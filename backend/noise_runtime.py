"""Additive noise shared by the backend and exported standalone fault modules."""

import math
import struct


NOISE_FAULT_TYPES = {"gaussian_noise", "uniform_white_noise", "gaussian_colored_noise"}


def _finite_noise_number(value, fallback):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _noise_uniform(seed, stream, time, salt):
    seed_hex = struct.pack("<d", seed).hex()
    time_hex = struct.pack("<d", float(time)).hex()
    value = f"{seed_hex}|{stream}|{time_hex}|{salt}".encode("utf-8")
    hashed = 2166136261
    for byte in value:
        hashed = ((hashed ^ byte) * 16777619) & 0xffffffff
    hashed = ((hashed ^ (hashed >> 16)) * 0x85ebca6b) & 0xffffffff
    hashed = ((hashed ^ (hashed >> 13)) * 0xc2b2ae35) & 0xffffffff
    hashed = (hashed ^ (hashed >> 16)) & 0xffffffff
    return (hashed + 0.5) / 4294967296


def sample_noise(noise_type, parameters, time, stream, state):
    seed = _finite_noise_number(parameters.get("seed", 1), 1.0)
    mean = _finite_noise_number(parameters.get("mean", 0), 0.0)
    std = max(0.0, _finite_noise_number(parameters.get("std", 0.1), 0.1))
    if noise_type == "uniform_white_noise":
        amplitude = max(0.0, _finite_noise_number(parameters.get("amplitude", 0.1), 0.1))
        return mean + (2 * _noise_uniform(seed, stream, time, "u") - 1) * amplitude
    gaussian = math.sqrt(-2 * math.log(_noise_uniform(seed, stream, time, "a"))) * math.cos(
        2 * math.pi * _noise_uniform(seed, stream, time, "b")
    )
    if noise_type != "gaussian_colored_noise":
        return mean + std * gaussian
    alpha = max(-0.999, min(0.999, _finite_noise_number(parameters.get("alpha", 0.9), 0.9)))
    signature = (seed, mean, std, alpha, parameters.get("start"), parameters.get("duration"))
    streams = state.setdefault("noiseStreams", {})
    previous = streams.get(stream)
    if previous and previous["time"] == time and previous["signature"] == signature:
        return mean + previous["value"]
    if previous and previous["signature"] == signature and previous["time"] < time:
        value = alpha * previous["value"] + std * math.sqrt(1 - alpha * alpha) * gaussian
    else:
        value = std * gaussian
    streams[stream] = {"time": time, "value": value, "signature": signature}
    return mean + value
