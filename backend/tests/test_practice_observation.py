import unittest

from backend.practice_observation import compare_physical_snapshots, point_type


class PracticeObservationTests(unittest.TestCase):
    def test_point_type_defaults_to_physical(self):
        matrix = {
            "points": [
                {"pointId": "point-M1", "shortName": "M1"},
                {"pointId": "point-V1", "shortName": "V1", "pointType": "virtual"},
            ]
        }

        self.assertEqual(point_type(matrix, "M1"), "physical")
        self.assertEqual(point_type(matrix, "V1"), "virtual")

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


if __name__ == "__main__":
    unittest.main()
