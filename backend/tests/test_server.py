import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from backend.server import SimulationBackendHandler
from backend.tests.fixtures import valid_package
from backend.tests.test_troubleshooting import sample_d_matrix


class SimulationBackendServerTests(unittest.TestCase):
    def setUp(self):
        SimulationBackendHandler.sessions = {}
        SimulationBackendHandler.practice_sessions = {}
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

    def _delete(self, path):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("DELETE", path)
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

    def test_steps_simulation_session(self):
        status, created = self._post("/api/simulations/session", valid_package())

        self.assertEqual(status, 200)
        self.assertEqual(created["status"], "success")
        session_id = created["sessionId"]

        status, first = self._post(f"/api/simulations/session/{session_id}/step", {})
        self.assertEqual(status, 200)
        self.assertEqual(first["sessionId"], session_id)
        self.assertEqual(first["curves"]["time"], [0.0])
        self.assertFalse(first["metrics"]["done"])

        status, second = self._post(f"/api/simulations/session/{session_id}/step", {"steps": 2})
        self.assertEqual(status, 200)
        self.assertEqual(second["curves"]["time"], [0.1, 0.2])
        self.assertTrue(second["metrics"]["done"])

    def test_returns_404_for_unknown_session(self):
        status, body = self._post("/api/simulations/session/missing/step", {})

        self.assertEqual(status, 404)
        self.assertEqual(body["errorCode"], "SESSION_NOT_FOUND")

    def test_deletes_simulation_session(self):
        _, created = self._post("/api/simulations/session", valid_package())
        session_id = created["sessionId"]

        status, body = self._delete(f"/api/simulations/session/{session_id}")

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        status, missing = self._post(f"/api/simulations/session/{session_id}/step", {})
        self.assertEqual(status, 404)
        self.assertEqual(missing["errorCode"], "SESSION_NOT_FOUND")

    def test_updates_practice_troubleshooting_session_from_student_operation(self):
        status, created = self._post(
            "/api/practice/troubleshooting/session",
            {"dMatrix": sample_d_matrix(), "targetFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(created["status"], "success")
        self.assertEqual(created["currentPath"]["faultId"], "target-fault")
        self.assertEqual(created["nextRecommendedStep"]["pointCode"], "M1")
        session_id = created["sessionId"]

        status, updated = self._post(
            f"/api/practice/troubleshooting/session/{session_id}/operation",
            {
                "operationId": "op-1",
                "actionType": "measure",
                "pointCode": "M1",
                "observed": "abnormal",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["status"], "success")
        self.assertEqual(updated["remainingFaultIds"], ["target-fault", "controller-fault"])
        self.assertTrue(updated["routeQuality"]["matchedRecommendedStep"])
        self.assertEqual(updated["nextRecommendedStep"]["pointCode"], "M2")


if __name__ == "__main__":
    unittest.main()
