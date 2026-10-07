"""Regulated scalar DC voltage source."""


def process(output_voltage=28.0, state=None):
    """Return the configured non-negative DC output voltage."""
    voltage = max(0.0, float(output_voltage))
    return {"outputs": {"dc_output": voltage}, "state": dict(state or {})}
