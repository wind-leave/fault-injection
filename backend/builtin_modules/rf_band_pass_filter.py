"""Stateful, high-stopband-rejection RF band-pass FIR filter."""

from backend.simulation_functions import band_pass_fir_filter


def process(
    rf_input=0.0,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """Filter one RF sample through the configured centre-frequency passband.

    A 129-tap Blackman-windowed FIR is used.  It has a 64-sample group delay
    and needs roughly 129 samples to settle after start/reset or reconfiguration.
    Frequencies above the simulation Nyquist frequency cannot be represented.
    """
    filtered_signal, next_state, middle_vars = band_pass_fir_filter(
        rf_input,
        center_frequency_hz,
        bandwidth_hz,
        dt,
        state=state,
    )

    return {
        "outputs": {"filtered_signal": filtered_signal},
        "state": next_state,
        "middleVars": middle_vars,
    }
