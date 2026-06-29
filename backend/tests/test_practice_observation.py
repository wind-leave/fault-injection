import unittest

from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_observation,
    evaluate_physical_measurement_snapshot,
)


def d_matrix_with_point(rule=None, channel="scope-1.ch1"):
    point = {
        "pointId": "tp-residual",
        "shortName": "M1",
        "name": "residual diagnostic point",
        "channel": channel,
    }
    if rule is not None:
        point["observationRule"] = rule
    return {"points": [point], "rows": []}


def simulation_result(actual, reference, channel="scope-1.ch1"):
    return {
        "curves": {
            "time": [0.0, 0.1],
            "channels": {
                f"{channel}.actual": actual,
                f"{channel}.reference": reference,
            },
        }
    }


class PracticeObservationTests(unittest.TestCase):
    def test_absolute_delta_normal(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.02, 1.03], [1.0, 1.0]),
        )

        self.assertEqual(result["observed"], "normal")
        self.assertEqual(result["reason"], "metric-below-normal-threshold")
        self.assertAlmostEqual(result["metricValue"], 0.03)

    def test_absolute_delta_abnormal(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.4, 1.5], [1.0, 1.0]),
        )

        self.assertEqual(result["observed"], "abnormal")
        self.assertEqual(result["reason"], "metric-above-abnormal-threshold")
        self.assertAlmostEqual(result["metricValue"], 0.5)

    def test_absolute_delta_unknown_between_thresholds(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.2], [1.0]),
        )

        self.assertEqual(result["observed"], "unknown")
        self.assertEqual(result["reason"], "metric-between-thresholds")

    def test_missing_channel_returns_unknown(self):
        result = evaluate_observation(
            d_matrix_with_point(),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            {"curves": {"channels": {}}},
        )

        self.assertEqual(result["observed"], "unknown")
        self.assertEqual(result["reason"], "missing-channel-data")

    def test_uses_default_thresholds_without_rule(self):
        result = evaluate_observation(
            d_matrix_with_point(),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.21], [1.0]),
        )

        self.assertEqual(result["method"], "absoluteDelta")
        self.assertEqual(result["normalThreshold"], 0.05)
        self.assertEqual(result["abnormalThreshold"], 0.2)
        self.assertEqual(result["observed"], "abnormal")

    def test_virtual_point_observation_includes_latest_values(self):
        matrix = d_matrix_with_point({
            "method": "absoluteDelta",
            "normalThreshold": 0.1,
            "abnormalThreshold": 0.3,
        })
        matrix["points"][0]["pointType"] = "virtual"

        result = evaluate_observation(
            matrix,
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.2, 1.5], [1.0, 1.1]),
        )

        self.assertEqual(result["pointType"], "virtual")
        self.assertEqual(result["actualValue"], 1.5)
        self.assertEqual(result["referenceValue"], 1.1)
        self.assertAlmostEqual(result["metricValue"], 0.4)
        self.assertEqual(result["observed"], "abnormal")

    def test_physical_snapshot_contains_only_physical_points(self):
        matrix = {
            "points": [
                {
                    "pointId": "tp-physical",
                    "shortName": "M1",
                    "name": "physical display point",
                    "pointType": "physical",
                    "channel": "scope-1.ch1",
                    "observationRule": {
                        "method": "absoluteDelta",
                        "normalThreshold": 0.1,
                        "abnormalThreshold": 0.3,
                    },
                },
                {
                    "pointId": "tp-virtual",
                    "shortName": "V1",
                    "name": "virtual instrument point",
                    "pointType": "virtual",
                    "channel": "scope-2.ch1",
                },
            ],
            "rows": [],
        }
        result = evaluate_physical_measurement_snapshot(
            matrix,
            {
                "curves": {
                    "channels": {
                        "scope-1.ch1.actual": [1.4],
                        "scope-1.ch1.reference": [1.0],
                        "scope-2.ch1.actual": [9.0],
                        "scope-2.ch1.reference": [0.0],
                    }
                }
            },
        )

        self.assertEqual(result["source"], "backend")
        self.assertEqual([point["pointCode"] for point in result["points"]], ["M1"])
        self.assertEqual(result["abnormalPointCodes"], ["M1"])
        self.assertEqual(result["normalPointCodes"], [])
        self.assertEqual(result["unknownPointCodes"], [])

    def test_missing_point_type_defaults_to_physical(self):
        result = evaluate_physical_measurement_snapshot(
            d_matrix_with_point(),
            simulation_result([1.21], [1.0]),
        )

        self.assertEqual([point["pointCode"] for point in result["points"]], ["M1"])
        self.assertEqual(result["points"][0]["pointType"], "physical")

    def test_compare_physical_snapshots_reports_repair_effect(self):
        before = {
            "points": [
                {"pointCode": "M1", "observed": "abnormal"},
                {"pointCode": "M2", "observed": "abnormal"},
            ],
            "abnormalPointCodes": ["M1", "M2"],
            "normalPointCodes": [],
            "unknownPointCodes": [],
        }
        after = {
            "points": [
                {"pointCode": "M1", "observed": "normal"},
                {"pointCode": "M2", "observed": "abnormal"},
            ],
            "abnormalPointCodes": ["M2"],
            "normalPointCodes": ["M1"],
            "unknownPointCodes": [],
        }

        result = compare_physical_snapshots(before, after)

        self.assertTrue(result["effective"])
        self.assertEqual(result["status"], "improved")
        self.assertEqual(result["recoveredPointCodes"], ["M1"])
        self.assertEqual(result["remainingAbnormalPointCodes"], ["M2"])
        self.assertEqual(result["unchangedAbnormalPointCodes"], ["M2"])
        self.assertEqual(result["newAbnormalPointCodes"], [])


if __name__ == "__main__":
    unittest.main()
