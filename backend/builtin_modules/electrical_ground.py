"""Single-input electrical ground terminator."""


def process(ground_input=0.0, state=None):
    """Consume the connected electrical input without producing an output."""
    return {"outputs": {}, "state": {**dict(state or {}), "ground_input": float(ground_input)}}
