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
        "channel": "scope-2.ch1",
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
        self.assertEqual(updated["ruleResult"], {
            "allowed": True,
            "ruleCode": "ACTION_ALLOWED",
            "durationSeconds": 120,
            "riskLevel": "medium",
            "repeatAction": False,
            "warnings": [],
        })
        self.assertEqual(updated["appliedAction"]["changes"][0]["type"], "fault_disabled")
        self.assertIn("simulationResult", updated)
        self.assertEqual(updated["simulationResult"]["curves"]["time"], [0.1])
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
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(measured["virtualMeasurement"]["pointCode"], "V1")

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault", "submittedAt": "2026-06-28T00:01:00Z"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(submitted["status"], "success")
        self.assertEqual(submitted["scoreBreakdown"]["faultLocalization"], 30)
        self.assertEqual(
            submitted["scoreBreakdown"]["diagnosticTreePath"],
            submitted["record"]["pathEvaluation"]["diagnosticTreePathScore"],
        )
        self.assertEqual(
            submitted["scoreBreakdown"]["informationGain"],
            round(submitted["record"]["pathEvaluation"]["routeQualityScore"] * 20 / 50, 3),
        )
        self.assertEqual(submitted["scoreBreakdown"]["efficiency"], 5)
        self.assertEqual(submitted["scoreBreakdown"]["safetyCompliance"], 15)
        self.assertNotIn("initialBestPath", submitted)
        self.assertEqual(submitted["initialRecommendedPath"]["faultId"], "target-fault")
        self.assertEqual(submitted["initialRecommendedPath"]["steps"][0]["actionType"], "measurePoint")
        self.assertEqual(submitted["initialRecommendedPath"]["steps"][0]["pointCode"], "M1")
        self.assertIn("replaceComponent", [step["actionType"] for step in submitted["initialRecommendedPath"]["steps"]])
        self.assertEqual(submitted["record"]["targetFaultId"], "target-fault")
        self.assertEqual(submitted["record"]["finalFaultId"], "target-fault")
        self.assertEqual(submitted["record"]["studentActions"][0]["faultId"], "fault-bias")
        self.assertEqual(submitted["record"]["recommendedPathHistory"], [])
        self.assertIn("initialPhysicalMeasurementSnapshot", submitted["record"])
        self.assertIn("physicalMeasurementSnapshots", submitted["record"])
        self.assertIn("virtualMeasurements", submitted["record"])
        self.assertIn("repairAttempts", submitted["record"])
        self.assertGreaterEqual(len(submitted["record"]["physicalMeasurementSnapshots"]), 2)
        self.assertEqual(submitted["record"]["repairAttempts"][0]["faultId"], "fault-bias")
        self.assertIn("repairEffect", submitted["record"]["repairAttempts"][0])
        self.assertEqual(submitted["record"]["troubleshootingState"]["repairAttempts"], submitted["record"]["repairAttempts"])
        self.assertNotIn("simulationResults", submitted["record"])

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
        self.assertEqual(repaired["ruleResult"]["ruleCode"], "ACTION_ALLOWED")
        self.assertNotIn("recommendedPath", repaired)
        self.assertNotIn("nextRecommendedAction", repaired)
        self.assertNotIn("actualTroubleshootingPath", repaired)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        self.assertIn("initialRecommendedPath", submitted)
        self.assertNotIn("initialBestPath", submitted)
        initial_steps = submitted["initialRecommendedPath"]["steps"]
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
        actual_path = submitted["record"]["actualTroubleshootingPath"]
        self.assertEqual(actual_path["basis"], "studentActions")
        self.assertEqual([step["actionType"] for step in actual_path["steps"]], ["measurePoint", "replaceWire"])
        self.assertEqual(actual_path["steps"][0]["routeRole"], "evidenceCollection")
        self.assertEqual(actual_path["steps"][0]["pointCode"], "V1")
        self.assertEqual(actual_path["steps"][1]["routeRole"], "repairAttempt")
        self.assertEqual(actual_path["steps"][1]["target"], {"type": "wire", "id": "edge-sim-scope"})
        self.assertEqual(actual_path["steps"][1]["faultId"], "fault-wire")
        self.assertIn("repairEffect", actual_path["steps"][1])
        self.assertEqual(submitted["record"]["pathEvaluation"]["measuredVirtualPointCount"], 1)
        self.assertEqual(submitted["record"]["pathEvaluation"]["wireRepairAttemptCount"], 1)
        self.assertEqual(submitted["record"]["pathEvaluation"]["componentRepairAttemptCount"], 0)
        self.assertEqual(submitted["record"]["pathEvaluation"]["totalStepCount"], 2)
        breakdown = submitted["record"]["pathEvaluation"]["routeQualityBreakdown"]
        self.assertEqual(
            set(breakdown.keys()),
            {
                "evidenceCollection",
                "pathOrder",
                "repairLocalization",
                "recoveryVerification",
                "operationControl",
            },
        )
        self.assertEqual(sum(breakdown.values()), submitted["record"]["pathEvaluation"]["routeQualityScore"])
        path_evaluation = submitted["record"]["pathEvaluation"]
        self.assertIn("faultTreeKeyNodes", path_evaluation)
        self.assertIn("keyNodeCoverage", path_evaluation)
        self.assertIn("diagnosticTreePathBreakdown", path_evaluation)
        key_nodes = path_evaluation["faultTreeKeyNodes"]
        self.assertEqual({node["type"] for node in key_nodes}, {"physicalEvidence", "measurePoint", "repairTarget"})
        self.assertEqual(path_evaluation["keyNodeCoverage"]["score"], 12)
        self.assertEqual(path_evaluation["keyNodeCoverage"]["maxScore"], 12)
        self.assertEqual(path_evaluation["keyNodeCoverage"]["missedNodeIds"], [])
        self.assertEqual(
            path_evaluation["diagnosticTreePathBreakdown"],
            {
                "keyNodeCoverage": 12,
                "sequenceReasonability": 10,
                "pathEfficiency": 6,
            },
        )
        self.assertEqual(path_evaluation["diagnosticTreePathScore"], 28)
        self.assertEqual(
            submitted["scoreBreakdown"]["diagnosticTreePath"],
            path_evaluation["diagnosticTreePathScore"],
        )
        self.assertEqual(
            submitted["scoreBreakdown"]["informationGain"],
            round(submitted["record"]["pathEvaluation"]["routeQualityScore"] * 20 / 50, 3),
        )

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
        history = submitted["record"]["dynamicReferenceHistory"]
        self.assertEqual(len(history), 1)
        reference_actions = history[0]["referenceBeforeAction"]["recommendedActionSet"]
        self.assertTrue(
            any(
                action.get("actionType") == "replaceComponent"
                and action.get("target") == {"type": "component", "id": "sim-1"}
                and action.get("faultId") == "fault-bias"
                and action.get("routeRole") == "repairAttempt"
                for action in reference_actions
            )
        )
        self.assertTrue(history[0]["matchResult"]["matched"])
        self.assertEqual(history[0]["matchResult"]["matchType"], "exactRepair")
        evaluation = submitted["record"]["pathEvaluation"]
        self.assertEqual(evaluation["dynamicReferenceMatchedCount"], 1)
        self.assertEqual(evaluation["dynamicReferenceUnmatchedCount"], 0)
        self.assertEqual(evaluation["routeQualityBreakdown"]["pathOrder"], 10)

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
        history = submitted["record"]["dynamicReferenceHistory"]
        actions = history[0]["referenceBeforeAction"]["recommendedActionSet"]
        self.assertEqual(actions[0]["actionType"], "measurePoint")
        self.assertEqual(actions[0]["pointCode"], "V1")
        self.assertEqual(actions[0]["rank"], 1)
        self.assertEqual(actions[0]["recommendationTier"], "optimal")
        self.assertGreater(actions[0]["expectedInformationGain"], actions[1]["expectedInformationGain"])
        self.assertGreater(actions[0]["priority"], actions[-1]["priority"])
        self.assertIn("confidence", actions[0])

        initial_steps = submitted["initialRecommendedPath"]["steps"]
        self.assertNotIn("verifyRecovery", [step["actionType"] for step in initial_steps])
        self.assertEqual(initial_steps[-1]["actionType"], "replaceComponent")
        self.assertEqual(initial_steps[-1]["routeRole"], "repairAttempt")

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
        self.assertEqual(repaired["ruleResult"]["ruleCode"], "POWER_NOT_OFF")

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalFaultId": "target-fault"},
        )

        self.assertEqual(status, 200)
        history = submitted["record"]["dynamicReferenceHistory"]
        measurement_match = history[0]["matchResult"]
        self.assertTrue(measurement_match["matched"])
        self.assertEqual(measurement_match["matchQuality"], "acceptable")
        self.assertGreater(measurement_match["score"], 0)
        self.assertLess(measurement_match["score"], 1.0)
        self.assertGreater(measurement_match["matchedAction"]["rank"], 1)

        repair_reference = history[1]["referenceBeforeAction"]["recommendedActionSet"]
        repair_candidate = next(
            action
            for action in repair_reference
            if action.get("actionType") == "replaceComponent" and action.get("faultId") == "fault-bias"
        )
        self.assertEqual(repair_candidate["safetyPrerequisites"], [{"type": "powerOff", "required": True}])

        repair_match = history[1]["matchResult"]
        self.assertTrue(repair_match["matched"])
        self.assertEqual(repair_match["matchQuality"], "unsafe")
        self.assertEqual(repair_match["score"], 0.0)
        self.assertFalse(repair_match["safetyPrerequisiteSatisfied"])

        evaluation = submitted["record"]["pathEvaluation"]
        self.assertEqual(evaluation["dynamicReferenceAcceptableCount"], 1)
        self.assertEqual(evaluation["dynamicReferenceUnsafeCount"], 1)
        self.assertIn("dynamicReferenceAverageScore", evaluation)
        self.assertLess(evaluation["dynamicReferenceAverageScore"], 1.0)

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
            for step in submitted["initialRecommendedPath"]["steps"]
            if step.get("routeRole") == "repairAttempt"
        ]
        self.assertEqual([step["actionType"] for step in repair_steps], ["replaceWire", "replaceComponent"])
        self.assertEqual(repair_steps[0]["riskCost"], 1)
        self.assertEqual(repair_steps[0]["timeCostSeconds"], 30)
        self.assertEqual(repair_steps[1]["riskCost"], 3)
        self.assertEqual(repair_steps[1]["safetyPrerequisites"], [{"type": "powerOff", "required": True}])

    def test_practice_session_creation_returns_physical_measurement_snapshot(self):
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
        snapshot = created["physicalMeasurementSnapshot"]
        self.assertEqual([point["pointCode"] for point in snapshot["points"]], ["M1", "M2", "M3"])
        self.assertIn("M1", snapshot["abnormalPointCodes"])
        self.assertNotIn("V1", [point["pointCode"] for point in snapshot["points"]])
        self.assertEqual(created["troubleshootingState"]["physicalMeasurementSnapshot"], snapshot)
        self.assertEqual(created["troubleshootingState"]["virtualMeasurements"], [])
        self.assertEqual(created["troubleshootingState"]["repairAttempts"], [])

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
        self.assertEqual(body["virtualMeasurement"]["pointCode"], "V1")
        self.assertEqual(body["virtualMeasurement"]["pointType"], "virtual")
        self.assertEqual(body["virtualMeasurement"]["source"], "backend")
        self.assertEqual(body["troubleshootingState"]["virtualMeasurements"][0]["pointCode"], "V1")
        self.assertEqual(body["troubleshootingState"]["repairAttempts"], [])

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

    def test_practice_action_repeated_repair_is_recorded_and_skipped(self):
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
        self.assertEqual(first["ruleResult"]["ruleCode"], "ACTION_ALLOWED")

        payload["operationId"] = "op-repeat"
        second_status, second = self._post(f"/api/practice/session/{session_id}/action", payload)

        self.assertEqual(second_status, 200)
        self.assertEqual(second["ruleResult"], {
            "allowed": False,
            "ruleCode": "REPEAT_REPAIR",
            "durationSeconds": 0,
            "riskLevel": "none",
            "repeatAction": True,
            "warnings": ["fault is already repaired"],
        })
        self.assertEqual(second["appliedAction"]["status"], "skipped")
        self.assertEqual(second["appliedAction"]["changes"], [])

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
        self.assertIn("M1", created["physicalMeasurementSnapshot"]["abnormalPointCodes"])
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
        self.assertEqual(updated["ruleResult"]["ruleCode"], "ACTION_ALLOWED")
        self.assertIn("physicalMeasurementSnapshot", updated)
        self.assertIn("repairEffect", updated)
        self.assertIn(updated["repairEffect"]["status"], {"recovered", "improved"})
        self.assertIn("M1", updated["repairEffect"]["recoveredPointCodes"])
        self.assertEqual(updated["troubleshootingState"]["repairAttempts"][0]["operationId"], "op-repair")
        self.assertEqual(updated["troubleshootingState"]["repairAttempts"][0]["repairEffect"], updated["repairEffect"])

    def test_skipped_repeated_repair_reports_unchanged_repair_effect(self):
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
        self.assertEqual(second["ruleResult"]["ruleCode"], "REPEAT_REPAIR")
        self.assertFalse(second["repairEffect"]["effective"])
        self.assertEqual(second["repairEffect"]["status"], "unchanged")
        self.assertEqual(len(second["troubleshootingState"]["repairAttempts"]), 2)

    def test_practice_action_target_mismatch_returns_error(self):
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
                "operationId": "op-mismatch",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "source-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "TARGET_MISMATCH")
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
                "dMatrix": sample_d_matrix(),
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
        self.assertEqual(adjusted["simulationResult"]["curves"]["channels"]["scope-1.ch1.actual"], [1.0])

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
        self.assertEqual(measured["simulationResult"]["curves"]["channels"]["scope-1.ch1.actual"], [1.0])

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
        self.assertEqual(first["virtualMeasurement"]["pointCode"], "V1")

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
        self.assertEqual(blocked["ruleResult"]["allowed"], False)
        self.assertEqual(blocked["ruleResult"]["ruleCode"], "POWER_NOT_OFF")
        self.assertTrue(blocked["normalizedAction"]["safetyViolation"])
        self.assertEqual(blocked["appliedAction"]["status"], "skipped")

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
