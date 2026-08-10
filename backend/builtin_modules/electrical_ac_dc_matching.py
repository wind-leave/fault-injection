"""AC-to-DC matching converter with a regulated DC output."""


def process(ac_input=0.0, conversion_gain=1.0, state=None):
    """Convert the connected AC source's RMS rating into stable DC voltage.

    ``ac_input`` is still accepted for compatibility with standalone callers.
    During graph simulation the engine stores the upstream source's RMS voltage
    in state, so a sampled AC zero crossing can never make the DC bus collapse.
    """
    next_state = dict(state or {})
    input_rms = next_state.get("ac_input_rms")
    if input_rms is None:
        input_rms = abs(float(ac_input))
    value = max(0.0, float(input_rms)) * max(0.0, float(conversion_gain))
    return {"outputs": {"dc_output": value}, "state": next_state}
