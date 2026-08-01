import math
import unittest

from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError


class ModuleRegistryTests(unittest.TestCase):
    def test_resolves_registered_module_and_executes_entry(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("passthrough")

        result = module.call({"input": 2.5}, {})

        self.assertEqual(result["outputs"]["output"], 2.5)

    def test_rejects_unknown_module_id(self):
        registry = ModuleRegistry.from_builtin_manifest()

        with self.assertRaises(SimulationBackendError) as context:
            registry.require("missing")

        self.assertEqual(context.exception.error_code, "MODULE_NOT_WHITELISTED")
        self.assertEqual(context.exception.field, "pythonBinding.moduleId")

    def test_rejects_out_of_range_parameter(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("gain")

        with self.assertRaises(SimulationBackendError) as context:
            module.call({"input": 1.0}, {"gain": 100.0})

        self.assertEqual(context.exception.error_code, "PARAM_OUT_OF_RANGE")
        self.assertEqual(context.exception.field, "parameters.gain")

    def test_gain_module_uses_parameter(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("gain")

        result = module.call({"input": 3.0}, {"gain": 2.0})

        self.assertEqual(result["outputs"]["output"], 6.0)

    def test_passthrough_module_accepts_and_returns_a_numeric_vector(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("passthrough").call({"input": [1, 2, 3, 4]}, {})

        self.assertEqual(result["outputs"]["output"], [1.0, 2.0, 3.0, 4.0])

    def test_vector2_passthrough_returns_a_fixed_length_vector(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("vector2_passthrough").call(
            {"input_vector": [1, 2]},
            {},
        )

        self.assertEqual(result["outputs"]["output_vector"], [1.0, 2.0])

    def test_rf_four_channel_source_generates_four_pulse_carriers_without_inputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        parameters = {
            "sample_1": 1,
            "sample_2": 2,
            "sample_3": 3,
            "sample_4": 4,
            "center_frequency_hz": 4,
            "pulse_width_seconds": 0.5,
            "pulse_period_seconds": 1,
            "phase_deg": 0,
        }

        active = registry.require("rf_four_channel_source").call({}, parameters, time=0.125)
        inactive = registry.require("rf_four_channel_source").call({}, parameters, time=0.75)

        self.assertEqual(active["outputs"]["rf_samples"], [-1.0, -2.0, -3.0, -4.0])
        self.assertEqual(inactive["outputs"]["rf_samples"], [0.0, 0.0, 0.0, 0.0])

    def test_rf_four_channel_source_uses_nonzero_default_amplitudes(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("rf_four_channel_source").call({}, {}, time=0.0)

        self.assertEqual(result["outputs"]["rf_samples"], [1.0, 0.8, 0.6, 0.4])

    def test_rf_pulse_feature_extractor_reports_fft_frequency_and_8_bit_amplitude(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_pulse_feature_extractor")
        sample_rate = 6400.0
        carrier_frequency = 400.0
        dt = 1.0 / sample_rate
        state = {}

        for index in range(64):
            time = index * dt
            sample = math.sin(2.0 * math.pi * carrier_frequency * time)
            result = module.call(
                {"rf_signal": sample},
                {"fft_size": 64, "adc_full_scale": 1, "envelope_threshold_adc": 12},
                time=time,
                dt=dt,
                state=state,
            )
            state = result["state"]

        outputs = result["outputs"]
        self.assertAlmostEqual(outputs["center_frequency_hz"], carrier_frequency, places=6)
        self.assertGreaterEqual(outputs["pulse_amplitude_adc"], 250)
        self.assertLessEqual(outputs["pulse_amplitude_adc"], 255)

    def test_rf_downconverter_outputs_iq_components(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_downconverter")

        result = module.call(
            {"rf_input": 1.0},
            {
                "lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "conversion_gain": 1.0,
                "low_pass_cutoff_hz": 0.0,
            },
            time=0.0,
        )

        self.assertAlmostEqual(result["outputs"]["if_i"], 2.0, places=12)
        self.assertAlmostEqual(result["outputs"]["if_q"], 0.0, places=12)

    def test_rf_limit_amplify_downconvert_split8_splits_four_inputs_into_eight_scalar_outputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_limit_amplify_downconvert_split8")
        self.assertEqual(module.parameters["lo_frequency_hz"]["default"], 99)

        result = module.call(
            {"rf_input": [4.0, 2.0, 0.0, -2.0]},
            {
                "limit_amplitude": 1.0,
                "gain_db": 0.0,
                "lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "conversion_gain": 1.0,
                "low_pass_cutoff_hz": 0.0,
                "split_insertion_loss_db": 0.0,
            },
            time=0.0,
        )

        outputs = result["outputs"]
        self.assertEqual(list(outputs), [f"rf_output_{index}" for index in range(1, 9)])
        expected = [2.0 ** 0.5, 2.0 ** 0.5, 2.0 ** 0.5, 2.0 ** 0.5, 0.0, 0.0, -(2.0 ** 0.5), -(2.0 ** 0.5)]
        for actual, expected_value in zip(outputs.values(), expected):
            self.assertAlmostEqual(actual, expected_value, places=12)

    def test_command_shaper_module_clamps_pitch_command(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("command_shaper")

        high_result = module.call({"pitch_command": 1.8}, {})
        low_result = module.call({"pitch_command": -1.4}, {})
        nominal_result = module.call({"pitch_command": 0.25}, {})

        self.assertEqual(high_result["outputs"]["shaped_command"], 1.0)
        self.assertEqual(low_result["outputs"]["shaped_command"], -1.0)
        self.assertEqual(nominal_result["outputs"]["shaped_command"], 0.25)

    def test_closed_loop_backend_modules_execute_sample_inputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        cases = [
            ("attitude_controller", {"attitude_error": 0.2}, "torque_command"),
            ("control_allocator", {"torque_command": 0.2}, "motor_total_command"),
            ("motor_mixer", {"motor_total_command": 0.2}, "motor_1_command"),
            ("motor_model", {"motor_command": 0.2}, "thrust"),
            ("vehicle_dynamics", {"thrust_1": 0.1, "thrust_2": 0.1, "thrust_3": 0.1, "thrust_4": 0.1}, "pitch_rate"),
            ("imu_gyro", {"body_rate": 0.1}, "measured_rate"),
        ]

        for module_id, inputs, output_name in cases:
            with self.subTest(module_id=module_id):
                result = registry.require(module_id).call(inputs, {}, dt=0.1, state={})
                self.assertIn(output_name, result["outputs"])
                self.assertIsInstance(result["state"], dict)


if __name__ == "__main__":
    unittest.main()
