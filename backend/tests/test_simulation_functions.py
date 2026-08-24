import unittest
import math

from backend.simulation_functions import (
    as_float,
    adc_convert_rf,
    adc_codes_to_normalized_iq,
    amplify_rf_excitation,
    amplify_rf_final_power_2,
    amplify_rf_power,
    amplify_rf_relay,
    amplify_rf_signal,
    band_pass_rf_filter,
    band_stop_rf_filter,
    clamp,
    combine_split_rf_power,
    control_rf_beam_array,
    control_rf_channel_amplitude_phase,
    control_signal_amplitude_phase,
    control_excitation_power_split,
    dac_convert_rf,
    dequantize_bipolar_code,
    dbf_form_baseband_signal,
    deterministic_noise,
    downconvert_rf_signal,
    first_numeric,
    first_order_response,
    floor_power_of_two,
    fft_radix2,
    high_pass_rf_filter,
    limit_rf_amplitude,
    low_pass_rf_filter,
    multiplex_wavelength_division,
    normalized_iq_to_dac_codes,
    estimate_fft_peak_frequency,
    periodic_gate,
    pulse_train,
    quantize_bipolar_sample,
    process_rf_frontend,
    rate_limit,
    select_excitation_signal,
    select_rf_switch,
    sp2t_switch,
    split_rf_power_2_to_8,
    upconvert_rf_signal,
)


class SimulationFunctionsTests(unittest.TestCase):
    def test_numeric_helpers_return_finite_values(self):
        self.assertEqual(as_float("bad", 2.5), 2.5)
        self.assertEqual(as_float(float("inf"), 2.5), 2.5)
        self.assertEqual(clamp(9, 0, 5), 5.0)
        self.assertEqual(clamp(-1, 5, 0), 0.0)
        self.assertEqual(first_numeric({"invalid": "x", "value": 3}, ("invalid", "value")), 3.0)

    def test_fft_helpers_estimate_sine_frequency_and_adc_conversion(self):
        sample_rate = 64.0
        samples = [math.sin(2.0 * math.pi * 8.0 * index / sample_rate) for index in range(64)]

        self.assertEqual(floor_power_of_two(100), 64)
        self.assertEqual(len(fft_radix2(samples)), 64)
        self.assertAlmostEqual(estimate_fft_peak_frequency(samples, 1.0 / sample_rate), 8.0)
        self.assertEqual(quantize_bipolar_sample(-1.0, 1.0), 0)
        self.assertEqual(quantize_bipolar_sample(1.0, 1.0), 255)
        self.assertAlmostEqual(dequantize_bipolar_code(128, 1.0), 1.0 / 255.0)

    def test_dynamic_helpers(self):
        self.assertEqual(first_order_response(0, 10, 1, 1), 5.0)
        self.assertEqual(rate_limit(0, 10, 2, 3, 0.5), 1.0)
        self.assertEqual(rate_limit(0, -10, 2, 3, 0.5), -1.5)

    def test_rf_amplitude_limiter_preserves_values_in_range(self):
        self.assertEqual(limit_rf_amplitude(0.4, 1.0), 0.4)
        self.assertEqual(limit_rf_amplitude(1.8, 1.0), 1.0)
        self.assertEqual(limit_rf_amplitude(-1.8, 1.0), -1.0)
        self.assertEqual(limit_rf_amplitude(1.8, -1.0), 1.0)

    def test_rf_amplifier_uses_db_gain_and_optional_saturation(self):
        self.assertAlmostEqual(amplify_rf_signal(1.0, 6.020599913), 2.0)
        self.assertEqual(amplify_rf_signal(1.0, 20.0, maximum_amplitude=3.0), 3.0)

    def test_rf_excitation_amplifier_applies_gain_and_saturation(self):
        self.assertEqual(amplify_rf_excitation(0.2, 20.0, maximum_output_amplitude=1.0), 1.0)

    def test_rf_power_amplifier_limits_peak_voltage_from_power_limit(self):
        self.assertEqual(
            amplify_rf_power(1.0, 20.0, maximum_output_power_watts=0.04, impedance_ohms=50.0),
            2.0,
        )

    def test_two_element_final_power_amplifier_uses_gate_control(self):
        outputs = amplify_rf_final_power_2(
            small_signal_inputs=(1.0, 1.0),
            gate_controls=(1.0, 0.0),
            gain_db=20.0,
            maximum_output_power_watts=0.04,
            impedance_ohms=50.0,
            gate_threshold=0.5,
        )

        self.assertEqual(len(outputs), 2)
        self.assertEqual(outputs[0], 2.0)
        self.assertEqual(outputs[1], 0.0)

    def test_rf_adc_converts_bipolar_samples_to_unsigned_codes(self):
        self.assertEqual(adc_convert_rf(-1.0, resolution_bits=12, full_scale_amplitude=1.0), 0)
        self.assertEqual(adc_convert_rf(0.0, resolution_bits=12, full_scale_amplitude=1.0), 2048)
        self.assertEqual(adc_convert_rf(1.0, resolution_bits=12, full_scale_amplitude=1.0), 4095)
        self.assertEqual(adc_convert_rf(2.0, resolution_bits=8, full_scale_amplitude=1.0), 255)

    def test_rf_dac_converts_unsigned_codes_to_bipolar_samples(self):
        self.assertEqual(dac_convert_rf(0, resolution_bits=12, full_scale_amplitude=1.0), -1.0)
        self.assertEqual(dac_convert_rf(4095, resolution_bits=12, full_scale_amplitude=1.0), 1.0)
        self.assertEqual(dac_convert_rf(5000, resolution_bits=12, full_scale_amplitude=1.0), 1.0)
        self.assertEqual(dac_convert_rf(4095, resolution_bits=12, full_scale_amplitude=1.0, offset=0.25), 1.25)

    def test_adc_codes_are_recovered_as_normalized_iq_baseband(self):
        i_code = adc_convert_rf(0.5, resolution_bits=16, full_scale_amplitude=1.0, offset=0.1)
        q_code = adc_convert_rf(-0.25, resolution_bits=16, full_scale_amplitude=1.0, offset=-0.2)

        in_phase, quadrature = adc_codes_to_normalized_iq(
            i_code,
            q_code,
            resolution_bits=16,
            full_scale_amplitude=1.0,
            i_offset=0.1,
            q_offset=-0.2,
        )
        self.assertAlmostEqual(in_phase, 0.5, places=4)
        self.assertAlmostEqual(quadrature, -0.25, places=4)

    def test_normalized_iq_is_converted_to_two_dac_codes(self):
        i_code, q_code = normalized_iq_to_dac_codes(0.5, -0.25, resolution_bits=16)

        self.assertAlmostEqual(dac_convert_rf(i_code, resolution_bits=16), 0.5, places=4)
        self.assertAlmostEqual(dac_convert_rf(q_code, resolution_bits=16), -0.25, places=4)

    def test_dbf_forms_iq_baseband_signal_with_amplitude_and_phase_weights(self):
        in_phase, quadrature = dbf_form_baseband_signal(
            samples=((1.0, 0.0), (1.0, 0.0)),
            amplitude_weights=(1.0, 2.0),
            phase_weights_deg=(0.0, 90.0),
        )

        self.assertAlmostEqual(in_phase, 1.0)
        self.assertAlmostEqual(quadrature, 2.0)

    def test_dbf_defaults_missing_weights_and_accepts_real_samples(self):
        in_phase, quadrature = dbf_form_baseband_signal((1.0, 2.0), amplitude_weights=(0.5,))

        self.assertEqual(in_phase, 2.5)
        self.assertEqual(quadrature, 0.0)

    def test_rf_low_pass_filter_uses_previous_output_as_state(self):
        output = low_pass_rf_filter(1.0, 0.0, 1.0 / (2.0 * 3.141592653589793), 1.0)

        self.assertAlmostEqual(output, 1.0 - (2.718281828459045 ** -1.0))
        self.assertEqual(low_pass_rf_filter(1.0, output, 0.0, 1.0), output)

    def test_rf_high_pass_filter_uses_previous_input_and_output_as_state(self):
        cutoff = 1.0 / (2.0 * 3.141592653589793)
        output = high_pass_rf_filter(1.0, 0.0, 0.0, cutoff, 1.0)

        self.assertAlmostEqual(output, 2.718281828459045 ** -1.0)
        self.assertAlmostEqual(
            high_pass_rf_filter(1.0, 1.0, output, cutoff, 1.0),
            2.718281828459045 ** -2.0,
        )
        self.assertEqual(high_pass_rf_filter(2.0, 1.0, output, cutoff, 0.0), output)

    def test_rf_band_pass_filter_cascades_high_and_low_pass_stages(self):
        cutoff_low = 1.0 / (4.0 * 3.141592653589793)
        cutoff_high = 1.0 / (2.0 * 3.141592653589793)
        high_pass_output, output = band_pass_rf_filter(
            1.0, 0.0, 0.0, 0.0, cutoff_low, cutoff_high, 1.0
        )

        self.assertAlmostEqual(high_pass_output, 2.718281828459045 ** -0.5)
        self.assertAlmostEqual(
            output,
            (2.718281828459045 ** -0.5) * (1.0 - 2.718281828459045 ** -1.0),
        )
        self.assertEqual(
            band_pass_rf_filter(1.0, 0.0, 0.0, output, 2.0, 1.0, 1.0),
            (0.0, output),
        )

    def test_rf_band_stop_filter_rejects_band_pass_component(self):
        cutoff_low = 1.0 / (4.0 * 3.141592653589793)
        cutoff_high = 1.0 / (2.0 * 3.141592653589793)
        output = band_stop_rf_filter(
            1.0, 0.0, 0.0, 0.0, cutoff_low, cutoff_high, 1.0
        )

        self.assertAlmostEqual(
            output,
            1.0 - (2.718281828459045 ** -0.5) * (1.0 - 2.718281828459045 ** -1.0),
        )
        self.assertEqual(
            band_stop_rf_filter(1.0, 0.0, 0.0, output, 2.0, 1.0, 1.0),
            output,
        )

    def test_rf_downconverter_generates_iq_mixer_outputs_and_optional_low_pass(self):
        in_phase, quadrature = downconvert_rf_signal(
            0.5,
            lo_frequency_hz=1.0,
            time=0.0,
        )
        filtered_i, filtered_q = downconvert_rf_signal(
            0.5,
            lo_frequency_hz=1.0,
            time=0.0,
            previous_output_iq=(0.0, 0.0),
            low_pass_cutoff_hz=1.0 / (2.0 * 3.141592653589793),
            dt=1.0,
        )

        self.assertEqual(in_phase, 1.0)
        self.assertEqual(quadrature, 0.0)
        self.assertAlmostEqual(filtered_i, 1.0 - (2.718281828459045 ** -1.0))
        self.assertEqual(filtered_q, 0.0)

    def test_rf_upconverter_combines_iq_signal_with_local_oscillator(self):
        self.assertAlmostEqual(
            upconvert_rf_signal((1.0, 0.0), lo_frequency_hz=1.0, time=0.25),
            0.0,
            places=6,
        )
        self.assertAlmostEqual(
            upconvert_rf_signal((0.0, 1.0), lo_frequency_hz=1.0, time=0.25),
            -1.0,
            places=6,
        )
        self.assertEqual(
            upconvert_rf_signal((1.0, 0.0), 0.0, conversion_gain=2.0),
            2.0,
        )

    def test_rf_switch_selects_the_requested_input(self):
        inputs = (0.25, -0.5, 1.0)

        self.assertEqual(select_rf_switch(inputs, 0), 0.25)
        self.assertEqual(select_rf_switch(inputs, 2), 1.0)
        self.assertEqual(select_rf_switch(inputs, 3, default=-1.0), -1.0)
        self.assertEqual(select_rf_switch(inputs, "invalid", default=-1.0), -1.0)

    def test_sp2t_switch_routes_input_to_one_throw(self):
        self.assertEqual(sp2t_switch(3.0, 0), (3.0, 0.0))
        self.assertEqual(sp2t_switch(3.0, 1), (0.0, 3.0))
        self.assertEqual(sp2t_switch(3.0, 2), (0.0, 0.0))

    def test_two_to_eight_power_splitter_divides_each_input_into_four_outputs(self):
        outputs = split_rf_power_2_to_8(4.0, 8.0)

        self.assertEqual(outputs, [2.0, 2.0, 2.0, 2.0, 4.0, 4.0, 4.0, 4.0])

    def test_excitation_signal_selection_can_be_disabled(self):
        self.assertEqual(select_excitation_signal((1.0, 2.0), 1), 2.0)
        self.assertEqual(select_excitation_signal((1.0, 2.0), 1, enabled=False), 0.0)

    def test_excitation_controlled_power_split_uses_enabled_outputs_only(self):
        outputs = control_excitation_power_split(8.0, output_enables=(True, False, True))

        self.assertAlmostEqual(outputs[0], 8.0 / (2.0 ** 0.5))
        self.assertEqual(outputs[1], 0.0)
        self.assertAlmostEqual(outputs[2], 8.0 / (2.0 ** 0.5))
        self.assertAlmostEqual(sum(value * value for value in outputs), 64.0)

    def test_channel_amplitude_phase_control_applies_gain_and_beam_scan(self):
        in_phase, quadrature = control_rf_channel_amplitude_phase(
            input_iq=(1.0, 0.0),
            input_gain_db=6.020599913,
            amplitude_weight=0.5,
            scan_angle_deg=30.0,
            element_index=1,
            element_spacing_wavelength=0.5,
        )

        self.assertAlmostEqual(in_phase, 0.0, places=6)
        self.assertAlmostEqual(quadrature, -1.0, places=6)

    def test_channel_amplitude_phase_control_filters_output_iq(self):
        in_phase, quadrature = control_rf_channel_amplitude_phase(
            input_iq=(1.0, 0.0),
            previous_output_iq=(0.0, 0.0),
            output_filter_cutoff_hz=1.0 / (2.0 * 3.141592653589793),
            dt=1.0,
        )

        self.assertAlmostEqual(in_phase, 1.0 - (2.718281828459045 ** -1.0))
        self.assertEqual(quadrature, 0.0)

    def test_generic_signal_amplitude_phase_control_accepts_and_returns_a_scalar(self):
        output = control_signal_amplitude_phase(
            input_signal=1.0,
            amplitude_scale=2.0,
            phase_shift_deg=90.0,
        )

        self.assertAlmostEqual(output, 0.0, places=10)
        self.assertEqual(control_signal_amplitude_phase(3.0), 3.0)

    def test_relay_amplifier_supports_enable_and_saturation(self):
        self.assertEqual(amplify_rf_relay(0.2, 20.0, maximum_output_amplitude=1.0), 1.0)
        self.assertEqual(amplify_rf_relay(0.2, 20.0, enabled=False), 0.0)

    def test_wavelength_division_multiplexer_keeps_wavelength_channel_pairs(self):
        multiplexed = multiplex_wavelength_division((0.5, -0.25), (1550.0, 1550.8))

        self.assertEqual(multiplexed, ((1550.0, 0.5), (1550.8, -0.25)))

    def test_beam_control_array_applies_scan_phase_to_each_element(self):
        outputs = control_rf_beam_array(
            channel_inputs=((1.0, 0.0), (1.0, 0.0)),
            scan_angle_deg=30.0,
            element_spacing_wavelength=0.5,
        )

        self.assertAlmostEqual(outputs[0][0], 1.0)
        self.assertAlmostEqual(outputs[0][1], 0.0)
        self.assertAlmostEqual(outputs[1][0], 0.0, places=6)
        self.assertAlmostEqual(outputs[1][1], -1.0, places=6)

    def test_combiner_splitter_combines_then_divides_power(self):
        outputs = combine_split_rf_power((2.0, 2.0), output_count=2)

        self.assertEqual(len(outputs), 2)
        self.assertAlmostEqual(outputs[0], 4.0 / (2.0 ** 0.5))
        self.assertAlmostEqual(outputs[1], 4.0 / (2.0 ** 0.5))

    def test_rf_frontend_applies_gain_vector_saturation_and_enable_control(self):
        in_phase, quadrature = process_rf_frontend(
            input_iq=(1.0, 1.0),
            lna_gain_db=6.020599913,
            maximum_output_amplitude=2.0,
        )

        self.assertAlmostEqual(in_phase, 2.0 ** 0.5, places=6)
        self.assertAlmostEqual(quadrature, 2.0 ** 0.5, places=6)
        self.assertEqual(process_rf_frontend((1.0, 1.0), enabled=False), (0.0, 0.0))

    def test_periodic_pulse_helpers(self):
        self.assertTrue(periodic_gate(0.25, 1.0, 0.5))
        self.assertFalse(periodic_gate(0.75, 1.0, 0.5))
        self.assertFalse(periodic_gate(0.25, 0.0, 0.5))
        self.assertEqual(pulse_train(1.25, 8, 1.0, 0.5), 8.0)
        self.assertEqual(pulse_train(1.75, 8, 1.0, 0.5, low_value=-1), -1.0)

    def test_noise_is_repeatable_and_bounded(self):
        first = deterministic_noise(42, 3, 0.25)
        self.assertEqual(first, deterministic_noise(42, 3, 0.25))
        self.assertGreaterEqual(first, -1.0)
        self.assertLess(first, 1.0)


if __name__ == "__main__":
    unittest.main()
