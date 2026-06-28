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

    def test_runs_practice_session_action_and_submit_flow(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(created["status"], "success")
        self.assertEqual(created["practiceSessionId"], created["sessionId"])
        self.assertTrue(created["simulationSessionId"].startswith("session-"))
        self.assertNotIn("troubleshooting", created)
        self.assertNotIn("currentPath", created)
        self.assertNotIn("nextRecommendedStep", created)
        session_id = created["sessionId"]

        status, updated = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-1",
                "actionType": "measure",
                "pointCode": "M1",
                "observed": "abnormal",
                "steps": 1,
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["status"], "success")
        self.assertIn("simulationResult", updated)
        self.assertEqual(updated["simulationResult"]["curves"]["time"], [0.0])
        self.assertNotIn("troubleshooting", updated)
        self.assertNotIn("currentPath", updated)
        self.assertNotIn("nextRecommendedStep", updated)
        self.assertNotIn("remainingFaultIds", updated)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault", "submittedAt": "2026-06-28T00:01:00Z"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(submitted["status"], "success")
        self.assertEqual(submitted["scoreBreakdown"]["faultDetection"], 40)
        self.assertEqual(submitted["initialBestPath"]["faultId"], "target-fault")
        self.assertEqual(submitted["initialBestPath"]["steps"][0]["pointCode"], "M1")
        self.assertEqual(submitted["record"]["targetFaultId"], "target-fault")
        self.assertEqual(submitted["record"]["finalFaultId"], "target-fault")
        self.assertEqual(submitted["record"]["studentActions"][0]["pointCode"], "M1")
        self.assertEqual(submitted["record"]["recommendedPathHistory"][0]["stepIndex"], 1)
        self.assertEqual(submitted["record"]["recommendedPathHistory"][0]["recommendedStep"]["pointCode"], "M1")
        self.assertEqual(submitted["record"]["recommendedPathHistory"][0]["actualPointCode"], "M1")
        self.assertTrue(submitted["record"]["recommendedPathHistory"][0]["matchedRecommendedStep"])
        self.assertNotIn("simulationResults", submitted["record"])

    def test_practice_actions_persist_simulation_state_across_steps(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, adjusted = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-adjust",
                "actionType": "adjustParameter",
                "targetId": "source-1",
                "parameter": "value",
                "value": 2.0,
                "observed": "unknown",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(adjusted["simulationResult"]["curves"]["channels"]["scope-1.ch1.actual"], [2.0])

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure",
                "actionType": "measure",
                "pointCode": "M1",
                "observed": "abnormal",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(measured["simulationResult"]["curves"]["channels"]["scope-1.ch1.actual"], [2.0])

    def test_submit_ends_practice_and_bound_simulation_session(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        practice_session_id = created["sessionId"]
        simulation_session_id = created["simulationSessionId"]

        status, submitted = self._post(
            f"/api/practice/session/{practice_session_id}/submit",
            {"finalFaultId": "target-fault"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(submitted["status"], "success")

        status, missing_practice = self._post(
            f"/api/practice/session/{practice_session_id}/action",
            {"actionType": "measure", "pointCode": "M1", "observed": "abnormal"},
        )
        self.assertEqual(status, 404)
        self.assertEqual(missing_practice["errorCode"], "SESSION_NOT_FOUND")

        status, missing_simulation = self._post(f"/api/simulations/session/{simulation_session_id}/step", {})
        self.assertEqual(status, 404)
        self.assertEqual(missing_simulation["errorCode"], "SESSION_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
