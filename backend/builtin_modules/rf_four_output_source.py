"""Four-port synchronous pulsed RF signal source."""

import math


def process(
    sample_1=1.0,
    sample_2=0.8,
    sample_3=0.6,
    sample_4=0.4,
    center_frequency_hz=100.0,
    pulse_width_seconds=1e-3,
    pulse_period_seconds=1e-3,
    phase_deg=0.0,
    time=0.0,
):
    """Return four independent scalar RF output-port samples for one simulation step."""
    amplitudes = (sample_1, sample_2, sample_3, sample_4)
    period = max(0.0, float(pulse_period_seconds))
    width = min(period, max(0.0, float(pulse_width_seconds)))

    if period <= 0.0 or width <= 0.0:
        carrier = 0.0
    elif math.fmod(float(time), period) >= width:
        carrier = 0.0
    else:
        phase = 2.0 * math.pi * max(0.0, float(center_frequency_hz)) * float(time)
        phase += math.radians(float(phase_deg))
        carrier = math.cos(phase)

    return {
        "outputs": {
            f"rf_output_{index}": float(amplitude) * carrier
            for index, amplitude in enumerate(amplitudes, start=1)
        }
    }
