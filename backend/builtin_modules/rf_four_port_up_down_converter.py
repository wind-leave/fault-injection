"""Four-port RF frequency converter with two two-element vector inputs and outputs."""

from backend.simulation_functions import downconvert_rf_signal, upconvert_rf_signal


def process(
    downconvert_rf_inputs=None,
    upconvert_baseband_inputs=None,
    downconvert_lo_frequency_hz=100.0,
    upconvert_lo_frequency_hz=100.0,
    lo_phase_deg=0.0,
    downconversion_gain=1.0,
    upconversion_gain=1.0,
    downconvert_low_pass_cutoff_hz=20.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Convert two-element RF and baseband input vectors.

    The first vector contains the two RF signals to be down-converted and the
    second contains the two in-phase baseband values to be up-converted.  Each
    output is likewise a two-element vector.  The down-conversion I/Q filter
    state is retained independently for the two input paths, so the configured
    low-pass filter removes the RF+LO mixing product across simulation steps.
    The up-conversion quadrature component is zero.
    """

    downconvert_values = downconvert_rf_inputs if isinstance(downconvert_rf_inputs, (list, tuple)) else ()
    upconvert_values = upconvert_baseband_inputs if isinstance(upconvert_baseband_inputs, (list, tuple)) else ()
    downconvert_rf_input_1 = downconvert_values[0] if len(downconvert_values) > 0 else 0.0
    downconvert_rf_input_2 = downconvert_values[1] if len(downconvert_values) > 1 else 0.0
    upconvert_baseband_input_1 = upconvert_values[0] if len(upconvert_values) > 0 else 0.0
    upconvert_baseband_input_2 = upconvert_values[1] if len(upconvert_values) > 1 else 0.0
    previous = dict(state or {})
    previous_i_values = list(previous.get("downconversion_i") or [])
    previous_q_values = list(previous.get("downconversion_q") or [])
    low_pass_cutoff_hz = float(downconvert_low_pass_cutoff_hz)

    def downconvert_path(rf_input, index):
        previous_i = previous_i_values[index] if index < len(previous_i_values) else 0.0
        previous_q = previous_q_values[index] if index < len(previous_q_values) else 0.0
        return downconvert_rf_signal(
            rf_input,
            lo_frequency_hz=downconvert_lo_frequency_hz,
            lo_phase_deg=lo_phase_deg,
            conversion_gain=downconversion_gain,
            time=time,
            previous_output_iq=(previous_i, previous_q),
            low_pass_cutoff_hz=low_pass_cutoff_hz if low_pass_cutoff_hz > 0.0 else None,
            dt=dt,
        )

    down_1_i, down_1_q = downconvert_path(downconvert_rf_input_1, 0)
    down_2_i, down_2_q = downconvert_path(downconvert_rf_input_2, 1)

    up_1 = upconvert_rf_signal(
        (upconvert_baseband_input_1, 0.0),
        lo_frequency_hz=upconvert_lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=upconversion_gain,
        time=time,
    )
    up_2 = upconvert_rf_signal(
        (upconvert_baseband_input_2, 0.0),
        lo_frequency_hz=upconvert_lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=upconversion_gain,
        time=time,
    )

    return {
        "outputs": {
            "downconverted_baseband_outputs": [down_1_i, down_2_i],
            "upconverted_rf_outputs": [up_1, up_2],
        },
        "state": {
            **previous,
            "downconversion_i": [down_1_i, down_2_i],
            "downconversion_q": [down_1_q, down_2_q],
        },
    }
