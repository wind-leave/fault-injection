def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(voltage_limited_command=0.0):
    command = _clamp(voltage_limited_command, -1.0, 1.0)
    return {
        "outputs": {f"rotor_{index}_command": command for index in range(1, 9)},
        "state": {},
        "middleVars": {"actuator_state": command},
    }
