import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from backend.server import SimulationBackendHandler
from backend.tests.fixtures import valid_package


class SimulationBackendServerTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), SimulationBackendHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    def _post(self, path, payload):
        body = json.dumps(payload)
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", path, body=body, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        response_body = response.read().decode("utf-8")
        connection.close()
        return response.status, json.loads(response_body)

    def test_runs_valid_simulation_request(self):
        status, body = self._post("/api/simulations/run", valid_package())

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertIn("scope-1.ch1.actual", body["curves"]["channels"])

    def test_returns_structured_error_for_unknown_module(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"]["moduleId"] = "unknown"

        status, body = self._post("/api/simulations/run", package)

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "MODULE_NOT_WHITELISTED")

    def test_returns_404_for_unknown_path(self):
        status, body = self._post("/api/nope", valid_package())

        self.assertEqual(status, 404)
        self.assertEqual(body["errorCode"], "NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
