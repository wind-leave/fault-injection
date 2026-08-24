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

    def test_cabinet03_module_applies_line_loss(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("cabinet03_module").call({"socket03": 10.0}, {})

        self.assertAlmostEqual(result["outputs"]["socket05"], 9.8, places=12)

    def test_electrical_modules_generate_ac_boost_dc_and_match_rms_ac_to_dc(self):
        registry = ModuleRegistry.from_builtin_manifest()

        ac_source = registry.require("electrical_ac_power_source").call(
            {},
            {"voltage_rms": 10.0, "frequency_hz": 1.0, "phase_deg": 90.0},
            time=0.0,
        )
        dc_boost = registry.require("electrical_dc_boost").call(
            {"dc_input": 12.0},
            {"boost_ratio": 2.0, "efficiency": 0.9},
        )
        ac_dc_matching = registry.require("electrical_ac_dc_matching").call(
            {"ac_input": -12.0},
            {"conversion_gain": 0.8},
            state={"ac_input_rms": 12.0},
        )
        ground = registry.require("electrical_ground").call({"ground_input": 24.0}, {})

        self.assertAlmostEqual(ac_source["outputs"]["ac_phase_a"], 10.0 * (2.0 ** 0.5), places=12)
        self.assertAlmostEqual(ac_source["outputs"]["ac_phase_b"], -5.0 * (2.0 ** 0.5), places=12)
        self.assertAlmostEqual(ac_source["outputs"]["ac_phase_c"], -5.0 * (2.0 ** 0.5), places=12)
        self.assertAlmostEqual(dc_boost["outputs"]["dc_output"], 21.6, places=12)
        self.assertAlmostEqual(ac_dc_matching["outputs"]["dc_output"], 9.6, places=12)
        self.assertEqual(ground["outputs"], {})
        self.assertEqual(ground["state"]["ground_input"], 24.0)

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

    def test_scalar_to_vector4_repeats_the_scalar_input(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("scalar_to_vector4").call(
            {"scalar_input": 2.5},
            {},
        )

        self.assertEqual(result["outputs"]["vector_output"], [2.5, 2.5, 2.5, 2.5])

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
        self.assertEqual(module.parameters["fft_size"]["default"], 1024)
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

    def test_rf_downconverter_selects_the_configured_scalar_input_and_outputs_iq_components(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_downconverter")

        mode_one = module.call(
            {"rf_input": 1.0, "rf_input_2": 3.0},
            {
                "input_mode": 1,
                "lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "conversion_gain": 1.0,
                "low_pass_cutoff_hz": 0.0,
            },
            time=0.0,
        )
        mode_two = module.call(
            {"rf_input": 1.0, "rf_input_2": 3.0},
            {
                "input_mode": 2,
                "lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "conversion_gain": 1.0,
                "low_pass_cutoff_hz": 0.0,
            },
            time=0.0,
        )

        self.assertAlmostEqual(mode_one["outputs"]["if_i"], 2.0, places=12)
        self.assertAlmostEqual(mode_one["outputs"]["if_q"], 0.0, places=12)
        self.assertAlmostEqual(mode_two["outputs"]["if_i"], 6.0, places=12)
        self.assertAlmostEqual(mode_two["outputs"]["if_q"], 0.0, places=12)

    def test_rf_four_output_source_provides_four_scalar_ports(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_four_output_source")

        result = module.call(
            {},
            {
                "sample_1": 1.0,
                "sample_2": 0.5,
                "sample_3": 0.0,
                "sample_4": -0.5,
                "center_frequency_hz": 0.0,
                "pulse_width_seconds": 1.0,
                "pulse_period_seconds": 1.0,
                "phase_deg": 0.0,
            },
            time=0.0,
        )

        self.assertEqual(
            result["outputs"],
            {
                "rf_output_1": 1.0,
                "rf_output_2": 0.5,
                "rf_output_3": 0.0,
                "rf_output_4": -0.5,
            },
        )

    def test_rf_four_port_up_down_converter_converts_two_paths_each_way(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_four_port_up_down_converter")

        result = module.call(
            {
                "downconvert_rf_input_1": 1.0,
                "downconvert_rf_input_2": -0.5,
                "upconvert_baseband_input_1": 0.25,
                "upconvert_baseband_input_2": -0.75,
            },
            {
                "downconvert_lo_frequency_hz": 0.0,
                "upconvert_lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "downconversion_gain": 1.0,
                "upconversion_gain": 1.0,
                "downconvert_low_pass_cutoff_hz": 0.0,
            },
            time=0.0,
        )

        self.assertEqual(
            result["outputs"],
            {
                "downconverted_output_1": 2.0,
                "downconverted_output_2": -1.0,
                "upconverted_output_1": 0.25,
                "upconverted_output_2": -0.75,
            },
        )

    def test_rf_limit_amplify_downconvert_split8_splits_four_inputs_into_eight_scalar_outputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_limit_amplify_downconvert_split8")
        self.assertEqual(module.parameters["lo_frequency_hz"]["default"], 5)

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
