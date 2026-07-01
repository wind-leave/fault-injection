import unittest

from backend.practice_scoring import (
    evaluate_path_quality,
    evaluate_practice_submission_score,
    grade_for_score,
)


class PracticeScoringTests(unittest.TestCase):
    def test_evaluates_existing_hundred_point_breakdown(self):
        path_evaluation = {
            "routeQualityScore": 50,
        }

        result = evaluate_practice_submission_score(
            correct=True,
            elapsed_seconds=120,
            scoring_rules={"fullEfficiencySeconds": 600},
            student_actions=[],
            path_evaluation=path_evaluation,
        )

        self.assertEqual(result["score"], 100)
        self.assertEqual(result["grade"], "优秀")
        self.assertEqual(
            result["scoreBreakdown"],
            {
                "faultLocalization": 30,
                "diagnosticTreePath": 30,
                "informationGain": 20,
                "efficiency": 5,
                "safetyCompliance": 15,
            },
        )
        self.assertEqual(result["deductions"], [])

    def test_fault_detection_deduction_uses_current_weight(self):
        result = evaluate_practice_submission_score(
            correct=False,
            elapsed_seconds=120,
            scoring_rules={},
            student_actions=[],
            path_evaluation={"routeQualityScore": 50},
        )

        self.assertEqual(result["scoreBreakdown"]["faultLocalization"], 0)
        self.assertEqual(result["deductions"][0]["points"], -30)

    def test_efficiency_uses_current_five_point_weight(self):
        result = evaluate_practice_submission_score(
            correct=True,
            elapsed_seconds=601,
            scoring_rules={"fullEfficiencySeconds": 600},
            student_actions=[],
            path_evaluation={"routeQualityScore": 50},
        )

        self.assertEqual(result["scoreBreakdown"]["efficiency"], 2.5)

    def test_evaluates_existing_path_quality_breakdown(self):
        actual_steps = [
            {
                "stepIndex": 1,
                "operationId": "measure-1",
                "actionType": "measurePoint",
            },
            {
                "stepIndex": 2,
                "operationId": "repair-1",
                "actionType": "replaceComponent",
                "repairEffect": {"effective": True, "status": "recovered"},
            },
        ]
        dynamic_reference_history = [
            {
                "operationId": "measure-1",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
            {
                "operationId": "repair-1",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
        ]

        result = evaluate_path_quality(
            actual_troubleshooting_steps=actual_steps,
            student_actions=[],
            dynamic_reference_history=dynamic_reference_history,
            initial_physical_measurement_snapshot={"abnormalPointCodes": ["M1"]},
        )

        self.assertEqual(result["routeQualityScore"], 50)
        self.assertEqual(
            result["routeQualityBreakdown"],
            {
                "evidenceCollection": 12,
                "pathOrder": 10,
                "repairLocalization": 15,
                "recoveryVerification": 8,
                "operationControl": 5,
            },
        )
        self.assertEqual(result["dynamicReferenceMatchedCount"], 2)
        self.assertEqual(result["dynamicReferenceAverageScore"], 1.0)

    def test_operation_control_ignores_safety_violations_unsafe_and_repeated_measurements(self):
        actual_steps = [
            {
                "stepIndex": 1,
                "operationId": "measure-1",
                "actionType": "measurePoint",
                "pointCode": "V1",
            },
            {
                "stepIndex": 2,
                "operationId": "measure-2",
                "actionType": "measurePoint",
                "pointCode": "V1",
            },
            {
                "stepIndex": 3,
                "operationId": "repair-1",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "repairEffect": {"effective": True, "status": "recovered"},
            },
        ]
        dynamic_reference_history = [
            {
                "operationId": "measure-1",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
            {
                "operationId": "measure-2",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
            {
                "operationId": "repair-1",
                "matchResult": {"matched": True, "matchQuality": "unsafe", "score": 0.0},
            },
        ]

        result = evaluate_path_quality(
            actual_troubleshooting_steps=actual_steps,
            student_actions=[{"operationId": "repair-1", "safetyViolation": True}],
            dynamic_reference_history=dynamic_reference_history,
            initial_physical_measurement_snapshot={"abnormalPointCodes": ["M1"]},
        )

        self.assertEqual(result["routeQualityBreakdown"]["operationControl"], 5)

    def test_operation_control_deducts_ineffective_repairs_duplicate_repairs_and_unmatched_actions(self):
        actual_steps = [
            {
                "stepIndex": 1,
                "operationId": "repair-1",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "repairEffect": {"effective": False, "status": "unchanged"},
            },
            {
                "stepIndex": 2,
                "operationId": "repair-2",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "repairEffect": {"effective": True, "status": "recovered"},
            },
            {
                "stepIndex": 3,
                "operationId": "measure-unmatched",
                "actionType": "measurePoint",
                "pointCode": "V2",
            },
        ]
        dynamic_reference_history = [
            {
                "operationId": "repair-1",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
            {
                "operationId": "repair-2",
                "matchResult": {"matched": True, "matchQuality": "optimal", "score": 1.0},
            },
            {
                "operationId": "measure-unmatched",
                "matchResult": {"matched": False, "matchQuality": "unmatched", "score": 0.0},
            },
        ]

        result = evaluate_path_quality(
            actual_troubleshooting_steps=actual_steps,
            student_actions=[],
            dynamic_reference_history=dynamic_reference_history,
            initial_physical_measurement_snapshot={"abnormalPointCodes": ["M1"]},
        )

        self.assertEqual(result["routeQualityBreakdown"]["operationControl"], 1)

    def test_grade_thresholds_match_existing_labels(self):
        self.assertEqual(grade_for_score(90), "优秀")
        self.assertEqual(grade_for_score(80), "良好")
        self.assertEqual(grade_for_score(70), "中等")
        self.assertEqual(grade_for_score(60), "合格")
        self.assertEqual(grade_for_score(59.999), "不合格")


if __name__ == "__main__":
    unittest.main()
