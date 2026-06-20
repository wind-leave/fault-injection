def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def _first_order(previous, target, tau, dt):
    alpha = _clamp(float(dt) / (max(float(tau), 0.001) + float(dt)), 0.0, 1.0)
    return float(previous) + alpha * (float(target) - float(previous))


def process(motor_total_command=0.0, dt=0.1, state=None):
    state = state or {}
    command = _clamp(motor_total_command, -0.22, 0.22)
    mix_output = _first_order(state.get("mix_output", 0.0), command, 0.1, dt)
    return {
        "outputs": {
            "motor_1_command": mix_output,
            "motor_2_command": mix_output,
            "motor_3_command": mix_output,
            "motor_4_command": mix_output,
        },
        "state": {"mix_output": mix_output},
        "middleVars": {"mixer_state": mix_output},
    }
