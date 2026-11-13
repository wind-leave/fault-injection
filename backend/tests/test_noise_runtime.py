import copy
import unittest

from backend.fault_runtime import FaultRuntime
from backend.noise_runtime import NOISE_FAULT_TYPES, sample_noise


class NoiseRuntimeTests(unittest.TestCase):
    def test_distributions_and_colored_autocorrelation(self):
        for noise_type in sorted(NOISE_FAULT_TYPES):
            with self.subTest(noise_type=noise_type):
                state = {}
                params = {"seed": 17, "std": 2, "amplitude": 2, "alpha": 0.85}
                values = [sample_noise(noise_type, params, index, "statistics", state) for index in range(8192)]
                mean = sum(values) / len(values)
                variance = sum((value - mean) ** 2 for value in values) / len(values)
                lag = sum((values[i] - mean) * (values[i - 1] - mean) for i in range(1, len(values))) / (len(values) - 1) / variance
                self.assertLess(abs(mean), 0.2)
                if noise_type == "uniform_white_noise":
                    self.assertTrue(all(-2 <= value <= 2 for value in values))
                    self.assertTrue(1.25 < variance < 1.42)
                    self.assertLess(abs(lag), 0.05)
                else:
                    self.assertTrue(3.5 < variance < 4.5)
                    kurtosis = sum((value - mean) ** 4 for value in values) / len(values) / variance ** 2
                    self.assertTrue(2.6 < kurtosis < 3.5)
                    self.assertTrue(0.8 < lag < 0.9) if noise_type == "gaussian_colored_noise" else self.assertLess(abs(lag), 0.05)

    def test_additive_windows_vectors_envelopes_and_protocol_scope(self):
        for noise_type in sorted(NOISE_FAULT_TYPES):
            for layer in ("electrical", "protocol"):
                with self.subTest(noise_type=noise_type, layer=layer):
                    fault = {
                        "faultId": "noise", "faultType": noise_type, "targetId": "target",
                        "targetField": "outputs.signal" if layer == "electrical" else "can.payload",
                        "injectionForm": "module-variable" if layer == "electrical" else "protocol-bus",
                        "vectorInjectionScope": "items", "vectorIndices": [1],
                        "startTime": 1, "duration": 2,
                        "parameters": {"mean": 2, "std": 0, "amplitude": 0, "seed": 7},
                    }
                    runtime = FaultRuntime([fault])
                    def apply(value, time):
                        return runtime.apply_node_output("target", value, time, "signal") if layer == "electrical" else runtime.apply_edge_value("target", value, time)
                    self.assertEqual(apply(10, 0), 10)
                    self.assertEqual(apply(10, 1), 12)
                    self.assertEqual(apply([10, 20], 1), [10, 22] if layer == "electrical" else [12, 22])
                    envelope = {"i": 3, "q": 4, "referenceFrequencyHz": 2e9}
                    self.assertEqual(apply(envelope, 1), {**envelope, "i": 5, "q": 6})
                    self.assertEqual(apply(10, 4), 10)

    def test_streams_are_independent_idempotent_and_replayable(self):
        for noise_type in sorted(NOISE_FAULT_TYPES):
            with self.subTest(noise_type=noise_type):
                fault = {"faultId": "noise", "faultType": noise_type, "targetId": "edge", "injectionForm": "protocol-bus", "parameters": {"seed": 7, "std": 0.2, "amplitude": 0.2}}
                runtime = FaultRuntime([fault])
                envelope = {"i": 10, "q": 20, "referenceFrequencyHz": 2e9}
                value = runtime.apply_edge_value("edge", [envelope, envelope], 0)
                increments = [value[0]["i"] - 10, value[0]["q"] - 20, value[1]["i"] - 10, value[1]["q"] - 20]
                self.assertEqual(len(set(increments)), 4)
                self.assertEqual(runtime.apply_edge_value("edge", [envelope, envelope], 0), value)
                snapshot = copy.deepcopy(runtime)
                self.assertEqual(runtime.apply_edge_value("edge", 10, 0.1), snapshot.apply_edge_value("edge", 10, 0.1))
                self.assertEqual(FaultRuntime([fault]).apply_edge_value("edge", [envelope, envelope], 0), value)
                self.assertNotEqual(sample_noise(noise_type, {}, 1e-14, "tiny", {}), sample_noise(noise_type, {}, 2e-14, "tiny", {}))
