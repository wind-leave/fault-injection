"""Two-input RF complex-envelope selector."""

from backend.simulation_functions import coerce_envelope_vector


def process(input_1, input_2, selected_input=1):
    """从两组四路复数包络向量中选择一组并原样输出。"""
    selected = int(float(selected_input))
    return {"selected_envelope": input_2 if selected == 2 else input_1}

