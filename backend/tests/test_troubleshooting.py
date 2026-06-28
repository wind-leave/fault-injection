import unittest

from backend.troubleshooting import TroubleshootingSession, build_troubleshooting_path


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


if __name__ == "__main__":
    unittest.main()
