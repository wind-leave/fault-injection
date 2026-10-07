"""单路复数包络到固定四路向量的等功率功分仿真组件。"""

from backend.simulation_functions import power_divide


def process(input_envelope=None):
    """复制单路输入，并对四个输出的 I/Q 分量施加 1/2 幅度系数。"""
    return {"outputs": {"output_envelope_vector": power_divide(input_envelope, 4)}}
