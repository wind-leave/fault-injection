def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def _first_order(previous, target, tau, dt):
    alpha = _clamp(float(dt) / (max(float(tau), 0.001) + float(dt)), 0.0, 1.0)
    return float(previous) + alpha * (float(target) - float(previous))


def process(torque_command=0.0, dt=0.1, state=None):
    state = state or {}
    allocated = _clamp(torque_command, -0.24, 0.24)
    allocation_output = _first_order(state.get("allocation_output", 0.0), allocated, 0.14, dt)
    return {
        "outputs": {"motor_total_command": allocation_output},
        "state": {"allocation_output": allocation_output},
        "middleVars": {"allocation_state": allocation_output},
    }
