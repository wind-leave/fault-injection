def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def _first_order(previous, target, tau, dt):
    alpha = _clamp(float(dt) / (max(float(tau), 0.001) + float(dt)), 0.0, 1.0)
    return float(previous) + alpha * (float(target) - float(previous))


def process(motor_command=0.0, dt=0.1, state=None):
    state = state or {}
    command = _clamp(motor_command, -0.22, 0.22)
    motor_response = _first_order(state.get("motor_response", 0.0), command, 0.28, dt)
    return {
        "outputs": {"thrust": motor_response},
        "state": {"motor_response": motor_response},
        "middleVars": {"motor_state": motor_response},
    }
