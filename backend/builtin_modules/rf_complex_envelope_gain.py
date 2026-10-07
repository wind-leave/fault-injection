"""Gain/attenuation block for an RF complex envelope."""

from backend.simulation_functions import apply_envelope_gain


def process(input_envelope, gain_db=0.0):
    """Scale every I/Q frame on this port by one voltage gain."""
    return {"output_envelope": apply_envelope_gain(input_envelope, gain_db)}
