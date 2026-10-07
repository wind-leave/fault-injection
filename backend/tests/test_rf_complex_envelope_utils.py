import math
import unittest
from unittest.mock import patch

from backend.simulation_functions import (
    apply_envelope_amplitude_phase_modulation,
    apply_envelope_band_pass_filter,
    apply_envelope_band_stop_filter,
    apply_envelope_downconversion,
    apply_envelope_low_pass_filter,
    apply_envelope_upconversion,
    extract_complex_envelope_pulse_features,
    power_combine,
)


class ComplexEnvelopeUtilsTests(unittest.TestCase):
    def test_band_stop_filter_rejects_in_band_and_passes_out_of_band_routes(self):
        inputs = [
            {
                "i": 1.0,
                "q": -0.5,
                "referenceFrequencyHz": 1_000_000.0,
                "impedanceOhm": 75.0,
                "unit": "mV",
            },
            {
                "i": 2.0,
                "q": 0.25,
                "referenceFrequencyHz": 2_000_000.0,
                "impedanceOhm": 50.0,
                "unit": "V",
            },
        ]

        result = apply_envelope_band_stop_filter(
            inputs,
            center_frequency_hz=1_000_000.0,
            bandwidth_hz=200_000.0,
            dt=0.0,
        )
        outputs = result["outputs"]["filtered_envelope"]

        self.assertEqual(outputs[0]["i"], 0.0)
        self.assertEqual(outputs[0]["q"], 0.0)
        self.assertEqual(outputs[0]["impedanceOhm"], 75.0)
        self.assertEqual(outputs[0]["unit"], "mV")
        self.assertEqual(outputs[1]["i"], 2.0)
        self.assertEqual(outputs[1]["q"], 0.25)
        self.assertEqual(len(result["state"]["lanes"]), 2)

    def test_band_stop_filter_smoothly_decays_an_in_band_route(self):
        envelope = {"i": 1.0, "q": -2.0, "referenceFrequencyHz": 1_000_000.0}
        bandwidth = 100.0
        dt = 0.01
        alpha = math.exp(-2.0 * math.pi * (bandwidth / 2.0) * dt)

        result = apply_envelope_band_stop_filter(
            envelope,
            center_frequency_hz=1_000_000.0,
            bandwidth_hz=bandwidth,
            dt=dt,
            state={"lanes": [{"output_i": 1.0, "output_q": -2.0}]},
        )
        output = result["outputs"]["filtered_envelope"][0]

        self.assertAlmostEqual(output["i"], alpha)
        self.assertAlmostEqual(output["q"], -2.0 * alpha)

    def test_band_stop_filter_with_zero_bandwidth_passes_the_input(self):
        envelope = {"i": 1.0, "q": 2.0, "referenceFrequencyHz": 1_000_000.0}

        result = apply_envelope_band_stop_filter(
            envelope,
            center_frequency_hz=1_000_000.0,
            bandwidth_hz=0.0,
            dt=0.0,
        )

        self.assertEqual(result["outputs"]["filtered_envelope"][0]["i"], 1.0)
        self.assertEqual(result["outputs"]["filtered_envelope"][0]["q"], 2.0)

    def test_power_combiner_accepts_any_positive_even_route_count(self):
        envelope = {
            "i": 1.0,
            "q": -0.5,
            "referenceFrequencyHz": 20e9,
            "impedanceOhm": 50.0,
            "unit": "V",
        }

        for route_count in (2, 4, 6):
            with self.subTest(route_count=route_count):
                output = power_combine([envelope] * route_count)

                self.assertAlmostEqual(output["i"], math.sqrt(route_count))
                self.assertAlmostEqual(output["q"], -0.5 * math.sqrt(route_count))
                self.assertEqual(output["referenceFrequencyHz"], 20e9)
                self.assertEqual(output["impedanceOhm"], 50.0)
                self.assertEqual(output["unit"], "V")

    def test_power_combiner_coherently_cancels_opposite_iq(self):
        output = power_combine([
            {"i": 1.0, "q": 2.0, "referenceFrequencyHz": 10e6},
            {"i": -1.0, "q": -2.0, "referenceFrequencyHz": 10e6},
        ])

        self.assertAlmostEqual(output["i"], 0.0)
        self.assertAlmostEqual(output["q"], 0.0)

    def test_power_combiner_rejects_invalid_route_counts_and_metadata(self):
        envelope = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 10e6}

        for invalid in (envelope, [], [envelope], [envelope] * 3):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    power_combine(invalid)

        with self.assertRaises(ValueError):
            power_combine([
                envelope,
                {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e6},
            ])

    def test_pulse_feature_extractor_tracks_width_period_amplitude_and_count(self):
        active = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 10e6}
        inactive = {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 10e6}
        state = None

        samples = (
            (0.0, active),
            (0.1, active),
            (0.2, inactive),
            (1.0, active),
        )
        for sample_time, envelope in samples:
            result = extract_complex_envelope_pulse_features(
                envelope,
                fft_size=4,
                adc_full_scale=1.0,
                envelope_threshold_adc=12,
                time=sample_time,
                dt=0.1,
                state=state,
            )
            state = result["state"]

        outputs = result["outputs"]
        self.assertEqual(outputs["center_frequency_hz"], 10e6)
        self.assertAlmostEqual(outputs["pulse_period_seconds"], 1.0)
        self.assertAlmostEqual(outputs["pulse_width_seconds"], 0.2)
        self.assertEqual(outputs["pulse_amplitude_adc"], 255)
        self.assertEqual(outputs["pulse_count"], 2)

    def test_pulse_feature_extractor_accepts_a_vector_and_selects_first_active_route(self):
        result = extract_complex_envelope_pulse_features(
            [
                {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 1e6},
                {"i": 0.5, "q": 0.0, "referenceFrequencyHz": 2e6},
            ],
            adc_full_scale=1.0,
            envelope_threshold_adc=12,
        )

        self.assertEqual(result["outputs"]["center_frequency_hz"], 2e6)
        self.assertEqual(result["outputs"]["pulse_amplitude_adc"], 128)
        self.assertEqual(result["outputs"]["pulse_count"], 1)

    def test_pulse_timing_updates_between_sparse_frequency_estimates(self):
        state = None
        estimates = []

        def estimate(samples, sample_period):
            estimates.append((len(samples), sample_period))
            return float(len(estimates) * 100)

        with patch("backend.simulation_functions._estimate_envelope_baseband_frequency", side_effect=estimate):
            for index in range(18):
                active = index in (0, 1, 8, 9)
                result = extract_complex_envelope_pulse_features(
                    {"i": 1.0 if active else 0.0, "q": 0.0, "referenceFrequencyHz": 1e6},
                    fft_size=16,
                    time=index * 0.1,
                    dt=0.1,
                    state=state,
                )
                state = result["state"]
                if index == 8:
                    self.assertEqual(result["outputs"]["pulse_count"], 2)
                    self.assertAlmostEqual(result["outputs"]["pulse_period_seconds"], 0.8)
                    self.assertAlmostEqual(result["outputs"]["pulse_width_seconds"], 0.2)
                if index == 16:
                    self.assertEqual(result["outputs"]["center_frequency_hz"], 1e6 + 100)
                if index == 17:
                    self.assertEqual(result["outputs"]["center_frequency_hz"], 1e6 + 200)

        self.assertEqual(estimates, [(16, 0.1), (16, 0.1)])
        self.assertEqual(result["outputs"]["pulse_amplitude_adc"], 255)

    def test_frequency_window_rolls_forward_without_mutating_previous_state(self):
        state = None
        windows = []

        def estimate(samples, _sample_period):
            windows.append([sample.real for sample in samples])
            return 50.0

        with patch("backend.simulation_functions._estimate_envelope_baseband_frequency", side_effect=estimate):
            for index in range(20):
                result = extract_complex_envelope_pulse_features(
                    {"i": index + 1, "q": 0.0, "referenceFrequencyHz": 1e6},
                    fft_size=16,
                    time=index * 0.1,
                    dt=0.1,
                    state=state,
                )
                if index == 16:
                    retained_state = result["state"]
                    retained_samples = list(retained_state["samples"])
                state = result["state"]

        self.assertEqual(windows, [
            list(range(1, 17)),
            list(range(3, 19)),
            list(range(5, 21)),
        ])
        self.assertEqual(retained_state["samples"], retained_samples)
        changed_reference = extract_complex_envelope_pulse_features(
            {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 2e6},
            fft_size=16,
            time=2.0,
            dt=0.1,
            state=state,
        )
        self.assertEqual(changed_reference["outputs"]["center_frequency_hz"], 2e6)
        self.assertEqual(len(changed_reference["state"]["samples"]), 1)

    def test_low_pass_filter_smooths_iq_and_preserves_metadata(self):
        envelope = {
            "i": 1.0,
            "q": -2.0,
            "referenceFrequencyHz": 10e6,
            "impedanceOhm": 75.0,
            "unit": "mV",
        }
        cutoff = 1.0
        dt = 0.1
        smoothing = 1.0 - math.exp(-2.0 * math.pi * cutoff * dt)

        first = apply_envelope_low_pass_filter(
            envelope,
            cutoff_frequency_hz=cutoff,
            dt=dt,
        )
        output = first["outputs"]["filtered_envelope"][0]

        self.assertAlmostEqual(output["i"], smoothing)
        self.assertAlmostEqual(output["q"], -2.0 * smoothing)
        self.assertEqual(output["referenceFrequencyHz"], 10e6)
        self.assertEqual(output["impedanceOhm"], 75.0)
        self.assertEqual(output["unit"], "mV")

        second = apply_envelope_low_pass_filter(
            envelope,
            cutoff_frequency_hz=cutoff,
            dt=dt,
            state=first["state"],
        )
        self.assertGreater(second["outputs"]["filtered_envelope"][0]["i"], output["i"])

    def test_low_pass_filter_keeps_independent_vector_lane_states(self):
        envelopes = [
            {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 10e6},
            {"i": 0.0, "q": 2.0, "referenceFrequencyHz": 20e6},
        ]

        result = apply_envelope_low_pass_filter(
            envelopes,
            cutoff_frequency_hz=10.0,
            dt=0.01,
        )

        outputs = result["outputs"]["filtered_envelope"]
        self.assertEqual(len(outputs), 2)
        self.assertGreater(outputs[0]["i"], 0.0)
        self.assertEqual(outputs[0]["q"], 0.0)
        self.assertEqual(outputs[1]["i"], 0.0)
        self.assertGreater(outputs[1]["q"], 0.0)
        self.assertEqual(len(result["state"]["lanes"]), 2)

    def test_low_pass_filter_holds_previous_output_when_dt_is_zero(self):
        envelope = {"i": 10.0, "q": 20.0, "referenceFrequencyHz": 1e6}
        state = {
            "lanes": [{
                "output_i": 1.5,
                "output_q": -0.5,
                "referenceFrequencyHz": 1e6,
            }]
        }

        result = apply_envelope_low_pass_filter(
            envelope,
            cutoff_frequency_hz=100.0,
            dt=0.0,
            state=state,
        )

        output = result["outputs"]["filtered_envelope"][0]
        self.assertEqual(output["i"], 1.5)
        self.assertEqual(output["q"], -0.5)

    def test_amplitude_phase_modulation_accepts_any_route_count(self):
        envelope = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9}

        for route_count in (2, 5):
            with self.subTest(route_count=route_count):
                outputs = apply_envelope_amplitude_phase_modulation(
                    [envelope] * route_count,
                    amplitude_scale=2.0,
                    phase_shift_deg=90.0,
                )

                self.assertEqual(len(outputs), route_count)
                self.assertAlmostEqual(outputs[0]["i"], 0.0, places=10)
                self.assertAlmostEqual(outputs[0]["q"], 2.0, places=10)
                self.assertEqual(outputs[0]["referenceFrequencyHz"], 20e9)

        scalar_output = apply_envelope_amplitude_phase_modulation(
            envelope,
            amplitude_scale=2.0,
            phase_shift_deg=90.0,
        )
        self.assertIsInstance(scalar_output, dict)
        self.assertAlmostEqual(scalar_output["q"], 2.0, places=10)

    def test_upconversion_updates_frequency_phase_and_gain(self):
        envelope = {"i": 1.0, "q": 0.0, "referenceFrequencyHz": 20e9}

        for route_count in (2, 5):
            with self.subTest(route_count=route_count):
                outputs = apply_envelope_upconversion(
                    [envelope] * route_count,
                    lo_frequency_hz=2e9,
                    lo_phase_deg=90.0,
                    conversion_gain=2.0,
                )

                self.assertEqual(len(outputs), route_count)
                self.assertEqual(outputs[0]["referenceFrequencyHz"], 22e9)
                self.assertAlmostEqual(outputs[0]["i"], 0.0, places=10)
                self.assertAlmostEqual(outputs[0]["q"], 2.0, places=10)

        scalar_output = apply_envelope_upconversion(envelope, lo_frequency_hz=2e9)
        self.assertIsInstance(scalar_output, dict)
        self.assertEqual(scalar_output["referenceFrequencyHz"], 22e9)

    def test_downconversion_preserves_low_side_spectrum_inversion(self):
        envelope = {"i": 1.0, "q": 2.0, "referenceFrequencyHz": 18e9}

        for route_count in (2, 5):
            with self.subTest(route_count=route_count):
                outputs = apply_envelope_downconversion(
                    [envelope] * route_count,
                    lo_frequency_hz=19e9,
                )

                self.assertEqual(len(outputs), route_count)
                self.assertEqual(outputs[0]["referenceFrequencyHz"], 1e9)
                self.assertEqual(outputs[0]["i"], 1.0)
                self.assertEqual(outputs[0]["q"], -2.0)

        scalar_output = apply_envelope_downconversion(
            envelope,
            lo_frequency_hz=19e9,
        )
        self.assertIsInstance(scalar_output, dict)
        self.assertEqual(scalar_output["referenceFrequencyHz"], 1e9)

    def test_band_pass_filter_accepts_any_route_count_without_middle_vars(self):
        envelope = {
            "i": 1.0,
            "q": -0.5,
            "referenceFrequencyHz": 1_000_000.0,
        }

        for input_envelope, expected_count in (
            (envelope, 1),
            ([envelope] * 2, 2),
            ([envelope] * 5, 5),
        ):
            with self.subTest(route_count=expected_count):
                result = apply_envelope_band_pass_filter(input_envelope, dt=0.0)

                self.assertNotIn("middleVars", result)
                self.assertEqual(
                    len(result["outputs"]["filtered_envelope"]), expected_count
                )
                self.assertEqual(len(result["state"]["lanes"]), expected_count)


if __name__ == "__main__":
    unittest.main()
