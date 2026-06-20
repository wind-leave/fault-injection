def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def _first_order(previous, target, tau, dt):
    alpha = _clamp(float(dt) / (max(float(tau), 0.001) + float(dt)), 0.0, 1.0)
    return float(previous) + alpha * (float(target) - float(previous))


def process(body_rate=0.0, dt=0.1, state=None):
    state = state or {}
    input_rate = _clamp(body_rate, -0.2, 0.2)
    measured_rate = _first_order(state.get("measured_rate", 0.0), input_rate, 0.08, dt)
    return {
        "outputs": {"measured_rate": measured_rate},
        "state": {"measured_rate": measured_rate},
        "middleVars": {"gyro_bias_state": measured_rate - input_rate},
    }
