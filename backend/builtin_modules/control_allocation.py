def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(moment_command=0.0, speed_command=0.0, altitude_command=0.0, allocationGain=1.0):
    raw = float(allocationGain) * (
        0.72 * float(moment_command) + 0.18 * float(speed_command) + 0.10 * float(altitude_command)
    )
    actuator_command = _clamp(raw, -1.0, 1.0)
    return {
        "outputs": {"actuator_command": actuator_command},
        "state": {},
        "middleVars": {"allocation_margin": 1.0 - abs(actuator_command)},
    }
