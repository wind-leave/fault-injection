"""Regulated scalar DC boost converter."""


def process(dc_input=0.0, boost_ratio=2.0, efficiency=0.95, state=None):
    """Accept a DC voltage and return its non-negative boosted DC output."""
    input_voltage = max(0.0, float(dc_input))
    ratio = max(0.0, float(boost_ratio))
    conversion_efficiency = min(1.0, max(0.0, float(efficiency)))
    value = input_voltage * ratio * conversion_efficiency
    return {"outputs": {"dc_output": value}, "state": dict(state or {})}
