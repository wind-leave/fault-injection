"""Configurable pulsed scalar source for an RF complex-envelope signal."""

import math

from backend.simulation_functions import coerce_envelope


def process(
    pulse_width_seconds=1e-3,
    pulse_period_seconds=10e-3,
    center_frequency_hz=10.0,
    power_dbm=0.0,
    time=0.0,
):
    """Return one rectangular-pulse I/Q envelope without a signal input.

    Power is specified in dBm and converted to the peak voltage of a sinusoidal
    carrier in a 50-ohm system.  The RF carrier itself is represented by
    ``referenceFrequencyHz``, so the active envelope is ``I=Vpeak, Q=0``.
    """
    impedance_ohm = 50.0
    period = max(0.0, float(pulse_period_seconds))
    width = min(period, max(0.0, float(pulse_width_seconds)))
    in_pulse = period > 0.0 and width > 0.0 and float(time) % period < width
    power_watts = 1e-3 * math.pow(10.0, float(power_dbm) / 10.0)
    peak_voltage = math.sqrt(2.0 * power_watts * impedance_ohm) if in_pulse else 0.0

    return {
        "output_envelope": coerce_envelope(
            {
                "i": peak_voltage,
                "q": 0.0,
                "referenceFrequencyHz": center_frequency_hz,
                "impedanceOhm": impedance_ohm,
                "unit": "V",
            }
        )
    }
