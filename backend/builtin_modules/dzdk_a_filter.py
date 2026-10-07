"""DZDK_A: first-order low-pass filter."""

import math


def process(socket01=0.0, cutoff_frequency_hz=1000.0, dt=0.0, state=None):
    previous = dict(state or {})
    sample = float(socket01)
    cutoff = max(0.0, float(cutoff_frequency_hz))
    step = max(0.0, float(dt))
    if cutoff <= 0.0 or step <= 0.0:
        filtered = sample
    else:
        time_constant = 1.0 / (2.0 * math.pi * cutoff)
        coefficient = step / (time_constant + step)
        filtered = float(previous.get("socket02", sample)) + coefficient * (sample - float(previous.get("socket02", sample)))
    return {"outputs": {"socket02": filtered}, "state": {"socket02": filtered}}
