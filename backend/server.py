import json
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.simulation_engine import run_simulation


MAX_REQUEST_BYTES = 1_000_000


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


class SimulationBackendHandler(BaseHTTPRequestHandler):
    endpoint = "/api/simulations/run"
    registry = ModuleRegistry.from_builtin_manifest()

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

    def do_POST(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        if self.path != self.endpoint:
            self._send_json(404, {"runId": run_id, "status": "error", "errorCode": "NOT_FOUND", "field": "path", "message": "not found"})
            return

        started = time.monotonic()
        try:
            payload = self._read_json()
            graph = compile_graph(payload, self.registry)
            result = run_simulation(graph, run_id=run_id)
            result["metrics"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
            self._send_json(200, result)
        except SimulationBackendError as exc:
            self._send_json(400, exc.to_response(run_id))
        except Exception as exc:
            self._send_json(500, {"runId": run_id, "status": "error", "errorCode": "INTERNAL_ERROR", "field": "server", "message": str(exc)})


def serve(host="127.0.0.1", port=8766):
    server = ThreadingHTTPServer((host, port), SimulationBackendHandler)
    print(f"Simulation backend listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
