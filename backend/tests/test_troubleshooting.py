import unittest

from backend.troubleshooting import TroubleshootingSession, build_troubleshooting_path, build_troubleshooting_plan


def sample_d_matrix():
    return {
        "points": [
            {
                "pointId": "tp-residual",
                "shortName": "M1",
                "name": "residual diagnostic point",
                "edgeId": "edge-residual",
            },
            {
                "pointId": "tp-controller",
                "shortName": "M2",
                "name": "controller output",
                "edgeId": "edge-controller",
            },
            {
                "pointId": "tp-motor",
                "shortName": "M3",
                "name": "motor response",
                "edgeId": "edge-motor",
            },
        ],
        "faults": [
            {"id": "target-fault", "name": "Target fault"},
            {"id": "controller-fault", "name": "Controller fault"},
            {"id": "motor-fault", "name": "Motor fault"},
        ],
        "rows": [
            {
                "faultId": "target-fault",
                "faultName": "Target fault",
                "targetLabel": "IMU",
                "layer": "physical",
                "detectableCount": 2,
                "cells": [
                    {"pointId": "tp-residual", "pointCode": "M1", "pointName": "residual diagnostic point", "detectable": True, "value": 1, "reason": "residual is abnormal"},
                    {"pointId": "tp-controller", "pointCode": "M2", "pointName": "controller output", "detectable": True, "value": 1, "reason": "controller output changes"},
                    {"pointId": "tp-motor", "pointCode": "M3", "pointName": "motor response", "detectable": False, "value": 0, "reason": "motor response is unchanged"},
                ],
            },
            {
                "faultId": "controller-fault",
                "faultName": "Controller fault",
                "detectableCount": 2,
                "cells": [
                    {"pointId": "tp-residual", "pointCode": "M1", "pointName": "residual diagnostic point", "detectable": True, "value": 1},
                    {"pointId": "tp-controller", "pointCode": "M2", "pointName": "controller output", "detectable": True, "value": 1},
                    {"pointId": "tp-motor", "pointCode": "M3", "pointName": "motor response", "detectable": True, "value": 1},
                ],
            },
            {
                "faultId": "motor-fault",
                "faultName": "Motor fault",
                "detectableCount": 1,
                "cells": [
                    {"pointId": "tp-residual", "pointCode": "M1", "pointName": "residual diagnostic point", "detectable": False, "value": 0},
                    {"pointId": "tp-controller", "pointCode": "M2", "pointName": "controller output", "detectable": False, "value": 0},
                    {"pointId": "tp-motor", "pointCode": "M3", "pointName": "motor response", "detectable": True, "value": 1},
                ],
            },
        ],
        "summary": {"pointCount": 3, "faultCount": 3, "detectableCells": 5},
        "generatedAt": "2026-06-28T00:00:00Z",
    }


class TroubleshootingAlgorithmTests(unittest.TestCase):
    def test_builds_initial_path_from_d_matrix(self):
        path = build_troubleshooting_path(sample_d_matrix(), "target-fault")

        self.assertTrue(path["ok"])
        self.assertEqual(path["faultId"], "target-fault")
        self.assertGreaterEqual(len(path["steps"]), 1)
        self.assertEqual(path["steps"][0]["pointCode"], "M1")

    def test_builds_path_and_key_steps_with_the_backend_algorithm(self):
        plan = build_troubleshooting_plan(sample_d_matrix(), "target-fault")

        self.assertEqual(plan["source"], "backend-algorithm")
        self.assertFalse(plan["isCustomized"])
        self.assertEqual(plan["keySteps"][0]["action"], "measure")
        self.assertIn("M1", plan["keySteps"][0]["text"])
        self.assertEqual(plan["keySteps"][-1]["action"], "replaceComponent")
        self.assertEqual(plan["keySteps"][-1]["targetLabel"], "IMU")
        self.assertIn("更换组件", plan["keySteps"][-1]["text"])
        self.assertIn("IMU", plan["keySteps"][-1]["text"])
        self.assertEqual(plan["steps"][-1]["action"], "replaceComponent")
        self.assertEqual(plan["steps"][-1]["targetLabel"], "IMU")
        self.assertNotIn("确认故障对象", " ".join(item["text"] for item in plan["keySteps"]))

    def test_generates_wire_replacement_for_edge_faults(self):
        matrix = sample_d_matrix()
        matrix["rows"][0].update({
            "targetKind": "edge",
            "targetEdgeId": "edge-command-controller",
            "targetLabel": "指令到控制器连线",
        })

        plan = build_troubleshooting_plan(matrix, "target-fault")

        self.assertEqual(plan["keySteps"][-1]["action"], "replaceWire")
        self.assertEqual(plan["keySteps"][-1]["targetId"], "edge-command-controller")
        self.assertIn("更换关键连线", plan["keySteps"][-1]["text"])

    def test_generates_both_wire_and_device_replacement_for_combined_repair_targets(self):
        matrix = sample_d_matrix()
        matrix["rows"][0]["repairTargets"] = [
            {"kind": "edge", "id": "edge-command-controller", "label": "指令到控制器连线"},
            {"kind": "node", "id": "node-controller", "label": "姿态控制器"},
        ]

        plan = build_troubleshooting_plan(matrix, "target-fault")
        actions = [step["action"] for step in plan["keySteps"]]

        self.assertIn("replaceWire", actions)
        self.assertIn("replaceComponent", actions)

    def test_updates_path_from_student_observations(self):
        session = TroubleshootingSession(sample_d_matrix(), "target-fault")

        result = session.record_operation(
            {
                "operationId": "op-1",
                "actionType": "measure",
                "pointCode": "M1",
                "observed": "abnormal",
            }
        )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["remainingFaultIds"], ["target-fault", "controller-fault"])
        self.assertTrue(result["routeQuality"]["matchedRecommendedStep"])
        self.assertEqual(result["currentPath"]["steps"][0]["studentObserved"], "abnormal")
        self.assertEqual(result["nextRecommendedStep"]["pointCode"], "M2")

        second = session.record_operation(
            {
                "operationId": "op-2",
                "actionType": "measure",
                "pointCode": "M3",
                "observed": "normal",
            }
        )

        self.assertEqual(second["remainingFaultIds"], ["target-fault"])
        self.assertIsNone(second["nextRecommendedStep"])

    def test_excludes_detectable_physical_points_from_generated_steps(self):
        matrix = sample_d_matrix()
        matrix["points"][0]["pointType"] = "physical"
        matrix["points"][1]["pointType"] = "virtual"
        matrix["points"][2]["pointType"] = "virtual"
        path = build_troubleshooting_path(matrix, "target-fault")

        measurement_steps = [step for step in path["steps"] if step.get("action") is None]
        self.assertEqual([step["pointCode"] for step in measurement_steps], ["M2"])
        self.assertNotIn("M1", [step["pointCode"] for step in measurement_steps])
        self.assertEqual(path["steps"][-1]["action"], "replaceComponent")

    def test_skips_virtual_measurements_when_physical_signature_is_unique(self):
        matrix = sample_d_matrix()
        matrix["points"][0]["pointType"] = "physical"
        matrix["points"][1]["pointType"] = "physical"
        matrix["points"][2]["pointType"] = "virtual"
        matrix["rows"][1]["cells"][1]["detectable"] = False

        path = build_troubleshooting_path(matrix, "target-fault")

        self.assertEqual([step["action"] for step in path["steps"]], ["replaceComponent"])
        self.assertEqual(path["steps"][0]["targetLabel"], "IMU")
        self.assertEqual(path["summary"], "现有物理测点已可唯一定位该故障，可直接执行修复。")


if __name__ == "__main__":
    unittest.main()
