def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(total_force=0.0, total_moment=0.0, dt=0.02, state=None):
    state = state or {}
    previous_rate = float(state.get("body_rate", 0.0))
    rate = _clamp(previous_rate + float(dt) * (0.55 * float(total_moment) - 0.22 * previous_rate), -1.2, 1.2)
    attitude = _clamp(float(state.get("attitude", 0.0)) + rate * float(dt), -1.0, 1.0)
    altitude = _clamp(float(state.get("altitude", 0.0)) + 0.04 * float(total_force) * float(dt), -50.0, 50.0)
    return {
        "outputs": {
            "attitude": attitude,
            "body_rate": rate,
            "altitude": altitude,
        },
        "state": {
            "attitude": attitude,
            "body_rate": rate,
            "altitude": altitude,
        },
        "middleVars": {"vehicle_energy": abs(rate) + abs(altitude) * 0.01},
    }
