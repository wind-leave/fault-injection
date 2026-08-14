def _clamp(value, minimum, maximum):
    numeric = float(value)
    return max(minimum, min(maximum, numeric))


def process(attitude_command=0.0, attitude_feedback=0.0, dt=0.02, state=None):
    state = state or {}
    error = _clamp(float(attitude_command) - float(attitude_feedback), -0.6, 0.6)
    integrator = _clamp(float(state.get("integrator", 0.0)) + error * float(dt), -0.35, 0.35)
    moment_command = _clamp(1.35 * error + 0.18 * integrator, -0.45, 0.45)
    return {
        "outputs": {"moment_command": moment_command},
        "state": {"integrator": integrator},
        "middleVars": {
            "attitude_error": error,
            "integrator_state": integrator,
        },
    }
