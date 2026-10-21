import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from backend.graph_compiler import compile_graph
from backend.component_registration import ComponentRegistrar
from backend.diagnostic_knowledge import build_multi_fault_troubleshooting_plan
from backend.module_registry import ModuleRegistry
from backend.practice import (
    PRACTICE_TYPE_TROUBLESHOOTING,
    PracticeSession,
    SequencePracticeSession,
    normalize_practice_type,
)
from backend.schemas import SimulationBackendError
from backend.simulation_engine import SimulationSession, run_simulation


MAX_REQUEST_BYTES = 1_000_000
MAX_STEP_BATCH = 100_000
SESSION_REAPER_INTERVAL_SECONDS = 30.0
INTERNAL_ERROR_MESSAGE = "internal server error; use runId to locate the server log"
DEFAULT_PRACTICE_RESULT_CALLBACK_URL = os.environ.get(
    "PRACTICE_RESULT_CALLBACK_URL",
    "http://127.0.0.1:9000/student/practice/result",
).strip()
PRACTICE_RESULT_CALLBACK_TIMEOUT_SECONDS = 3.0


logger = logging.getLogger(__name__)


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


def _practice_identity_field(payload, field, required=False):
    """Normalize an external practice-task identifier.

    Inspection and power-on self-test tasks require both identifiers; troubleshooting keeps them
    optional for existing clients. Supplied values are retained until submit.
    """
    if field not in payload:
        if required:
            raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be a non-empty string or number")
        return ""
    value = payload.get(field)
    if value is None or isinstance(value, bool):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be a non-empty string or number")
    normalized = str(value).strip()
    if not normalized:
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be a non-empty string or number")
    return normalized


class SimulationBackendHandler(BaseHTTPRequestHandler):
    endpoint = "/api/simulations/run"
    session_endpoint = "/api/simulations/session"
    practice_endpoint = "/api/practice/session"
    troubleshooting_plan_endpoint = "/api/troubleshooting/plan"
    component_registration_endpoint = "/api/components/register"
    component_batch_delete_endpoint = "/api/components/batch-delete"
    component_endpoint = "/api/components"
    component_registrar = ComponentRegistrar.for_persistent_storage()
    registry = ModuleRegistry.from_manifests([
        ModuleRegistry.builtin_manifest_path(),
        component_registrar.manifest_path,
    ])
    sessions = {}
    state_lock = threading.RLock()
    sessions_lock = state_lock
    practice_sessions = {}
    practice_sessions_lock = state_lock
    _session_reservation = object()
    max_active_simulation_sessions = 100
    max_active_practice_sessions = 100
    max_response_samples = 100_000
    default_max_practice_actions = 200
    default_simulation_session_idle_timeout_seconds = 900.0
    practice_result_callback_url = DEFAULT_PRACTICE_RESULT_CALLBACK_URL

    def log_message(self, format, *args):
        return

    def _load_component_registry(self):
        """Reload both shipped modules and the persistent custom component catalog."""
        return ModuleRegistry.from_manifests([
            ModuleRegistry.builtin_manifest_path(),
            self.component_registrar.manifest_path,
        ])

    def _send_json(self, status_code, payload):
        body = _json_bytes(payload)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _external_practice_identity(value):
        text = str(value or "").strip()
        return int(text) if text.isdigit() else text

    def _publish_practice_result(self, session, result):
        callback_url = str(type(self).practice_result_callback_url or "").strip()
        if not callback_url:
            return {"status": "skipped", "reason": "callback-not-configured"}
        parsed = urlparse(callback_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            logger.warning("invalid practice result callback URL: %s", callback_url)
            return {"status": "failed", "url": callback_url, "reason": "invalid-callback-url"}
        evaluation_report = dict(result.get("evaluationReport") or {})
        if getattr(session, "is_sequence_practice", False):
            evaluation_report = {
                "totalScore": result["totalScore"],
                "submittedAt": datetime.fromtimestamp(session.submitted_at, tz=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "totalDurationSeconds": round(max(0.0, session.submitted_at - session.created_at)),
            }
        evaluation_report.pop("studentId", None)
        evaluation_report.pop("jobId", None)
        payload = {
            "studentId": self._external_practice_identity(session.studentid),
            "jobId": self._external_practice_identity(session.jobid),
            "evaluationReport": evaluation_report,
        }
        request = Request(
            callback_url,
            data=_json_bytes(payload),
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=PRACTICE_RESULT_CALLBACK_TIMEOUT_SECONDS) as response:
                status_code = int(getattr(response, "status", response.getcode()))
                response.read()
            if 200 <= status_code < 300:
                return {"status": "delivered", "url": callback_url, "httpStatus": status_code}
            return {"status": "failed", "url": callback_url, "httpStatus": status_code}
        except Exception as exc:
            logger.warning("failed to publish practice result to %s: %s", callback_url, exc)
            return {"status": "failed", "url": callback_url, "reason": type(exc).__name__}

    @staticmethod
    def _new_id(prefix, store=None):
        while True:
            candidate = f"{prefix}-{uuid.uuid4().hex}"
            if store is None or candidate not in store:
                return candidate

    @classmethod
    def purge_expired_sessions(cls, now=None):
        """Remove expired practice sessions and idle standalone sessions."""
        checked_at = time.time() if now is None else float(now)
        removed_practice = 0
        removed_simulation = 0

        with cls.state_lock:
            practice_candidates = [
                (session_id, session)
                for session_id, session in cls.practice_sessions.items()
                if session is not cls._session_reservation
            ]

        for session_id, session in practice_candidates:
            with session.lock:
                with cls.state_lock:
                    if cls.practice_sessions.get(session_id) is not session:
                        continue
                    if not session.is_expired(now=checked_at):
                        continue
                    session.close("expired", now=checked_at)
                    cls.practice_sessions.pop(session_id, None)
                    if cls.sessions.pop(session.simulation_session_id, None) is not None:
                        removed_simulation += 1
                    removed_practice += 1

        with cls.state_lock:
            bound_simulation_ids = {
                session.simulation_session_id
                for session in cls.practice_sessions.values()
                if session is not cls._session_reservation
            }
            simulation_candidates = [
                (session_id, session)
                for session_id, session in cls.sessions.items()
                if session is not cls._session_reservation
                and session_id not in bound_simulation_ids
            ]

        for session_id, session in simulation_candidates:
            with session.lock:
                with cls.state_lock:
                    if cls.sessions.get(session_id) is not session:
                        continue
                    if not session.is_expired(now=checked_at):
                        continue
                    cls.sessions.pop(session_id, None)
                    removed_simulation += 1

        return {
            "practiceSessions": removed_practice,
            "simulationSessions": removed_simulation,
        }

    def _send_backend_error(self, run_id, exc):
        status_code = {
            "OPERATION_ID_CONFLICT": 409,
            "COMPONENT_ALREADY_REGISTERED": 409,
            "UNAUTHORIZED": 403,
        }.get(exc.error_code, 400)
        self._send_json(status_code, exc.to_response(run_id))

    def _send_internal_error(self, run_id):
        logger.exception(
            "unhandled backend exception runId=%s method=%s path=%s",
            run_id,
            self.command,
            urlparse(self.path).path,
        )
        try:
            self._send_json(
                500,
                {
                    "runId": run_id,
                    "status": "error",
                    "errorCode": "INTERNAL_ERROR",
                    "field": "server",
                    "message": INTERNAL_ERROR_MESSAGE,
                },
            )
        except (BrokenPipeError, ConnectionResetError):
            logger.warning("client disconnected before error response runId=%s", run_id)

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

    def _component_delete_path(self, path):
        prefix = f"{self.component_endpoint}/"
        if not path.startswith(prefix):
            return ""
        module_id = path[len(prefix):].strip("/")
        return module_id if module_id and "/" not in module_id else ""

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
        target_fault_ids = payload.get("targetFaultIds")
        if target_fault_ids is not None:
            if not isinstance(target_fault_ids, list) or not target_fault_ids:
                raise SimulationBackendError("INVALID_SCHEMA", "targetFaultIds", "targetFaultIds must be a non-empty array")
        elif not isinstance(target_fault_id, str) or not target_fault_id.strip():
            raise SimulationBackendError("INVALID_SCHEMA", "targetFaultId", "targetFaultId or targetFaultIds is required")
        max_steps = payload.get("maxSteps", 4)
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 1 <= max_steps <= 12:
            raise SimulationBackendError("INVALID_SCHEMA", "maxSteps", "maxSteps must be an integer from 1 to 12")
        normalized_target_fault_ids = target_fault_ids if target_fault_ids is not None else [target_fault_id.strip()]
        plan = build_multi_fault_troubleshooting_plan(
            d_matrix,
            normalized_target_fault_ids,
            observations=payload.get("observations"),
            max_faults=len((d_matrix or {}).get("rows") or []),
            max_steps=max_steps,
            model_graph=payload.get("modelGraph"),
        )
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "plan": plan,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _register_component(self, run_id, started):
        # Registration installs executable source.  Keep the endpoint local by
        # default; a deployed service can opt into a bearer-like shared token.
        required_token = os.environ.get("GZ_COMPONENT_REGISTRATION_TOKEN", "")
        client_host = self.client_address[0]
        if required_token:
            if self.headers.get("X-GZ-Component-Registration-Token", "") != required_token:
                raise SimulationBackendError("UNAUTHORIZED", "X-GZ-Component-Registration-Token", "invalid component registration token")
        elif client_host not in {"127.0.0.1", "::1"}:
            raise SimulationBackendError("UNAUTHORIZED", "client", "component registration is limited to localhost")
        component = self.component_registrar.register(self._read_json())
        type(self).registry = self._load_component_registry()
        self._send_json(
            201,
            {
                "runId": run_id,
                "status": "success",
                "component": component,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _delete_component(self, run_id, module_id, started):
        required_token = os.environ.get("GZ_COMPONENT_REGISTRATION_TOKEN", "")
        client_host = self.client_address[0]
        if required_token:
            if self.headers.get("X-GZ-Component-Registration-Token", "") != required_token:
                raise SimulationBackendError("UNAUTHORIZED", "X-GZ-Component-Registration-Token", "invalid component registration token")
        elif client_host not in {"127.0.0.1", "::1"}:
            raise SimulationBackendError("UNAUTHORIZED", "client", "component registration is limited to localhost")
        component = self.component_registrar.unregister(module_id)
        type(self).registry = self._load_component_registry()
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "component": component,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _update_component(self, run_id, module_id, started):
        required_token = os.environ.get("GZ_COMPONENT_REGISTRATION_TOKEN", "")
        client_host = self.client_address[0]
        if required_token:
            if self.headers.get("X-GZ-Component-Registration-Token", "") != required_token:
                raise SimulationBackendError("UNAUTHORIZED", "X-GZ-Component-Registration-Token", "invalid component registration token")
        elif client_host not in {"127.0.0.1", "::1"}:
            raise SimulationBackendError("UNAUTHORIZED", "client", "component registration is limited to localhost")
        component = self.component_registrar.update(module_id, self._read_json())
        type(self).registry = self._load_component_registry()
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "component": component,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _delete_components(self, run_id, started):
        required_token = os.environ.get("GZ_COMPONENT_REGISTRATION_TOKEN", "")
        client_host = self.client_address[0]
        if required_token:
            if self.headers.get("X-GZ-Component-Registration-Token", "") != required_token:
                raise SimulationBackendError("UNAUTHORIZED", "X-GZ-Component-Registration-Token", "invalid component registration token")
        elif client_host not in {"127.0.0.1", "::1"}:
            raise SimulationBackendError("UNAUTHORIZED", "client", "component registration is limited to localhost")
        payload = self._read_json()
        components = self.component_registrar.unregister_many(payload.get("moduleIds"))
        type(self).registry = self._load_component_registry()
        self._send_json(
            200,
            {
                "runId": run_id,
                "status": "success",
                "components": components,
                "metrics": {"elapsedMs": round((time.monotonic() - started) * 1000, 3)},
            },
        )

    def _create_session(self, run_id, started):
        payload = self._read_json()
        graph = compile_graph(payload, self.registry)
        type(self).purge_expired_sessions()
        with self.sessions_lock:
            if len(self.sessions) >= self.max_active_simulation_sessions:
                raise SimulationBackendError(
                    "SIMULATION_LIMIT_EXCEEDED",
                    "sessions",
                    "too many active simulation sessions",
                )
            session_id = self._new_id("session", self.sessions)
            session = SimulationSession(
                graph,
                run_id=run_id,
                idle_timeout_seconds=self.default_simulation_session_idle_timeout_seconds,
            )
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
        actual_only = payload.get("actualOnly", False)
        if not isinstance(actual_only, bool):
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "actualOnly",
                "actualOnly must be a boolean",
            )
        with self.sessions_lock:
            session = self.sessions.get(session_id)
            if session is self._session_reservation:
                session = None
        if session is None:
            self._send_session_not_found(run_id, session_id)
            return
        with session.lock:
            with self.sessions_lock:
                if self.sessions.get(session_id) is not session:
                    self._send_session_not_found(run_id, session_id)
                    return
            result = session.step(
                steps,
                paths=("actual",) if actual_only else ("actual", "reference"),
            )
        result["sessionId"] = session_id
        result["metrics"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
        self._send_json(200, result)

    def _create_practice_session(self, run_id, started):
        payload = self._read_json()
        practice_type = normalize_practice_type(payload.get("practiceType"))
        requires_identity = practice_type != PRACTICE_TYPE_TROUBLESHOOTING
        studentid = _practice_identity_field(payload, "studentid", required=requires_identity)
        jobid = _practice_identity_field(payload, "jobid", required=requires_identity)
        if practice_type != PRACTICE_TYPE_TROUBLESHOOTING:
            type(self).purge_expired_sessions()
            with self.state_lock:
                if len(self.practice_sessions) >= self.max_active_practice_sessions:
                    raise SimulationBackendError(
                        "SIMULATION_LIMIT_EXCEEDED",
                        "practiceSessions",
                        "too many active practice sessions",
                    )
                practice_session_id = self._new_id("practice", self.practice_sessions)
                self.practice_sessions[practice_session_id] = self._session_reservation
            try:
                session = SequencePracticeSession(
                    practice_session_id,
                    practice_type,
                    lifecycle=payload.get("lifecycle"),
                    resource_limits=payload.get("resourceLimits"),
                    default_max_actions=self.default_max_practice_actions,
                    studentid=studentid,
                    jobid=jobid,
                )
                result = session.initial_response()
            except Exception:
                with self.state_lock:
                    if self.practice_sessions.get(practice_session_id) is self._session_reservation:
                        self.practice_sessions.pop(practice_session_id, None)
                raise
            with self.state_lock:
                self.practice_sessions[practice_session_id] = session
            self._send_json(200, result)
            return
        simulation_package = payload.get("simulationPackage")
        if not isinstance(simulation_package, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "simulationPackage", "simulationPackage must be an object")
        graph = compile_graph(simulation_package, self.registry)
        type(self).purge_expired_sessions()
        with self.state_lock:
            if len(self.practice_sessions) >= self.max_active_practice_sessions:
                raise SimulationBackendError(
                    "SIMULATION_LIMIT_EXCEEDED",
                    "practiceSessions",
                    "too many active practice sessions",
                )
            if len(self.sessions) >= self.max_active_simulation_sessions:
                raise SimulationBackendError(
                    "SIMULATION_LIMIT_EXCEEDED",
                    "sessions",
                    "too many active simulation sessions",
                )
            practice_session_id = self._new_id("practice", self.practice_sessions)
            simulation_session_id = self._new_id("session", self.sessions)
            self.practice_sessions[practice_session_id] = self._session_reservation
            self.sessions[simulation_session_id] = self._session_reservation
        target_fault_ids = payload.get("targetFaultIds")
        target_fault_id = payload.get("targetFaultId")
        try:
            if target_fault_ids is not None:
                if not isinstance(target_fault_ids, list) or not target_fault_ids:
                    raise SimulationBackendError(
                        "INVALID_SCHEMA",
                        "targetFaultIds",
                        "targetFaultIds must be a non-empty array",
                    )
                if not target_fault_id:
                    target_fault_id = target_fault_ids[0]
            simulation_session = SimulationSession(graph, run_id=run_id)
            session = PracticeSession(
                practice_session_id,
                simulation_session_id,
                simulation_session,
                payload.get("dMatrix"),
                target_fault_id,
                target_fault_ids=target_fault_ids,
                initial_point_states=payload.get("initialPointStates"),
                initial_recommended_path=payload.get("initialRecommendedPath"),
                scoring_rules=payload.get("scoringRules"),
                lifecycle=payload.get("lifecycle"),
                action_rules=payload.get("actionRules"),
                resource_limits=payload.get("resourceLimits"),
                display_console_controls=payload.get("displayConsoleControls"),
                connection_bindings=(
                    payload.get("connectionBindings")
                    or simulation_package.get("connectionBindings")
                ),
                diagnostic_conditions=payload.get("diagnosticConditions"),
                model_graph=simulation_package,
                default_max_actions=self.default_max_practice_actions,
                studentid=studentid,
                jobid=jobid,
            )
            result = session.initial_response()
        except Exception:
            with self.state_lock:
                if self.practice_sessions.get(practice_session_id) is self._session_reservation:
                    self.practice_sessions.pop(practice_session_id, None)
                if self.sessions.get(simulation_session_id) is self._session_reservation:
                    self.sessions.pop(simulation_session_id, None)
            raise
        with self.state_lock:
            self.sessions[simulation_session_id] = simulation_session
            self.practice_sessions[practice_session_id] = session
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _record_practice_action(self, run_id, session_id, started):
        payload = self._read_json()
        steps = self._validate_steps(payload)
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is self._session_reservation:
                session = None
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with session.lock:
            with self.state_lock:
                if self.practice_sessions.get(session_id) is not session:
                    self._send_practice_session_not_found(run_id, session_id)
                    return
                if session.is_expired():
                    session.close("expired")
                    self.practice_sessions.pop(session_id, None)
                    self.sessions.pop(session.simulation_session_id, None)
                    expired = True
                else:
                    expired = False
            if not expired:
                result = session.record_action(payload, steps=steps)
        if expired:
            self._send_practice_session_expired(run_id, session_id)
            return
        if not getattr(session, "is_sequence_practice", False):
            result["runId"] = run_id
            result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _submit_practice_session(self, run_id, session_id, started):
        payload = self._read_json()
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is self._session_reservation:
                session = None
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with session.lock:
            with self.state_lock:
                if self.practice_sessions.get(session_id) is not session:
                    self._send_practice_session_not_found(run_id, session_id)
                    return
                if session.is_expired():
                    session.close("expired")
                    self.practice_sessions.pop(session_id, None)
                    self.sessions.pop(session.simulation_session_id, None)
                    expired = True
                else:
                    expired = False
            if not expired:
                result = session.submit(payload)
                with self.state_lock:
                    if self.practice_sessions.get(session_id) is session:
                        self.practice_sessions.pop(session_id, None)
                        self.sessions.pop(session.simulation_session_id, None)
        if expired:
            self._send_practice_session_expired(run_id, session_id)
            return
        result["resultDelivery"] = self._publish_practice_result(session, result)
        self._send_json(200, result)

    def _practice_status(self, run_id, session_id, started):
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is self._session_reservation:
                session = None
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with session.lock:
            with self.state_lock:
                if self.practice_sessions.get(session_id) is not session:
                    self._send_practice_session_not_found(run_id, session_id)
                    return
                if session.is_expired():
                    session.close("expired")
                    self.practice_sessions.pop(session_id, None)
                    self.sessions.pop(session.simulation_session_id, None)
                    expired = True
                else:
                    expired = False
            if not expired:
                result = session.status_response()
        if expired:
            self._send_practice_session_expired(run_id, session_id)
            return
        result["runId"] = run_id
        result["metrics"] = {"elapsedMs": round((time.monotonic() - started) * 1000, 3)}
        self._send_json(200, result)

    def _delete_practice_session(self, run_id, session_id, started):
        with self.practice_sessions_lock:
            session = self.practice_sessions.get(session_id)
            if session is self._session_reservation:
                session = None
        if session is None:
            self._send_practice_session_not_found(run_id, session_id)
            return
        with session.lock:
            with self.state_lock:
                if self.practice_sessions.get(session_id) is not session:
                    self._send_practice_session_not_found(run_id, session_id)
                    return
                lifecycle = session.close("abandoned")
                self.practice_sessions.pop(session_id, None)
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
        run_id = self._new_id("run")
        path = urlparse(self.path).path
        session_id = self._session_step_path(path)
        practice_action_session_id = self._practice_action_path(path)
        practice_submit_session_id = self._practice_submit_path(path)
        if path != self.endpoint and path != self.session_endpoint and path != self.practice_endpoint and path != self.troubleshooting_plan_endpoint and path != self.component_registration_endpoint and path != self.component_batch_delete_endpoint and not session_id and not practice_action_session_id and not practice_submit_session_id:
            self._send_not_found(run_id)
            return

        started = time.monotonic()
        try:
            if path == self.troubleshooting_plan_endpoint:
                self._build_troubleshooting_plan(run_id, started)
                return
            if path == self.component_registration_endpoint:
                self._register_component(run_id, started)
                return
            if path == self.component_batch_delete_endpoint:
                self._delete_components(run_id, started)
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
            self._send_backend_error(run_id, exc)
        except Exception:
            self._send_internal_error(run_id)

    def do_GET(self):
        run_id = self._new_id("run")
        path = urlparse(self.path).path
        practice_status_session_id = self._practice_status_path(path)
        if not practice_status_session_id:
            self._send_not_found(run_id)
            return
        started = time.monotonic()
        try:
            self._practice_status(run_id, practice_status_session_id, started)
        except SimulationBackendError as exc:
            self._send_backend_error(run_id, exc)
        except Exception:
            self._send_internal_error(run_id)

    def do_PUT(self):
        run_id = self._new_id("run")
        module_id = self._component_delete_path(urlparse(self.path).path)
        if not module_id:
            self._send_not_found(run_id)
            return
        started = time.monotonic()
        try:
            self._update_component(run_id, module_id, started)
        except SimulationBackendError as exc:
            self._send_backend_error(run_id, exc)
        except Exception:
            self._send_internal_error(run_id)

    def do_DELETE(self):
        run_id = self._new_id("run")
        path = urlparse(self.path).path
        started = time.monotonic()
        try:
            component_module_id = self._component_delete_path(path)
            if component_module_id:
                self._delete_component(run_id, component_module_id, started)
                return
            practice_session_id = self._practice_delete_path(path)
            if practice_session_id:
                self._delete_practice_session(run_id, practice_session_id, started)
                return
            session_id = self._session_delete_path(path)
            if not session_id or session_id.endswith("/step"):
                self._send_not_found(run_id)
                return
            with self.sessions_lock:
                session = self.sessions.get(session_id)
                if session is self._session_reservation:
                    session = None
            if session is None:
                self._send_session_not_found(run_id, session_id)
                return
            with session.lock:
                with self.sessions_lock:
                    if self.sessions.get(session_id) is not session:
                        self._send_session_not_found(run_id, session_id)
                        return
                    self.sessions.pop(session_id, None)
            self._send_json(200, {"runId": run_id, "sessionId": session_id, "status": "success"})
        except SimulationBackendError as exc:
            self._send_backend_error(run_id, exc)
        except Exception:
            self._send_internal_error(run_id)


class _SessionReaper:
    def __init__(self, handler_class, interval_seconds=SESSION_REAPER_INTERVAL_SECONDS):
        self.handler_class = handler_class
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="simulation-session-reaper", daemon=True)

    def _run(self):
        while not self.stop_event.wait(self.interval_seconds):
            try:
                removed = self.handler_class.purge_expired_sessions()
                if removed["practiceSessions"] or removed["simulationSessions"]:
                    logger.info("purged expired sessions: %s", removed)
            except Exception:
                logger.exception("failed to purge expired simulation sessions")

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=max(1.0, self.interval_seconds + 1.0))


def serve(host="127.0.0.1", port=8766):
    server = ThreadingHTTPServer((host, port), SimulationBackendHandler)
    reaper = _SessionReaper(SimulationBackendHandler)
    reaper.start()
    print(f"Simulation backend listening on http://{host}:{port}")
    try:
        server.serve_forever()
    finally:
        reaper.stop()
        server.server_close()


if __name__ == "__main__":
    serve()
