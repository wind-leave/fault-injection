"""Magnitude limiter for an RF complex envelope."""

from backend.simulation_functions import coerce_envelope_vector, limit_envelope_amplitude


def process(input_envelope, limit_amplitude=1.0):
    """逐路限制固定四路复数包络向量，同时保留各路 I/Q 相位。"""
    input_vector = coerce_envelope_vector(input_envelope)
    return {"output_envelope": limit_envelope_amplitude(input_vector, limit_amplitude)}
