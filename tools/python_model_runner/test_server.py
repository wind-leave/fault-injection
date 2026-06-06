import json
import socket
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from tools.python_model_runner.server import PythonModelRunnerHandler


class PythonModelRunnerServerTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), PythonModelRunnerHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    def _request(self, method, path, payload=None, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        request_body = body
        if request_body is None and payload is not None:
            request_body = json.dumps(payload)
        request_headers = dict(headers or {})
        if request_body is not None:
            request_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=request_body, headers=request_headers)
        response = connection.getresponse()
        response_body = response.read().decode("utf-8")
        connection.close()
        return response, response_body

    def test_allows_local_origin_with_explicit_cors_header(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            payload={
                "entryFunction": "process",
                "inputs": {"error": 0.5},
                "outputNames": ["output_0"],
                "middleVarNames": [],
                "source": "def process(error):\n    return error\n",
            },
            headers={"Origin": "http://127.0.0.1:5173"},
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(
            response.getheader("Access-Control-Allow-Origin"),
            "http://127.0.0.1:5173",
        )
        self.assertEqual(json.loads(response_body)["outputs"]["output_0"], 0.5)

    def test_allows_requests_without_origin_header(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            payload={
                "entryFunction": "process",
                "inputs": {"error": 0.5},
                "outputNames": ["output_0"],
                "middleVarNames": [],
                "source": "def process(error):\n    return error\n",
            },
        )

        self.assertEqual(response.status, 200)
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))
        self.assertEqual(json.loads(response_body)["outputs"]["output_0"], 0.5)

    def test_rejects_non_local_origin(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            payload={
                "entryFunction": "process",
                "inputs": {"error": 0.5},
                "outputNames": ["output_0"],
                "middleVarNames": [],
                "source": "def process(error):\n    return error\n",
            },
            headers={"Origin": "https://evil.example"},
        )

        self.assertEqual(response.status, 403)
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))
        self.assertEqual(json.loads(response_body)["error"], "origin not allowed")

    def test_rejects_non_local_origin_with_malformed_content_length(self):
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=5) as client:
            client.sendall(
                (
                    "POST /api/python-flow/execute HTTP/1.1\r\n"
                    "Host: 127.0.0.1\r\n"
                    "Origin: https://evil.example\r\n"
                    "Content-Type: application/json\r\n"
                    "Content-Length: abc\r\n"
                    "\r\n"
                    "{}"
                ).encode("ascii")
            )
            chunks = []
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
            response = b"".join(chunks).decode("utf-8")

        self.assertIn("403", response)
        self.assertIn('{"error": "origin not allowed"}', response)

    def test_returns_structured_error_for_non_finite_response_values(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            payload={
                "entryFunction": "process",
                "inputs": {},
                "outputNames": ["output_0"],
                "middleVarNames": [],
                "source": "def process():\n    return float('nan')\n",
            },
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status, 400)
        self.assertNotIn("NaN", response_body)
        self.assertIn("non-finite", json.loads(response_body)["error"])

    def test_rejects_non_finite_tokens_in_request_json(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            body=(
                '{"entryFunction":"process","inputs":{"error":NaN},'
                '"outputNames":["output_0"],"middleVarNames":[],'
                '"source":"def process(error):\\n    return error\\n"}'
            ),
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status, 400)
        self.assertIn("invalid JSON", json.loads(response_body)["error"])

    def test_rejects_non_object_request_json(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            body='["not-an-object"]',
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status, 400)
        self.assertIn("top-level JSON object", json.loads(response_body)["error"])

    def test_rejects_empty_request_body(self):
        response, response_body = self._request(
            "POST",
            "/api/python-flow/execute",
            body="",
            headers={"Origin": "http://localhost:5173"},
        )

        self.assertEqual(response.status, 400)
        self.assertIn("invalid JSON", json.loads(response_body)["error"])

    def test_rejects_negative_content_length(self):
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=5) as client:
            client.sendall(
                (
                    "POST /api/python-flow/execute HTTP/1.1\r\n"
                    "Host: 127.0.0.1\r\n"
                    "Origin: http://localhost:5173\r\n"
                    "Content-Type: application/json\r\n"
                    "Content-Length: -5\r\n"
                    "\r\n"
                ).encode("ascii")
            )
            chunks = []
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
            response = b"".join(chunks).decode("utf-8")

        self.assertIn("400", response)
        self.assertIn("invalid Content-Length", response)


if __name__ == "__main__":
    unittest.main()
