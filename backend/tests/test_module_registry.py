import importlib
import math
import unittest
from unittest.mock import patch

from backend import module_registry
from backend.module_registry import ModuleRegistry, RegisteredModule, clear_module_call_cache
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

    def test_prepared_call_reuses_unchanged_parameters_and_revalidates_changes(self):
        module = ModuleRegistry.from_builtin_manifest().require("gain")
        prepared = module.prepare()
        original_resolve = RegisteredModule._resolve_parameters
        resolved = []

        def resolve(instance, parameters):
            resolved.append(dict(parameters))
            return original_resolve(instance, parameters)

        with patch.object(RegisteredModule, "_resolve_parameters", resolve):
            self.assertEqual(prepared.call({"input": 2.0}, {"gain": 2.0})["outputs"]["output"], 4.0)
            self.assertEqual(prepared.call({"input": 3.0}, {"gain": 2.0})["outputs"]["output"], 6.0)
            self.assertEqual(prepared.call({"input": 2.0}, {"gain": 3.0})["outputs"]["output"], 6.0)
            with self.assertRaises(SimulationBackendError) as context:
                prepared.call({"input": 2.0}, {"gain": 100.0})

        self.assertEqual(resolved, [
            {"gain": 2.0}, {"gain": 3.0}, {"gain": 100.0},
        ])
        self.assertEqual(context.exception.error_code, "PARAM_OUT_OF_RANGE")

    def test_prepared_call_reloads_entry_after_component_cache_is_cleared(self):
        module = ModuleRegistry.from_builtin_manifest().require("passthrough")
        prepared = module.prepare()
        with patch("backend.module_registry._load_module_entry", wraps=module_registry._load_module_entry) as load_entry:
            prepared.call({"input": 1.0}, {})
            clear_module_call_cache()
            prepared.call({"input": 2.0}, {})
        self.assertEqual(load_entry.call_count, 2)

    def test_rf_complex_envelope_scalar_source_generates_power_calibrated_pulses(self):
        registry = ModuleRegistry.from_builtin_manifest()
        source = registry.require("rf_complex_envelope_scalar_source")
        parameters = {
            "pulse_width_seconds": 0.001,
            "pulse_period_seconds": 0.01,
            "center_frequency_hz": 10.0,
            "power_dbm": 0.0,
        }

        active = source.call({}, parameters, time=0.0005)["outputs"]["output_envelope"]
        inactive = source.call({}, parameters, time=0.002)["outputs"]["output_envelope"]

        self.assertAlmostEqual(active["i"], math.sqrt(0.1))
        self.assertEqual(active["q"], 0.0)
        self.assertEqual(active["referenceFrequencyHz"], 10.0)
        self.assertEqual(active["impedanceOhm"], 50.0)
        self.assertEqual(active["unit"], "V")
        self.assertEqual(inactive["i"], 0.0)
        self.assertEqual(inactive["q"], 0.0)

    def test_caches_module_entry_and_signature_between_samples(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("gain")
        clear_module_call_cache()

        with patch("backend.module_registry.importlib.import_module", wraps=importlib.import_module) as imported:
            module.call({"input": 2.0}, {"gain": 3.0})
            module.call({"input": 4.0}, {"gain": 5.0})

        self.assertEqual(imported.call_count, 1)

    def test_dzdk_modules_filter_limit_downconvert_and_extract_features(self):
        registry = ModuleRegistry.from_builtin_manifest()

        filtered = registry.require("DZDK_A").call(
            {"socket01": 1.0}, {"cutoff_frequency_hz": 1.0}, dt=0.1, state={"socket02": 0.0}
        )
        limited = registry.require("DZDK_B").call(
            {"socket01": 5.0}, {"lower_limit": -2.0, "upper_limit": 2.0}
        )
        downconverted = registry.require("DZDK_C").call(
            {"socket01": 1.0},
            {"lo_frequency_hz": 0.0, "lo_phase_deg": 0.0, "conversion_gain": 1.0, "low_pass_cutoff_hz": 0.0},
            time=0.0,
        )
        extracted = registry.require("DZDK_D").call(
            {"socket01": -3.0}, {"window_size": 4}, state={"samples": [1.0, 2.0]}
        )

        self.assertGreater(filtered["outputs"]["socket02"], 0.0)
        self.assertLess(filtered["outputs"]["socket02"], 1.0)
        self.assertEqual(limited["outputs"]["socket02"], 2.0)
        self.assertEqual(downconverted["outputs"]["socket02"], 2.0)
        self.assertEqual(downconverted["outputs"]["socket03"], 0.0)
        self.assertEqual(extracted["outputs"]["socket02"], 0.0)
        self.assertAlmostEqual(extracted["outputs"]["socket03"], (14 / 3) ** 0.5)
        self.assertEqual(extracted["outputs"]["socket04"], 3.0)

    def test_rf_band_pass_filter_and_iq_amplitude_phase_modulator(self):
        registry = ModuleRegistry.from_builtin_manifest()

        filter_state = {}
        filtered = None
        for index in range(256):
            filtered = registry.require("rf_band_pass_filter").call(
                {"rf_input": math.sin(2.0 * math.pi * 1e9 * index * 1e-10)},
                {"center_frequency_hz": 1e9, "bandwidth_hz": 1e9},
                dt=1e-10,
                state=filter_state,
            )
            filter_state = filtered["state"]
        modulated = registry.require("rf_amplitude_phase_modulator").call(
            {"input_i": 1.0, "input_q": 0.0},
            {"amplitude_scale": 2.0, "phase_shift_deg": 90.0, "output_filter_cutoff_hz": 0.0},
            dt=1.0,
            state={},
        )

        self.assertGreater(abs(filtered["outputs"]["filtered_signal"]), 0.5)
        self.assertAlmostEqual(modulated["outputs"]["output_i"], 0.0, places=12)
        self.assertAlmostEqual(modulated["outputs"]["output_q"], 2.0, places=12)

    def test_rf_complex_envelope_processing_modules_preserve_rf_context(self):
        registry = ModuleRegistry.from_builtin_manifest()
        first = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50, "unit": "V"}
        second = {"i": 0.0, "q": 1.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50, "unit": "V"}
        input_1 = [first] * 4
        input_2 = [second] * 4

        selected = registry.require("rf_complex_envelope_selector").call(
            {"input_1": input_1, "input_2": input_2}, {"selected_input": 2}
        )["outputs"]["selected_envelope"]
        gained = registry.require("rf_complex_envelope_gain").call(
            {"input_envelope": selected}, {"gain_db": 6.020599913279624}
        )["outputs"]["output_envelope"]
        limited = registry.require("rf_complex_envelope_limiter").call(
            {"input_envelope": gained}, {"limit_amplitude": 1.0}
        )["outputs"]["output_envelope"]
        modulated = registry.require("rf_complex_envelope_amplitude_phase_modulator").call(
            {"input_envelope": limited}, {"amplitude_scale": 0.5, "phase_shift_deg": 90}
        )["outputs"]["output_envelope"]
        filtered = registry.require("rf_complex_envelope_band_pass_filter").call(
            {"input_envelope": modulated}, {"center_frequency_hz": 20e9, "bandwidth_hz": 100e6}, dt=1e-6, state={}
        )["outputs"]["filtered_envelope"]

        self.assertEqual(len(selected), 4)
        self.assertAlmostEqual(selected[0]["i"], 0.0)
        self.assertAlmostEqual(selected[0]["q"], 1.0)
        self.assertAlmostEqual(gained[0]["q"], 2.0, places=10)
        self.assertAlmostEqual(limited[0]["q"], 1.0)
        self.assertAlmostEqual(modulated[0]["i"], -0.5, places=10)
        self.assertAlmostEqual(modulated[0]["q"], 0.0, places=10)
        self.assertAlmostEqual(filtered[0]["i"], -0.5, places=10)
        self.assertEqual(filtered[0]["referenceFrequencyHz"], 20e9)
        self.assertEqual(filtered[0]["impedanceOhm"], 50.0)

    def test_rf_complex_envelope_vector4_receiver_copies_input_to_two_outputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        input_vector = [
            {
                "re": float(index + 1),
                "im": -float(index + 1),
                "referenceFrequencyHz": 20e9 + index,
                "impedanceOhm": 50,
            }
            for index in range(4)
        ]

        outputs = registry.require("rf_complex_envelope_vector4_dual_output_receiver").call(
            {"input_envelope_vector": input_vector}, {}
        )["outputs"]

        first = outputs["output_envelope_vector_1"]
        second = outputs["output_envelope_vector_2"]
        self.assertEqual(len(first), 4)
        self.assertEqual(first, second)
        self.assertEqual(first[0]["i"], 1.0)
        self.assertEqual(first[0]["q"], -1.0)
        self.assertEqual(first[3]["referenceFrequencyHz"], 20e9 + 3)
        self.assertIsNot(first, second)
        self.assertIsNot(first[0], second[0])

    def test_rf_complex_envelope_ports_process_a_vector_of_independent_iq_frames(self):
        registry = ModuleRegistry.from_builtin_manifest()
        vector = [
            {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
            {"i": 0.0, "q": 2.0, "referenceFrequencyHz": 21e9, "impedanceOhm": 75},
            {"i": -1.0, "q": 0.0, "referenceFrequencyHz": 22e9, "impedanceOhm": 50},
            {"i": 0.0, "q": -2.0, "referenceFrequencyHz": 23e9, "impedanceOhm": 75},
        ]
        gained = registry.require("rf_complex_envelope_gain").call(
            {"input_envelope": vector}, {"gain_db": 6.020599913279624}
        )["outputs"]["output_envelope"]
        shifted = registry.require("rf_complex_envelope_upconverter").call(
            {"input_envelope": gained}, {"lo_frequency_hz": 1e9, "lo_phase_deg": 0, "conversion_gain": 1}
        )["outputs"]["output_envelope"]

        self.assertEqual(len(shifted), 4)
        self.assertAlmostEqual(shifted[0]["i"], 2.0, places=10)
        self.assertAlmostEqual(shifted[1]["q"], 4.0, places=10)
        self.assertEqual(shifted[0]["referenceFrequencyHz"], 21e9)
        self.assertEqual(shifted[1]["referenceFrequencyHz"], 22e9)
        self.assertEqual(shifted[1]["impedanceOhm"], 75.0)

    def test_rf_complex_envelope_up_and_downconverters_update_reference_frequency(self):
        registry = ModuleRegistry.from_builtin_manifest()
        envelope = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50}
        vector = [envelope] * 4

        downconverted = registry.require("rf_complex_envelope_downconverter").call(
            {"input_envelope": vector},
            {"lo_frequency_hz": 19e9, "lo_phase_deg": 90, "conversion_gain": 2},
        )["outputs"]["output_envelope"]
        upconverted = registry.require("rf_complex_envelope_upconverter").call(
            {"input_envelope": vector},
            {"lo_frequency_hz": 2e9, "lo_phase_deg": 90, "conversion_gain": 1},
        )["outputs"]["output_envelope"]
        inverted = registry.require("rf_complex_envelope_downconverter").call(
            {"input_envelope": [{"i": 1.0, "q": 2.0, "referenceFrequencyHz": 18e9}] * 4},
            {"lo_frequency_hz": 19e9, "lo_phase_deg": 0, "conversion_gain": 1},
        )["outputs"]["output_envelope"]

        self.assertEqual(downconverted[0]["referenceFrequencyHz"], 1e9)
        self.assertAlmostEqual(downconverted[0]["i"], 0.0, places=10)
        self.assertAlmostEqual(downconverted[0]["q"], -2.0, places=10)
        self.assertEqual(upconverted[0]["referenceFrequencyHz"], 22e9)
        self.assertAlmostEqual(upconverted[0]["i"], 0.0, places=10)
        self.assertAlmostEqual(upconverted[0]["q"], 1.0, places=10)
        self.assertEqual(inverted[0]["referenceFrequencyHz"], 1e9)
        self.assertEqual(inverted[0]["i"], 1.0)
        self.assertEqual(inverted[0]["q"], -2.0)

    def test_fixed_four_route_complex_envelope_modules_reject_other_vector_lengths(self):
        registry = ModuleRegistry.from_builtin_manifest()
        short_vector = [{"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9}] * 3

        with self.assertRaisesRegex(ValueError, "exactly 4 routes"):
            registry.require("rf_complex_envelope_limiter").call(
                {"input_envelope": short_vector}, {"limit_amplitude": 1.0}
            )

    def test_rf_band_pass_filter_rejects_out_of_band_tone(self):
        registry = ModuleRegistry.from_builtin_manifest()
        component = registry.require("rf_band_pass_filter")
        dt = 1e-10  # 10 GHz sample rate, 5 GHz Nyquist frequency

        def measure_rms(frequency_hz):
            state = {}
            samples = []
            for index in range(1024):
                result = component.call(
                    {"rf_input": math.sin(2.0 * math.pi * frequency_hz * index * dt)},
                    {"center_frequency_hz": 1e9, "bandwidth_hz": 1e9},
                    dt=dt,
                    state=state,
                )
                state = result["state"]
                if index >= 512:
                    samples.append(result["outputs"]["filtered_signal"])
            return (sum(sample * sample for sample in samples) / len(samples)) ** 0.5

        in_band_rms = measure_rms(1e9)
        out_of_band_rms = measure_rms(2e9)
        self.assertGreater(in_band_rms, 0.5)
        self.assertLess(out_of_band_rms, in_band_rms * 0.001)

    def test_rf_band_pass_filter_rejects_pulse_train_harmonics_after_settling(self):
        """A 1 ns / 2 ns RF pulse train has 500 MHz-spaced sidebands."""
        registry = ModuleRegistry.from_builtin_manifest()
        component = registry.require("rf_band_pass_filter")
        dt = 1e-10
        state = {}
        outputs = []
        for index in range(1000):
            time = index * dt
            # 1 GHz carrier, 1 ns pulse width, 2 ns repetition period.
            rf_input = math.sin(2.0 * math.pi * 1e9 * time) if time % 2e-9 < 1e-9 else 0.0
            result = component.call(
                {"rf_input": rf_input},
                {"center_frequency_hz": 1e9, "bandwidth_hz": 5e8},
                dt=dt,
                state=state,
            )
            state = result["state"]
            outputs.append(result["outputs"]["filtered_signal"])

        settled = outputs[200:]

        def tone_amplitude(frequency_hz):
            size = len(settled)
            return 2.0 * abs(sum(
                sample * complex(
                    math.cos(-2.0 * math.pi * frequency_hz * index * dt),
                    math.sin(-2.0 * math.pi * frequency_hz * index * dt),
                )
                for index, sample in enumerate(settled)
            )) / size

        carrier = tone_amplitude(1e9)
        self.assertGreater(carrier, 0.1)
        self.assertLess(tone_amplitude(0.5e9), carrier * 0.001)
        self.assertLess(tone_amplitude(1.5e9), carrier * 0.001)

    def test_cabinet03_module_applies_line_loss(self):
        registry = ModuleRegistry.from_builtin_manifest()

        result = registry.require("cabinet03_module").call({"socket03": 10.0}, {})

        self.assertAlmostEqual(result["outputs"]["socket05"], 9.8, places=12)

    def test_electrical_modules_generate_ac_and_dc_sources_boost_dc_and_match_rms_ac_to_dc(self):
        registry = ModuleRegistry.from_builtin_manifest()

        ac_source = registry.require("electrical_ac_power_source").call(
            {},
            {"voltage_rms": 10.0, "frequency_hz": 1.0, "phase_deg": 90.0},
            time=0.0,
        )
        dc_source = registry.require("electrical_dc_power_source").call(
            {},
            {"output_voltage": 28.0},
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
        self.assertEqual(dc_source["outputs"]["dc_output"], 28.0)
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

    def test_rf_complex_envelope_to_vector4_repeats_normalized_envelope(self):
        registry = ModuleRegistry.from_builtin_manifest()
        input_envelope = {
            "re": 0.25,
            "im": -0.75,
            "referenceFrequencyHz": 20e9,
            "impedanceOhm": 75.0,
        }

        result = registry.require("rf_complex_envelope_to_vector4").call(
            {"input_envelope": input_envelope},
            {},
        )

        vector = result["outputs"]["envelope_vector"]
        expected = {
            "i": 0.25,
            "q": -0.75,
            "referenceFrequencyHz": 20e9,
            "impedanceOhm": 75.0,
            "unit": "V",
        }
        self.assertEqual(vector, [expected, expected, expected, expected])
        self.assertIsNot(vector[0], vector[1])

    def test_rf_complex_envelope_vector4_power_divider_repeats_and_scales_scalar_input(self):
        registry = ModuleRegistry.from_builtin_manifest()
        input_envelope = {"i": 2.0, "q": -4.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 75.0}

        result = registry.require("rf_complex_envelope_vector4_power_divider").call(
            {"input_envelope": input_envelope},
            {},
        )

        vector = result["outputs"]["output_envelope_vector"]
        self.assertEqual(
            [(item["i"], item["q"]) for item in vector],
            [(1.0, -2.0), (1.0, -2.0), (1.0, -2.0), (1.0, -2.0)],
        )
        self.assertEqual(vector[0]["referenceFrequencyHz"], 20e9)
        self.assertEqual(vector[0]["impedanceOhm"], 75.0)
        self.assertIsNot(vector[0], vector[1])

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
            sample = [
                math.cos(2.0 * math.pi * carrier_frequency * time),
                math.sin(2.0 * math.pi * carrier_frequency * time),
            ]
            result = module.call(
                {"if_i": sample[0], "if_q": sample[1]},
                {"fft_size": 64, "adc_full_scale": 1, "envelope_threshold_adc": 12},
                time=time,
                dt=dt,
                state=state,
            )
            state = result["state"]

        outputs = result["outputs"]
        self.assertAlmostEqual(outputs["center_frequency_hz"], carrier_frequency, places=6)
        self.assertEqual(outputs["pulse_count"], 1)
        self.assertGreaterEqual(outputs["pulse_amplitude_adc"], 250)
        self.assertLessEqual(outputs["pulse_amplitude_adc"], 255)

    def test_rf_pulse_feature_extractor_ignores_a_stronger_negative_frequency_image(self):
        module = ModuleRegistry.from_builtin_manifest().require("rf_pulse_feature_extractor")
        sample_rate = 4096.0
        wanted_frequency = 512.0
        negative_image_frequency = 1024.0
        dt = 1.0 / sample_rate
        state = {}

        for index in range(64):
            time = index * dt
            wanted_phase = 2.0 * math.pi * wanted_frequency * time
            image_phase = 2.0 * math.pi * negative_image_frequency * time
            result = module.call(
                {
                    "if_i": 0.5 * math.cos(wanted_phase) + math.cos(image_phase),
                    "if_q": 0.5 * math.sin(wanted_phase) - math.sin(image_phase),
                },
                {
                    "fft_size": 64,
                    "adc_full_scale": 2,
                    "envelope_threshold_adc": 12,
                    "complex_filter_bandwidth_hz": 100,
                },
                time=time,
                dt=dt,
                state=state,
            )
            state = result["state"]

        self.assertAlmostEqual(result["outputs"]["center_frequency_hz"], wanted_frequency, places=6)

    def test_rf_pulse_feature_extractor_counts_each_detected_envelope_rising_edge(self):
        module = ModuleRegistry.from_builtin_manifest().require("rf_pulse_feature_extractor")
        state = {}
        time = 0.0
        dt = 0.1

        first_pulse = module.call(
            {"if_i": 1.0, "if_q": 0.0},
            {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12},
            time=time,
            dt=dt,
            state=state,
        )
        self.assertEqual(first_pulse["outputs"]["pulse_count"], 1)
        state = first_pulse["state"]

        for _ in range(8):
            time += dt
            result = module.call(
                {"if_i": 0.0, "if_q": 0.0},
                {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12},
                time=time,
                dt=dt,
                state=state,
            )
            state = result["state"]

        time += dt
        second_pulse = module.call(
            {"if_i": 1.0, "if_q": 0.0},
            {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12},
            time=time,
            dt=dt,
            state=state,
        )
        self.assertEqual(second_pulse["outputs"]["pulse_count"], 2)

    def test_complex_envelope_pulse_feature_extractor_reports_absolute_frequency_and_pulse_timing(self):
        module = ModuleRegistry.from_builtin_manifest().require("rf_complex_envelope_pulse_feature_extractor")
        frequency_state = {}
        for index in range(4):
            frequency_result = module.call(
                {"input_envelope_vector": [
                    {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                ]},
                {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12, "envelope_smoothing": 1},
                time=index * 0.1,
                dt=0.1,
                state=frequency_state,
            )
            frequency_state = frequency_result["state"]
        self.assertAlmostEqual(frequency_result["outputs"]["center_frequency_hz"], 20e9)

        state = {}
        dt = 0.1
        result = None
        for index in range(22):
            time = index * dt
            active = index % 10 in (1, 2)
            result = module.call(
                {"input_envelope_vector": [
                    {"i": 1.0 if active else 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                    {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50},
                ]},
                {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12, "envelope_smoothing": 1},
                time=time,
                dt=dt,
                state=state,
            )
            state = result["state"]

        outputs = result["outputs"]
        self.assertEqual(outputs["pulse_count"], 3)
        self.assertAlmostEqual(outputs["pulse_period_seconds"], 1.0)
        self.assertAlmostEqual(outputs["pulse_width_seconds"], 0.2)
        self.assertEqual(outputs["pulse_amplitude_adc"], 255)

    def test_complex_envelope_pulse_feature_extractor_selects_the_first_nonzero_vector_route(self):
        module = ModuleRegistry.from_builtin_manifest().require("rf_complex_envelope_pulse_feature_extractor")
        zero = {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 10e9, "impedanceOhm": 50}
        cases = [
            ([zero, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9}, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 30e9}, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 40e9}], 20e9),
            ([zero, zero, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 30e9}, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 40e9}], 30e9),
            ([zero, zero, zero, {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 40e9}], 40e9),
        ]

        for samples, expected_frequency in cases:
            result = module.call(
                {"input_envelope_vector": samples},
                {"fft_size": 4, "adc_full_scale": 1, "envelope_threshold_adc": 12, "envelope_smoothing": 1},
                time=0.0,
                dt=0.1,
                state={},
            )
            self.assertEqual(result["outputs"]["center_frequency_hz"], expected_frequency)

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
        self.assertEqual(mode_one["outputs"]["if_iq"], [2.0, 0.0])
        self.assertAlmostEqual(mode_two["outputs"]["if_i"], 6.0, places=12)
        self.assertAlmostEqual(mode_two["outputs"]["if_q"], 0.0, places=12)
        self.assertEqual(mode_two["outputs"]["if_iq"], [6.0, 0.0])

    def test_rf_downconverter_keeps_low_pass_state_separate_when_switching_inputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_downconverter")
        parameters = {
            "lo_frequency_hz": 0.0,
            "lo_phase_deg": 0.0,
            "conversion_gain": 1.0,
            "low_pass_cutoff_hz": 1.0 / (2.0 * math.pi),
        }

        input_two = module.call(
            {"rf_input": 0.0, "rf_input_2": 1.0},
            {**parameters, "input_mode": 2},
            time=0.0,
            dt=1.0,
        )
        input_one = module.call(
            {"rf_input": 0.0, "rf_input_2": 1.0},
            {**parameters, "input_mode": 1},
            time=1.0,
            dt=1.0,
            state=input_two["state"],
        )

        self.assertGreater(input_two["outputs"]["if_i"], 0.0)
        self.assertEqual(input_one["outputs"]["if_i"], 0.0)
        self.assertEqual(input_one["outputs"]["if_q"], 0.0)

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
                "downconvert_rf_inputs": [1.0, -0.5],
                "upconvert_baseband_inputs": [0.25, -0.75],
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
                "downconverted_baseband_outputs": [2.0, -1.0],
                "upconverted_rf_outputs": [0.25, -0.75],
            },
        )

    def test_rf_four_port_up_down_converter_filters_the_sum_mixing_product(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("rf_four_port_up_down_converter")

        result = module.call(
            {
                "downconvert_rf_inputs": [1.0, 0.0],
                "upconvert_baseband_inputs": [0.0, 0.0],
            },
            {
                "downconvert_lo_frequency_hz": 0.0,
                "upconvert_lo_frequency_hz": 0.0,
                "lo_phase_deg": 0.0,
                "downconversion_gain": 1.0,
                "upconversion_gain": 1.0,
                "downconvert_low_pass_cutoff_hz": 1.0 / (2.0 * math.pi),
            },
            time=0.0,
            dt=1.0,
        )

        self.assertAlmostEqual(
            result["outputs"]["downconverted_baseband_outputs"][0],
            2.0 * (1.0 - math.exp(-1.0)),
        )
        self.assertEqual(result["state"]["downconversion_i"], result["outputs"]["downconverted_baseband_outputs"])

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
