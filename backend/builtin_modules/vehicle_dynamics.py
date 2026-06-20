def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(thrust_1=0.0, thrust_2=0.0, thrust_3=0.0, thrust_4=0.0, dt=0.1, state=None):
    state = state or {}
    torque = _clamp((float(thrust_1) + float(thrust_2) + float(thrust_3) + float(thrust_4)) / 4.0, -0.22, 0.22)
    previous = float(state.get("pitch_rate", 0.0))
    pitch_rate = _clamp(previous + float(dt) * (1.04 * torque - 1.65 * previous), -0.18, 0.18)
    return {
        "outputs": {"pitch_rate": pitch_rate},
        "state": {"pitch_rate": pitch_rate},
        "middleVars": {"pitch_state": pitch_rate},
    }
