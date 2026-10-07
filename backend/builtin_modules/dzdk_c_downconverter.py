"""DZDK_C: single-input RF down-converter with I/Q outputs."""

from backend.simulation_functions import downconvert_rf_signal


def process(
    socket01=0.0,
    lo_frequency_hz=990_000_000.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
    low_pass_cutoff_hz=20_000_000.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    previous = dict(state or {})
    output_i, output_q = downconvert_rf_signal(
        socket01,
        lo_frequency_hz=lo_frequency_hz,
        lo_phase_deg=lo_phase_deg,
        conversion_gain=conversion_gain,
        time=time,
        previous_output_iq=(previous.get("socket02", 0.0), previous.get("socket03", 0.0)),
        low_pass_cutoff_hz=low_pass_cutoff_hz if float(low_pass_cutoff_hz) > 0.0 else None,
        dt=dt,
    )
    return {
        "outputs": {"socket02": output_i, "socket03": output_q},
        "state": {"socket02": output_i, "socket03": output_q},
    }
