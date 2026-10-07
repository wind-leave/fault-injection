"""四路复数包络输入、双四路复数包络输出的接收组件。"""

from backend.simulation_functions import coerce_envelope_vector


def process(input_envelope_vector):
    """校验并接收四路复数包络，向两个端口输出相互独立的副本。"""
    received = coerce_envelope_vector(input_envelope_vector, 4)
    return {
        "output_envelope_vector_1": [dict(envelope) for envelope in received],
        "output_envelope_vector_2": [dict(envelope) for envelope in received],
    }
