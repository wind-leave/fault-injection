"""Single-channel RF down-converter with scalar I/Q outputs."""

from backend.simulation_functions import downconvert_rf_signal


def process(
    rf_input=0.0,
    lo_frequency_hz=990_000_000.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
    low_pass_cutoff_hz=20_000_000.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Mix a real RF sample with the local oscillator and low-pass to I/Q."""
    previous = dict(state or {})
    output_i, output_q = downconvert_rf_signal(
        rf_input,
        lo_frequency_hz=lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=conversion_gain,
        time=time,
        previous_output_iq=(previous.get("i", 0.0), previous.get("q", 0.0)),
        low_pass_cutoff_hz=low_pass_cutoff_hz if float(low_pass_cutoff_hz) > 0.0 else None,
        dt=dt,
    )
    return {
        "outputs": {
            "if_i": output_i,
            "if_q": output_q,
        },
        "state": {"i": output_i, "q": output_q},
    }
