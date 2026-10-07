"""DZDK_D: sliding-window scalar feature extractor."""

import math


def process(socket01=0.0, window_size=32.0, state=None):
    previous = dict(state or {})
    size = max(1, min(4096, int(round(float(window_size)))))
    samples = [float(value) for value in (previous.get("samples") or [])]
    samples.append(float(socket01))
    samples = samples[-size:]
    mean = sum(samples) / len(samples)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    peak = max(abs(value) for value in samples)
    return {
        "outputs": {"socket02": mean, "socket03": rms, "socket04": peak},
        "state": {"samples": samples},
    }
