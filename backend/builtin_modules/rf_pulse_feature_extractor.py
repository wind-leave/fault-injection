"""Extract pulse-RF features from an A/D sampled scalar RF signal."""

from backend.simulation_functions import (
    clamp,
    dequantize_bipolar_code,
    estimate_fft_peak_frequency,
    floor_power_of_two,
    quantize_bipolar_sample,
)


def process(
    rf_signal=0.0,
    fft_size=1024.0,
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
    size = floor_power_of_two(configured_size)
    sample_period = max(0.0, float(dt))
    adc_code = quantize_bipolar_sample(rf_signal, full_scale, maximum_code=255)
    adc_sample = dequantize_bipolar_code(adc_code, full_scale, maximum_code=255)

    samples = list(previous.get("samples") or [])
    samples.append(adc_sample)
    samples = samples[-size:]

    center_frequency = float(previous.get("center_frequency_hz", 0.0))
    if len(samples) == size and sample_period > 0.0:
        center_frequency = estimate_fft_peak_frequency(samples, sample_period, window="hann")

    threshold = clamp(float(envelope_threshold_adc), 0.0, 255.0)
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
        amplitude = int(clamp(pulse_peak, 0, 255))
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
            "pulse_amplitude_adc": int(clamp(reported_amplitude, 0, 255)),
        },
        "state": next_state,
    }
