import unittest

from backend.practice_observation import evaluate_observation


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


if __name__ == "__main__":
    unittest.main()
