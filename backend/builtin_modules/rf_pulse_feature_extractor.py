"""Extract pulse-RF features from an A/D sampled scalar RF signal."""

import math


def _clamp(value, lower, upper):
    return max(lower, min(upper, value))


def _power_of_two(value):
    size = 1
    while size * 2 <= value:
        size *= 2
    return size


def _fft(values):
    """Iterative radix-2 FFT; the input size must be a power of two."""
    count = len(values)
    result = [complex(value, 0.0) for value in values]
    bit_reversed = 0
    for index in range(1, count):
        bit = count >> 1
        while bit_reversed & bit:
            bit_reversed ^= bit
            bit >>= 1
        bit_reversed ^= bit
        if index < bit_reversed:
            result[index], result[bit_reversed] = result[bit_reversed], result[index]

    span = 2
    while span <= count:
        step = complex(math.cos(-2.0 * math.pi / span), math.sin(-2.0 * math.pi / span))
        for start in range(0, count, span):
            factor = 1.0 + 0.0j
            half = span // 2
            for offset in range(half):
                even = result[start + offset]
                odd = factor * result[start + offset + half]
                result[start + offset] = even + odd
                result[start + offset + half] = even - odd
                factor *= step
        span *= 2
    return result


def _adc_quantize(value, full_scale):
    normalized = _clamp(float(value) / full_scale, -1.0, 1.0)
    return int(round((normalized + 1.0) * 127.5))


def _adc_dequantize(code, full_scale):
    return ((float(code) / 127.5) - 1.0) * full_scale


def _estimate_center_frequency(samples, sample_period):
    count = len(samples)
    if count < 4 or sample_period <= 0.0:
        return 0.0
    # Hann window suppresses the leakage caused by the finite pulse window.
    windowed = [
        sample * (0.5 - 0.5 * math.cos(2.0 * math.pi * index / (count - 1)))
        for index, sample in enumerate(samples)
    ]
    spectrum = _fft(windowed)
    half = count // 2
    peak_bin = max(range(1, half), key=lambda index: abs(spectrum[index]))
    return peak_bin / (count * sample_period)


def process(
    rf_signal=0.0,
    fft_size=64.0,
    adc_full_scale=1.0,
    envelope_threshold_adc=12.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Return center frequency, PRI, pulse width and unsigned 8-bit amplitude.

    The component receives one scalar sample at each simulation tick.  Samples
    are quantized to an unsigned 8-bit A/D code before a sliding FFT estimates
    the carrier.  A smoothed rectified envelope then detects pulse edges.
    """
    previous = dict(state or {})
    full_scale = max(1e-12, abs(float(adc_full_scale)))
    configured_size = max(4, int(round(float(fft_size))))
    size = _power_of_two(configured_size)
    sample_period = max(0.0, float(dt))
    adc_code = _adc_quantize(rf_signal, full_scale)
    adc_sample = _adc_dequantize(adc_code, full_scale)

    samples = list(previous.get("samples") or [])
    samples.append(adc_sample)
    samples = samples[-size:]

    center_frequency = float(previous.get("center_frequency_hz", 0.0))
    if len(samples) == size and sample_period > 0.0:
        center_frequency = _estimate_center_frequency(samples, sample_period)

    threshold = _clamp(float(envelope_threshold_adc), 0.0, 255.0)
    sample_magnitude = abs(adc_code - 127.5) / 127.5 * 255.0
    envelope = 0.78 * float(previous.get("envelope", 0.0)) + 0.22 * sample_magnitude
    active = envelope >= threshold
    was_active = bool(previous.get("active", False))
    rising_time = previous.get("rising_time")
    previous_rising_time = previous.get("previous_rising_time")
    pulse_period = float(previous.get("pulse_period_seconds", 0.0))
    pulse_width = float(previous.get("pulse_width_seconds", 0.0))
    pulse_peak = int(previous.get("pulse_peak", 0))
    amplitude = int(previous.get("pulse_amplitude_adc", 0))
    now = float(time)

    if active and not was_active:
        previous_rising_time = rising_time
        rising_time = now
        if previous_rising_time is not None:
            pulse_period = max(0.0, now - float(previous_rising_time))
        pulse_peak = int(round(sample_magnitude))
    elif active:
        pulse_peak = max(pulse_peak, int(round(sample_magnitude)))
    elif was_active:
        if rising_time is not None:
            pulse_width = max(0.0, now - float(rising_time))
        amplitude = int(_clamp(pulse_peak, 0, 255))
        pulse_peak = 0

    reported_amplitude = pulse_peak if active else amplitude
    next_state = {
        "samples": samples,
        "center_frequency_hz": center_frequency,
        "envelope": envelope,
        "active": active,
        "rising_time": rising_time,
        "previous_rising_time": previous_rising_time,
        "pulse_period_seconds": pulse_period,
        "pulse_width_seconds": pulse_width,
        "pulse_peak": pulse_peak,
        "pulse_amplitude_adc": amplitude,
    }
    return {
        "outputs": {
            "center_frequency_hz": center_frequency,
            "pulse_period_seconds": pulse_period,
            "pulse_width_seconds": pulse_width,
            "pulse_amplitude_adc": int(_clamp(reported_amplitude, 0, 255)),
        },
        "state": next_state,
    }
