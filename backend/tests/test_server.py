import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from backend.server import SimulationBackendHandler
from backend.tests.fixtures import valid_package
from backend.tests.test_troubleshooting import sample_d_matrix


def d_matrix_with_observation_rule():
    matrix = sample_d_matrix()
    matrix["points"][0]["channel"] = "scope-1.ch1"
    matrix["points"][0]["observationRule"] = {
        "method": "absoluteDelta",
        "normalThreshold": 0.1,
        "abnormalThreshold": 0.3,
    }
    return matrix


def d_matrix_with_physical_and_virtual_points():
    matrix = sample_d_matrix()
    matrix["points"][0]["pointType"] = "physical"
    matrix["points"][0]["channel"] = "scope-1.ch1"
    matrix["points"][0]["observationRule"] = {
        "method": "absoluteDelta",
        "normalThreshold": 0.1,
        "abnormalThreshold": 0.3,
    }
    matrix["points"].append({
        "pointId": "tp-virtual",
        "shortName": "V1",
        "name": "virtual instrument point",
        "pointType": "virtual",
        "channel": "scope-1.ch1",
    })
    return matrix


def d_matrix_with_rankable_virtual_points():
    matrix = d_matrix_with_physical_and_virtual_points()
    matrix["points"].append({
        "pointId": "tp-virtual-low",
        "shortName": "V2",
        "name": "low value virtual point",
        "pointType": "virtual",
        "channel": "scope-3.ch1",
    })
    matrix["rows"][0]["cells"].extend([
        {"pointId": "tp-virtual", "pointCode": "V1", "pointName": "virtual instrument point", "detectable": True, "value": 1},
        {"pointId": "tp-virtual-low", "pointCode": "V2", "pointName": "low value virtual point", "detectable": True, "value": 1},
    ])
    matrix["rows"][1]["cells"].extend([
        {"pointId": "tp-virtual", "pointCode": "V1", "pointName": "virtual instrument point", "detectable": False, "value": 0},
        {"pointId": "tp-virtual-low", "pointCode": "V2", "pointName": "low value virtual point", "detectable": True, "value": 1},
    ])
    matrix["rows"][2]["cells"].extend([
        {"pointId": "tp-virtual", "pointCode": "V1", "pointName": "virtual instrument point", "detectable": False, "value": 0},
        {"pointId": "tp-virtual-low", "pointCode": "V2", "pointName": "low value virtual point", "detectable": False, "value": 0},
    ])
    return matrix


class SimulationBackendServerTests(unittest.TestCase):
    def setUp(self):
        SimulationBackendHandler.sessions = {}
        SimulationBackendHandler.practice_sessions = {}
        SimulationBackendHandler.max_active_simulation_sessions = 100
        SimulationBackendHandler.max_active_practice_sessions = 100
        SimulationBackendHandler.max_response_samples = 1000
        SimulationBackendHandler.default_max_practice_actions = 200
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

    def _get(self, path):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("GET", path)
        response = connection.getresponse()
        response_body = response.read().decode("utf-8")
        connection.close()
        return response.status, json.loads(response_body)

    def test_create_practice_session_retains_supplied_private_task_data(self):
        initial_recommended_path = {
            "ok": True,
            "faultId": "target-fault",
            "steps": [{"index": 1, "actionType": "measurePoint", "pointCode": "M1"}],
            "keySteps": [1],
            "summary": "custom initial path",
        }
        key_nodes = [
            {"nodeId": "key-node-1", "nodeType": "measurement", "pointCode": "M1"},
        ]

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
                "initialRecommendedPath": initial_recommended_path,
                "keyNodes": key_nodes,
            },
        )

        self.assertEqual(status, 200)
        self.assertNotIn("initialRecommendedPath", created)
        self.assertNotIn("keyNodes", created)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertEqual(session.initial_best_path, initial_recommended_path)
        self.assertEqual(session.fault_tree_key_nodes, key_nodes)

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

    def test_builds_d_matrix_path_and_key_steps_through_the_backend_endpoint(self):
        status, body = self._post(
            "/api/troubleshooting/plan",
            {"dMatrix": sample_d_matrix(), "targetFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["plan"]["source"], "backend-algorithm")
        self.assertGreater(len(body["plan"]["steps"]), 0)
        self.assertGreater(len(body["plan"]["keySteps"]), 0)

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

    def test_rejects_new_simulation_session_when_active_session_limit_is_reached(self):
        SimulationBackendHandler.max_active_simulation_sessions = 1
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)

        status, rejected = self._post("/api/simulations/session", valid_package())

        self.assertEqual(status, 400)
        self.assertEqual(rejected["status"], "error")
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "sessions")
        self.assertEqual(len(SimulationBackendHandler.sessions), 1)

    def test_rejects_step_batch_that_would_exceed_response_sample_limit(self):
        SimulationBackendHandler.max_response_samples = 1
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)

        status, rejected = self._post(f"/api/simulations/session/{created['sessionId']}/step", {"steps": 2})

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "steps")

    def test_runs_practice_session_action_and_submit_flow(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
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
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["status"], "success")
        self.assertEqual(updated["normalizedAction"]["actionType"], "replaceComponent")
        self.assertEqual(updated["normalizedAction"]["target"], {"type": "component", "id": "sim-1"})
        self.assertEqual(updated["normalizedAction"]["faultId"], "fault-bias")
        self.assertNotIn("ruleResult", updated)
        self.assertNotIn("appliedAction", updated)
        self.assertIn("simulationResult", updated)
        self.assertEqual(updated["simulationResult"]["status"], "completed")
        self.assertEqual(updated["simulationResult"]["simulationConfig"], {"duration": 0.3, "stepSize": 0.1})
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["pointCode"], "M1")
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["sourceDeviceId"], "sim-1")
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["sourcePort"], "socket03")
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["samples"], [
            {"time": 0.0, "actual": 1.0},
            {"time": 0.1, "actual": 1.0},
            {"time": 0.2, "actual": 1.0},
        ])
        self.assertIn("virtualMeasurements", updated["simulationResult"])
        self.assertEqual(updated["simulationResult"]["virtualMeasurements"][0]["sourcePort"], "socket03")
        self.assertNotIn("curves", updated["simulationResult"])
        self.assertNotIn("componentOutputs", updated["simulationResult"])
        self.assertNotIn("observationResult", updated)
        self.assertNotIn("troubleshooting", updated)
        self.assertNotIn("currentPath", updated)
        self.assertNotIn("nextRecommendedStep", updated)
        self.assertNotIn("remainingFaultIds", updated)

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-virtual-before-submit",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "pointCode": "V1",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("virtualMeasurement", measured)
        self.assertNotIn("troubleshootingState", measured)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultName": "Target fault", "submittedAt": "2026-06-28T00:01:00Z"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(submitted["status"], "success")
        report = submitted["evaluationReport"]
        score_details = {item["item"]: item["score"] for item in report["scoreDetails"]}
        self.assertEqual(score_details["faultLocalization"], 30)
        self.assertEqual(score_details["efficiency"], 5)
        self.assertEqual(score_details["safetyCompliance"], 15)
        self.assertNotIn("initialBestPath", submitted)
        self.assertEqual(report["initialOptimalPath"]["faultId"], "target-fault")
        self.assertEqual(report["initialOptimalPath"]["steps"][0]["actionType"], "measurePoint")
        self.assertEqual(report["initialOptimalPath"]["steps"][0]["pointCode"], "M2")
        self.assertIn("replaceComponent", [step["actionType"] for step in report["initialOptimalPath"]["steps"]])
        for field in ("score", "grade", "scoreBreakdown", "deductions", "initialRecommendedPath"):
            self.assertNotIn(field, submitted)
        self.assertNotIn("record", submitted)

    def test_adjusts_display_console_parameter_and_returns_full_rerun_result(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
                "displayConsoleControls": [{
                    "displayConsoleId": "console-1",
                    "targetComponentId": "source-1",
                    "componentType": "signal_source",
                    "parameterKeys": ["value"],
                }],
            },
        )
        self.assertEqual(status, 200)

        status, updated = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {
                "operationId": "op-console-value",
                "actionType": "adjustDisplayConsoleParameter",
                "target": {"type": "displayConsole", "id": "console-1"},
                "componentId": "source-1",
                "parameters": {"value": 2.5},
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["normalizedAction"]["parameters"], {"value": 2.5})
        self.assertEqual(updated["appliedParameters"], [{
            "type": "display_console_parameter_updated",
            "displayConsoleId": "console-1",
            "nodeId": "source-1",
            "parameter": "value",
            "previousValue": 1.0,
            "newValue": 2.5,
        }])
        self.assertEqual(updated["simulationResult"]["status"], "completed")
        self.assertEqual(
            [sample["actual"] for sample in updated["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [2.5, 2.5, 2.5],
        )

    def test_submit_returns_internal_action_path_for_measurement_and_wire_repair(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-wire",
            "faultType": "wire_open",
            "targetId": "edge-sim-scope",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
                "initialPointStates": [{"pointCode": "V1", "observed": "abnormal"}],
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("initialRecommendedPath", created)
        self.assertNotIn("actualTroubleshootingPath", created)
        self.assertNotIn("faultTreeKeyNodes", created)
        session_id = created["sessionId"]

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("recommendedPath", measured)
        self.assertNotIn("nextRecommendedAction", measured)
        self.assertNotIn("actualTroubleshootingPath", measured)

        status, repaired = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-wire",
                "actionType": "replaceWire",
                "target": {"type": "wire", "id": "edge-sim-scope"},
                "faultId": "fault-wire",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("ruleResult", repaired)
        self.assertNotIn("recommendedPath", repaired)
        self.assertNotIn("nextRecommendedAction", repaired)
        self.assertNotIn("actualTroubleshootingPath", repaired)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("initialRecommendedPath", submitted)
        self.assertNotIn("initialBestPath", submitted)
        initial_steps = submitted["evaluationReport"]["initialOptimalPath"]["steps"]
        self.assertEqual(initial_steps[0]["actionType"], "measurePoint")
        self.assertTrue(
            any(
                step.get("actionType") == "replaceWire"
                and step.get("target") == {"type": "wire", "id": "edge-sim-scope"}
                and step.get("faultId") == "fault-wire"
                and step.get("routeRole") == "repairAttempt"
                for step in initial_steps
            )
        )
        self.assertNotIn("record", submitted)
        evaluations = submitted["evaluationReport"]["stepEvaluations"]
        self.assertEqual([item["studentAction"]["actionType"] for item in evaluations], ["measurePoint", "replaceWire"])
        self.assertEqual(evaluations[0]["studentAction"]["pointCode"], "V1")
        self.assertEqual(evaluations[1]["studentAction"]["target"], {"type": "wire", "id": "edge-sim-scope"})
        self.assertEqual(evaluations[1]["studentAction"]["faultId"], "fault-wire")
        self.assertEqual(submitted["evaluationReport"]["keyNodeCoverage"]["score"], 12)
        self.assertEqual(submitted["evaluationReport"]["keyNodeCoverage"]["maxScore"], 12)
        self.assertEqual(submitted["evaluationReport"]["keyNodeCoverage"]["missedNodeIds"], [])
        score_details = {item["item"]: item["score"] for item in submitted["evaluationReport"]["scoreDetails"]}
        self.assertEqual(score_details["diagnosticTreePath"], 18)

    def test_dynamic_reference_scores_direct_repair_from_physical_evidence(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, repaired = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-direct-component",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("dynamicReferenceHistory", repaired)
        self.assertNotIn("recommendedActionSet", repaired)
        self.assertNotIn("nextRecommendedAction", repaired)

        status, status_body = self._get(f"/api/practice/session/{session_id}/status")
        self.assertEqual(status, 200)
        self.assertNotIn("dynamicReferenceHistory", status_body)
        self.assertNotIn("recommendedActionSet", status_body)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("record", submitted)
        step = submitted["evaluationReport"]["stepEvaluations"][0]
        self.assertTrue(step["matchResult"]["matched"])
        self.assertEqual(step["matchResult"]["matchType"], "exactRepair")
        self.assertEqual(step["systemRecommendedAction"]["target"], {"type": "component", "id": "sim-1"})

    def test_recommended_actions_are_ranked_without_adding_recovery_verification_step(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
                "initialPointStates": [
                    {"pointCode": "M1", "observed": "abnormal"},
                    {"pointCode": "V1", "observed": "abnormal"},
                ],
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-v1",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("record", submitted)
        recommended = submitted["evaluationReport"]["stepEvaluations"][0]["systemRecommendedAction"]
        self.assertEqual(recommended["actionType"], "measurePoint")
        self.assertEqual(recommended["pointCode"], "V1")
        self.assertEqual(recommended["rank"], 1)
        self.assertEqual(recommended["recommendationTier"], "optimal")
        self.assertIn("confidence", recommended)

        initial_steps = submitted["evaluationReport"]["initialOptimalPath"]["steps"]
        self.assertNotIn("verifyRecovery", [step["actionType"] for step in initial_steps])
        self.assertEqual(initial_steps[-1]["actionType"], "replaceComponent")
        self.assertEqual(initial_steps[-1]["routeRole"], "repairAttempt")

    def test_virtual_measurement_reduces_the_working_d_matrix_and_uses_saved_initial_result(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
                "initialPointStates": [
                    {"pointCode": "M1", "observed": "abnormal"},
                    {"pointCode": "V1", "observed": "abnormal"},
                    {"pointCode": "V2", "observed": "abnormal"},
                ],
            },
        )
        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertEqual(session.simulation_results, [])

        status, measured = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-v1",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "pointCode": "V1",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("simulationResult", measured)
        self.assertNotIn("V1", [point["shortName"] for point in session.active_d_matrix["points"]])
        self.assertTrue(all(
            all(cell.get("pointCode") != "V1" for cell in row["cells"])
            for row in session.active_d_matrix["rows"]
        ))
        self.assertEqual([row["faultId"] for row in session.active_d_matrix["rows"]], ["target-fault"])
        self.assertEqual(
            session.dynamic_reference_history[-1]["referenceAfterAction"]["recommendedActionSet"][0]["actionType"],
            "replaceComponent",
        )

    def test_dynamic_reference_uses_tiered_scores_and_safety_prerequisites(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
                "initialPointStates": [
                    {"pointCode": "M1", "observed": "abnormal"},
                    {"pointCode": "V1", "observed": "abnormal"},
                    {"pointCode": "V2", "observed": "abnormal"},
                ],
                "actionRules": {
                    "replaceComponent": {"requiresPowerOff": True, "durationSeconds": 120, "riskLevel": "high"},
                },
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-v2",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-3.ch1"},
                "pointCode": "V2",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("recommendedActionSet", measured)

        status, repaired = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-unsafe-component",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("ruleResult", repaired)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("record", submitted)
        evaluations = submitted["evaluationReport"]["stepEvaluations"]
        measurement_match = evaluations[0]["matchResult"]
        self.assertTrue(measurement_match["matched"])
        self.assertEqual(measurement_match["matchQuality"], "acceptable")
        self.assertGreater(measurement_match["score"], 0)
        self.assertLess(measurement_match["score"], 1.0)
        self.assertGreater(measurement_match["matchedAction"]["rank"], 1)

        repair_match = evaluations[1]["matchResult"]
        self.assertTrue(repair_match["matched"])
        self.assertEqual(repair_match["matchQuality"], "unsafe")
        self.assertEqual(repair_match["score"], 0.0)
        self.assertFalse(repair_match["safetyPrerequisiteSatisfied"])

    def test_initial_repair_actions_are_sorted_by_weight_and_include_safety_prerequisites(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [
            {
                "faultId": "fault-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.5,
                "parameters": {"bias": 0.5},
            },
            {
                "faultId": "fault-wire",
                "faultType": "wire_open",
                "targetId": "edge-sim-scope",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.5,
                "parameters": {"bias": 0.5},
            },
        ]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
                "actionRules": {
                    "replaceComponent": {"requiresPowerOff": True, "durationSeconds": 120, "riskLevel": "high"},
                    "replaceWire": {"durationSeconds": 30, "riskLevel": "low"},
                },
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        repair_steps = [
            step
            for step in submitted["evaluationReport"]["initialOptimalPath"]["steps"]
            if step.get("routeRole") == "repairAttempt"
        ]
        self.assertEqual([step["actionType"] for step in repair_steps], ["replaceWire", "replaceComponent"])
        self.assertEqual(repair_steps[0]["riskCost"], 1)
        self.assertEqual(repair_steps[0]["timeCostSeconds"], 30)
        self.assertEqual(repair_steps[1]["riskCost"], 3)
        self.assertEqual(repair_steps[1]["safetyPrerequisites"], [{"type": "powerOff", "required": True}])

    def test_practice_session_creation_keeps_physical_measurement_snapshot_internal(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.3
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        snapshot = session.latest_physical_measurement_snapshot
        self.assertEqual([point["pointCode"] for point in snapshot["points"]], ["M1", "M2", "M3"])
        self.assertIn("M1", snapshot["abnormalPointCodes"])
        self.assertNotIn("V1", [point["pointCode"] for point in snapshot["points"]])
        self.assertNotIn("physicalMeasurementSnapshot", created)
        self.assertNotIn("troubleshootingState", created)

    def test_practice_action_rejects_unsupported_action_type(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure",
                "actionType": "measure",
                "target": {"type": "testPoint", "id": "point-M1"},
                "faultId": "fault-bias",
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "UNSUPPORTED_ACTION_TYPE")

    def test_measure_point_returns_virtual_measurement_without_updating_repair_path(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure-virtual",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
                "steps": 1,
                "observed": "normal",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["normalizedAction"]["actionType"], "measurePoint")
        self.assertNotIn("ruleResult", body)
        self.assertNotIn("appliedAction", body)
        self.assertNotIn("virtualMeasurement", body)
        self.assertNotIn("simulationResult", body)
        self.assertNotIn("troubleshootingState", body)

    def test_measure_point_rejects_physical_console_point(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure-physical",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "pointCode": "M1",
                "steps": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["errorCode"], "INVALID_ACTION_SCHEMA")
        self.assertEqual(body["field"], "pointCode")

    def test_practice_action_repeated_replacement_is_recorded_and_applied(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.4,
            "parameters": {"bias": 1.0},
        }]
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
        payload = {
            "operationId": "op-repair",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "faultId": "fault-bias",
            "steps": 1,
        }

        first_status, first = self._post(f"/api/practice/session/{session_id}/action", payload)
        self.assertEqual(first_status, 200)
        self.assertNotIn("ruleResult", first)

        payload["operationId"] = "op-repeat"
        second_status, second = self._post(f"/api/practice/session/{session_id}/action", payload)

        self.assertEqual(second_status, 200)
        self.assertNotIn("ruleResult", second)
        self.assertNotIn("appliedAction", second)

    def test_repair_action_returns_physical_snapshot_and_repair_effect(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertIn("M1", session.latest_physical_measurement_snapshot["abnormalPointCodes"])
        session_id = created["sessionId"]

        status, updated = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-repair",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )

        self.assertEqual(status, 200)
        self.assertNotIn("ruleResult", updated)
        self.assertNotIn("physicalMeasurementSnapshot", updated)
        self.assertNotIn("repairEffect", updated)
        self.assertNotIn("troubleshootingState", updated)

    def test_repeated_replacement_reports_unchanged_repair_effect(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]
        repair_payload = {
            "operationId": "op-repair",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "faultId": "fault-bias",
            "steps": 1,
        }
        status, first = self._post(f"/api/practice/session/{session_id}/action", repair_payload)
        self.assertEqual(status, 200)

        status, second = self._post(
            f"/api/practice/session/{session_id}/action",
            {**repair_payload, "operationId": "op-repair-repeat"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("ruleResult", second)
        self.assertNotIn("repairEffect", second)
        self.assertNotIn("troubleshootingState", second)

    def test_practice_action_unknown_target_returns_error(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]
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

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-missing-target",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "missing-component"},
                "steps": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "TARGET_NOT_FOUND")
        self.assertEqual(body["field"], "target.id")

    def test_practice_repair_persists_simulation_state_across_steps(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.4,
            "parameters": {"bias": 1.0},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, adjusted = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-repair",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            [sample["actual"] for sample in adjusted["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [1.0, 1.0, 1.0, 1.0],
        )

        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-repair-again",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            [sample["actual"] for sample in measured["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [1.0, 1.0, 1.0, 1.0],
        )

    def test_replacements_without_faults_rerun_the_full_model_from_zero(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.3
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

        status, component_result = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-replace-healthy-component",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("faultId", component_result["normalizedAction"])
        self.assertNotIn("appliedAction", component_result)
        self.assertEqual(
            [sample["time"] for sample in component_result["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [0.0, 0.1, 0.2],
        )
        self.assertTrue(component_result["simulationResult"]["summary"]["done"])

        status, wire_result = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-replace-healthy-wire",
                "actionType": "replaceWire",
                "target": {"type": "wire", "id": "edge-source-sim"},
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("appliedAction", wire_result)
        self.assertEqual(
            [sample["time"] for sample in wire_result["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [0.0, 0.1, 0.2],
        )
        self.assertTrue(wire_result["simulationResult"]["summary"]["done"])

    def test_submit_returns_complete_practice_evaluation_report(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.3
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, _ = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-report-measure",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )
        self.assertEqual(status, 200)
        status, _ = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-report-replace",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault", "finalFaultName": "Target fault"},
        )

        self.assertEqual(status, 200, submitted)
        report = submitted["evaluationReport"]
        self.assertEqual(report["faultConclusion"]["target"]["faultId"], "target-fault")
        self.assertEqual(report["faultConclusion"]["student"]["faultId"], "target-fault")
        self.assertTrue(report["faultConclusion"]["correct"])
        self.assertEqual(len(report["scoreDetails"]), 5)
        self.assertEqual(sum(item["score"] for item in report["scoreDetails"]), report["totalScore"])
        self.assertNotIn("initialRecommendedPath", submitted)
        self.assertEqual(len(report["stepEvaluations"]), 2)
        self.assertTrue(all("studentRating" in step for step in report["stepEvaluations"]))
        self.assertTrue(all("systemRecommendedAction" in step for step in report["stepEvaluations"]))
        replacement_step = report["stepEvaluations"][1]
        self.assertEqual(replacement_step["studentRating"]["level"], "optimal")
        self.assertEqual(
            replacement_step["systemRecommendedAction"]["target"],
            {"type": "component", "id": "sim-1"},
        )
        coverage = report["keyNodeCoverage"]
        self.assertTrue(coverage["nodes"])
        self.assertTrue(all("covered" in node for node in coverage["nodes"]))
        self.assertEqual(
            sum(item["deductedPoints"] for item in report["deductionAnalysis"]),
            round(100 - report["totalScore"], 3),
        )
        self.assertIsInstance(report["improvementSuggestions"], list)

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

    def test_rejects_new_practice_session_when_active_practice_limit_is_reached(self):
        SimulationBackendHandler.max_active_practice_sessions = 1
        payload = {
            "simulationPackage": valid_package(),
            "dMatrix": sample_d_matrix(),
            "targetFaultId": "target-fault",
        }
        status, created = self._post("/api/practice/session", payload)
        self.assertEqual(status, 200)

        status, rejected = self._post("/api/practice/session", payload)

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "practiceSessions")

    def test_practice_session_rejects_actions_after_action_limit(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
                "resourceLimits": {"maxActions": 1},
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, first = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-1",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("virtualMeasurement", first)
        self.assertNotIn("troubleshootingState", first)

        status, rejected = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-2",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "resourceLimits.maxActions")

    def test_repair_action_requires_power_off_when_configured(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
                "actionRules": {
                    "replaceComponent": {
                        "requiresPowerOff": True,
                        "durationSeconds": 120,
                        "riskLevel": "high",
                    },
                },
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, blocked = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-hot-swap",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "safetyState": {"powerOff": False},
            },
        )

        self.assertEqual(status, 200)
        self.assertNotIn("ruleResult", blocked)
        self.assertNotIn("safetyViolation", blocked["normalizedAction"])
        self.assertNotIn("appliedAction", blocked)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )
        self.assertEqual(status, 200)
        safety_detail = next(item for item in submitted["evaluationReport"]["scoreDetails"] if item["item"] == "safetyCompliance")
        self.assertEqual(safety_detail["score"], 10)
        self.assertNotIn("record", submitted)

    def test_get_practice_session_status_reports_lifecycle_state(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._get(f"/api/practice/session/{session_id}/status")

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["practiceSessionId"], session_id)
        self.assertEqual(body["simulationSessionId"], created["simulationSessionId"])
        self.assertEqual(body["lifecycle"]["state"], "active")
        self.assertEqual(body["lifecycle"]["actionCount"], 0)
        self.assertEqual(body["lifecycle"]["maxLifetimeSeconds"], 3600.0)
        self.assertEqual(body["lifecycle"]["idleTimeoutSeconds"], 900.0)
        self.assertIn("createdAt", body["lifecycle"])
        self.assertIn("lastActivityAt", body["lifecycle"])
        self.assertIn("troubleshootingState", body)

    def test_deletes_practice_session_and_bound_simulation_session(self):
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

        status, deleted = self._delete(f"/api/practice/session/{practice_session_id}")

        self.assertEqual(status, 200)
        self.assertEqual(deleted["status"], "success")
        self.assertEqual(deleted["practiceSessionId"], practice_session_id)
        self.assertEqual(deleted["simulationSessionId"], simulation_session_id)
        self.assertEqual(deleted["lifecycle"]["state"], "abandoned")

        status, missing_practice = self._get(f"/api/practice/session/{practice_session_id}/status")
        self.assertEqual(status, 404)
        self.assertEqual(missing_practice["errorCode"], "SESSION_NOT_FOUND")

        status, missing_simulation = self._post(f"/api/simulations/session/{simulation_session_id}/step", {})
        self.assertEqual(status, 404)
        self.assertEqual(missing_simulation["errorCode"], "SESSION_NOT_FOUND")

    def test_expired_practice_session_is_cleaned_before_action(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
                "lifecycle": {"maxLifetimeSeconds": 0},
            },
        )
        self.assertEqual(status, 200)
        practice_session_id = created["sessionId"]
        simulation_session_id = created["simulationSessionId"]

        status, expired = self._post(
            f"/api/practice/session/{practice_session_id}/action",
            {
                "operationId": "op-expired",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
            },
        )

        self.assertEqual(status, 410)
        self.assertEqual(expired["status"], "error")
        self.assertEqual(expired["errorCode"], "SESSION_EXPIRED")
        self.assertEqual(expired["field"], "sessionId")

        status, missing_simulation = self._post(f"/api/simulations/session/{simulation_session_id}/step", {})
        self.assertEqual(status, 404)
        self.assertEqual(missing_simulation["errorCode"], "SESSION_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
