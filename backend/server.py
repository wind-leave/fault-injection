import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.practice import PracticeSession
from backend.schemas import SimulationBackendError
from backend.simulation_engine import SimulationSession, run_simulation
from backend.troubleshooting import build_troubleshooting_plan


MAX_REQUEST_BYTES = 1_000_000
MAX_STEP_BATCH = 1000


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


class SimulationBackendHandler(BaseHTTPRequestHandler):
    endpoint = "/api/simulations/run"
    session_endpoint = "/api/simulations/session"
    practice_endpoint = "/api/practice/session"
    troubleshooting_plan_endpoint = "/api/troubleshooting/plan"
    registry = ModuleRegistry.from_builtin_manifest()
    sessions = {}
    sessions_lock = threading.Lock()
    practice_sessions = {}
    practice_sessions_lock = threading.Lock()
    max_active_simulation_sessions = 100
    max_active_practice_sessions = 100
    max_response_samples = 1000
    default_max_practice_actions = 200

    def log_message(self, format, *args):
        return

    def _send_json(self, status_code, payload):
        body = _json_bytes(payload)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise SimulationBackendError("INVALID_SCHEMA", "Content-Length", "invalid Content-Length") from exc
        if length <= 0:
            raise SimulationBackendError("INVALID_SCHEMA", "request", "request body is required")
        if length > MAX_REQUEST_BYTES:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "request", "request body is too large")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SimulationBackendError("INVALID_SCHEMA", "request", "invalid JSON") from exc
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "request", "top-level JSON object is required")
        return payload

    def _send_not_found(self, run_id=""):
        self._send_json(404, {"runId": run_id, "status": "error", "errorCode": "NOT_FOUND", "field": "path", "message": "not found"})

    def _send_session_not_found(self, run_id="", session_id=""):
        self._send_json(
            404,
            {
                "runId": run_id,
                "status": "error",
                "errorCode": "SESSION_NOT_FOUND",
                "field": "sessionId",
                "message": f"simulation session not found: {session_id}",
            },
        )

    def _send_practice_session_not_found(self, run_id="", session_id=""):
        self._send_json(
            404,
            {
                "runId": run_id,
                "status": "error",
                "errorCode": "SESSION_NOT_FOUND",
                "field": "sessionId",
                "message": f"practice session not found: {session_id}",
            },
        )

    def _send_practice_session_expired(self, run_id="", session_id=""):
        self._send_json(
            410,
            {
                "runId": run_id,
                "status": "error",
                "errorCode": "SESSION_EXPIRED",
                "field": "sessionId",
                "message": f"practice session expired: {session_id}",
            },
        )

    def _session_step_path(self, path):
        prefix = f"{self.session_endpoint}/"
        suffix = "/step"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return ""
        session_id = path[len(prefix):-len(suffix)]
        return session_id.strip("/")

    def _session_delete_path(self, path):
        prefix = f"{self.session_endpoint}/"
        if not path.startswith(prefix):
            return ""
        session_id = path[len(prefix):]
        return session_id.strip("/")

    def _practice_action_path(self, path):
        prefix = f"{self.practice_endpoint}/"
        suffix = "/action"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return ""
        session_id = path[len(prefix):-len(suffix)]
        return session_id.strip("/")

    def _practice_submit_path(self, path):
        prefix = f"{self.practice_endpoint}/"
        suffix = "/submit"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return ""
        session_id = path[len(prefix):-len(suffix)]
        return session_id.strip("/")

    def _practice_status_path(self, path):
        prefix = f"{self.practice_endpoint}/"
        suffix = "/status"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return ""
        session_id = path[len(prefix):-len(suffix)]
        return session_id.strip("/")

    def _practice_delete_path(self, path):
        prefix = f"{self.practice_endpoint}/"
        if not path.startswith(prefix):
            return ""
        session_id = path[len(prefix):].strip("/")
        if not session_id or "/" in session_id:
            return ""
        return session_id

    def _validate_steps(self, payload):
        steps = payload.get("steps", 1)
        if isinstance(steps, bool) or not isinstance(steps, int):
            raise SimulationBackendError("INVALID_SCHEMA", "steps", "steps must be an integer")
        if steps < 1 or steps > MAX_STEP_BATCH:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "steps", "steps is outside the allowed range")
        if steps > self.max_response_samples:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "steps", "steps exceeds the response sample limit")
        return steps

    def _build_troubleshooting_plan(self, run_id, started):
        payload = self._read_json()
        d_matrix = payload.get("dMatrix")
        target_fault_id = payload.get("targetFaultId")
        if not isinstance(target_fault_id, str) or not target_fault_id.strip():
            raise SimulationBackendError("INVALID_SCHEMA", "targetFaultId", "targetFaultId is required")
        max_steps = payload.get("maxSteps", 4)
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 1 <= max_steps <= 12:
            raise SimulationBackendError("INVALID_SCHEMA", "maxSteps", "maxSteps must be an integer from 1 to 12")
        plan = build_troubleshooting_plan(d_matrix, target_fault_id.strip(), max_steps=max_steps)
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "plan": plan,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _ensure_simulation_session_capacity(self):
        with self.sessions_lock:
            if len(self.sessions) >= self.max_active_simulation_sessions:
                raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "sessions", "too many active simulation sessions")

    def _ensure_practice_session_capacity(self):
        with self.practice_sessions_lock:
            if len(self.practice_sessions) >= self.max_active_practice_sessions:
                raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "practiceSessions", "too many active practice sessions")

    def _create_session(self, run_id, started):
        payload = self._read_json()
        graph = compile_graph(payload, self.registry)
        self._ensure_simulation_session_capacity()
        session_id = f"session-{uuid.uuid4().hex[:12]}"
        session = SimulationSession(graph, run_id=run_id)
        with self.sessions_lock:
            self.sessions[session_id] = session
        self._send_json(
            200,
            {
                "runId": run_id,
                "sessionId": session_id,
                "status": "success",
                "metrics": {
                    "sampleCount": 0,
                    "stepIndex": session.step_index,
                    "time": session.current_time,
                    "done": session.done,
                    "elapsedMs": round((time.monotonic() - started) * 1000, 3),
                },
                "warnings": [],
            },
        )

    def _step_session(self, run_id, session_id, started):
        payload = self._read_json()
        steps = self._validate_steps(payload)
        with self.sessions_lock:
            session = self.sessions.get(session_id)
            if session is not None:
                result = session.step(steps)
        if session is None:
            self._send_session_not_found(run_id, session_id)
            return
        result["sessionId"] = session_id
        result["metrics"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
        self._send_json(200, result)

    def _create_practice_session(self, run_id, started):
        payload = self._read_json()
        simulation_package = payload.get("simulationPackage")
        if not isinstance(simulation_package, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "simulationPackage", "simulationPackage must be an object")
        graph = compile_graph(simulation_package, self.registry)
        self._ensure_practice_session_capacity()
        self._ensure_simulation_session_capacity()
        practice_session_id = f"practice-{uuid.uuid4().hex[:12]}"
        simulation_session_id = f"session-{uuid.uuid4().hex[:12]}"
        simulation_session = SimulationSession(graph, run_id=run_id)
        session = PracticeSession(
            practice_session_id,
            simulation_session_id,
            simulation_session,
            payload.get("dMatrix"),
            payload.get("targetFaultId"),
            initial_point_states=payload.get("initialPointStates"),
            initial_recommended_path=payload.get("initialRecommendedPath"),
            key_nodes=payload.get("keyNodes"),
            scoring_rules=payload.get("scoringRules"),
            lifecycle=payload.get("lifecycle"),
            action_rules=payload.get("actionRules"),
            resource_limits=payload.get("resourceLimits"),
            default_max_actions=self.default_max_practice_actions,
        )
        with self.sessions_lock:
            self.sessions[simulation_session_id] = simulation_session
        with self.practice_sessions_lock:
            self.practice_sessions[practice_session_id] = session
        result = session.initial_response()
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _record_practice_action(self, run_id, session_id, started):
        payload = self._read_json()
        steps = self._validate_steps(payload)
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is not None and session.is_expired():
                session.close("expired")
                self.practice_sessions.pop(session_id, None)
                expired_session = session
                session = None
            else:
                expired_session = None
            if session is not None:
                result = session.record_action(payload, steps=steps)
        if expired_session is not None:
            with self.sessions_lock:
                self.sessions.pop(expired_session.simulation_session_id, None)
            self._send_practice_session_expired(run_id, session_id)
            return
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _submit_practice_session(self, run_id, session_id, started):
        payload = self._read_json()
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is not None and session.is_expired():
                session.close("expired")
                self.practice_sessions.pop(session_id, None)
                expired_session = session
                session = None
            else:
                expired_session = None
            if session is not None:
                result = session.submit(payload)
                self.practice_sessions.pop(session_id, None)
        if expired_session is not None:
            with self.sessions_lock:
                self.sessions.pop(expired_session.simulation_session_id, None)
            self._send_practice_session_expired(run_id, session_id)
            return
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with self.sessions_lock:
            self.sessions.pop(session.simulation_session_id, None)
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _practice_status(self, run_id, session_id, started):
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is not None and session.is_expired():
                session.close("expired")
                self.practice_sessions.pop(session_id, None)
                expired_session = session
                session = None
            else:
                expired_session = None
            if session is not None:
                result = session.status_response()
        if expired_session is not None:
            with self.sessions_lock:
                self.sessions.pop(expired_session.simulation_session_id, None)
            self._send_practice_session_expired(run_id, session_id)
            return
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _delete_practice_session(self, run_id, session_id, started):
        with self.practice_sessions_lock:
            session = self.practice_sessions.pop(session_id, None)
            if session is not None:
                lifecycle = session.close("abandoned")
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with self.sessions_lock:
            self.sessions.pop(session.simulation_session_id, None)
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "sessionId": session.practice_session_id,
                "practiceSessionId": session.practice_session_id,
                "simulationSessionId": session.simulation_session_id,
                "lifecycle": lifecycle,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def do_POST(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        path = urlparse(self.path).path
        session_id = self._session_step_path(path)
        practice_action_session_id = self._practice_action_path(path)
        practice_submit_session_id = self._practice_submit_path(path)
        if path != self.endpoint and path != self.session_endpoint and path != self.practice_endpoint and path != self.troubleshooting_plan_endpoint and not session_id and not practice_action_session_id and not practice_submit_session_id:
            self._send_not_found(run_id)
            return

        started = time.monotonic()
        try:
            if path == self.troubleshooting_plan_endpoint:
                self._build_troubleshooting_plan(run_id, started)
                return
            if path == self.practice_endpoint:
                self._create_practice_session(run_id, started)
                return
            if practice_action_session_id:
                self._record_practice_action(run_id, practice_action_session_id, started)
                return
            if practice_submit_session_id:
                self._submit_practice_session(run_id, practice_submit_session_id, started)
                return
            if path == self.session_endpoint:
                self._create_session(run_id, started)
                return
            if session_id:
                self._step_session(run_id, session_id, started)
                return
            payload = self._read_json()
            graph = compile_graph(payload, self.registry)
            result = run_simulation(graph, run_id=run_id)
            result["metrics"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
            self._send_json(200, result)
        except SimulationBackendError as exc:
            self._send_json(400, exc.to_response(run_id))
        except Exception as exc:
            self._send_json(500, {"runId": run_id, "status": "error", "errorCode": "INTERNAL_ERROR", "field": "server", "message": str(exc)})

    def do_GET(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        path = urlparse(self.path).path
        practice_status_session_id = self._practice_status_path(path)
        if not practice_status_session_id:
            self._send_not_found(run_id)
            return
        started = time.monotonic()
        try:
            self._practice_status(run_id, practice_status_session_id, started)
        except SimulationBackendError as exc:
            self._send_json(400, exc.to_response(run_id))
        except Exception as exc:
            self._send_json(500, {"runId": run_id, "status": "error", "errorCode": "INTERNAL_ERROR", "field": "server", "message": str(exc)})

    def do_DELETE(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        path = urlparse(self.path).path
        practice_session_id = self._practice_delete_path(path)
        if practice_session_id:
            started = time.monotonic()
            self._delete_practice_session(run_id, practice_session_id, started)
            return
        session_id = self._session_delete_path(path)
        if not session_id or session_id.endswith("/step"):
            self._send_not_found(run_id)
            return
        with self.sessions_lock:
            session = self.sessions.pop(session_id, None)
        if session is None:
            self._send_session_not_found(run_id, session_id)
            return
        self._send_json(200, {"runId": run_id, "sessionId": session_id, "status": "success"})


def serve(host="127.0.0.1", port=8766):
    server = ThreadingHTTPServer((host, port), SimulationBackendHandler)
    print(f"Simulation backend listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
