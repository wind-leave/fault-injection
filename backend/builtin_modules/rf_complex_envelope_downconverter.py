"""Downconverter for a single RF complex envelope."""

from backend.simulation_functions import apply_envelope_downconversion


def process(input_envelope, lo_frequency_hz=0.0, lo_phase_deg=0.0, conversion_gain=1.0):
    """对单路或任意路数的复数包络逐路执行下变频。

    A negative analytic output frequency is represented with a positive
    reference frequency after conjugating the I/Q envelope, preserving the
    expected spectrum inversion of low-side mixing.
    """
    return {
        "output_envelope": apply_envelope_downconversion(
            input_envelope,
            lo_frequency_hz=lo_frequency_hz,
            lo_phase_deg=lo_phase_deg,
            conversion_gain=conversion_gain,
        )
    }
