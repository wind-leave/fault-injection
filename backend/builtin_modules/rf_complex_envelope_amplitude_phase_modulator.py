"""Amplitude and phase modulation for a single RF complex-envelope port."""

from backend.simulation_functions import (
    apply_envelope_amplitude_phase_modulation,
)


def process(input_envelope, amplitude_scale=1.0, phase_shift_deg=0.0):
    """以同一设置逐路缩放和旋转单路或任意路数的复数包络。"""
    return {
        "output_envelope": apply_envelope_amplitude_phase_modulation(
            input_envelope,
            amplitude_scale=amplitude_scale,
            phase_shift_deg=phase_shift_deg,
        )
    }
