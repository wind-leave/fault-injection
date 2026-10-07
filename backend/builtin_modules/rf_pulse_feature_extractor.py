"""Extract pulse-RF features from separate A/D sampled I/Q inputs."""

import math

from backend.simulation_functions import (
    clamp,
    dequantize_bipolar_code,
    estimate_complex_fft_positive_peak_frequency,
    floor_power_of_two,
    quantize_bipolar_sample,
)


def _complex_low_pass(sample, previous, cutoff_hz, dt):
    """One-pole complex low pass, applied after translating the wanted bin to DC."""
    cutoff = float(cutoff_hz)
    step = float(dt)
    if cutoff <= 0.0 or step <= 0.0:
        return sample
    alpha = 1.0 - math.exp(-2.0 * math.pi * cutoff * step)
    return previous + min(1.0, max(0.0, alpha)) * (sample - previous)


def process(
    if_i=0.0,
    if_q=0.0,
    fft_size=1024.0,
    adc_full_scale=1.0,
    envelope_threshold_adc=12.0,
    complex_filter_bandwidth_hz=2_000_000_000.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Return detected-pulse count, center frequency, PRI, width and amplitude.

    ``if_i`` and ``if_q`` are separate scalar interfaces. Their complex form
    is processed by a sliding FFT which searches only positive frequencies.
    The identified positive-frequency component is translated to DC and
    complex low-pass filtered before its magnitude drives pulse-envelope
    detection.
    """
    previous = dict(state or {})
    full_scale = max(1e-12, abs(float(adc_full_scale)))
    configured_size = max(4, int(round(float(fft_size))))
    size = floor_power_of_two(configured_size)
    sample_period = max(0.0, float(dt))
    adc_i_code = quantize_bipolar_sample(if_i, full_scale, maximum_code=255)
    adc_q_code = quantize_bipolar_sample(if_q, full_scale, maximum_code=255)
    adc_sample = complex(
        dequantize_bipolar_code(adc_i_code, full_scale, maximum_code=255),
        dequantize_bipolar_code(adc_q_code, full_scale, maximum_code=255),
    )

    samples = list(previous.get("samples") or [])
    samples.append(adc_sample)
    samples = samples[-size:]

    center_frequency = float(previous.get("center_frequency_hz", 0.0))
    if len(samples) == size and sample_period > 0.0:
        center_frequency = estimate_complex_fft_positive_peak_frequency(samples, sample_period, window="hann")

    filter_frequency = center_frequency if center_frequency > 0.0 else float(previous.get("filter_frequency_hz", 0.0))
    if filter_frequency > 0.0:
        phase = 2.0 * math.pi * filter_frequency * float(time)
        baseband_sample = adc_sample * complex(math.cos(-phase), math.sin(-phase))
    else:
        baseband_sample = adc_sample
    filtered_baseband = _complex_low_pass(
        baseband_sample,
        complex(
            float(previous.get("filtered_baseband_i", 0.0)),
            float(previous.get("filtered_baseband_q", 0.0)),
        ),
        complex_filter_bandwidth_hz,
        sample_period,
    )

    threshold = clamp(float(envelope_threshold_adc), 0.0, 255.0)
    sample_magnitude = min(255.0, abs(filtered_baseband) / full_scale * 255.0)
    envelope = 0.78 * float(previous.get("envelope", 0.0)) + 0.22 * sample_magnitude
    active = envelope >= threshold
    was_active = bool(previous.get("active", False))
    rising_time = previous.get("rising_time")
    previous_rising_time = previous.get("previous_rising_time")
    pulse_period = float(previous.get("pulse_period_seconds", 0.0))
    pulse_width = float(previous.get("pulse_width_seconds", 0.0))
    pulse_peak = int(previous.get("pulse_peak", 0))
    amplitude = int(previous.get("pulse_amplitude_adc", 0))
    pulse_count = max(0, int(previous.get("pulse_count", 0)))
    now = float(time)

    if active and not was_active:
        pulse_count += 1
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
        amplitude = int(clamp(pulse_peak, 0, 255))
        pulse_peak = 0

    reported_amplitude = pulse_peak if active else amplitude
    next_state = {
        "samples": samples,
        "center_frequency_hz": center_frequency,
        "filter_frequency_hz": filter_frequency,
        "filtered_baseband_i": filtered_baseband.real,
        "filtered_baseband_q": filtered_baseband.imag,
        "envelope": envelope,
        "active": active,
        "rising_time": rising_time,
        "previous_rising_time": previous_rising_time,
        "pulse_period_seconds": pulse_period,
        "pulse_width_seconds": pulse_width,
        "pulse_peak": pulse_peak,
        "pulse_amplitude_adc": amplitude,
        "pulse_count": pulse_count,
    }
    return {
        "outputs": {
            "pulse_count": pulse_count,
            "center_frequency_hz": center_frequency,
            "pulse_period_seconds": pulse_period,
            "pulse_width_seconds": pulse_width,
            "pulse_amplitude_adc": int(clamp(reported_amplitude, 0, 255)),
        },
        "state": next_state,
    }
