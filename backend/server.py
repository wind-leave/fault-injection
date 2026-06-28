import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.simulation_engine import SimulationSession, run_simulation
from backend.troubleshooting import TroubleshootingSession


MAX_REQUEST_BYTES = 1_000_000
MAX_STEP_BATCH = 1000


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


class SimulationBackendHandler(BaseHTTPRequestHandler):
    endpoint = "/api/simulations/run"
    session_endpoint = "/api/simulations/session"
    practice_troubleshooting_endpoint = "/api/practice/troubleshooting/session"
    registry = ModuleRegistry.from_builtin_manifest()
    sessions = {}
    sessions_lock = threading.Lock()
    practice_sessions = {}
    practice_sessions_lock = threading.Lock()

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

    def _practice_operation_path(self, path):
        prefix = f"{self.practice_troubleshooting_endpoint}/"
        suffix = "/operation"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return ""
        session_id = path[len(prefix):-len(suffix)]
        return session_id.strip("/")

    def _validate_steps(self, payload):
        steps = payload.get("steps", 1)
        if isinstance(steps, bool) or not isinstance(steps, int):
            raise SimulationBackendError("INVALID_SCHEMA", "steps", "steps must be an integer")
        if steps < 1 or steps > MAX_STEP_BATCH:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "steps", "steps is outside the allowed range")
        return steps

    def _create_session(self, run_id, started):
        payload = self._read_json()
        graph = compile_graph(payload, self.registry)
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

    def _create_practice_troubleshooting_session(self, run_id, started):
        payload = self._read_json()
        session_id = f"practice-{uuid.uuid4().hex[:12]}"
        session = TroubleshootingSession(payload.get("dMatrix"), payload.get("targetFaultId"))
        with self.practice_sessions_lock:
            self.practice_sessions[session_id] = session
        result = session.initial_response()
        result["runId"] = run_id
        result["sessionId"] = session_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _record_practice_troubleshooting_operation(self, run_id, session_id, started):
        payload = self._read_json()
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is not None:
                result = session.record_operation(payload)
        if session is None:
            self._send_session_not_found(run_id, session_id)
            return
        result["runId"] = run_id
        result["sessionId"] = session_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def do_POST(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        path = urlparse(self.path).path
        session_id = self._session_step_path(path)
        practice_session_id = self._practice_operation_path(path)
        if path != self.endpoint and path != self.session_endpoint and path != self.practice_troubleshooting_endpoint and not session_id and not practice_session_id:
            self._send_not_found(run_id)
            return

        started = time.monotonic()
        try:
            if path == self.practice_troubleshooting_endpoint:
                self._create_practice_troubleshooting_session(run_id, started)
                return
            if practice_session_id:
                self._record_practice_troubleshooting_operation(run_id, practice_session_id, started)
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

    def do_DELETE(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        path = urlparse(self.path).path
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
