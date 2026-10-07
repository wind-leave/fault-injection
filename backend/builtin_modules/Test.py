"""三选一四路复数包络选择与限幅组件。"""

from backend.simulation_functions import (
    magnitude,
    map_envelope_vector,
    with_iq,
)


def process(
    input_1,
    input_2,
    input_3,
    selected_input=1,
    limit_amplitude=1.0,
):
    """
    从三组四路复数包络向量中选择一组，然后逐路进行幅值限制。

    selected_input:
        1 -> input_1
        2 -> input_2
        3 -> input_3

    limit_amplitude:
        每一路复数包络允许的最大幅值 sqrt(I² + Q²)。
    """
    selected = int(float(selected_input))

    input_map = {
        1: input_1,
        2: input_2,
        3: input_3,
    }

    if selected not in input_map:
        raise ValueError(
            f"selected_input must be 1, 2, or 3; got {selected_input}"
        )

    # 检查并规范化为固定四路复数包络
    selected_vector = input_map[selected]
    limit = max(0.0, float(limit_amplitude))

    def limit_one(envelope, _index):
        amplitude = magnitude(envelope)
        scale = min(1.0, limit / amplitude) if amplitude > 0.0 else 1.0

        return with_iq(
            envelope,
            envelope["i"] * scale,
            envelope["q"] * scale,
        )

    output_vector = map_envelope_vector(
        selected_vector,
        limit_one,
        length=4,
    )


    return {
        "output_envelope": output_vector
    }



from backend.simulation_functions import (
    coerce_envelope_vector,
    limit_envelope_amplitude,
)


def process(
    input_1,
    input_2,
    input_3,
    selected_input=1,
    limit_amplitude=1.0,
):
    selected = int(float(selected_input))

    input_map = {
        1: input_1,
        2: input_2,
        3: input_3,
    }

    if selected not in input_map:
        raise ValueError(
            f"selected_input must be 1, 2, or 3; got {selected_input}"
        )

    # 确保选中的信号是四路复数包络
    selected_vector = coerce_envelope_vector(
        input_map[selected],
        length=4,
    )

    # 对选中的四路信号统一限幅
    output_vector = limit_envelope_amplitude(
        selected_vector,
        limit_amplitude,
    )

    return {
        "output_envelope": output_vector
    }




from backend.simulation_functions import (
    coerce_envelope_vector,
    power_divide,
)


def process(input_envelope_vector, output_count=4):
    """将四路输入中的每一路分别等功率分配为指定路数。"""

    # 检查输入必须是四路复数包络
    input_vector = coerce_envelope_vector(
        input_envelope_vector,
        length=4,
    )

    output_vector = []

    for envelope in input_vector:
        divided = power_divide(
            envelope,
            output_count,
        )

        output_vector.extend(divided)

    return {
        "output_envelope_vector": output_vector
    }



from backend.simulation_functions import (
    apply_envelope_band_pass_filter,
)


def process(
    input_1,
    input_2,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    previous = dict(state or {})

    # 滤波 input_1 的所有通道
    result_1 = apply_envelope_band_pass_filter(
        input_1,
        center_frequency_hz=center_frequency_hz,
        bandwidth_hz=bandwidth_hz,
        dt=dt,
        state=previous.get("input_1"),
    )

    # 滤波 input_2 的所有通道
    result_2 = apply_envelope_band_pass_filter(
        input_2,
        center_frequency_hz=center_frequency_hz,
        bandwidth_hz=bandwidth_hz,
        dt=dt,
        state=previous.get("input_2"),
    )

    return {
        "outputs": {
            "filtered_input_1": result_1["outputs"]["filtered_envelope"],
            "filtered_input_2": result_2["outputs"]["filtered_envelope"],
        },
        "state": {
            "input_1": result_1["state"],
            "input_2": result_2["state"],
        },
    }
