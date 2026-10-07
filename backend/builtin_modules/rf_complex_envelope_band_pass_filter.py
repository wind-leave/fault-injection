"""Equivalent RF band-pass filter operating on a complex envelope."""

from backend.simulation_functions import apply_envelope_band_pass_filter


def process(input_envelope, center_frequency_hz=1_000_000.0, bandwidth_hz=100_000.0, dt=0.0, state=None):
    """逐路滤波单路或任意路数的复数包络，不重建其射频载波。

    The reference-frequency offset performs the RF pass-band decision.  For an
    in-band carrier, a first-order complex low-pass with half the configured
    passband width filters envelope modulation and pulse edges.
    """
    return apply_envelope_band_pass_filter(
        input_envelope,
        center_frequency_hz=center_frequency_hz,
        bandwidth_hz=bandwidth_hz,
        dt=dt,
        state=state,
    )
