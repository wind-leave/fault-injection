def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(rotor_command=0.0, dt=0.02, state=None):
    state = state or {}
    previous = float(state.get("rotor_speed", 0.0))
    target = _clamp(rotor_command, -1.0, 1.0)
    alpha = _clamp(float(dt) / (0.18 + float(dt)), 0.0, 1.0)
    rotor_speed = previous + alpha * (target - previous)
    thrust = _clamp(rotor_speed * 0.82, -0.9, 0.9)
    return {
        "outputs": {"rotor_thrust": thrust},
        "state": {"rotor_speed": rotor_speed},
        "middleVars": {"rotor_speed_state": rotor_speed},
    }
