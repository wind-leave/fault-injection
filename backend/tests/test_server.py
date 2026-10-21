import copy
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

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
    matrix["rows"][0].update({
        "targetKind": "node",
        "targetNodeId": "sim-1",
        "targetLabel": "simulation component",
    })
    matrix["rows"][1].update({
        "targetKind": "edge",
        "targetEdgeId": "edge-sim-scope",
        "targetLabel": "simulation output wire",
    })
    matrix["rows"][2].update({
        "targetKind": "node",
        "targetNodeId": "source-1",
        "targetLabel": "signal source",
    })
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
        "sourceElementName": "输出",
        "targetElementName": "输入",
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
        "sourceElementName": "输出",
        "targetElementName": "输入",
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
        SimulationBackendHandler.max_response_samples = 100000
        SimulationBackendHandler.default_max_practice_actions = 200
        SimulationBackendHandler.default_simulation_session_idle_timeout_seconds = 900.0
        SimulationBackendHandler.practice_result_callback_url = ""
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), SimulationBackendHandler)
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

    def test_sequence_practice_types_return_student_and_job_ids(self):
        for practice_type in ("inspection2", "inspection4"):
            with self.subTest(practice_type=practice_type):
                status, created = self._post(
                    "/api/practice/session",
                    {"practiceType": practice_type, "studentid": "student-1", "jobid": "job-1"},
                )

                self.assertEqual(status, 200)
                self.assertEqual(created["practiceType"], practice_type)
                self.assertEqual(created["practiceSessionId"], created["sessionId"])
                self.assertNotIn("simulationSessionId", created)
                session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
                self.assertFalse(hasattr(session, "optimal_action_sequence"))

                for action_number in (1, 2, 3, 4, 5):
                    action_status, action_result = self._post(
                        f"/api/practice/session/{created['practiceSessionId']}/action",
                        {"actionNumber": action_number},
                    )
                    self.assertEqual(action_status, 200)
                    self.assertEqual(action_result, {"status": "success"})

                submit_status, submitted = self._post(
                    f"/api/practice/session/{created['practiceSessionId']}/submit",
                    {},
                )
                self.assertEqual(submit_status, 200)
                self.assertEqual(submitted, {
                    "studentId": "student-1",
                    "jobId": "job-1",
                    "totalScore": 100.0,
                    "resultDelivery": {"status": "skipped", "reason": "callback-not-configured"},
                })

    def test_fixed_score_practice_types_submit_without_actions(self):
        for practice_type in ("inspection1", "inspection3", "powerOnSelfTestTraining"):
            with self.subTest(practice_type=practice_type):
                status, created = self._post(
                    "/api/practice/session",
                    {"practiceType": practice_type, "studentid": "student-2", "jobid": "job-2"},
                )
                self.assertEqual(status, 200)
                self.assertEqual(created["practiceType"], practice_type)
                self.assertNotIn("simulationSessionId", created)

                submit_status, submitted = self._post(
                    f"/api/practice/session/{created['practiceSessionId']}/submit",
                    {},
                )
                self.assertEqual(submit_status, 200)
                self.assertEqual(submitted, {
                    "studentId": "student-2",
                    "jobId": "job-2",
                    "totalScore": 100.0,
                    "resultDelivery": {"status": "skipped", "reason": "callback-not-configured"},
                })

    def test_all_lightweight_practice_types_post_score_to_student_service(self):
        callback_url = "http://127.0.0.1:9000/student/practice/result"
        with patch.object(
            SimulationBackendHandler,
            "practice_result_callback_url",
            callback_url,
        ), patch("backend.server.urlopen") as mocked_urlopen:
            callback_response = MagicMock()
            callback_response.status = 201
            mocked_urlopen.return_value.__enter__.return_value = callback_response

            for practice_type in (
                "inspection1", "inspection2", "inspection3", "inspection4",
                "powerOnSelfTestTraining", "powerOnSelfTestExam",
            ):
                with self.subTest(practice_type=practice_type):
                    status, created = self._post(
                        "/api/practice/session",
                        {"practiceType": practice_type, "studentid": 21, "jobid": 61},
                    )
                    self.assertEqual(status, 200)
                    session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
                    if practice_type in ("inspection2", "inspection4", "powerOnSelfTestExam"):
                        for action_number in (1, 3, 2, 4, 5):
                            action = {"actionNumber": action_number}
                            if practice_type == "powerOnSelfTestExam":
                                action["isCorrect"] = action_number != 4
                            action_status, _ = self._post(
                                f"/api/practice/session/{created['practiceSessionId']}/action",
                                action,
                            )
                            self.assertEqual(action_status, 200)

                    status, submitted = self._post(
                        f"/api/practice/session/{created['practiceSessionId']}/submit",
                        {},
                    )
                    self.assertEqual(status, 200)
                    expected_score = {
                        "inspection2": 60.0,
                        "inspection4": 60.0,
                        "powerOnSelfTestExam": 50.0,
                    }.get(practice_type, 100.0)
                    self.assertEqual(submitted["totalScore"], expected_score)
                    self.assertEqual(set(submitted), {"studentId", "jobId", "totalScore", "resultDelivery"})
                    self.assertEqual(submitted["studentId"], "21")
                    self.assertEqual(submitted["jobId"], "61")
                    self.assertEqual(submitted["resultDelivery"], {
                        "status": "delivered",
                        "url": callback_url,
                        "httpStatus": 201,
                    })
                    request = mocked_urlopen.call_args.args[0]
                    self.assertEqual(request.full_url, callback_url)
                    self.assertEqual(json.loads(request.data.decode("utf-8")), {
                        "studentId": 21,
                        "jobId": 61,
                        "evaluationReport": {
                            "totalScore": expected_score,
                            "submittedAt": datetime.fromtimestamp(session.submitted_at, tz=timezone.utc)
                            .isoformat()
                            .replace("+00:00", "Z"),
                            "totalDurationSeconds": round(max(0.0, session.submitted_at - session.created_at)),
                        },
                    })

            self.assertEqual(mocked_urlopen.call_count, 6)

    def test_lightweight_practice_requires_student_and_job_ids(self):
        for practice_type in (
            "inspection1", "inspection2", "inspection3", "inspection4",
            "powerOnSelfTestTraining", "powerOnSelfTestExam",
        ):
            with self.subTest(practice_type=practice_type):
                for payload, missing_field in (
                    ({"practiceType": practice_type}, "studentid"),
                    ({"practiceType": practice_type, "studentid": "student-1"}, "jobid"),
                ):
                    status, rejected = self._post("/api/practice/session", payload)
                    self.assertEqual(status, 400)
                    self.assertEqual(rejected["field"], missing_field)

    def test_fixed_score_practice_types_reject_actions(self):
        for practice_type in ("inspection1", "inspection3", "powerOnSelfTestTraining"):
            with self.subTest(practice_type=practice_type):
                status, created = self._post(
                    "/api/practice/session",
                    {"practiceType": practice_type, "studentid": "student-1", "jobid": "job-1"},
                )
                self.assertEqual(status, 200)

                action_status, rejected = self._post(
                    f"/api/practice/session/{created['practiceSessionId']}/action",
                    {"actionNumber": 1},
                )
                self.assertEqual(action_status, 400)
                self.assertEqual(rejected["field"], "actionNumber")

    def test_power_on_self_test_exam_gates_correctness_score_on_step_order(self):
        for first_action, expected_score in (
            ({"actionNumber": 1, "isCorrect": True}, 100.0),
            ({"actionNumber": 1, "isCorrect": False}, 90.0),
            ({"actionNumber": 2, "isCorrect": True}, 80.0),
            ({"actionNumber": 2, "isCorrect": False}, 80.0),
        ):
            with self.subTest(first_action=first_action):
                status, created = self._post("/api/practice/session", {
                    "practiceType": "powerOnSelfTestExam",
                    "studentid": "student-self-test",
                    "jobid": "job-self-test",
                })
                self.assertEqual(status, 200)
                self.assertEqual(created["practiceType"], "powerOnSelfTestExam")
                self.assertNotIn("simulationSessionId", created)
                self.assertNotIn("optimalActionSequence", created)
                session_id = created["practiceSessionId"]
                actions = [first_action] + [
                    {"actionNumber": number, "isCorrect": True} for number in (2, 3, 4, 5)
                ]
                for action in actions:
                    action_status, result = self._post(f"/api/practice/session/{session_id}/action", action)
                    self.assertEqual(action_status, 200)
                    self.assertEqual(result, {"status": "success"})
                status, submitted = self._post(f"/api/practice/session/{session_id}/submit", {})
                self.assertEqual(status, 200)
                self.assertEqual(submitted, {
                    "studentId": "student-self-test",
                    "jobId": "job-self-test",
                    "totalScore": expected_score,
                    "resultDelivery": {"status": "skipped", "reason": "callback-not-configured"},
                })
                self.assertNotIn(session_id, SimulationBackendHandler.practice_sessions)
                status, _ = self._post(f"/api/practice/session/{session_id}/submit", {})
                self.assertEqual(status, 404)

    def test_power_on_self_test_exam_score_extremes(self):
        for numbers, is_correct, expected_score in (
            ((1, 2, 3, 4, 5), False, 50.0),
            ((2, 3, 4, 5, 1), True, 0.0),
            ((2, 3, 4, 5, 1), False, 0.0),
        ):
            with self.subTest(numbers=numbers, is_correct=is_correct):
                status, created = self._post("/api/practice/session", {
                    "practiceType": "powerOnSelfTestExam", "studentid": 21, "jobid": 61,
                })
                self.assertEqual(status, 200)
                session_id = created["practiceSessionId"]
                for number in numbers:
                    status, _ = self._post(f"/api/practice/session/{session_id}/action", {
                        "actionNumber": number, "isCorrect": is_correct,
                    })
                    self.assertEqual(status, 200)
                status, submitted = self._post(f"/api/practice/session/{session_id}/submit", {})
                self.assertEqual(status, 200)
                self.assertEqual(submitted["totalScore"], expected_score)

    def test_power_on_self_test_exam_rejects_missing_or_non_boolean_correctness(self):
        status, created = self._post("/api/practice/session", {
            "practiceType": "powerOnSelfTestExam", "studentid": "student-1", "jobid": "job-1",
        })
        self.assertEqual(status, 200)
        session_id = created["practiceSessionId"]
        for payload in [{"actionNumber": 1}] + [
            {"actionNumber": 1, "isCorrect": value} for value in (None, 0, 1, "true", "false", [], {})
        ]:
            with self.subTest(payload=payload):
                status, rejected = self._post(f"/api/practice/session/{session_id}/action", payload)
                self.assertEqual(status, 400)
                self.assertEqual(rejected["field"], "isCorrect")
        for number in (True, None, 0, -1, 1.5, "1"):
            with self.subTest(action_number=number):
                status, rejected = self._post(f"/api/practice/session/{session_id}/action", {
                    "actionNumber": number, "isCorrect": True,
                })
                self.assertEqual(status, 400)
                self.assertEqual(rejected["field"], "actionNumber")
        session = SimulationBackendHandler.practice_sessions[session_id]
        self.assertEqual(session.student_action_sequence, [])
        self.assertEqual(session.student_action_correctness, [])
        for number in (1, 2, 3, 4, 5):
            status, _ = self._post(f"/api/practice/session/{session_id}/action", {
                "actionNumber": number, "isCorrect": True,
            })
            self.assertEqual(status, 200)
        status, submitted = self._post(f"/api/practice/session/{session_id}/submit", {})
        self.assertEqual(status, 200)
        self.assertEqual(submitted["totalScore"], 100.0)

    def test_power_on_self_test_exam_requires_exactly_five_actions(self):
        for action_count in (0, 4, 6):
            with self.subTest(action_count=action_count):
                status, created = self._post("/api/practice/session", {
                    "practiceType": "powerOnSelfTestExam", "studentid": "student-1", "jobid": "job-1",
                })
                self.assertEqual(status, 200)
                session_id = created["practiceSessionId"]
                for number in range(1, action_count + 1):
                    status, _ = self._post(f"/api/practice/session/{session_id}/action", {
                        "actionNumber": number, "isCorrect": True,
                    })
                    self.assertEqual(status, 200)
                status, rejected = self._post(f"/api/practice/session/{session_id}/submit", {})
                self.assertEqual(status, 400)
                self.assertEqual(rejected["field"], "actionNumber")
                self.assertIn(session_id, SimulationBackendHandler.practice_sessions)

    def test_power_on_self_test_exam_action_limit_does_not_record_rejected_step(self):
        status, created = self._post("/api/practice/session", {
            "practiceType": "powerOnSelfTestExam", "studentid": "student-1", "jobid": "job-1",
            "resourceLimits": {"maxActions": 1},
        })
        self.assertEqual(status, 200)
        session_id = created["practiceSessionId"]
        status, _ = self._post(f"/api/practice/session/{session_id}/action", {
            "actionNumber": 1, "isCorrect": True,
        })
        self.assertEqual(status, 200)
        status, rejected = self._post(f"/api/practice/session/{session_id}/action", {
            "actionNumber": 2, "isCorrect": False,
        })
        self.assertEqual(status, 400)
        self.assertEqual(rejected["field"], "resourceLimits.maxActions")
        session = SimulationBackendHandler.practice_sessions[session_id]
        self.assertEqual(session.student_action_sequence, [1])
        self.assertEqual(session.student_action_correctness, [True])

    def test_sequence_practice_deducts_by_action_position_and_returns_ids(self):
        for practice_type in ("inspection2", "inspection4"):
            with self.subTest(practice_type=practice_type):
                status, created = self._post(
                    "/api/practice/session",
                    {"practiceType": practice_type, "studentid": "student-1", "jobid": "job-1"},
                )
                self.assertEqual(status, 200)

                for action_number in (1, 3, 2, 4, 5):
                    status, result = self._post(
                        f"/api/practice/session/{created['practiceSessionId']}/action",
                        {"actionNumber": action_number},
                    )
                    self.assertEqual(status, 200)
                    self.assertEqual(result, {"status": "success"})

                status, submitted = self._post(
                    f"/api/practice/session/{created['practiceSessionId']}/submit",
                    {},
                )
                self.assertEqual(status, 200)
                self.assertEqual(submitted, {
                    "studentId": "student-1",
                    "jobId": "job-1",
                    "totalScore": 60.0,
                    "resultDelivery": {"status": "skipped", "reason": "callback-not-configured"},
                })

    def test_sequence_practice_requires_the_fixed_action_count_before_submit(self):
        status, created = self._post(
            "/api/practice/session",
            {"practiceType": "inspection4", "studentid": "student-1", "jobid": "job-1"},
        )
        self.assertEqual(status, 200)
        for action_number in (1, 2, 3, 4):
            status, result = self._post(
                f"/api/practice/session/{created['practiceSessionId']}/action",
                {"actionNumber": action_number},
            )
            self.assertEqual(status, 200)

        status, rejected = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {},
        )
        self.assertEqual(status, 400)
        self.assertEqual(rejected["field"], "actionNumber")

    def test_sequence_practice_rejects_invalid_type_and_action_number(self):
        status, rejected = self._post(
            "/api/practice/session",
            {"practiceType": "unknown"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(rejected["field"], "practiceType")

        status, created = self._post(
            "/api/practice/session",
            {"practiceType": "inspection2", "studentid": "student-1", "jobid": "job-1"},
        )
        self.assertEqual(status, 200)
        status, rejected = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {"actionNumber": True},
        )
        self.assertEqual(status, 400)
        self.assertEqual(rejected["field"], "actionNumber")

    def test_create_practice_session_retains_supplied_private_task_data(self):
        initial_recommended_path = {
            "ok": True,
            "faultId": "target-fault",
            "steps": [{"index": 1, "actionType": "measurePoint", "pointCode": "M1"}],
            "keySteps": [
                {
                    "id": "measure-v1",
                    "action": "measure",
                    "actionType": "measurePoint",
                    "pointId": "tp-virtual",
                    "pointCode": "V1",
                    "text": "检测测点 V1",
                },
                {
                    "id": "replace-sim-1",
                    "action": "replaceComponent",
                    "targetId": "sim-1",
                    "targetLabel": "仿真设备",
                    "text": "更换设备：仿真设备",
                },
            ],
            "summary": "custom initial path",
        }

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
                "initialRecommendedPath": initial_recommended_path,
                # Legacy client data must not override the authored key steps.
                "keyNodes": [{"nodeId": "ignored-legacy-node"}],
            },
        )

        self.assertEqual(status, 200)
        self.assertNotIn("initialRecommendedPath", created)
        self.assertNotIn("keyNodes", created)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertEqual(session.initial_best_path, initial_recommended_path)
        self.assertEqual(
            session.fault_tree_key_nodes,
            [
                {
                    "nodeId": "measure-V1",
                    "type": "measurePoint",
                    "pointCode": "V1",
                    "label": "检测测点 V1",
                    "score": 6.0,
                },
                {
                    "nodeId": "repair-component-sim-1",
                    "type": "repairTarget",
                    "target": {"type": "component", "id": "sim-1"},
                    "faultIds": ["target-fault"],
                    "label": "仿真设备",
                    "score": 6.0,
                },
            ],
        )

    def test_practice_candidates_are_fault_combinations_for_multi_fault_tasks(self):
        matrix = sample_d_matrix()
        matrix["points"][0]["pointType"] = "physical"
        matrix["points"][1]["pointType"] = "physical"
        matrix["rows"] = matrix["rows"][:2]
        matrix["rows"][0]["cells"][0]["detectable"] = True
        matrix["rows"][0]["cells"][1]["detectable"] = False
        matrix["rows"][1]["cells"][0]["detectable"] = False
        matrix["rows"][1]["cells"][1]["detectable"] = True

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": matrix,
                "targetFaultIds": ["target-fault", "controller-fault"],
                "initialPointStates": [
                    {"pointCode": "M1", "observed": "abnormal"},
                    {"pointCode": "M2", "observed": "abnormal"},
                ],
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        reference = session._build_dynamic_reference()
        self.assertEqual(
            reference["candidateFaultCombinations"],
            [["target-fault", "controller-fault"]],
        )
        self.assertEqual(reference["candidateFaultIds"], ["target-fault", "controller-fault"])
        self.assertEqual(reference["basis"], "currentEvidenceAndFaultCombinations")

    def test_practice_session_builds_knowledge_graph_from_model_and_d_matrix(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        graph = session.diagnostic_knowledge_graph
        node_keys = {(node["kind"], node["id"]) for node in graph["nodes"]}
        relation_types = {relation["type"] for relation in graph["relations"]}
        self.assertIn(("component", "sim-1"), node_keys)
        self.assertIn(("signalEdge", "edge-sim-scope"), node_keys)
        self.assertIn(("measurementPoint", "tp-virtual"), node_keys)
        self.assertTrue({"OUTPUTS_TO", "INPUTS_TO", "DETECTABILITY", "RESOLVED_BY_REPLACING"}.issubset(relation_types))

    def test_measurement_recommendations_query_session_knowledge_graph_detectability(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_rankable_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        before_point_codes = {
            action.get("pointCode")
            for action in session._build_dynamic_reference()["recommendedActionSet"]
            if action.get("actionType") == "measurePoint"
        }
        self.assertIn("V1", before_point_codes)

        session.diagnostic_knowledge_graph["relations"] = [
            relation
            for relation in session.diagnostic_knowledge_graph["relations"]
            if not (
                relation.get("type") == "DETECTABILITY"
                and (relation.get("target") or {}).get("id") == "tp-virtual"
            )
        ]
        session._index_diagnostic_knowledge_graph()
        after_point_codes = {
            action.get("pointCode")
            for action in session._build_dynamic_reference()["recommendedActionSet"]
            if action.get("actionType") == "measurePoint"
        }
        self.assertNotIn("V1", after_point_codes)

    def test_submit_accepts_multiple_final_target_ids_with_order_independent_exact_match(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultIds": ["target-fault", "controller-fault"],
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {"finalTargetIds": ["edge-sim-scope", "sim-1"]},
        )

        self.assertEqual(status, 200)
        conclusion = submitted["evaluationReport"]["targetConclusion"]
        self.assertTrue(conclusion["exactMatch"])
        self.assertEqual(conclusion["setAccuracy"], 1.0)
        self.assertEqual(conclusion["precision"], 1.0)
        self.assertEqual(conclusion["recall"], 1.0)
        self.assertEqual(conclusion["missedTargetIds"], [])
        self.assertEqual(conclusion["extraTargetIds"], [])
        score_details = {
            item["item"]: item["score"]
            for item in submitted["evaluationReport"]["scoreDetails"]
        }
        self.assertEqual(score_details["faultLocalization"], 30)

    def test_submit_scores_duplicate_wire_ids_as_one_canonical_target(self):
        matrix = d_matrix_with_physical_and_virtual_points()
        target_row = next(row for row in matrix["rows"] if row["faultId"] == "target-fault")
        target_row["targetId"] = "edge-duplicate"
        target_row["targetEdgeId"] = "edge-duplicate"
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        for relation in session.diagnostic_knowledge_graph["relations"]:
            if (
                relation.get("type") == "OCCURS_ON"
                and (relation.get("source") or {}).get("id") == "target-fault"
            ):
                relation["target"] = {"kind": "signalEdge", "id": "edge-sim-scope"}

        status, submitted = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {"finalTargetIds": ["edge-duplicate"]},
        )

        self.assertEqual(status, 200)
        conclusion = submitted["evaluationReport"]["targetConclusion"]
        self.assertTrue(conclusion["exactMatch"])
        self.assertEqual(conclusion["expectedTargetIds"], ["edge-sim-scope"])
        self.assertEqual(conclusion["studentTargetIds"], ["edge-sim-scope"])
        self.assertEqual(conclusion["matchedTargetIds"], ["edge-sim-scope"])
        self.assertEqual(conclusion["missedTargetIds"], [])
        self.assertEqual(conclusion["extraTargetIds"], [])

    def test_submit_scores_partial_multi_target_conclusion_by_jaccard_accuracy(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultIds": ["target-fault", "controller-fault"],
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {"finalTargetIds": ["sim-1", "source-1"]},
        )

        self.assertEqual(status, 200)
        conclusion = submitted["evaluationReport"]["targetConclusion"]
        self.assertFalse(conclusion["exactMatch"])
        self.assertEqual(conclusion["setAccuracy"], 0.333)
        self.assertEqual(conclusion["precision"], 0.5)
        self.assertEqual(conclusion["recall"], 0.5)
        self.assertEqual(conclusion["matchedTargetIds"], ["sim-1"])
        self.assertEqual(conclusion["missedTargetIds"], ["edge-sim-scope"])
        self.assertEqual(conclusion["extraTargetIds"], ["source-1"])
        score_details = {
            item["item"]: item["score"]
            for item in submitted["evaluationReport"]["scoreDetails"]
        }
        self.assertEqual(score_details["faultLocalization"], 10)

    def test_submit_requires_canvas_target_ids_not_private_fault_ids(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        status, rejected = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {"finalFaultIds": ["target-fault"]},
        )

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "INVALID_SCHEMA")
        self.assertEqual(rejected["field"], "finalTargetIds")

    def test_submit_accepts_arbitrary_final_target_ids(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/submit",
            {"finalTargetIds": ["external-result-id", "external-result-id"]},
        )

        self.assertEqual(status, 200)
        conclusion = submitted["evaluationReport"]["targetConclusion"]
        self.assertEqual(conclusion["studentTargetIds"], ["external-result-id"])
        self.assertEqual(conclusion["extraTargetIds"], ["external-result-id"])

    def test_rank_one_does_not_promote_a_low_value_action_to_optimal(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertEqual(
            session._match_quality_score({"rank": 1, "recommendationTier": "lowValue"}),
            ("lowValue", 0.4),
        )

    def test_repair_recommendations_use_candidate_knowledge_graph_not_runtime_fault_answer(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "runtime-answer",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 1.0,
            "parameters": {"bias": 0.5},
        }]
        matrix = d_matrix_with_physical_and_virtual_points()
        matrix["rows"][0].update({
            "targetKind": "node",
            "targetNodeId": "source-1",
            "targetLabel": "signal source",
        })

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
                "initialPointStates": [
                    {"pointCode": "M1", "observed": "abnormal"},
                    {"pointCode": "M2", "observed": "abnormal"},
                    {"pointCode": "M3", "observed": "normal"},
                ],
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        repair_targets = [
            action["target"]
            for action in session._build_dynamic_reference()["recommendedActionSet"]
            if action["actionType"] in {"replaceComponent", "replaceWire"}
        ]
        self.assertIn({"type": "component", "id": "source-1"}, repair_targets)
        self.assertNotIn({"type": "component", "id": "sim-1"}, repair_targets)

    def test_runs_valid_simulation_request(self):
        status, body = self._post("/api/simulations/run", valid_package())

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertIn("scope-1.ch1.actual", body["curves"]["channels"])

    def test_full_run_rejects_total_sample_count_above_hard_limit(self):
        package = valid_package()
        package["simulationConfig"] = {"duration": 1000.0, "stepSize": 0.0005}

        status, body = self._post("/api/simulations/run", package)

        self.assertEqual(status, 400)
        self.assertEqual(body["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(body["field"], "simulationConfig.samples")

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
        self.assertNotIn("source", body["plan"])
        self.assertNotIn("pathGeneration", body["plan"])
        self.assertNotIn("isCustomized", body["plan"])
        self.assertGreater(len(body["plan"]["steps"]), 0)
        self.assertGreater(len(body["plan"]["keySteps"]), 0)

    def test_builds_multi_fault_knowledge_graph_plan_through_the_backend_endpoint(self):
        matrix = sample_d_matrix()
        matrix["rows"][0].update({"targetKind": "node", "targetNodeId": "node-imu"})
        matrix["rows"][1].update({"targetKind": "edge", "targetEdgeId": "edge-controller"})

        status, body = self._post(
            "/api/troubleshooting/plan",
            {
                "dMatrix": matrix,
                "targetFaultIds": ["target-fault", "controller-fault"],
                "maxFaults": 2,
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["plan"]["mode"], "multiple")
        self.assertNotIn("source", body["plan"])
        self.assertNotIn("pathGeneration", body["plan"])
        self.assertNotIn("isCustomized", body["plan"])
        self.assertNotIn("knowledgeGraph", body["plan"])
        self.assertTrue(
            {step["action"] for step in body["plan"]["steps"]}.issubset(
                {"measure", "replaceWire", "replaceComponent"}
            )
        )

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

    def test_steps_simulation_session_on_actual_path_only(self):
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
        status, created = self._post("/api/simulations/session", package)
        self.assertEqual(status, 200)

        status, result = self._post(
            f"/api/simulations/session/{created['sessionId']}/step",
            {"steps": 1, "actualOnly": True},
        )

        self.assertEqual(status, 200)
        self.assertTrue(result["curves"]["channels"]["scope-1.ch1.actual"])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [])
        self.assertTrue(result["componentOutputs"]["steps"][0]["actual"])
        self.assertEqual(result["componentOutputs"]["steps"][0]["reference"], {})

    def test_rejects_non_boolean_actual_only_step_option(self):
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)

        status, result = self._post(
            f"/api/simulations/session/{created['sessionId']}/step",
            {"actualOnly": "true"},
        )

        self.assertEqual(status, 400)
        self.assertEqual(result["errorCode"], "INVALID_SCHEMA")
        self.assertEqual(result["field"], "actualOnly")

    def test_step_session_keeps_small_step_size_and_allows_long_total_timeline(self):
        package = valid_package()
        package["simulationConfig"] = {"duration": 1000.0, "stepSize": 0.0005}

        status, created = self._post("/api/simulations/session", package)
        self.assertEqual(status, 200)

        status, first = self._post(
            f"/api/simulations/session/{created['sessionId']}/step",
            {"steps": 1},
        )
        self.assertEqual(status, 200)
        self.assertEqual(first["metrics"]["sampleCount"], 1)
        self.assertEqual(first["metrics"]["stepIndex"], 1)
        self.assertFalse(first["metrics"]["done"])

    def test_generated_ids_use_full_uuid_and_retry_store_collisions(self):
        status, created = self._post("/api/simulations/session", valid_package())

        self.assertEqual(status, 200)
        self.assertRegex(created["runId"], r"^run-[0-9a-f]{32}$")
        self.assertRegex(created["sessionId"], r"^session-[0-9a-f]{32}$")

        duplicate = "a" * 32
        replacement = "b" * 32
        existing = {f"session-{duplicate}": object()}
        with patch(
            "backend.server.uuid.uuid4",
            side_effect=[SimpleNamespace(hex=duplicate), SimpleNamespace(hex=replacement)],
        ):
            generated = SimulationBackendHandler._new_id("session", existing)
        self.assertEqual(generated, f"session-{replacement}")

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
        self.assertEqual(status, 400)
        self.assertEqual(missing["errorCode"], "SESSION_NOT_FOUND")

    def test_active_reaper_removes_idle_standalone_simulation_session(self):
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)
        session_id = created["sessionId"]
        session = SimulationBackendHandler.sessions[session_id]
        session.idle_timeout_seconds = 10.0
        session.last_activity_at = 100.0

        removed = SimulationBackendHandler.purge_expired_sessions(now=111.0)

        self.assertEqual(removed, {"practiceSessions": 0, "simulationSessions": 1})
        self.assertNotIn(session_id, SimulationBackendHandler.sessions)

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

    def test_concurrent_session_creation_keeps_capacity_check_atomic(self):
        SimulationBackendHandler.max_active_simulation_sessions = 1

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(
                lambda _: self._post("/api/simulations/session", valid_package()),
                range(2),
            ))

        self.assertEqual(sorted(status for status, _ in results), [200, 400])
        self.assertEqual(len(SimulationBackendHandler.sessions), 1)

    def test_rejects_step_batch_that_would_exceed_response_sample_limit(self):
        SimulationBackendHandler.max_response_samples = 1
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)

        status, rejected = self._post(f"/api/simulations/session/{created['sessionId']}/step", {"steps": 2})

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "steps")

    def test_accepts_the_default_one_hundred_thousand_step_batch(self):
        status, created = self._post("/api/simulations/session", valid_package())
        self.assertEqual(status, 200)

        status, result = self._post(
            f"/api/simulations/session/{created['sessionId']}/step",
            {"steps": 100_000},
        )

        self.assertEqual(status, 200)
        self.assertEqual(result["metrics"]["sampleCount"], 3)

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
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["sourceDeviceId"], "passthrough")
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["sourcePort"], "socket03")
        self.assertEqual(updated["simulationResult"]["physicalMeasurements"][0]["samples"], [
            {"time": 0.0, "actual": 1.0, "constantRangeBoundary": "start"},
            {"time": 0.2, "actual": 1.0, "constantRangeBoundary": "end"},
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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("virtualMeasurement", measured)
        self.assertNotIn("troubleshootingState", measured)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalTargetIds": ["sim-1"], "submittedAt": "2026-06-28T00:01:00Z"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(submitted["status"], "success")
        report = submitted["evaluationReport"]
        self.assertTrue(all(step.get("text") for step in report["initialOptimalPath"]["steps"]))
        self.assertTrue(all(
            evaluation["studentAction"].get("text")
            for evaluation in report["stepEvaluations"]
        ))
        self.assertTrue(all(
            node.get("text")
            for node in report["keyNodeCoverage"]["nodes"]
        ))
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

    def test_replace_component_resolves_python_binding_module_id(self):
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

        status, updated = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-module-id",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "passthrough"},
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["normalizedAction"]["target"], {"type": "component", "id": "passthrough"})
        self.assertEqual(updated["normalizedAction"]["resolvedTarget"], {"type": "component", "id": "sim-1"})

    def test_practice_full_rerun_rejects_total_sample_count_and_rolls_back_action(self):
        package = valid_package()
        package["simulationConfig"] = {"duration": 1000.0, "stepSize": 0.0005}
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

        status, rejected = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {
                "operationId": "op-full-run-limit",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(rejected["errorCode"], "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(rejected["field"], "simulationConfig.samples")
        self.assertEqual(session.student_actions, [])
        self.assertEqual(session.simulation_action_history, [])
        self.assertEqual(session.repair_attempts, [])

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
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]

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
            [2.5, 2.5],
        )
        self.assertEqual(
            session.latest_simulation_result["curves"]["channels"]["scope-1.ch1.reference"],
            [],
        )
        self.assertEqual(session.simulation_session.module_states["reference"], {})
        self.assertEqual(session.latest_physical_measurement_snapshot["source"], "d-matrix")
        self.assertEqual(session.latest_physical_measurement_snapshot["abnormalPointCodes"], [])
        self.assertIn("M1", session.latest_physical_measurement_snapshot["normalPointCodes"])
        self.assertEqual(session.repair_attempts[-1]["repairEffect"]["status"], "recovered")

    def test_live_path_refreshes_after_optional_console_condition_action(self):
        matrix = {
            "diagnosticContext": {"values": {"component:source-1:value": 1}},
            "points": [{
                "pointId": "M1",
                "shortName": "M1",
                "name": "physical point M1",
                "pointType": "physical",
                "channel": "scope-1.ch1",
                "conditionKeys": ["component:source-1:value"],
                "detectabilityRules": [
                    {"faultId": "fault-a", "when": {"component:source-1:value": 1}, "detectable": True},
                    {"faultId": "fault-a", "when": {"component:source-1:value": 2}, "detectable": False},
                    {"faultId": "fault-b", "when": {"component:source-1:value": 1}, "detectable": True},
                    {"faultId": "fault-b", "when": {"component:source-1:value": 2}, "detectable": True},
                ],
            }],
            "rows": [
                {"faultId": "fault-a", "faultName": "fault A", "targetNodeId": "sim-1", "cells": [{"pointCode": "M1", "detectable": True, "value": 1}]},
                {"faultId": "fault-b", "faultName": "fault B", "targetNodeId": "source-1", "cells": [{"pointCode": "M1", "detectable": True, "value": 1}]},
            ],
        }
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": matrix,
                "targetFaultId": "fault-a",
                "displayConsoleControls": [{
                    "displayConsoleId": "console-1",
                    "targetComponentId": "source-1",
                    "parameterKeys": ["value"],
                }],
                "diagnosticConditions": [{
                    "key": "component:source-1:value",
                    "componentId": "source-1",
                    "parameterKey": "value",
                    "label": "输入模式",
                    "options": [{"value": 1, "label": "工况 1"}, {"value": 2, "label": "工况 2"}],
                    "currentValue": 1,
                }],
            },
        )

        self.assertEqual(status, 200)
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        self.assertNotEqual(
            (session._build_dynamic_reference().get("nextContinuousAction") or {}).get("actionType"),
            "adjustDisplayConsoleParameter",
        )

        status, updated = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {
                "operationId": "op-optional-condition",
                "actionType": "adjustDisplayConsoleParameter",
                "target": {"type": "displayConsole", "id": "console-1"},
                "componentId": "source-1",
                "parameter": "value",
                "value": 2,
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["simulationResult"]["diagnosticContext"]["values"], {"component:source-1:value": 2.0})
        self.assertTrue(session._build_dynamic_reference()["continuousPath"]["isolated"])

    def test_operation_id_is_idempotent_and_rejects_conflicting_reuse(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
                "resourceLimits": {"maxActions": 1},
                "displayConsoleControls": [{
                    "displayConsoleId": "console-1",
                    "targetComponentId": "source-1",
                    "componentType": "signal_source",
                    "parameterKeys": ["value"],
                }],
            },
        )
        self.assertEqual(status, 200)
        session_id = created["practiceSessionId"]
        action = {
            "operationId": "op-idempotent",
            "actionType": "adjustDisplayConsoleParameter",
            "target": {"type": "displayConsole", "id": "console-1"},
            "componentId": "source-1",
            "parameters": {"value": 2.5},
        }

        first_status, first = self._post(f"/api/practice/session/{session_id}/action", action)
        retry_status, retry = self._post(f"/api/practice/session/{session_id}/action", action)

        self.assertEqual((first_status, retry_status), (200, 200))
        self.assertEqual(first["normalizedAction"], retry["normalizedAction"])
        session = SimulationBackendHandler.practice_sessions[session_id]
        self.assertEqual(len(session.student_actions), 1)
        self.assertEqual(len(session.simulation_action_history), 1)
        self.assertEqual(session.simulation_session.graph.nodes["source-1"].parameters["value"], 2.5)

        conflict_status, conflict = self._post(
            f"/api/practice/session/{session_id}/action",
            {**action, "parameters": {"value": 3.0}},
        )
        self.assertEqual(conflict_status, 409)
        self.assertEqual(conflict["errorCode"], "OPERATION_ID_CONFLICT")
        self.assertEqual(conflict["field"], "operationId")
        self.assertEqual(len(session.student_actions), 1)
        self.assertEqual(session.simulation_session.graph.nodes["source-1"].parameters["value"], 2.5)

    def test_different_practice_sessions_can_rerun_concurrently(self):
        session_ids = []
        for index in range(2):
            status, created = self._post(
                "/api/practice/session",
                {
                    "simulationPackage": valid_package(),
                    "dMatrix": d_matrix_with_physical_and_virtual_points(),
                    "targetFaultId": "target-fault",
                    "displayConsoleControls": [{
                        "displayConsoleId": f"console-{index}",
                        "targetComponentId": "source-1",
                        "componentType": "signal_source",
                        "parameterKeys": ["value"],
                    }],
                },
            )
            self.assertEqual(status, 200)
            session_ids.append(created["practiceSessionId"])

        barrier = threading.Barrier(2)
        for session_id in session_ids:
            simulation = SimulationBackendHandler.practice_sessions[session_id].simulation_session
            original_rerun = simulation.run_from_zero

            def synchronized_rerun(original=original_rerun):
                barrier.wait(timeout=3)
                return original()

            simulation.run_from_zero = synchronized_rerun

        def adjust(index):
            return self._post(
                f"/api/practice/session/{session_ids[index]}/action",
                {
                    "operationId": f"op-concurrent-{index}",
                    "actionType": "adjustDisplayConsoleParameter",
                    "target": {"type": "displayConsole", "id": f"console-{index}"},
                    "componentId": "source-1",
                    "parameters": {"value": 2.0 + index},
                },
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(adjust, range(2)))

        self.assertEqual([status for status, _ in results], [200, 200])

    def test_failed_practice_creation_releases_both_capacity_reservations(self):
        with patch(
            "backend.server.PracticeSession.initial_response",
            side_effect=RuntimeError("forced initial response failure"),
        ), self.assertLogs("backend.server", level="ERROR"):
            status, response = self._post(
                "/api/practice/session",
                {
                    "simulationPackage": valid_package(),
                    "dMatrix": d_matrix_with_physical_and_virtual_points(),
                    "targetFaultId": "target-fault",
                },
            )

        self.assertEqual(status, 500)
        self.assertEqual(response["errorCode"], "INTERNAL_ERROR")
        self.assertNotIn("forced initial response failure", response["message"])
        self.assertEqual(SimulationBackendHandler.practice_sessions, {})
        self.assertEqual(SimulationBackendHandler.sessions, {})

    def test_failed_wire_repair_rolls_back_simulation_and_practice_state(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "target-fault",
            "faultType": "wire_open",
            "targetId": "edge-sim-scope",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {},
        }]
        matrix = d_matrix_with_physical_and_virtual_points()
        matrix["points"][0].update({
            # A legacy point can retain its parent canvas ID. The simulation
            # result must resolve the real component that emits the edge.
            "sourceDeviceId": "canvas-flight-control",
            "sourceNodeId": "canvas-flight-control",
            "measurementSourceNodeId": "sim-1",
        })
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        simulation = session.simulation_session
        simulation.step_index = 1
        simulation.fault_runtime.disconnect_edge("edge-sim-scope")
        simulation.fault_runtime.edge_state["edge-sim-scope"] = {"last": 7.0}
        simulation.module_states["actual"]["existing"] = {"value": 1.0}
        simulation.previous_values[("actual", "existing")] = 2.0
        initial_runtime_state = {
            "stepIndex": simulation.step_index,
            "edgeState": copy.deepcopy(simulation.fault_runtime.edge_state),
            "disconnectedEdgeIds": copy.deepcopy(simulation.fault_runtime.disconnected_edge_ids),
            "moduleStates": copy.deepcopy(simulation.module_states),
            "previousValues": copy.deepcopy(simulation.previous_values),
        }
        initial_practice_state = {
            "studentActions": copy.deepcopy(session.student_actions),
            "simulationActionHistory": copy.deepcopy(session.simulation_action_history),
            "repairAttempts": copy.deepcopy(session.repair_attempts),
            "physicalMeasurementSnapshots": copy.deepcopy(session.physical_measurement_snapshots),
            "latestPhysicalMeasurementSnapshot": copy.deepcopy(session.latest_physical_measurement_snapshot),
            "lastActivityAt": session.last_activity_at,
        }

        def fail_rerun():
            simulation.step_index = 2
            simulation.fault_runtime.edge_state["dirty"] = {"last": 9.0}
            simulation.module_states["actual"]["dirty"] = {"value": 9.0}
            simulation.previous_values[("actual", "dirty")] = 9.0
            raise RuntimeError("forced rerun failure")

        simulation.run_from_zero = fail_rerun
        status, response = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {
                "operationId": "op-rollback-wire",
                "actionType": "replaceWire",
                "target": {"type": "wire", "id": "edge-sim-scope"},
            },
        )

        self.assertEqual(status, 500)
        self.assertEqual(response["errorCode"], "INTERNAL_ERROR")
        self.assertEqual(
            response["message"],
            "internal server error; use runId to locate the server log",
        )
        self.assertEqual(simulation.step_index, initial_runtime_state["stepIndex"])
        self.assertEqual(simulation.fault_runtime.edge_state, initial_runtime_state["edgeState"])
        self.assertEqual(
            simulation.fault_runtime.disconnected_edge_ids,
            initial_runtime_state["disconnectedEdgeIds"],
        )
        self.assertEqual(simulation.module_states, initial_runtime_state["moduleStates"])
        self.assertEqual(simulation.previous_values, initial_runtime_state["previousValues"])
        self.assertTrue(simulation.fault_runtime.fault_instances[0]["enabled"])
        self.assertTrue(simulation.graph.fault_instances[0]["enabled"])
        self.assertIs(simulation.fault_runtime.fault_instances, simulation.graph.fault_instances)
        self.assertEqual(session.student_actions, initial_practice_state["studentActions"])
        self.assertEqual(
            session.simulation_action_history,
            initial_practice_state["simulationActionHistory"],
        )
        self.assertEqual(session.repair_attempts, initial_practice_state["repairAttempts"])
        self.assertEqual(
            session.physical_measurement_snapshots,
            initial_practice_state["physicalMeasurementSnapshots"],
        )
        self.assertEqual(
            session.latest_physical_measurement_snapshot,
            initial_practice_state["latestPhysicalMeasurementSnapshot"],
        )
        self.assertEqual(session.last_activity_at, initial_practice_state["lastActivityAt"])

    def test_failed_display_parameter_action_restores_node_parameters(self):
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

        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]

        def fail_rerun():
            raise RuntimeError("forced parameter rerun failure")

        session.simulation_session.run_from_zero = fail_rerun
        status, response = self._post(
            f"/api/practice/session/{created['practiceSessionId']}/action",
            {
                "operationId": "op-rollback-parameter",
                "actionType": "adjustDisplayConsoleParameter",
                "target": {"type": "displayConsole", "id": "console-1"},
                "componentId": "source-1",
                "parameter": "value",
                "value": 2.5,
            },
        )

        self.assertEqual(status, 500)
        self.assertEqual(
            response["message"],
            "internal server error; use runId to locate the server log",
        )
        self.assertEqual(session.simulation_session.graph.nodes["source-1"].parameters["value"], 1.0)
        self.assertEqual(session.student_actions, [])
        self.assertEqual(session.simulation_action_history, [])
        self.assertEqual(session.repair_attempts, [])

    def test_submit_returns_internal_action_path_for_measurement_and_wire_repair(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "target-fault",
            "faultType": "wire_open",
            "targetId": "edge-sim-scope",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        matrix = d_matrix_with_rankable_virtual_points()
        matrix["rows"][0].update({
            "targetKind": "edge",
            "targetEdgeId": "edge-sim-scope",
            "targetLabel": "simulation output wire",
        })
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": matrix,
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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
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
            {"finalTargetIds": ["edge-sim-scope"]},
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
                and step.get("routeRole") == "repairAttempt"
                and step.get("text") == "更换连线：sim-1 · output → scope-1 · CH1。"
                for step in initial_steps
            )
        )
        self.assertTrue(all("faultId" not in step for step in initial_steps if "faultIds" in step))
        self.assertNotIn("record", submitted)
        evaluations = submitted["evaluationReport"]["stepEvaluations"]
        self.assertEqual([item["studentAction"]["actionType"] for item in evaluations], ["measurePoint", "replaceWire"])
        self.assertEqual(evaluations[0]["studentAction"]["pointCode"], "V1")
        self.assertEqual(
            evaluations[1]["studentAction"]["target"],
            {"type": "wire", "name": "sim-1 · output → scope-1 · CH1"},
        )
        self.assertEqual(evaluations[1]["studentAction"]["faultId"], "fault-wire")
        self.assertEqual(evaluations[1]["studentAction"]["text"], "更换连线：sim-1 · output → scope-1 · CH1。")
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
            {"finalTargetIds": ["sim-1"], "submittedAt": "2000-01-01T00:00:00Z"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("record", submitted)
        step = submitted["evaluationReport"]["stepEvaluations"][0]
        self.assertNotIn("matchResult", step)
        self.assertEqual(step["studentRating"]["level"], "optimal")
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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
            },
        )
        self.assertEqual(status, 200)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalTargetIds": ["sim-1"]},
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

    def test_virtual_measurement_retains_full_candidate_universe_and_uses_saved_initial_result(self):
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
        self.assertEqual(session.max_candidate_fault_count, 3)
        self.assertEqual(len(session._all_candidate_fault_combinations()), 7)
        status, measured = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-v1",
                "actionType": "measurePoint",
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("simulationResult", measured)
        self.assertNotIn("V1", [point["shortName"] for point in session.active_d_matrix["points"]])
        self.assertTrue(all(
            all(cell.get("pointCode") != "V1" for cell in row["cells"])
            for row in session.active_d_matrix["rows"]
        ))
        self.assertEqual(len(session.active_d_matrix["rows"]), 3)
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
                "componentId": "scope-3",
                "portId": "CH1",
                "elementName": "输入",
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
            {"finalTargetIds": ["sim-1"]},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("record", submitted)
        evaluations = submitted["evaluationReport"]["stepEvaluations"]
        measurement_rating = evaluations[0]["studentRating"]
        self.assertEqual(measurement_rating["level"], "acceptable")
        self.assertGreater(measurement_rating["score"], 0)
        self.assertLess(measurement_rating["score"], 1.0)
        measurement_evaluation = evaluations[0]
        self.assertIn(
            "LOWER_INFORMATION_GAIN",
            {item["code"] for item in measurement_evaluation["deductionReasons"]},
        )

        repair_rating = evaluations[1]["studentRating"]
        self.assertEqual(repair_rating["level"], "unsafe")
        self.assertEqual(repair_rating["score"], 0.0)
        self.assertEqual(
            {item["code"] for item in evaluations[1]["deductionReasons"]},
            {"SAFETY_PREREQUISITE_MISSING"},
        )

    def test_initial_repair_actions_are_sorted_by_weight_and_include_safety_prerequisites(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [
            {
                "faultId": "target-fault",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.5,
                "parameters": {"bias": 0.5},
            },
            {
                "faultId": "controller-fault",
                "faultType": "wire_open",
                "targetId": "edge-sim-scope",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.5,
                "parameters": {"bias": 0.5},
            },
        ]
        matrix = d_matrix_with_physical_and_virtual_points()
        matrix["rows"] = matrix["rows"][:2]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
                "targetFaultIds": ["target-fault", "controller-fault"],
                "actionRules": {
                    "replaceComponent": {"requiresPowerOff": True, "durationSeconds": 120, "riskLevel": "high"},
                    "replaceWire": {"durationSeconds": 30, "riskLevel": "low"},
                },
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]
        session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        repair_nodes = [
            node for node in session.fault_tree_key_nodes if node.get("type") == "repairTarget"
        ]
        self.assertEqual(
            {tuple(sorted(node["target"].items())) for node in repair_nodes},
            {
                tuple(sorted({"type": "component", "id": "sim-1"}.items())),
                tuple(sorted({"type": "wire", "id": "edge-sim-scope"}.items())),
            },
        )
        self.assertEqual(sum(node["score"] for node in session.fault_tree_key_nodes), 12)

        status, submitted = self._post(
            f"/api/practice/session/{session_id}/submit",
            {"finalTargetIds": ["sim-1"]},
        )

        self.assertEqual(status, 200)
        repair_steps = [
            step
            for step in submitted["evaluationReport"]["initialOptimalPath"]["steps"]
            if step.get("routeRole") == "repairAttempt"
        ]
        self.assertEqual([step["actionType"] for step in repair_steps], ["replaceWire", "replaceComponent"])
        self.assertNotIn("riskCost", repair_steps[0])
        self.assertNotIn("timeCostSeconds", repair_steps[0])
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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
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

    def test_measure_point_resolves_both_endpoints_of_one_virtual_measurement(self):
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

        source_status, source_body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure-source-endpoint",
                "actionType": "measurePoint",
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
            },
        )
        self.assertEqual(source_status, 200)
        self.assertEqual(source_body["normalizedAction"]["pointCode"], "V1")
        self.assertEqual(source_body["normalizedAction"]["elementName"], "输出")
        self.assertEqual(source_body["normalizedAction"]["target"]["id"], "scope-1.ch1")

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        target_session_id = created["sessionId"]
        target_status, target_body = self._post(
            f"/api/practice/session/{target_session_id}/action",
            {
                "operationId": "op-measure-target-endpoint",
                "actionType": "measurePoint",
                "componentId": "scope-1",
                "portId": "CH1",
                "elementName": "输入",
            },
        )
        self.assertEqual(target_status, 200)
        self.assertEqual(target_body["normalizedAction"]["pointCode"], "V1")
        self.assertEqual(target_body["normalizedAction"]["elementName"], "输入")
        self.assertEqual(target_body["normalizedAction"]["target"]["id"], "scope-1.ch1")

    def test_measure_point_rejects_wrong_scalar_element_name(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        status, body = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-measure-wrong-scalar-element",
                "actionType": "measurePoint",
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "错误名称",
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["errorCode"], "TARGET_NOT_FOUND")
        self.assertEqual(body["field"], "elementName")

    def test_measure_point_uses_vector_element_name_to_resolve_endpoint(self):
        matrix = d_matrix_with_physical_and_virtual_points()
        vector_point = next(point for point in matrix["points"] if point.get("shortName") == "V1")
        vector_point["sourceVectorElementName"] = "A"
        vector_point["targetVectorElementName"] = "A输入"
        matrix["points"].append({
            "pointId": "tp-virtual-pitch",
            "shortName": "V2",
            "name": "virtual pitch point",
            "pointType": "virtual",
            "channel": "scope-1.ch1",
            "sourceVectorElementName": "B",
            "targetVectorElementName": "B输入",
        })
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        status, body = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-measure-vector-element",
                "actionType": "measurePoint",
                "componentId": "scope-1",
                "portId": "CH1",
                "elementName": "B输入",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["normalizedAction"]["pointCode"], "V2")
        self.assertEqual(body["normalizedAction"]["elementName"], "B输入")
        self.assertEqual(
            body["normalizedAction"]["resolvedMeasurementPoint"]["elementName"],
            "B输入",
        )
        self.assertNotIn("sourceVectorElementName", body["normalizedAction"])
        self.assertNotIn("targetVectorElementName", body["normalizedAction"])

    def test_measure_point_requires_element_name_for_every_point(self):
        matrix = d_matrix_with_physical_and_virtual_points()
        vector_point = next(point for point in matrix["points"] if point.get("shortName") == "V1")
        vector_point["sourceVectorElementName"] = "B"
        vector_point["targetVectorElementName"] = "B输入"
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": matrix,
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)

        status, body = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-measure-vector-without-name",
                "actionType": "measurePoint",
                "componentId": "sim-1",
                "portId": "socket03",
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["errorCode"], "INVALID_ACTION_SCHEMA")
        self.assertEqual(body["field"], "elementName")

    def test_measure_point_rejects_legacy_point_code_only_request(self):
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
        self.assertEqual(body["field"], "componentId")

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
        self.assertEqual(
            session.latest_simulation_result["curves"]["channels"]["scope-1.ch1.reference"],
            [],
        )
        self.assertEqual(session.simulation_session.module_states["reference"], {})

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
            [1.0, 1.0],
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
            [1.0, 1.0],
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
            [0.0, 0.2],
        )
        self.assertTrue(component_result["simulationResult"]["summary"]["done"])

        status, wire_result = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-replace-healthy-wire",
                "actionType": "replaceWire",
                "sourceComponentId": "source-1",
                "sourcePortId": "out",
                "targetComponentId": "passthrough",
                "targetPortId": "input",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("appliedAction", wire_result)
        self.assertEqual(
            wire_result["normalizedAction"]["target"],
            {"type": "wire", "id": "edge-source-sim"},
        )
        self.assertEqual(wire_result["normalizedAction"]["targetId"], "edge-source-sim")
        self.assertEqual(
            [sample["time"] for sample in wire_result["simulationResult"]["physicalMeasurements"][0]["samples"]],
            [0.0, 0.2],
        )
        self.assertTrue(wire_result["simulationResult"]["summary"]["done"])

    def test_replace_wire_uses_four_endpoint_binding_for_all_private_edges(self):
        package = valid_package()
        package["faultInstances"] = [
            {
                "faultId": "fault-input-wire",
                "faultType": "wire_open",
                "targetId": "edge-source-sim",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.3,
                "parameters": {},
            },
            {
                "faultId": "fault-output-wire",
                "faultType": "wire_open",
                "targetId": "edge-sim-scope",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.3,
                "parameters": {},
            },
        ]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
                "connectionBindings": [{
                    "sourceDeviceId": "external-device",
                    "sourcePort": "output",
                    "targetDeviceId": "subsystem-1",
                    "targetPort": "input",
                    "backingEdgeIds": ["edge-source-sim", "edge-sim-scope"],
                }],
            },
        )
        self.assertEqual(status, 200)

        status, result = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-replace-public-wire",
                "actionType": "replaceWire",
                "sourceDeviceId": "external-device",
                "sourcePort": "output",
                "targetDeviceId": "subsystem-1",
                "targetPort": "input",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            result["normalizedAction"]["targetIds"],
            ["edge-source-sim", "edge-sim-scope"],
        )
        self.assertTrue(result["simulationResult"]["summary"]["done"])

        package["connectionBindings"] = [{
            "sourceDeviceId": "external-device",
            "sourcePort": "output",
            "targetDeviceId": "subsystem-1",
            "targetPort": "input",
            "backingEdgeIds": ["edge-source-sim", "edge-sim-scope"],
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
                "connectionBindings": [],
            },
        )
        self.assertEqual(status, 200)

        status, result = self._post(
            f"/api/practice/session/{created['sessionId']}/action",
            {
                "operationId": "op-replace-embedded-public-wire",
                "actionType": "replaceWire",
                "sourceDeviceId": "external-device",
                "sourcePort": "output",
                "targetDeviceId": "subsystem-1",
                "targetPort": "input",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            result["normalizedAction"]["targetIds"],
            ["edge-source-sim", "edge-sim-scope"],
        )

    def test_rf_practice_repairs_return_complex_envelope_measurement_values(self):
        package = {
            "schemaVersion": 1,
            "packageId": "rf-practice-measurement",
            "simulationConfig": {"duration": 3e-6, "stepSize": 1e-6},
            "nodes": [
                {
                    "id": "rf-source", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "rf_complex_envelope_scalar_source", "entryFunction": "process"},
                    "parameters": {"center_frequency_hz": 20e9},
                    "outputs": [{"id": "output-0", "name": "output_envelope", "dataType": "rf_complex_envelope"}],
                },
                {
                    "id": "rf-vector", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "rf_complex_envelope_to_vector4", "entryFunction": "process"},
                    "inputs": [{"id": "input-0", "name": "input_envelope", "dataType": "rf_complex_envelope"}],
                    "outputs": [{"id": "output-0", "name": "envelope_vector", "dataType": "rf_complex_envelope", "vectorLength": 4}],
                },
                {
                    "id": "rf-receiver", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "rf_complex_envelope_vector4_dual_output_receiver", "entryFunction": "process"},
                    "inputs": [{"id": "input-0", "name": "input_envelope_vector", "dataType": "rf_complex_envelope", "vectorLength": 4}],
                    "outputs": [{"id": "output-0", "name": "output_envelope_vector_1", "dataType": "rf_complex_envelope", "vectorLength": 4}],
                },
            ],
            "edges": [
                {"id": "edge-rf", "sourceNodeId": "rf-source", "sourcePortIndex": 0,
                 "targetNodeId": "rf-vector", "targetPortIndex": 0},
                {"id": "edge-rf-vector", "sourceNodeId": "rf-vector", "sourcePortIndex": 0,
                 "targetNodeId": "rf-receiver", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [],
            "reportedNodeIds": [],
        }
        matrix = sample_d_matrix()
        matrix["points"][0].update({"edgeId": "edge-rf", "pointType": "physical"})
        matrix["points"][1].update({"edgeId": "edge-rf-vector", "pointType": "virtual", "vectorIndex": 2})
        matrix["points"][2].update({
            "edgeId": "public-rf-wire", "pointType": "physical",
            "sourceDeviceId": "external-rf-source", "sourcePort": "output-0",
            "targetDeviceId": "rf-subsystem", "targetPort": "input-0",
        })
        status, created = self._post("/api/practice/session", {
            "simulationPackage": package,
            "dMatrix": matrix,
            "targetFaultId": "target-fault",
            "connectionBindings": [{
                "sourceDeviceId": "external-rf-source", "sourcePort": "output-0",
                "targetDeviceId": "rf-subsystem", "targetPort": "input-0",
                "backingEdgeIds": ["edge-rf"],
            }],
        })
        self.assertEqual(status, 200)
        session_id = created["practiceSessionId"]

        actions = [
            {"operationId": "replace-rf-component", "actionType": "replaceComponent",
             "target": {"type": "component", "id": "rf_complex_envelope_scalar_source"}},
            {"operationId": "replace-rf-wire", "actionType": "replaceWire",
             "sourceDeviceId": "rf_complex_envelope_scalar_source", "sourcePort": "output-0",
             "targetDeviceId": "rf_complex_envelope_to_vector4", "targetPort": "input-0"},
        ]
        for action in actions:
            with self.subTest(action=action["actionType"]):
                status, response = self._post(f"/api/practice/session/{session_id}/action", action)
                self.assertEqual(status, 200, response)
                measurement = response["simulationResult"]["physicalMeasurements"][0]
                actual = measurement["samples"][0]["actual"]
                self.assertIsInstance(actual, dict)
                self.assertGreater(actual["i"], 0)
                self.assertEqual(actual["q"], 0)
                self.assertEqual(actual["referenceFrequencyHz"], 20e9)
                vector_actual = response["simulationResult"]["virtualMeasurements"][0]["samples"][0]["actual"]
                self.assertEqual(vector_actual, actual)
                public_wire_actual = response["simulationResult"]["physicalMeasurements"][1]["samples"][0]["actual"]
                self.assertEqual(public_wire_actual, actual)

    def test_submit_returns_complete_practice_evaluation_report(self):
        package = valid_package()
        package["nodes"][1]["name"] = "仿真设备"
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
                "studentid": "student-20260001",
                "jobid": "job-fault-training-001",
            },
        )
        self.assertEqual(status, 200)
        self.assertNotIn("studentid", created)
        self.assertNotIn("jobid", created)
        session_id = created["sessionId"]

        status, _ = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-report-measure",
                "actionType": "measurePoint",
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
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
            {"finalTargetIds": ["sim-1"]},
        )

        self.assertEqual(status, 200, submitted)
        self.assertNotIn("studentid", submitted)
        self.assertNotIn("jobid", submitted)
        report = submitted["evaluationReport"]
        self.assertEqual(report["studentId"], "student-20260001")
        self.assertEqual(report["jobId"], "job-fault-training-001")
        self.assertRegex(report["submittedAt"], r"^\d{4}-\d{2}-\d{2}T.*Z$")
        self.assertNotEqual(report["submittedAt"], "2000-01-01T00:00:00Z")
        self.assertIsInstance(report["totalDurationSeconds"], int)
        self.assertGreaterEqual(report["totalDurationSeconds"], 0)
        self.assertNotIn("candidateFaultSets", report["initialOptimalPath"])
        self.assertNotIn("knowledgeGraph", report["initialOptimalPath"])
        self.assertNotIn("pathGeneration", report["initialOptimalPath"])
        self.assertNotIn("source", report["initialOptimalPath"])
        self.assertNotIn("isCustomized", report["initialOptimalPath"])
        self.assertEqual(report["targetConclusion"]["expectedTargetIds"], ["sim-1"])
        self.assertEqual(report["targetConclusion"]["studentTargetIds"], ["sim-1"])
        self.assertTrue(report["targetConclusion"]["correct"])
        repair_action = next(
            item["studentAction"]
            for item in report["stepEvaluations"]
            if item["studentAction"].get("actionType") == "replaceComponent"
        )
        self.assertEqual(repair_action["target"], {"type": "component", "name": "仿真设备"})
        self.assertEqual(len(report["scoreDetails"]), 5)
        self.assertEqual(sum(item["score"] for item in report["scoreDetails"]), report["totalScore"])
        self.assertNotIn("initialRecommendedPath", submitted)
        self.assertEqual(len(report["stepEvaluations"]), 2)
        self.assertTrue(all("studentRating" in step for step in report["stepEvaluations"]))
        self.assertTrue(all("systemRecommendedAction" in step for step in report["stepEvaluations"]))
        self.assertTrue(all("systemRecommendationRating" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("matchResult" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("candidateFaultCombinationsBefore" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("candidateFaultCombinationsAfter" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("candidateCountBefore" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("candidateCountAfter" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("removedCandidateCombinations" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("addedCandidateCombinations" not in step for step in report["stepEvaluations"]))

        self.assertTrue(all("virtualMeasurement" not in step["studentAction"] for step in report["stepEvaluations"]))
        self.assertTrue(all("candidateFaultsAfterAction" not in step["studentAction"] for step in report["stepEvaluations"]))
        self.assertTrue(all("faultId" not in step["studentAction"] for step in report["stepEvaluations"]))
        self.assertTrue(all("informationGain" not in step for step in report["stepEvaluations"]))
        self.assertTrue(all("deductionReasons" in step for step in report["stepEvaluations"]))
        self.assertEqual(
            round(sum(step["deductedDecisionPoints"] for step in report["stepEvaluations"]), 3),
            round(30 - next(item["score"] for item in report["scoreDetails"] if item["item"] == "informationGain"), 3),
        )
        replacement_step = report["stepEvaluations"][1]
        self.assertEqual(replacement_step["studentRating"]["level"], "optimal")
        self.assertEqual(
            replacement_step["systemRecommendedAction"]["target"],
            {"type": "component", "id": "sim-1"},
        )
        self.assertNotIn("faultId", replacement_step["systemRecommendedAction"])
        self.assertIn("faultIds", replacement_step["systemRecommendedAction"])
        self.assertNotIn("timeCostSeconds", replacement_step["systemRecommendedAction"])
        self.assertNotIn("riskCost", replacement_step["systemRecommendedAction"])
        self.assertNotIn("candidateSupportRatio", replacement_step["systemRecommendedAction"])
        self.assertNotIn("supportingCombinationCount", replacement_step["systemRecommendedAction"])
        self.assertNotIn("candidateCombinationCount", replacement_step["systemRecommendedAction"])
        coverage = report["keyNodeCoverage"]
        self.assertTrue(coverage["nodes"])
        self.assertTrue(all("covered" in node for node in coverage["nodes"]))
        self.assertEqual(
            sum(item["deductedPoints"] for item in report["deductionAnalysis"]),
            round(100 - report["totalScore"], 3),
        )
        self.assertIsInstance(report["improvementSuggestions"], list)

    def test_submit_posts_the_complete_result_to_the_configured_student_service(self):
        with patch.object(
            SimulationBackendHandler,
            "practice_result_callback_url",
            "http://127.0.0.1:9000/student/practice/result",
        ), patch("backend.server.urlopen") as mocked_urlopen:
            callback_response = MagicMock()
            callback_response.status = 201
            mocked_urlopen.return_value.__enter__.return_value = callback_response
            status, created = self._post(
                "/api/practice/session",
                {
                    "simulationPackage": valid_package(),
                    "dMatrix": d_matrix_with_physical_and_virtual_points(),
                    "targetFaultId": "target-fault",
                    "studentid": 21,
                    "jobid": 61,
                },
            )
            self.assertEqual(status, 200)
            status, submitted = self._post(
                f"/api/practice/session/{created['practiceSessionId']}/submit",
                {"finalTargetIds": ["sim-1"]},
            )

        self.assertEqual(status, 200)
        self.assertNotIn("runId", submitted)
        self.assertNotIn("metrics", submitted)
        self.assertEqual(submitted["resultDelivery"], {
            "status": "delivered",
            "url": "http://127.0.0.1:9000/student/practice/result",
            "httpStatus": 201,
        })
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:9000/student/practice/result")
        callback_payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(callback_payload["studentId"], 21)
        self.assertEqual(callback_payload["jobId"], 61)
        self.assertNotIn("practiceSessionId", callback_payload)
        self.assertNotIn("simulationSessionId", callback_payload)
        self.assertNotIn("studentId", callback_payload["evaluationReport"])
        self.assertNotIn("jobId", callback_payload["evaluationReport"])
        self.assertEqual(
            callback_payload["evaluationReport"],
            {
                key: value
                for key, value in submitted["evaluationReport"].items()
                if key not in {"studentId", "jobId"}
            },
        )

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
            {"finalTargetIds": ["sim-1"]},
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

    def test_new_practice_session_proactively_reclaims_expired_capacity(self):
        SimulationBackendHandler.max_active_practice_sessions = 1
        payload = {
            "simulationPackage": valid_package(),
            "dMatrix": sample_d_matrix(),
            "targetFaultId": "target-fault",
        }
        status, first = self._post("/api/practice/session", payload)
        self.assertEqual(status, 200)
        expired_session = SimulationBackendHandler.practice_sessions[first["practiceSessionId"]]
        expired_session.max_lifetime_seconds = 0.0

        status, second = self._post("/api/practice/session", payload)

        self.assertEqual(status, 200)
        self.assertNotIn(first["practiceSessionId"], SimulationBackendHandler.practice_sessions)
        self.assertNotIn(first["simulationSessionId"], SimulationBackendHandler.sessions)
        self.assertIn(second["practiceSessionId"], SimulationBackendHandler.practice_sessions)
        self.assertEqual(expired_session.lifecycle_state, "expired")

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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
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
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
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
            {"finalTargetIds": ["sim-1"]},
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

    def test_active_reaper_removes_expired_practice_and_bound_simulation_session(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        practice_session = SimulationBackendHandler.practice_sessions[created["practiceSessionId"]]
        practice_session.created_at = 100.0
        practice_session.last_activity_at = 100.0
        practice_session.max_lifetime_seconds = 10.0

        removed = SimulationBackendHandler.purge_expired_sessions(now=111.0)

        self.assertEqual(removed, {"practiceSessions": 1, "simulationSessions": 1})
        self.assertEqual(practice_session.lifecycle_state, "expired")
        self.assertNotIn(created["practiceSessionId"], SimulationBackendHandler.practice_sessions)
        self.assertNotIn(created["simulationSessionId"], SimulationBackendHandler.sessions)


if __name__ == "__main__":
    unittest.main()
