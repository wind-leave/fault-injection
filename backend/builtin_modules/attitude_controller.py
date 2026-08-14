def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def _first_order(previous, target, tau, dt):
    alpha = _clamp(float(dt) / (max(float(tau), 0.001) + float(dt)), 0.0, 1.0)
    return float(previous) + alpha * (float(target) - float(previous))


def process(attitude_error=0.0, dt=0.1, state=None):
    state = state or {}
    error = _clamp(attitude_error, -0.3, 0.3)
    integrator = _clamp(float(state.get("integrator", 0.0)) + error * float(dt), -0.22, 0.22)
    torque = _clamp(1.18 * error + 0.16 * integrator, -0.26, 0.26)
    controller_output = _first_order(state.get("controller_output", 0.0), torque, 0.12, dt)
    return {
        "outputs": {"torque_command": controller_output},
        "state": {"integrator": integrator, "controller_output": controller_output},
        "middleVars": {"integrator_state": integrator},
    }
