"""单路射频复数包络复制为四路向量的仿真组件。"""

from backend.simulation_functions import coerce_envelope


def process(input_envelope=None):
    """将单路 I/Q 复数包络规范化并复制为四个独立的输出分量。"""
    envelope = coerce_envelope(input_envelope)
    return {"outputs": {"envelope_vector": [dict(envelope) for _ in range(4)]}}
