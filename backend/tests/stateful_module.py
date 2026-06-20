def process(input=0.0, dt=0.1, state=None):
    state = state or {}
    total = float(state.get("total", 0.0)) + float(input) * float(dt)
    return {
        "outputs": {"output": total},
        "state": {"total": total},
        "middleVars": {"total": total},
    }
