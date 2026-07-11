def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(actuator_command=0.0, bus_voltage=1.0):
    voltage = _clamp(bus_voltage, 0.45, 1.05)
    command = _clamp(float(actuator_command) * voltage, -1.0, 1.0)
    return {
        "outputs": {"voltage_limited_command": command},
        "state": {},
        "middleVars": {"voltage_margin": voltage},
    }
