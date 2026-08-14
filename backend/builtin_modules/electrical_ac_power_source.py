"""Configurable three-phase AC voltage source."""

import math


def process(voltage_rms=220.0, frequency_hz=50.0, phase_deg=0.0, time=0.0, state=None):
    """Output balanced A/B/C phase voltages from RMS voltage and frequency."""
    rms = max(0.0, float(voltage_rms))
    phase_rad = math.radians(float(phase_deg))
    angle = 2.0 * math.pi * float(frequency_hz) * float(time) + phase_rad
    peak = math.sqrt(2.0) * rms
    return {
        "outputs": {
            "ac_phase_a": peak * math.sin(angle),
            "ac_phase_b": peak * math.sin(angle - (2.0 * math.pi / 3.0)),
            "ac_phase_c": peak * math.sin(angle + (2.0 * math.pi / 3.0)),
        },
        "state": dict(state or {}),
    }
