"""二维向量传递仿真组件。"""


def process(input_vector=0.0):
    """将二维输入向量逐元素传递到二维输出向量。"""
    values = input_vector if isinstance(input_vector, (list, tuple)) else ()
    output_vector = [
        float(values[index]) if index < len(values) else 0.0
        for index in range(2)
    ]
    return {"outputs": {"output_vector": output_vector}}
