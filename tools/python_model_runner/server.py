import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from tools.python_model_runner.runtime import DEFAULT_TIMEOUT_SECONDS, execute_payload_isolated

TRUSTED_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


def _is_trusted_local_origin(origin):
    if not origin:
        return True

    try:
        parsed = urlparse(origin)
    except ValueError:
        return False

    return parsed.scheme in {"http", "https"} and parsed.hostname in TRUSTED_LOCAL_HOSTS


def _encode_json(payload):
    return json.dumps(payload, allow_nan=False).encode("utf-8")


def _reject_non_finite_json_constant(value):
    raise ValueError(f"invalid JSON: non-finite numeric token {value!r} is not allowed")


def _decode_request_json(raw_body):
    if raw_body == b"":
        raise ValueError("invalid JSON: request body is required")

    try:
        payload = json.loads(
            raw_body.decode("utf-8"),
            parse_constant=_reject_non_finite_json_constant,
        )
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise ValueError(f"invalid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValueError("invalid JSON: top-level JSON object is required")

    return payload


class PythonModelRunnerHandler(BaseHTTPRequestHandler):
    endpoint = "/api/python-flow/execute"
    execution_timeout_seconds = DEFAULT_TIMEOUT_SECONDS

    def log_message(self, format, *args):  # pragma: no cover - suppress noisy test logging
        return

    def _send_json(self, status_code, payload, origin=None):
        body = _encode_json(payload)
        self.send_response(status_code)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_request_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            raise ValueError("invalid Content-Length header")
        if content_length < 0:
            raise ValueError("invalid Content-Length header")
        if content_length > 0:
            return self.rfile.read(content_length)
        return b""

    def _discard_request_body(self):
        try:
            self._read_request_body()
        except ValueError:
            return

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if not _is_trusted_local_origin(origin):
            self._send_json(403, {"error": "origin not allowed"})
            return

        self._send_json(200, {}, origin=origin)

    def do_POST(self):
        if self.path != self.endpoint:
            self._send_json(404, {"error": "not found"})
            return

        origin = self.headers.get("Origin")
        if not _is_trusted_local_origin(origin):
            self._discard_request_body()
            self._send_json(403, {"error": "origin not allowed"})
            return

        try:
            raw_body = self._read_request_body()
            payload = _decode_request_json(raw_body)
            result = execute_payload_isolated(
                payload,
                timeout_seconds=self.execution_timeout_seconds,
            )
        except Exception as exc:  # pragma: no cover - minimal stdlib server wrapper
            self._send_json(400, {"error": str(exc)}, origin=origin if _is_trusted_local_origin(origin) and origin else None)
            return

        self._send_json(200, result, origin=origin)


def serve(host="127.0.0.1", port=8765):
    server = ThreadingHTTPServer((host, port), PythonModelRunnerHandler)
    print(f"Python model runner listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
