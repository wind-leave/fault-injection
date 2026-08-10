"""四路射频限幅、放大、下变频及八路功分仿真组件。"""

from backend.simulation_functions import (
    amplify_rf_signal,
    combine_split_rf_power,
    downconvert_rf_signal,
    limit_rf_amplitude,
)


def process(
    rf_input=None,
    limit_amplitude=1.0,
    gain_db=0.0,
    lo_frequency_hz=5.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
    low_pass_cutoff_hz=5.0,
    split_insertion_loss_db=0.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """处理四路实数射频输入并输出八路实数基带信号。

    ``rf_input`` 是长度为 4 的输入向量。处理顺序为：每一路分别执行
    限幅 -> 放大 -> 下变频和低通滤波（取 I 路实数分量） -> 1 分 2。四路各分两路，
    共得到八个独立标量输出端口。
    """
    input_values = rf_input if isinstance(rf_input, (list, tuple)) else ()
    previous_i_values = list((state or {}).get("previous_i_values") or [])
    outputs = []
    next_i_values = []
    for index in range(4):
        sample = input_values[index] if index < len(input_values) else 0.0
        limited = limit_rf_amplitude(sample, limit_amplitude)
        amplified = amplify_rf_signal(limited, gain_db)
        previous_i = previous_i_values[index] if index < len(previous_i_values) else 0.0
        baseband_i, _baseband_q = downconvert_rf_signal(
            amplified,
            lo_frequency_hz=lo_frequency_hz,
            lo_phase_deg=lo_phase_deg,
            conversion_gain=conversion_gain,
            time=time,
            previous_output_iq=(previous_i, 0.0),
            low_pass_cutoff_hz=low_pass_cutoff_hz if float(low_pass_cutoff_hz) > 0.0 else None,
            dt=dt,
        )
        next_i_values.append(baseband_i)
        outputs.extend(combine_split_rf_power(
            [baseband_i],
            output_count=2,
            insertion_loss_db=split_insertion_loss_db,
        ))
    return {
        "outputs": {
            f"rf_output_{index + 1}": value
            for index, value in enumerate(outputs)
        },
        "state": {"previous_i_values": next_i_values},
    }
