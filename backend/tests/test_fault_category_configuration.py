import unittest

from backend.fault_runtime import FaultRuntime


class FaultCategoryConfigurationTests(unittest.TestCase):
    def test_noise_is_added_after_fault_for_parameters_signals_and_protocol(self):
        for noise_type in ("gaussian_noise", "uniform_white_noise", "gaussian_colored_noise"):
            for target_field, injection_form in (("params.gain", "module-variable"), ("outputs.signal", "module-variable"), ("edge", "protocol-bus")):
                with self.subTest(noise_type=noise_type, target_field=target_field):
                    fault = {"faultId": "combined", "faultType": "parameter_step", "targetId": "target", "targetField": target_field,
                             "injectionForm": injection_form, "startTime": 1, "duration": 2,
                             "parameters": {"targetValue": 4, "noiseEnabled": 1, "noiseType": noise_type, "noiseMean": 2, "noiseStd": 0, "noiseAmplitude": 0}}
                    runtime = FaultRuntime([fault])
                    def apply(time):
                        if target_field.startswith("params."):
                            return runtime.apply_node_parameters("target", {"gain": 10}, time)["gain"]
                        if injection_form == "protocol-bus":
                            return runtime.apply_edge_value("target", 10, time)
                        return runtime.apply_node_output("target", 10, time, "signal")
                    self.assertEqual(apply(0), 10)
                    self.assertEqual(apply(1), 6)
                    self.assertEqual(apply(4), 10)

    def test_noise_is_added_once_on_selected_vector_lanes_and_iq(self):
        fault = {"faultId": "combined", "faultType": "parameter_step", "targetId": "target", "targetField": "outputs.signal",
                 "vectorInjectionScope": "items", "vectorIndices": [1],
                 "parameters": {"targetValue": 4, "noiseEnabled": 1, "noiseType": "gaussian_noise", "noiseMean": 2, "noiseStd": 0}}
        runtime = FaultRuntime([fault])
        self.assertEqual(runtime.apply_node_output("target", [10, 20], 0, "signal"), [10, 6])
        envelope = {"i": 10, "q": 20, "referenceFrequencyHz": 2e9}
        self.assertEqual(runtime.apply_node_output("target", envelope, 0, "signal"), {**envelope, "i": 6, "q": 6})

    def test_communication_modes_and_overlay(self):
        params = {"noiseEnabled": 1, "noiseType": "gaussian_noise", "noiseMean": 0.5, "noiseStd": 0}
        for fault_type, extra, expected in (("data_tamper", {"scale": 2, "bias": 1}, 21.5),
                                             ("random_packet_loss", {"drop_rate": 1, "strategy": "zero"}, 0.5),
                                             ("random_packet_loss", {"drop_rate": 0}, 10.5),
                                             ("signal_cutoff", {}, 0.5)):
            with self.subTest(fault_type=fault_type, extra=extra):
                fault = {"faultId": "communication", "faultType": fault_type, "targetId": "wire", "parameters": {**params, **extra}}
                self.assertEqual(FaultRuntime([fault]).apply_edge_value("wire", 10, 0), expected)
        fault = {"faultId": "delay", "faultType": "link_delay", "targetId": "wire", "parameters": {**params, "delaySteps": 1}}
        runtime = FaultRuntime([fault])
        runtime.apply_edge_value("wire", 10, 0)
        self.assertEqual(runtime.apply_edge_value("wire", 20, 1), 10.5)
        fault["parameters"]["delaySteps"] = 3
        runtime = FaultRuntime([fault])
        self.assertEqual([runtime.apply_edge_value("wire", 10, time) for time in range(4)], [10.5] * 4)


if __name__ == "__main__":
    unittest.main()
