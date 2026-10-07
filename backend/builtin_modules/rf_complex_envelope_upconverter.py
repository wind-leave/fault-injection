"""Upconverter for a single RF complex envelope."""

from backend.simulation_functions import apply_envelope_upconversion


def process(input_envelope, lo_frequency_hz=0.0, lo_phase_deg=0.0, conversion_gain=1.0):
    """对单路或任意路数的复数包络逐路上变频并旋转 I/Q。"""
    return {
        "output_envelope": apply_envelope_upconversion(
            input_envelope,
            lo_frequency_hz=lo_frequency_hz,
            lo_phase_deg=lo_phase_deg,
            conversion_gain=conversion_gain,
        )
    }
