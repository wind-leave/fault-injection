"""Four-port RF frequency converter with two down-conversion and two up-conversion paths."""

from backend.simulation_functions import downconvert_rf_signal, upconvert_rf_signal


def process(
    downconvert_rf_input_1=0.0,
    downconvert_rf_input_2=0.0,
    upconvert_baseband_input_1=0.0,
    upconvert_baseband_input_2=0.0,
    downconvert_lo_frequency_hz=100.0,
    upconvert_lo_frequency_hz=100.0,
    lo_phase_deg=0.0,
    downconversion_gain=1.0,
    upconversion_gain=1.0,
    time=0.0,
    dt=0.0,
):
    """Convert two RF scalar inputs down and two scalar baseband inputs up.

    Down-conversion paths return their in-phase baseband components.  Each
    up-conversion input represents an in-phase baseband value; its quadrature
    component is zero.
    """

    down_1_i, _ = downconvert_rf_signal(
        downconvert_rf_input_1,
        lo_frequency_hz=downconvert_lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=downconversion_gain,
        time=time,
        previous_output_iq=(0.0, 0.0),
        low_pass_cutoff_hz=None,
        dt=dt,
    )
    down_2_i, _ = downconvert_rf_signal(
        downconvert_rf_input_2,
        lo_frequency_hz=downconvert_lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=downconversion_gain,
        time=time,
        previous_output_iq=(0.0, 0.0),
        low_pass_cutoff_hz=None,
        dt=dt,
    )

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
            "downconverted_output_1": down_1_i,
            "downconverted_output_2": down_2_i,
            "upconverted_output_1": up_1,
            "upconverted_output_2": up_2,
        },
    }
