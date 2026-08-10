"""标量复制为四维向量的仿真组件。"""


def process(scalar_input=0.0):
    """将输入标量复制为长度固定为 4 的向量。"""
    value = float(scalar_input)
    return {"outputs": {"vector_output": [value, value, value, value]}}
