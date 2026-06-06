"""
Module: single_io_demo
Description: Single-input, single-output demo block.
"""


def process(signal: float) -> float:
    """
    Minimal Python binding example with one input, one output,
    and one observable middle variable.
    """
    # @observable
    middle_value = signal * 0.5

    return middle_value
