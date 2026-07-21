import unittest

from backend.builtin_modules.barometer_sensor import process


class BarometerSensorTests(unittest.TestCase):
    def test_applies_bias_and_scale_to_true_altitude(self):
        result = process(true_altitude=100.0, bias=2.5, scale=1.02)

        self.assertEqual(result["outputs"]["measured_altitude"], 104.55)


if __name__ == "__main__":
    unittest.main()
