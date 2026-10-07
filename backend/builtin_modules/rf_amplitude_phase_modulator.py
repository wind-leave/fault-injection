"""I/Q amplitude and phase modulation component."""

from backend.simulation_functions import control_rf_channel_amplitude_phase


def process(
    input_i=0.0,
    input_q=0.0,
    amplitude_scale=1.0,
    phase_shift_deg=0.0,
    output_filter_cutoff_hz=0.0,
    dt=0.0,
    state=None,
):
    """Apply linear amplitude scaling and a true phase rotation to an I/Q pair."""
    previous = dict(state or {})
    cutoff = max(0.0, float(output_filter_cutoff_hz))
    output_i, output_q = control_rf_channel_amplitude_phase(
        (float(input_i), float(input_q)),
        previous_output_iq=(
            previous.get("output_i", 0.0),
            previous.get("output_q", 0.0),
        ),
        amplitude_weight=max(0.0, float(amplitude_scale)),
        phase_weight_deg=float(phase_shift_deg),
        output_filter_cutoff_hz=cutoff if cutoff > 0.0 else None,
        dt=dt,
    )
    return {
        "outputs": {"output_i": output_i, "output_q": output_q},
        "state": {"output_i": output_i, "output_q": output_q},
        "middleVars": {
            "amplitude_scale": max(0.0, float(amplitude_scale)),
            "phase_shift_deg": float(phase_shift_deg),
        },
    }
