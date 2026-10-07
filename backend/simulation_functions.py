"""后端射频仿真函数库。

本模块仅依赖 Python 标准库，兼容 Python 3.8.10。后续仿真组件可直接导入
本文件中的函数；每个函数的文档字符串均说明输入参数和返回值。
"""

import math


def coerce_envelope(value):
    """规范化一个 I/Q 复数包络。

    参数：
        value: 包络字典。I/Q 可使用 ``i/q`` 或 ``re/im`` 字段；可选字段为
            ``referenceFrequencyHz``、``impedanceOhm`` 和 ``unit``。

    返回：
        新字典，固定包含 ``i``、``q``、``referenceFrequencyHz``、
        ``impedanceOhm`` 和 ``unit``。数值字段转换为浮点数；缺省阻抗为
        50 Ω，缺省单位为 ``"V"``，负参考频率被限制为 0 Hz。

    异常：
        ValueError: ``value`` 不是字典。
        TypeError/ValueError: 字段值不能转换成所需的数字类型。
    """
    if not isinstance(value, dict):
        raise ValueError("RF complex-envelope input must be a mapping")
    i_value = float(value.get("i", value.get("re", 0.0)))
    q_value = float(value.get("q", value.get("im", 0.0)))
    reference_frequency = max(0.0, float(value.get("referenceFrequencyHz", 0.0)))
    impedance = float(value.get("impedanceOhm", 50.0))
    return {
        "i": i_value,
        "q": q_value,
        "referenceFrequencyHz": reference_frequency,
        "impedanceOhm": impedance if impedance > 0.0 else 50.0,
        "unit": str(value.get("unit") or "V"),
    }


def is_envelope_collection(value):
    """判断输入是否为多路包络列表；是列表返回 True，否则返回 False。"""
    return isinstance(value, list)


def coerce_envelope_collection(value):
    """规范化单路或多路 I/Q 包络，并保持输入结构。

    参数：
        value: 单个包络字典，或由包络字典组成的非空列表。

    返回：
        输入为字典时返回一个规范化字典；输入为列表时返回同样长度的
        规范化字典列表。

    异常：
        ValueError: 输入为空列表，或其中某一路不是包络字典。
    """
    if is_envelope_collection(value):
        if not value:
            raise ValueError("RF complex-envelope collection must not be empty")
        return [coerce_envelope(item) for item in value]
    return coerce_envelope(value)


def coerce_envelope_vector(value, length=4):
    """规范化指定长度的复数包络向量。

    参数：
        value: 由包络字典组成的非空列表；不接受单个包络字典。
        length: 要求的通道路数，默认为 4，必须为正整数。

    返回：
        长度严格等于 ``length`` 的规范化包络列表。

    异常：
        ValueError: 长度无效、输入不是列表或实际路数不匹配。
    """
    expected_length = int(length)
    if expected_length < 1:
        raise ValueError("RF complex-envelope vector length must be positive")
    if not is_envelope_collection(value):
        raise ValueError(f"RF complex-envelope input must be a {expected_length}-route vector")
    envelopes = coerce_envelope_collection(value)
    if len(envelopes) != expected_length:
        raise ValueError(
            f"RF complex-envelope vector must contain exactly {expected_length} routes; got {len(envelopes)}"
        )
    return envelopes


def map_envelopes(value, transform):
    """对单路或任意路数的包络逐路执行变换，并保持输入结构。

    参数：
        value: 单个包络字典，或由包络字典组成的非空列表。
        transform: 接收 ``(normalized_envelope, zero_based_index)`` 的函数。

    返回：
        单路输入返回一次 ``transform`` 的结果；列表输入返回同样长度的
        变换结果列表。结果元素的具体类型由 ``transform`` 决定。
    """
    envelopes = coerce_envelope_collection(value)
    if isinstance(envelopes, list):
        return [transform(envelope, index) for index, envelope in enumerate(envelopes)]
    return transform(envelopes, 0)


def map_envelope_vector(value, transform, length=4):
    """对指定长度的复数包络向量逐路执行变换。

    参数：
        value: 长度必须等于 ``length`` 的包络列表。
        transform: 接收 ``(normalized_envelope, zero_based_index)`` 的函数。
        length: 要求的通道路数，默认为 4。

    返回：
        包含各路变换结果的列表，长度始终等于 ``length``。
    """
    return [
        transform(envelope, index)
        for index, envelope in enumerate(coerce_envelope_vector(value, length))
    ]


def with_iq(envelope, i_value, q_value):
    """复制并规范化一个包络，仅替换其 I、Q 分量。

    参数：
        envelope: 原始包络字典。
        i_value: 新的同相分量，可转换为浮点数。
        q_value: 新的正交分量，可转换为浮点数。

    返回：
        新包络字典；参考频率、阻抗和单位来自规范化后的原包络。
    """
    normalized = coerce_envelope(envelope)
    normalized["i"] = float(i_value)
    normalized["q"] = float(q_value)
    return normalized


def apply_envelope_gain(input_envelope, gain_db=0.0):
    """对单路或任意路数的复数包络施加统一的电压增益。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        gain_db: 电压增益，单位 dB；幅度倍率为 ``10 ** (gain_db / 20)``。

    返回：
        I、Q 同比例缩放后的包络；输入为单路时返回字典，输入为列表时
        返回同样长度的列表。
    """
    scale = math.pow(10.0, float(gain_db) / 20.0)
    return map_envelopes(
        input_envelope,
        lambda envelope, _index: with_iq(
            envelope,
            envelope["i"] * scale,
            envelope["q"] * scale,
        ),
    )


def apply_envelope_amplitude_phase_modulation(
    input_envelope,
    amplitude_scale=1.0,
    phase_shift_deg=0.0,
):
    """对单路或任意路数的复数包络施加幅度缩放和相位旋转。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        amplitude_scale: 非负线性幅度倍率；负值按 0 处理。
        phase_shift_deg: I/Q 向量的逆时针旋转角度，单位为度。

    返回：
        调制后的包络；输入为单路时返回字典，输入为列表时返回同样长度
        的列表。参考频率、阻抗和单位保持不变。
    """
    scale = max(0.0, float(amplitude_scale))
    phase = math.radians(float(phase_shift_deg))

    def modulate_one(envelope, _index):
        output_i, output_q = rotate_iq(envelope["i"], envelope["q"], phase)
        return with_iq(envelope, scale * output_i, scale * output_q)

    return map_envelopes(input_envelope, modulate_one)


def apply_envelope_upconversion(
    input_envelope,
    lo_frequency_hz=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """对单路或任意路数的复数包络逐路上变频。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        lo_frequency_hz: 本振频率，单位 Hz；负值按 0 处理。
        lo_phase_deg: 本振相位，单位为度，用于逆时针旋转 I/Q。
        conversion_gain: 非负线性转换增益；负值按 0 处理。

    返回：
        上变频后的包络，参考频率为输入参考频率与本振频率之和；单路输入
        返回字典，列表输入返回同样长度的列表。
    """
    lo_frequency = max(0.0, float(lo_frequency_hz))
    gain = max(0.0, float(conversion_gain))
    phase = math.radians(float(lo_phase_deg))

    def convert_one(envelope, _index):
        output_i, output_q = rotate_iq(envelope["i"], envelope["q"], phase)
        output = with_iq(envelope, gain * output_i, gain * output_q)
        output["referenceFrequencyHz"] = (
            envelope["referenceFrequencyHz"] + lo_frequency
        )
        return output

    return map_envelopes(input_envelope, convert_one)


def apply_envelope_downconversion(
    input_envelope,
    lo_frequency_hz=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """对单路或任意路数的复数包络逐路下变频。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        lo_frequency_hz: 本振频率，单位 Hz；负值按 0 处理。
        lo_phase_deg: 本振相位，单位为度。
        conversion_gain: 非负线性转换增益；负值按 0 处理。

    返回：
        下变频后的包络，输出参考频率为输入与本振频率之差的绝对值。
        当差值为负时通过共轭 I/Q 表示低侧混频产生的频谱反转。单路输入
        返回字典，列表输入返回同样长度的列表。
    """
    lo_frequency = max(0.0, float(lo_frequency_hz))
    gain = max(0.0, float(conversion_gain))
    phase = math.radians(float(lo_phase_deg))

    def convert_one(envelope, _index):
        frequency_difference = envelope["referenceFrequencyHz"] - lo_frequency
        if frequency_difference >= 0.0:
            output_i, output_q = rotate_iq(envelope["i"], envelope["q"], -phase)
            output_frequency = frequency_difference
        else:
            output_i, output_q = rotate_iq(envelope["i"], -envelope["q"], phase)
            output_frequency = -frequency_difference
        output = with_iq(envelope, gain * output_i, gain * output_q)
        output["referenceFrequencyHz"] = output_frequency
        return output

    return map_envelopes(input_envelope, convert_one)


def apply_envelope_low_pass_filter(
    input_envelope,
    cutoff_frequency_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """逐路低通滤波单路或任意路数的复数包络。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        cutoff_frequency_hz: 复数包络的低通截止频率，单位 Hz。
        dt: 本次与上次调用的时间间隔，单位秒。
        state: 上次返回的 ``state`` 字典，格式为
            ``{"lanes": [{"output_i": ..., "output_q": ...}, ...]}``。

    返回：
        包含两个字段的字典：

        - ``outputs.filtered_envelope``：滤波后的复数包络列表。为兼容后端
          仿真组件端口，即使输入为单个包络，也返回长度为 1 的列表。
        - ``state.lanes``：各路当前 I/Q 输出状态，下一采样时刻应原样传回。

        I、Q 分量分别使用一阶指数离散低通滤波，参考频率、阻抗和单位
        保持不变。截止频率或步长小于等于 0 时保持上一输出；某一路参考
        频率发生变化时清空该路历史，避免混合两个不同的射频参考系。
    """
    cutoff = max(0.0, float(cutoff_frequency_hz))
    sample_period = max(0.0, float(dt))
    previous = dict(state or {})
    smoothing = (
        1.0 - math.exp(-2.0 * math.pi * cutoff * sample_period)
        if cutoff > 0.0 and sample_period > 0.0
        else 0.0
    )

    def filter_one(envelope, lane_state):
        same_reference = (
            "referenceFrequencyHz" not in lane_state
            or float(lane_state["referenceFrequencyHz"])
            == envelope["referenceFrequencyHz"]
        )
        previous_i = float(lane_state.get("output_i", 0.0)) if same_reference else 0.0
        previous_q = float(lane_state.get("output_q", 0.0)) if same_reference else 0.0
        output_i = previous_i + smoothing * (envelope["i"] - previous_i)
        output_q = previous_q + smoothing * (envelope["q"] - previous_q)
        return (
            with_iq(envelope, output_i, output_q),
            {
                "output_i": output_i,
                "output_q": output_q,
                "referenceFrequencyHz": envelope["referenceFrequencyHz"],
            },
        )

    envelopes = coerce_envelope_collection(input_envelope)
    if not isinstance(envelopes, list):
        envelopes = [envelopes]
    previous_lanes = list(previous.get("lanes") or [])
    results = [
        filter_one(
            envelope,
            previous_lanes[index] if index < len(previous_lanes) else {},
        )
        for index, envelope in enumerate(envelopes)
    ]
    return {
        "outputs": {"filtered_envelope": [result[0] for result in results]},
        "state": {"lanes": [result[1] for result in results]},
    }


def apply_envelope_band_pass_filter(
    input_envelope,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """逐路带通滤波单路或任意路数的复数包络。

    参数：
        input_envelope: 单个包络字典或非空包络列表。每一路根据其
            ``referenceFrequencyHz`` 独立判断是否处于通带。
        center_frequency_hz: 射频通带中心频率，单位 Hz；负值按 0 处理。
        bandwidth_hz: 射频通带总宽度，单位 Hz；负值按 0 处理。
        dt: 本次与上次调用的时间间隔，单位秒；小于等于 0 时不做平滑。
        state: 上次返回的 ``state`` 字典，格式为
            ``{"lanes": [{"output_i": ..., "output_q": ...}, ...]}``。

    返回：
        包含两个字段的字典：

        - ``outputs.filtered_envelope``：滤波后的包络列表。即使输入是单个
          包络，这里也返回长度为 1 的列表。
        - ``state.lanes``：各路本次 I/Q 输出状态，供下一采样时刻传回。

        参考频率位于 ``中心频率 ± 带宽/2`` 内时，以带宽半宽作为一阶
        低通截止频率处理包络；通带外则按相同时间常数衰减到零。
    """
    centre = max(0.0, float(center_frequency_hz))
    bandwidth = max(0.0, float(bandwidth_hz))
    sample_period = max(0.0, float(dt))
    previous = dict(state or {})
    cutoff = bandwidth / 2.0
    alpha = (
        math.exp(-2.0 * math.pi * cutoff * sample_period)
        if cutoff > 0.0 and sample_period > 0.0
        else 0.0
    )

    def filter_one(envelope, lane_state):
        in_band = (
            bandwidth > 0.0
            and abs(envelope["referenceFrequencyHz"] - centre) <= bandwidth / 2.0
        )
        target_i = envelope["i"] if in_band else 0.0
        target_q = envelope["q"] if in_band else 0.0
        output_i = (
            alpha * float(lane_state.get("output_i", 0.0))
            + (1.0 - alpha) * target_i
        )
        output_q = (
            alpha * float(lane_state.get("output_q", 0.0))
            + (1.0 - alpha) * target_q
        )
        return (
            with_iq(envelope, output_i, output_q),
            {"output_i": output_i, "output_q": output_q},
        )

    envelopes = coerce_envelope_collection(input_envelope)
    if not isinstance(envelopes, list):
        envelopes = [envelopes]
    previous_lanes = list(previous.get("lanes") or [])
    results = [
        filter_one(
            envelope,
            previous_lanes[index] if index < len(previous_lanes) else {},
        )
        for index, envelope in enumerate(envelopes)
    ]
    return {
        "outputs": {"filtered_envelope": [result[0] for result in results]},
        "state": {"lanes": [result[1] for result in results]},
    }


def apply_envelope_band_stop_filter(
    input_envelope,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """逐路带阻滤波单路或任意路数的复数包络。

    参数：
        input_envelope: 单个包络字典或非空包络列表。每一路根据其
            ``referenceFrequencyHz`` 独立判断是否处于阻带。
        center_frequency_hz: 射频阻带中心频率，单位 Hz；负值按 0 处理。
        bandwidth_hz: 射频阻带总宽度，单位 Hz；负值按 0 处理。
        dt: 本次与上次调用的时间间隔，单位秒；小于等于 0 时不做平滑。
        state: 上次返回的 ``state`` 字典，格式为
            ``{"lanes": [{"output_i": ..., "output_q": ...}, ...]}``。

    返回：
        包含两个字段的字典：

        - ``outputs.filtered_envelope``：滤波后的包络列表。即使输入是单个
          包络，这里也返回长度为 1 的列表。
        - ``state.lanes``：各路本次 I/Q 输出状态，供下一采样时刻传回。

        参考频率位于 ``中心频率 ± 带宽/2`` 内时，I/Q 目标值为零；阻带
        外保持原 I/Q。带宽半宽用作一阶过渡的时间常数，因而连续传入
        ``state`` 时可避免阻带边界切换产生不连续跳变。
    """
    centre = max(0.0, float(center_frequency_hz))
    bandwidth = max(0.0, float(bandwidth_hz))
    sample_period = max(0.0, float(dt))
    previous = dict(state or {})
    cutoff = bandwidth / 2.0
    alpha = (
        math.exp(-2.0 * math.pi * cutoff * sample_period)
        if cutoff > 0.0 and sample_period > 0.0
        else 0.0
    )

    def filter_one(envelope, lane_state):
        in_stop_band = (
            bandwidth > 0.0
            and abs(envelope["referenceFrequencyHz"] - centre) <= bandwidth / 2.0
        )
        target_i = 0.0 if in_stop_band else envelope["i"]
        target_q = 0.0 if in_stop_band else envelope["q"]
        output_i = (
            alpha * float(lane_state.get("output_i", 0.0))
            + (1.0 - alpha) * target_i
        )
        output_q = (
            alpha * float(lane_state.get("output_q", 0.0))
            + (1.0 - alpha) * target_q
        )
        return (
            with_iq(envelope, output_i, output_q),
            {"output_i": output_i, "output_q": output_q},
        )

    envelopes = coerce_envelope_collection(input_envelope)
    if not isinstance(envelopes, list):
        envelopes = [envelopes]
    previous_lanes = list(previous.get("lanes") or [])
    results = [
        filter_one(
            envelope,
            previous_lanes[index] if index < len(previous_lanes) else {},
        )
        for index, envelope in enumerate(envelopes)
    ]
    return {
        "outputs": {"filtered_envelope": [result[0] for result in results]},
        "state": {"lanes": [result[1] for result in results]},
    }


def power_divide(input_envelope, output_count):
    """将一个复数包络等功率分配为指定路数。

    参数：
        input_envelope: 单个包络字典，不接受多路列表。
        output_count: 输出路数，必须是大于等于 1 的整数或整数值浮点数。

    返回：
        长度为 ``output_count`` 的包络列表。每路 I/Q 幅度均乘以
        ``1 / sqrt(output_count)``，因此所有输出的总功率等于输入功率。

    异常：
        ValueError: 输出路数不是整数或小于 1。
    """
    count_number = float(output_count)
    if not count_number.is_integer():
        raise ValueError("RF complex-envelope power-divider output count must be an integer")

    count = int(count_number)
    if count < 1:
        raise ValueError("RF complex-envelope power-divider output count must be positive")

    envelope = coerce_envelope(input_envelope)
    amplitude_scale = 1.0 / math.sqrt(count)
    return [
        with_iq(
            envelope,
            envelope["i"] * amplitude_scale,
            envelope["q"] * amplitude_scale,
        )
        for _ in range(count)
    ]


def power_combine(input_envelopes):
    """将任意正偶数路复数包络相干合成为一路。

    参数：
        input_envelopes: 由复数包络字典组成的列表，路数必须为大于等于 2
            的偶数。各路必须使用相同的参考频率、阻抗和单位。

    返回：
        合路后的单个复数包络字典。I、Q 分量分别相干求和后乘以
        ``1 / sqrt(route_count)``，与 :func:`power_divide` 的等功率模型
        互易。相位相反的输入会相消；输出射频元数据取自第一路输入。

    异常：
        ValueError: 输入不是列表、路数小于 2、路数不是偶数，或各路射频
            元数据不一致。
    """
    if not is_envelope_collection(input_envelopes):
        raise ValueError("RF complex-envelope power-combiner input must be a route vector")

    route_count = len(input_envelopes)
    if route_count < 2 or route_count % 2 != 0:
        raise ValueError(
            "RF complex-envelope power-combiner route count must be a positive even number"
        )

    envelopes = coerce_envelope_collection(input_envelopes)
    reference = envelopes[0]
    for envelope in envelopes[1:]:
        if not math.isclose(
            envelope["referenceFrequencyHz"],
            reference["referenceFrequencyHz"],
            rel_tol=1e-12,
            abs_tol=1e-9,
        ):
            raise ValueError(
                "RF complex-envelope power-combiner inputs must share one reference frequency"
            )
        if not math.isclose(
            envelope["impedanceOhm"],
            reference["impedanceOhm"],
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise ValueError(
                "RF complex-envelope power-combiner inputs must share one impedance"
            )
        if envelope["unit"] != reference["unit"]:
            raise ValueError(
                "RF complex-envelope power-combiner inputs must share one unit"
            )

    amplitude_scale = 1.0 / math.sqrt(route_count)
    return with_iq(
        reference,
        sum(envelope["i"] for envelope in envelopes) * amplitude_scale,
        sum(envelope["q"] for envelope in envelopes) * amplitude_scale,
    )


def magnitude(envelope):
    """计算单路 I/Q 复数包络的幅值。

    参数：
        envelope: 单个包络字典。

    返回：
        浮点数 ``sqrt(I² + Q²)``。
    """
    normalized = coerce_envelope(envelope)
    return math.hypot(normalized["i"], normalized["q"])


def limit_envelope_amplitude(input_envelope, limit_amplitude):
    """限制单路或任意路数复数包络的最大幅值。

    参数：
        input_envelope: 单个包络字典或非空包络列表。
        limit_amplitude: 非负线性幅度上限；负值按 0 处理。

    返回：
        幅值不超过上限的包络。超限时 I、Q 按相同比例缩小，因此相位保持
        不变；未超限时数值不变。单路输入返回字典，列表输入返回同样长度
        的列表。
    """
    limit = max(0.0, float(limit_amplitude))

    def limit_one(envelope, _index):
        input_magnitude = magnitude(envelope)
        scale = min(1.0, limit / input_magnitude) if input_magnitude > 0.0 else 1.0
        return with_iq(
            envelope,
            envelope["i"] * scale,
            envelope["q"] * scale,
        )

    return map_envelopes(input_envelope, limit_one)


def rotate_iq(i_value, q_value, phase_rad):
    """将一个 I/Q 向量逆时针旋转。

    参数：
        i_value: 输入同相分量，可转换为浮点数。
        q_value: 输入正交分量，可转换为浮点数。
        phase_rad: 旋转角度，单位为弧度；正值表示逆时针旋转。

    返回：
        二元组 ``(rotated_i, rotated_q)``，两个元素均为浮点数。
    """
    cosine = math.cos(float(phase_rad))
    sine = math.sin(float(phase_rad))
    return (
        float(i_value) * cosine - float(q_value) * sine,
        float(i_value) * sine + float(q_value) * cosine,
    )


def as_float(value, default=0.0):
    """将输入安全转换为有限浮点数。

    参数：
        value：待转换的数值或字符串。
        default：转换失败、无穷大或非数值时返回的默认值；可为 ``None``。

    返回：
        有限浮点数；当 ``default`` 为 ``None`` 且转换失败时返回 ``None``。
    """
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default if default is None else float(default)
    return numeric if math.isfinite(numeric) else (default if default is None else float(default))


def clamp(value, minimum, maximum):
    """将数值限制在闭区间内。

    参数：
        value：待限制的数值。
        minimum：下限；大于上限时会自动与上限交换。
        maximum：上限。

    返回：
        位于 ``[minimum, maximum]`` 范围内的浮点数。
    """
    lower = as_float(minimum)
    upper = as_float(maximum)
    if lower > upper:
        lower, upper = upper, lower
    return min(upper, max(lower, as_float(value, lower)))


def floor_power_of_two(value):
    """返回不大于输入值的最大 2 的整数次幂。

    参数：
        value：待规范化的数值，例如 FFT 点数配置。

    返回：
        不大于 ``value`` 的最大正整数 2 的幂；输入小于 1 或无效时返回 1。
        可用于将任意 FFT 点数约束为基 2 FFT 支持的长度。
    """
    limit = max(1, int(as_float(value, 1)))
    size = 1
    while size * 2 <= limit:
        size *= 2
    return size


def fft_radix2(values):
    """计算基 2 的离散傅里叶变换（FFT）。

    参数：
        values：时域样本序列；序列长度必须是 2 的整数次幂，元素可为实数或复数。

    返回：
        与输入等长的复数频域序列。频率索引 ``k`` 对应
        ``k * 采样率 / 样本数``。

    异常：
        ValueError：输入为空或长度不是 2 的整数次幂。
    """
    count = len(values)
    if count <= 0 or count & (count - 1):
        raise ValueError("FFT 输入长度必须是 2 的整数次幂")

    result = [complex(value) for value in values]
    bit_reversed = 0
    for index in range(1, count):
        bit = count >> 1
        while bit_reversed & bit:
            bit_reversed ^= bit
            bit >>= 1
        bit_reversed ^= bit
        if index < bit_reversed:
            result[index], result[bit_reversed] = result[bit_reversed], result[index]

    span = 2
    while span <= count:
        step = complex(math.cos(-2.0 * math.pi / span), math.sin(-2.0 * math.pi / span))
        for start in range(0, count, span):
            factor = 1.0 + 0.0j
            half = span // 2
            for offset in range(half):
                even = result[start + offset]
                odd = factor * result[start + offset + half]
                result[start + offset] = even + odd
                result[start + offset + half] = even - odd
                factor *= step
        span *= 2
    return result


def _estimate_envelope_baseband_frequency(samples, sample_period):
    """估计复数包络样本中最强的带符号基带频率。"""
    count = len(samples)
    step = max(0.0, float(sample_period))
    if count < 4 or step <= 0.0 or count & (count - 1):
        return 0.0
    windowed = [
        complex(sample)
        * (0.5 - 0.5 * math.cos(2.0 * math.pi * index / (count - 1)))
        for index, sample in enumerate(samples)
    ]
    spectrum = fft_radix2(windowed)
    peak_bin = max(range(count), key=lambda index: abs(spectrum[index]))
    signed_bin = peak_bin if peak_bin <= count // 2 else peak_bin - count
    return signed_bin / (count * step)


def extract_complex_envelope_pulse_features(
    input_envelope,
    fft_size=1024.0,
    adc_full_scale=1.0,
    envelope_threshold_adc=12.0,
    envelope_smoothing=1.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """从复数包络中提取中心频率、重周、脉宽、幅度和脉冲个数。

    参数：
        input_envelope: 单个复数包络字典，或由包络字典组成的非空列表。
            列表输入按顺序选择第一路 I、Q 不同时为零的包络；全部为零时
            使用最后一路，以保留其参考频率等射频上下文。
        fft_size: 基带频率估计使用的 FFT 点数；向下取为不小于 4 的 2 次幂。
        adc_full_scale: 对应 ADC 码 255 的复包络幅度满量程。
        envelope_threshold_adc: 脉冲有效判定门限，范围限制为 0 到 255。
        envelope_smoothing: 包络平滑系数，范围限制为 0 到 1；默认 1 保留边沿。
        time: 当前仿真时刻，单位秒。
        dt: 仿真步长，单位秒，用于 FFT 频率刻度。
        state: 上一次调用返回的 ``state``；首次调用可传 ``None``。

    返回：
        ``{"outputs": ..., "state": ...}``。``outputs`` 包含：

        - ``center_frequency_hz``：参考频率加带符号基带 FFT 峰值；
        - ``pulse_period_seconds``：相邻脉冲上升沿间隔；
        - ``pulse_width_seconds``：最近一次完整脉冲的宽度；
        - ``pulse_amplitude_adc``：当前或最近脉冲峰值，整数 0 到 255；
        - ``pulse_count``：累计检测到的脉冲上升沿数量。

        脉冲时序和幅度在每个采样时刻更新。中心频率在收满 FFT 窗口后
        首次估计，此后每新增至多 128 个样本估计一次；较短窗口按窗口
        长度的八分之一设置更新间隔。两次估计之间沿用上次的基带频率。
        下一采样时刻应把返回的 ``state`` 原样传回本函数。
    """
    envelopes = coerce_envelope_collection(input_envelope)
    if not isinstance(envelopes, list):
        envelopes = [envelopes]
    envelope = next(
        (item for item in envelopes if item["i"] != 0.0 or item["q"] != 0.0),
        envelopes[-1],
    )

    previous = dict(state or {})
    reference_frequency = envelope["referenceFrequencyHz"]
    full_scale = max(1e-12, abs(float(adc_full_scale)))
    size = floor_power_of_two(max(4, int(round(float(fft_size)))))
    sample_period = max(0.0, float(dt))
    smoothing = min(1.0, max(0.0, float(envelope_smoothing)))

    same_sampling_context = (
        previous.get("reference_frequency_hz") == reference_frequency
        and previous.get("fft_size", size) == size
        and previous.get("sample_period", sample_period) == sample_period
    )
    # Copy once so callers can retain an earlier state for rollback. Once the
    # window is full, write_index identifies its oldest sample.
    samples = list(previous.get("samples") or []) if same_sampling_context else []
    write_index = int(previous.get("sample_write_index", 0)) if same_sampling_context else 0
    since_fft = int(previous.get("samples_since_fft", 0)) if same_sampling_context else 0
    baseband_frequency = float(previous.get("baseband_frequency_hz", 0.0)) if same_sampling_context else 0.0
    hop = min(128, max(1, size // 8))
    new_sample = complex(envelope["i"], envelope["q"])
    if len(samples) < size:
        samples.append(new_sample)
        write_index = 0
        should_estimate = len(samples) == size
    else:
        write_index %= size
        samples[write_index] = new_sample
        write_index = (write_index + 1) % size
        since_fft += 1
        should_estimate = since_fft >= hop
    if should_estimate and sample_period > 0.0:
        window = samples[write_index:] + samples[:write_index] if write_index else samples
        baseband_frequency = _estimate_envelope_baseband_frequency(window, sample_period)
        since_fft = 0
    center_frequency = reference_frequency + baseband_frequency

    sample_magnitude = min(
        255.0,
        math.hypot(envelope["i"], envelope["q"]) / full_scale * 255.0,
    )
    previous_envelope = float(previous.get("envelope", 0.0))
    detected_envelope = previous_envelope + smoothing * (
        sample_magnitude - previous_envelope
    )
    threshold = clamp(float(envelope_threshold_adc), 0.0, 255.0)
    active = detected_envelope >= threshold
    was_active = bool(previous.get("active", False))
    rising_time = previous.get("rising_time")
    previous_rising_time = previous.get("previous_rising_time")
    pulse_period = float(previous.get("pulse_period_seconds", 0.0))
    pulse_width = float(previous.get("pulse_width_seconds", 0.0))
    pulse_peak = int(previous.get("pulse_peak", 0))
    amplitude = int(previous.get("pulse_amplitude_adc", 0))
    pulse_count = max(0, int(previous.get("pulse_count", 0)))
    now = float(time)

    if active and not was_active:
        pulse_count += 1
        previous_rising_time = rising_time
        rising_time = now
        if previous_rising_time is not None:
            pulse_period = max(0.0, now - float(previous_rising_time))
        pulse_peak = int(round(sample_magnitude))
    elif active:
        pulse_peak = max(pulse_peak, int(round(sample_magnitude)))
    elif was_active:
        if rising_time is not None:
            pulse_width = max(0.0, now - float(rising_time))
        amplitude = int(clamp(pulse_peak, 0, 255))
        pulse_peak = 0

    reported_amplitude = pulse_peak if active else amplitude
    return {
        "outputs": {
            "center_frequency_hz": center_frequency,
            "pulse_period_seconds": pulse_period,
            "pulse_width_seconds": pulse_width,
            "pulse_amplitude_adc": int(clamp(reported_amplitude, 0, 255)),
            "pulse_count": pulse_count,
        },
        "state": {
            "samples": samples,
            "sample_write_index": write_index,
            "samples_since_fft": since_fft,
            "fft_size": size,
            "sample_period": sample_period,
            "reference_frequency_hz": reference_frequency,
            "baseband_frequency_hz": baseband_frequency,
            "envelope": detected_envelope,
            "active": active,
            "rising_time": rising_time,
            "previous_rising_time": previous_rising_time,
            "pulse_period_seconds": pulse_period,
            "pulse_width_seconds": pulse_width,
            "pulse_peak": pulse_peak,
            "pulse_amplitude_adc": amplitude,
            "pulse_count": pulse_count,
        },
    }


def quantize_bipolar_sample(sample, full_scale_amplitude=1.0, maximum_code=255):
    """将双极性模拟采样值量化为无符号 ADC 码。

    参数：
        sample：待量化的模拟采样值。
        full_scale_amplitude：正、负满量程的绝对幅度；无效或为 0 时按 1 处理。
        maximum_code：ADC 最大码值，例如 8 位 ADC 使用 255。

    返回：
        位于 ``[0, maximum_code]`` 的整数码。``-full_scale_amplitude`` 对应 0，
        ``+full_scale_amplitude`` 对应最大码值。
    """
    full_scale = max(1e-12, abs(as_float(full_scale_amplitude, 1.0)))
    code_max = max(1, int(as_float(maximum_code, 255)))
    normalized = clamp(as_float(sample) / full_scale, -1.0, 1.0)
    return int(round((normalized + 1.0) * code_max / 2.0))


def dequantize_bipolar_code(code, full_scale_amplitude=1.0, maximum_code=255):
    """将无符号 ADC 码恢复为双极性模拟幅度近似值。

    参数：
        code：待恢复的无符号码值，超出范围时自动限幅。
        full_scale_amplitude：正、负满量程的绝对幅度。
        maximum_code：ADC 最大码值，应与量化时保持一致。

    返回：
        位于 ``[-full_scale_amplitude, +full_scale_amplitude]`` 的浮点采样值。
    """
    full_scale = max(1e-12, abs(as_float(full_scale_amplitude, 1.0)))
    code_max = max(1, int(as_float(maximum_code, 255)))
    bounded_code = clamp(code, 0, code_max)
    return (bounded_code / code_max * 2.0 - 1.0) * full_scale


def estimate_fft_peak_frequency(samples, sample_period, window="hann"):
    """利用单边 FFT 主峰估计实数信号的中心频率。

    参数：
        samples：等间隔实数采样序列，长度必须为 2 的整数次幂。
        sample_period：相邻样本的时间间隔，单位 s。
        window：窗函数类型；当前支持 ``"hann"`` 和 ``"rectangular"``。

    返回：
        非直流单边频谱中幅度最大的频点，单位 Hz。样本不足 4 个、采样周期无效
        或没有可用的非直流频点时返回 0。
    """
    count = len(samples)
    step = as_float(sample_period)
    if count < 4 or step <= 0.0:
        return 0.0
    if count & (count - 1):
        raise ValueError("中心频率估计的样本长度必须是 2 的整数次幂")

    kind = str(window or "hann").strip().lower()
    if kind == "rectangular":
        windowed = [as_float(sample) for sample in samples]
    else:
        windowed = [
            as_float(sample) * (0.5 - 0.5 * math.cos(2.0 * math.pi * index / (count - 1)))
            for index, sample in enumerate(samples)
        ]
    spectrum = fft_radix2(windowed)
    half = count // 2
    if half <= 1:
        return 0.0
    peak_bin = max(range(1, half), key=lambda index: abs(spectrum[index]))
    return peak_bin / (count * step)


def estimate_complex_fft_positive_peak_frequency(samples, sample_period, window="hann"):
    """Estimate the strongest strictly positive-frequency component of I/Q samples.

    ``samples`` contains complex values formed as ``I + jQ``.  Unlike the
    real-signal estimator above, its FFT has independent positive and negative
    frequency bins.  Searching only bins ``1 .. N/2 - 1`` therefore rejects
    the negative-frequency mixer image while retaining the desired difference
    product.
    """
    count = len(samples)
    step = as_float(sample_period)
    if count < 4 or step <= 0.0:
        return 0.0
    if count & (count - 1):
        raise ValueError("复数中心频率估计的样本长度必须是 2 的整数次幂")

    kind = str(window or "hann").strip().lower()
    if kind == "rectangular":
        windowed = [complex(sample) for sample in samples]
    else:
        windowed = [
            complex(sample) * (0.5 - 0.5 * math.cos(2.0 * math.pi * index / (count - 1)))
            for index, sample in enumerate(samples)
        ]
    spectrum = fft_radix2(windowed)
    half = count // 2
    if half <= 1:
        return 0.0
    peak_bin = max(range(1, half), key=lambda index: abs(spectrum[index]))
    return peak_bin / (count * step)


def limit_rf_amplitude(sample, maximum_amplitude):
    """对单个射频时域采样值执行对称限幅。

    参数：
        sample：待限幅的时域幅度采样值。
        maximum_amplitude：最大绝对幅度；负值按其绝对值处理。

    返回：
        限制在 ``[-maximum_amplitude, +maximum_amplitude]`` 的浮点数。
    """
    limit = abs(as_float(maximum_amplitude))
    return clamp(sample, -limit, limit)


def amplify_rf_signal(sample, gain_db=0.0, maximum_amplitude=None):
    """按 dB 增益放大单个射频时域采样值。

    参数：
        sample：输入时域幅度采样值。
        gain_db：幅度增益，单位 dB，按 ``10 ** (gain_db / 20)`` 换算。
        maximum_amplitude：可选的最大输出绝对幅度；提供时模拟饱和限幅。

    返回：
        放大后的浮点采样值；若设置最大幅度则为限幅后的值。
    """
    gain = math.pow(10.0, as_float(gain_db) / 20.0)
    output = as_float(sample) * gain
    if maximum_amplitude is None:
        return output
    return limit_rf_amplitude(output, maximum_amplitude)


def amplify_rf_excitation(sample, gain_db=0.0, maximum_output_amplitude=None):
    """射频激励级或驱动级放大。

    参数：
        sample：输入激励信号的时域幅度采样值。
        gain_db：驱动级幅度增益，单位 dB。
        maximum_output_amplitude：可选的激励级最大输出绝对幅度。

    返回：
        放大并按需饱和后的激励信号采样值。
    """
    return amplify_rf_signal(sample, gain_db, maximum_output_amplitude)


def amplify_rf_power(
    sample,
    gain_db=0.0,
    maximum_output_power_watts=None,
    impedance_ohms=50.0,
):
    """射频功率放大并按最大输出功率限幅。

    参数：
        sample：输入正弦信号的瞬时电压采样值。
        gain_db：功放增益，单位 dB。
        maximum_output_power_watts：可选的最大输出平均功率，单位 W。
        impedance_ohms：负载阻抗，单位欧姆，默认 50 欧姆。

    返回：
        放大后的电压采样值；设置最大功率时按
        ``P = V_peak ** 2 / (2 * R)`` 换算峰值电压后限幅。
    """
    output = amplify_rf_signal(sample, gain_db)
    if maximum_output_power_watts is None:
        return output
    power_limit = max(0.0, as_float(maximum_output_power_watts))
    impedance = max(1e-12, as_float(impedance_ohms, 50.0))
    maximum_peak_amplitude = math.sqrt(2.0 * power_limit * impedance)
    return limit_rf_amplitude(output, maximum_peak_amplitude)


def amplify_rf_final_power_2(
    small_signal_inputs,
    gate_controls=None,
    gain_db=0.0,
    maximum_output_power_watts=None,
    impedance_ohms=50.0,
    gate_threshold=0.5,
):
    """2 元末级功放：小信号功率放大与栅极控制。

    参数：
        small_signal_inputs：2 路小信号序列；不足 2 路按 0 补齐。若传入
            单个数值，则作为公共激励复制给全部阵元。
        gate_controls：2 路栅极控制量或单个公共控制量；未提供时全部导通。
        gain_db：每个末级功放的增益，单位 dB。
        maximum_output_power_watts：每个末级功放的最大输出平均功率，单位 W。
        impedance_ohms：每个末级功放的负载阻抗，单位欧姆。
        gate_threshold：数值型栅极控制量的导通阈值。

    返回：
        固定长度为 2 的输出元组；未导通阵元对应输出为 0。
    """
    if isinstance(small_signal_inputs, (tuple, list)):
        inputs = tuple(as_float(value) for value in small_signal_inputs[:2])
        inputs += (0.0,) * (2 - len(inputs))
    else:
        inputs = (as_float(small_signal_inputs),) * 2

    if gate_controls is None:
        gates = (True,) * 2
    elif isinstance(gate_controls, (tuple, list)):
        gates = tuple(gate_controls[:2]) + (0.0,) * (2 - len(gate_controls))
    else:
        gates = (gate_controls,) * 2

    threshold = as_float(gate_threshold, 0.5)
    outputs = []
    for sample, gate in zip(inputs, gates):
        enabled = gate if isinstance(gate, bool) else as_float(gate) >= threshold
        outputs.append(
            amplify_rf_power(
                sample,
                gain_db,
                maximum_output_power_watts,
                impedance_ohms,
            ) if enabled else 0.0
        )
    return tuple(outputs)


def amplify_rf_relay(sample, gain_db=0.0, enabled=True, maximum_output_amplitude=None):
    """中继放大器。

    参数：
        sample：输入信号采样值。
        gain_db：中继增益，单位 dB。
        enabled：中继使能开关；为假时关闭输出。
        maximum_output_amplitude：可选的输出最大绝对幅度。

    返回：
        已使能时的放大/限幅结果；未使能时返回 0。
    """
    if not enabled:
        return 0.0
    return amplify_rf_signal(sample, gain_db, maximum_output_amplitude)


def multiplex_wavelength_division(channel_samples, wavelengths_nm):
    """波分复用：将多个通道与波长标识组合为复用谱线。

    参数：
        channel_samples：各光通道的数值样本序列。
        wavelengths_nm：各通道对应的波长序列，单位 nm。

    返回：
        ``((波长nm, 通道样值), ...)`` 元组。两个输入序列按下标配对，
        波长不足的通道不参与复用。
    """
    samples = tuple(channel_samples or ())
    wavelengths = tuple(wavelengths_nm or ())
    count = min(len(samples), len(wavelengths))
    return tuple((as_float(wavelengths[index]), as_float(samples[index])) for index in range(count))


def control_rf_beam_array(
    channel_inputs,
    previous_outputs_iq=None,
    input_gain_db=0.0,
    amplitude_weights=None,
    phase_weights_deg=None,
    scan_angle_deg=0.0,
    element_spacing_wavelength=0.5,
    output_filter_cutoff_hz=None,
    dt=0.0,
):
    """波控阵列：批量执行阵元通道幅相控制和波束扫描。

    参数：
        channel_inputs：阵元 I/Q 输入序列，格式为 ``((I, Q), ...)``。
        previous_outputs_iq：上一仿真步的阵元输出序列，用于保存滤波状态。
        input_gain_db：所有阵元共用的输入增益，单位 dB。
        amplitude_weights：各阵元幅度权重序列；缺失项默认 1。
        phase_weights_deg：各阵元人工相位权重序列，单位度；缺失项默认 0。
        scan_angle_deg：波束扫描角，单位度。
        element_spacing_wavelength：阵元间距，以工作波长为单位。
        output_filter_cutoff_hz：可选的每通道输出低通截止频率，单位 Hz。
        dt：仿真步长，单位秒。

    返回：
        与输入阵元数相同的 I/Q 输出元组序列。
    """
    inputs = tuple(channel_inputs or ())
    previous = tuple(previous_outputs_iq or ())
    return tuple(
        control_rf_channel_amplitude_phase(
            input_iq=sample,
            previous_output_iq=previous[index] if index < len(previous) else (0.0, 0.0),
            input_gain_db=input_gain_db,
            amplitude_weight=_weight_at(amplitude_weights, index, 1.0),
            phase_weight_deg=_weight_at(phase_weights_deg, index, 0.0),
            scan_angle_deg=scan_angle_deg,
            element_index=index,
            element_spacing_wavelength=element_spacing_wavelength,
            output_filter_cutoff_hz=output_filter_cutoff_hz,
            dt=dt,
        )
        for index, sample in enumerate(inputs)
    )


def process_rf_frontend(
    input_iq,
    previous_output_iq=(0.0, 0.0),
    enabled=True,
    lna_gain_db=0.0,
    maximum_output_amplitude=None,
    output_filter_cutoff_hz=None,
    dt=0.0,
):
    """射频前端处理模块：使能、低噪声增益、矢量限幅和输出滤波。

    参数：
        input_iq：输入基带信号，格式为 ``(I, Q)``。
        previous_output_iq：上一仿真步输出，用于 I/Q 滤波状态保持。
        enabled：前端使能开关；为假时关闭输出。
        lna_gain_db：低噪声放大器增益，单位 dB。
        maximum_output_amplitude：可选的 I/Q 合成矢量最大幅度。
        output_filter_cutoff_hz：可选的输出低通截止频率，单位 Hz。
        dt：仿真步长，单位秒。

    返回：
        处理后的 ``(I, Q)`` 元组；未使能时返回 ``(0.0, 0.0)``。
    """
    if not enabled:
        return 0.0, 0.0
    input_i, input_q = _as_iq_sample(input_iq)
    gain = math.pow(10.0, as_float(lna_gain_db) / 20.0)
    output_i = input_i * gain
    output_q = input_q * gain
    if maximum_output_amplitude is not None:
        maximum = abs(as_float(maximum_output_amplitude))
        magnitude = math.sqrt(output_i * output_i + output_q * output_q)
        if magnitude > maximum and magnitude > 0.0:
            scale = maximum / magnitude
            output_i *= scale
            output_q *= scale
    if output_filter_cutoff_hz is None:
        return output_i, output_q
    previous_i, previous_q = _as_iq_sample(previous_output_iq)
    return (
        low_pass_rf_filter(output_i, previous_i, output_filter_cutoff_hz, dt),
        low_pass_rf_filter(output_q, previous_q, output_filter_cutoff_hz, dt),
    )


def combine_split_rf_power(input_samples, output_count=1, insertion_loss_db=0.0):
    """合路功分：先相干合路，再等功率分配。

    参数：
        input_samples：同频输入信号的电压/幅度采样值序列。
        output_count：功分输出路数，最小为 1。
        insertion_loss_db：合路功分链路总插入损耗，单位 dB。

    返回：
        长度为 ``output_count`` 的等功率输出浮点列表。输入按幅度直接求和，
        因此相位相反的信号会相消。
    """
    combined = sum(as_float(sample) for sample in tuple(input_samples or ()))
    return _split_rf_power(combined, output_count, insertion_loss_db)


def adc_convert_rf(sample, resolution_bits=12, full_scale_amplitude=1.0, offset=0.0):
    """射频接收链路单采样点 A/D 转换。

    参数：
        sample：双极性模拟输入采样值。
        resolution_bits：量化分辨率，限制为 1 至 32 位。
        full_scale_amplitude：输入满量程绝对幅度；正负满量程对应最小/最大码。
        offset：量化前叠加的直流偏置。

    返回：
        无符号整数码。``-full_scale_amplitude`` 对应 0，正满量程对应
        ``2 ** resolution_bits - 1``；超满量程输入会饱和。
    """
    bits = max(1, min(32, int(as_float(resolution_bits, 12))))
    full_scale = abs(as_float(full_scale_amplitude, 1.0))
    if full_scale == 0.0:
        return 0
    maximum_code = (1 << bits) - 1
    analog_value = as_float(sample) + as_float(offset)
    normalized = clamp((analog_value + full_scale) / (2.0 * full_scale), 0.0, 1.0)
    return int(math.floor(normalized * maximum_code + 0.5))


def dac_convert_rf(code, resolution_bits=12, full_scale_amplitude=1.0, offset=0.0):
    """射频激励链路单采样点 D/A 转换。

    参数：
        code：无符号数字输入码；越界码会饱和。
        resolution_bits：转换分辨率，限制为 1 至 32 位。
        full_scale_amplitude：输出满量程绝对幅度。
        offset：转换后叠加的输出直流偏置。

    返回：
        双极性模拟输出采样值。码 0 对应负满量程，最大码对应正满量程。
    """
    bits = max(1, min(32, int(as_float(resolution_bits, 12))))
    full_scale = abs(as_float(full_scale_amplitude, 1.0))
    if full_scale == 0.0:
        return as_float(offset)
    maximum_code = (1 << bits) - 1
    quantized_code = int(math.floor(as_float(code) + 0.5))
    bounded_code = min(maximum_code, max(0, quantized_code))
    normalized = float(bounded_code) / maximum_code
    return (normalized * 2.0 - 1.0) * full_scale + as_float(offset)


def adc_codes_to_normalized_iq(
    i_code,
    q_code,
    resolution_bits=12,
    full_scale_amplitude=1.0,
    i_offset=0.0,
    q_offset=0.0,
):
    """将两路 ADC 码恢复为归一化数字基带 I/Q。

    参数：
        i_code：I 路 ADC 输出码。
        q_code：Q 路 ADC 输出码。
        resolution_bits：两路 ADC 的分辨率。
        full_scale_amplitude：ADC 输入满量程绝对幅度。
        i_offset：I 路 ADC 量化前使用的直流偏置。
        q_offset：Q 路 ADC 量化前使用的直流偏置。

    返回：
        归一化 ``(I, Q)`` 元组，分量范围限制在约 ``[-1, 1]``，可直接输入 DBF。
    """
    full_scale = abs(as_float(full_scale_amplitude, 1.0))
    if full_scale == 0.0:
        return 0.0, 0.0
    restored_i = dac_convert_rf(i_code, resolution_bits, full_scale) - as_float(i_offset)
    restored_q = dac_convert_rf(q_code, resolution_bits, full_scale) - as_float(q_offset)
    return clamp(restored_i / full_scale, -1.0, 1.0), clamp(restored_q / full_scale, -1.0, 1.0)


def normalized_iq_to_dac_codes(i_value, q_value, resolution_bits=12, full_scale_amplitude=1.0):
    """将归一化数字基带 I/Q 量化为两路 DAC 输入码。

    参数：
        i_value：归一化 I 分量，正常范围为 ``[-1, 1]``。
        q_value：归一化 Q 分量，正常范围为 ``[-1, 1]``。
        resolution_bits：两路 DAC 的分辨率。
        full_scale_amplitude：DAC 输出满量程绝对幅度。

    返回：
        ``(I码, Q码)`` 整数元组；输入超出归一化范围时饱和。
    """
    full_scale = abs(as_float(full_scale_amplitude, 1.0))
    if full_scale == 0.0:
        return 0, 0
    i_sample = clamp(i_value, -1.0, 1.0) * full_scale
    q_sample = clamp(q_value, -1.0, 1.0) * full_scale
    return (
        adc_convert_rf(i_sample, resolution_bits, full_scale),
        adc_convert_rf(q_sample, resolution_bits, full_scale),
    )


def _as_iq_sample(sample):
    """将单路基带采样值转换为有限 I/Q 分量。

    参数：
        sample：可为复数、``(I, Q)`` 序列或单个实数；实数按 I 分量处理。

    返回：
        ``(I, Q)`` 浮点元组；无效分量按默认值 0 处理。
    """
    if isinstance(sample, complex):
        return as_float(sample.real), as_float(sample.imag)
    if isinstance(sample, (tuple, list)) and len(sample) >= 2:
        return as_float(sample[0]), as_float(sample[1])
    return as_float(sample), 0.0


def _weight_at(weights, index, default):
    """读取指定通道权重。

    参数：
        weights：权重序列，可为 ``None``。
        index：需读取的通道下标。
        default：权重缺失或无效时使用的默认值。

    返回：
        指定通道的有限浮点权重，或默认值。
    """
    source = tuple(weights or ())
    return as_float(source[index], default) if index < len(source) else default


def dbf_form_baseband_signal(samples, amplitude_weights=None, phase_weights_deg=None):
    """DBF 数字波束形成：对多路基带信号执行幅相加权和矢量合成。

    参数：
        samples：通道基带样本序列；每项可为 ``(I, Q)``、复数或实数。
        amplitude_weights：各通道幅度权重序列；缺失项默认 1。
        phase_weights_deg：各通道相位权重序列，单位度；缺失项默认 0 度。

    返回：
        合成后的 ``(I, Q)`` 浮点元组。输出为直接叠加结果，不做归一化。
    """
    total_i = 0.0
    total_q = 0.0
    for index, sample in enumerate(tuple(samples or ())):
        input_i, input_q = _as_iq_sample(sample)
        amplitude = _weight_at(amplitude_weights, index, 1.0)
        phase_rad = math.radians(_weight_at(phase_weights_deg, index, 0.0))
        cosine = math.cos(phase_rad)
        sine = math.sin(phase_rad)
        total_i += amplitude * (input_i * cosine - input_q * sine)
        total_q += amplitude * (input_i * sine + input_q * cosine)
    return total_i, total_q


def low_pass_rf_filter(sample, previous_output, cutoff_frequency_hz, dt):
    """一阶低通滤波。

    参数：
        sample：当前仿真步的输入采样值。
        previous_output：上一仿真步的滤波输出，用作状态。
        cutoff_frequency_hz：低通截止频率，单位 Hz。
        dt：仿真步长，单位秒。

    返回：
        当前仿真步的滤波输出。截止频率或步长无效时保持上一输出。
    """
    previous = as_float(previous_output)
    cutoff = as_float(cutoff_frequency_hz)
    step = as_float(dt)
    if cutoff <= 0.0 or step <= 0.0:
        return previous
    alpha = 1.0 - math.exp(-2.0 * math.pi * cutoff * step)
    return previous + clamp(alpha, 0.0, 1.0) * (as_float(sample) - previous)


def high_pass_rf_filter(sample, previous_input, previous_output, cutoff_frequency_hz, dt):
    """一阶高通滤波。

    参数：
        sample：当前仿真步的输入采样值。
        previous_input：上一仿真步的输入采样值，用作状态。
        previous_output：上一仿真步的高通输出，用作状态。
        cutoff_frequency_hz：高通截止频率，单位 Hz。
        dt：仿真步长，单位秒。

    返回：
        当前仿真步的高通输出。调用方应在下一仿真步将本次 ``sample`` 和
        返回值分别作为 ``previous_input``、``previous_output`` 传入。

    使用与低通函数一致的指数离散化时间常数；步长或截止频率无效时保持上一输出。
    """
    current = as_float(sample)
    previous_sample = as_float(previous_input)
    previous = as_float(previous_output)
    cutoff = as_float(cutoff_frequency_hz)
    step = as_float(dt)
    if cutoff < 0.0 or step <= 0.0:
        return previous
    decay = math.exp(-2.0 * math.pi * cutoff * step)
    return decay * (previous + current - previous_sample)


def _valid_rf_band(low_cutoff_frequency_hz, high_cutoff_frequency_hz):
    """返回已归一化且有效的带通频率范围，或 ``None``。"""
    low_cutoff = as_float(low_cutoff_frequency_hz)
    high_cutoff = as_float(high_cutoff_frequency_hz)
    if low_cutoff < 0.0 or high_cutoff <= low_cutoff:
        return None
    return low_cutoff, high_cutoff


def band_pass_rf_filter(
    sample,
    previous_input,
    previous_high_pass_output,
    previous_output,
    low_cutoff_frequency_hz,
    high_cutoff_frequency_hz,
    dt,
):
    """一阶带通滤波。

    参数：
        sample：当前仿真步的输入采样值。
        previous_input：上一仿真步的输入采样值。
        previous_high_pass_output：上一仿真步高通级输出。
        previous_output：上一仿真步带通输出。
        low_cutoff_frequency_hz：通带下截止频率，单位 Hz，可为 0。
        high_cutoff_frequency_hz：通带上截止频率，单位 Hz，必须大于下截止频率。
        dt：仿真步长，单位秒。

    返回：
        ``(high_pass_output, band_pass_output)``。调用方应保存 ``sample``、
        高通级输出和带通输出，分别用于下一步的状态参数。

    该函数由一阶高通和一阶低通串联构成。频率范围无效或步长非正时保持上一输出。
    """
    previous_high_pass = as_float(previous_high_pass_output)
    previous = as_float(previous_output)
    band = _valid_rf_band(low_cutoff_frequency_hz, high_cutoff_frequency_hz)
    if band is None or as_float(dt) <= 0.0:
        return previous_high_pass, previous
    low_cutoff, high_cutoff = band
    high_pass_output = high_pass_rf_filter(
        sample,
        previous_input,
        previous_high_pass_output,
        low_cutoff,
        dt,
    )
    band_pass_output = low_pass_rf_filter(high_pass_output, previous, high_cutoff, dt)
    return high_pass_output, band_pass_output


def band_pass_fir_filter(
    sample,
    center_frequency_hz,
    bandwidth_hz,
    dt,
    state=None,
    tap_count=129,
):
    """对单个射频采样执行有状态 FIR 带通滤波。

    参数：
        sample：当前输入采样值。
        center_frequency_hz：通带中心频率，单位 Hz。
        bandwidth_hz：通带带宽，单位 Hz。
        dt：仿真步长，单位秒。
        state：上次调用返回的状态字典；配置变化时自动清空历史。
        tap_count：FIR 抽头数，必须为不小于 3 的奇数；无效时使用 129。

    返回：
        ``(filtered_sample, next_state, metadata)``。``next_state`` 应在下一
        仿真步原样传回；``metadata`` 含实际下、上截止频率和群时延采样数。

    实现采用 Blackman 窗线性相位 FIR，并在通带中心频率处归一化增益。
    通带会自动限制在仿真采样率的奈奎斯特频率以内；步长或通带无效时输出 0
    且返回空状态。
    """
    step = as_float(dt)
    requested_tap_count = int(as_float(tap_count, 129))
    taps_count = requested_tap_count if requested_tap_count >= 3 and requested_tap_count % 2 else 129
    if step <= 0.0:
        return 0.0, {}, {
            "low_cutoff_hz": 0.0,
            "high_cutoff_hz": 0.0,
            "group_delay_samples": 0.0,
        }

    sample_rate_hz = 1.0 / step
    nyquist_hz = sample_rate_hz / 2.0
    center_hz = max(0.0, as_float(center_frequency_hz))
    bandwidth = max(1.0, as_float(bandwidth_hz))
    low_cutoff_hz = max(0.0, center_hz - bandwidth / 2.0)
    high_cutoff_hz = min(nyquist_hz, center_hz + bandwidth / 2.0)
    if high_cutoff_hz <= low_cutoff_hz:
        return 0.0, {}, {
            "low_cutoff_hz": 0.0,
            "high_cutoff_hz": 0.0,
            "group_delay_samples": 0.0,
        }

    configuration = (sample_rate_hz, low_cutoff_hz, high_cutoff_hz, taps_count)
    previous = state if isinstance(state, dict) else {}
    if tuple(previous.get("configuration", ())) != configuration:
        midpoint = (taps_count - 1) / 2.0
        taps = []
        for index in range(taps_count):
            offset = index - midpoint
            if offset == 0.0:
                ideal = 2.0 * (high_cutoff_hz - low_cutoff_hz) / sample_rate_hz
            else:
                ideal = (
                    math.sin(2.0 * math.pi * high_cutoff_hz * offset / sample_rate_hz)
                    - math.sin(2.0 * math.pi * low_cutoff_hz * offset / sample_rate_hz)
                ) / (math.pi * offset)
            window = (
                0.42
                - 0.5 * math.cos(2.0 * math.pi * index / (taps_count - 1))
                + 0.08 * math.cos(4.0 * math.pi * index / (taps_count - 1))
            )
            taps.append(ideal * window)

        actual_center_hz = (low_cutoff_hz + high_cutoff_hz) / 2.0
        gain = math.hypot(
            sum(coefficient * math.cos(2.0 * math.pi * actual_center_hz * index / sample_rate_hz)
                for index, coefficient in enumerate(taps)),
            sum(coefficient * math.sin(2.0 * math.pi * actual_center_hz * index / sample_rate_hz)
                for index, coefficient in enumerate(taps)),
        )
        if gain > 1e-12:
            taps = [coefficient / gain for coefficient in taps]
        history = []
    else:
        saved_taps = previous.get("taps")
        taps = (
            [as_float(value) for value in saved_taps]
            if isinstance(saved_taps, list) and len(saved_taps) == taps_count
            else []
        )
        if not taps:
            return band_pass_fir_filter(
                sample,
                center_frequency_hz,
                bandwidth_hz,
                dt,
                state={},
                tap_count=taps_count,
            )
        history = [as_float(value) for value in previous.get("input_history", ())][-(taps_count - 1):]

    history.append(as_float(sample))
    padded_history = [0.0] * max(0, taps_count - len(history)) + history
    filtered_sample = sum(coefficient * value for coefficient, value in zip(taps, reversed(padded_history)))
    return filtered_sample, {
        "configuration": list(configuration),
        "input_history": history[-(taps_count - 1):],
        "taps": taps,
    }, {
        "low_cutoff_hz": low_cutoff_hz,
        "high_cutoff_hz": high_cutoff_hz,
        "group_delay_samples": (taps_count - 1) / 2.0,
    }


def band_stop_rf_filter(
    sample,
    previous_input,
    previous_high_pass_output,
    previous_output,
    low_cutoff_frequency_hz,
    high_cutoff_frequency_hz,
    dt,
):
    """一阶带阻（陷波）滤波。

    参数与 :func:`band_pass_rf_filter` 相同，但 ``previous_output`` 为上一仿真
    步的带阻输出。

    返回：
        当前仿真步的带阻输出。调用方保存 ``sample``、高通级输出和返回值，
        即可在下一步继续计算。

    带阻输出为输入减去同一频段的带通输出，可抑制下、上截止频率之间的信号。
    """
    previous = as_float(previous_output)
    band = _valid_rf_band(low_cutoff_frequency_hz, high_cutoff_frequency_hz)
    if band is None or as_float(dt) <= 0.0:
        return previous
    low_cutoff, high_cutoff = band
    previous_band_pass_output = as_float(previous_input) - previous
    _next_high_pass_output, band_pass_output = band_pass_rf_filter(
        sample,
        previous_input,
        previous_high_pass_output,
        previous_band_pass_output,
        low_cutoff,
        high_cutoff,
        dt,
    )
    return as_float(sample) - band_pass_output


def downconvert_rf_signal(
    rf_sample,
    lo_frequency_hz,
    time=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
    previous_output_iq=(0.0, 0.0),
    low_pass_cutoff_hz=None,
    dt=0.0,
):
    """将单路实数射频信号下变频为 I/Q 信号。

    参数：
        rf_sample：当前仿真步的实数射频采样值。
        lo_frequency_hz：本振频率，单位 Hz。
        time：当前仿真时刻，单位秒。
        lo_phase_deg：本振初相位，单位度。
        conversion_gain：混频器电压/幅度转换增益。
        previous_output_iq：上一步低通后的 ``(I, Q)`` 输出状态。
        low_pass_cutoff_hz：可选的基带低通截止频率，单位 Hz；为 ``None`` 时
            返回未滤波的混频结果。
        dt：仿真步长，单位秒；仅在设置低通截止频率时使用。

    返回：
        下变频后的 ``(I, Q)`` 浮点元组。Q 路使用负正交本振，使正频率差频
        对应 ``I + jQ`` 的正相位旋转。
    """
    phase = (
        2.0 * math.pi * as_float(lo_frequency_hz) * as_float(time)
        + math.radians(as_float(lo_phase_deg))
    )
    amplified_sample = as_float(rf_sample) * as_float(conversion_gain, 1.0)
    mixed_i = 2.0 * amplified_sample * math.cos(phase)
    mixed_q = -2.0 * amplified_sample * math.sin(phase)
    if low_pass_cutoff_hz is None:
        return mixed_i, mixed_q
    previous_i, previous_q = _as_iq_sample(previous_output_iq)
    return (
        low_pass_rf_filter(mixed_i, previous_i, low_pass_cutoff_hz, dt),
        low_pass_rf_filter(mixed_q, previous_q, low_pass_cutoff_hz, dt),
    )


def upconvert_rf_signal(
    input_iq,
    lo_frequency_hz,
    time=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """将基带 I/Q 信号上变频为单路实数射频信号。

    参数：
        input_iq：当前仿真步的基带信号，可为 ``(I, Q)`` 元组、复数或单个实数。
        lo_frequency_hz：本振频率，单位 Hz。
        time：当前仿真时刻，单位秒。
        lo_phase_deg：本振初相位，单位度。
        conversion_gain：上变频器电压/幅度转换增益。

    返回：
        实数射频采样值，计算式为
        ``gain * (I * cos(lo_phase) - Q * sin(lo_phase))``。
    """
    input_i, input_q = _as_iq_sample(input_iq)
    phase = (
        2.0 * math.pi * as_float(lo_frequency_hz) * as_float(time)
        + math.radians(as_float(lo_phase_deg))
    )
    return as_float(conversion_gain, 1.0) * (
        input_i * math.cos(phase) - input_q * math.sin(phase)
    )


def _split_rf_power(sample, output_count, insertion_loss_db = 0.0):
    """将单路射频时域样本等功率分配到多路输出。

    参数：
        sample：输入时域幅度采样值。
        output_count：输出路数，最小为 1。
        insertion_loss_db：总插入损耗，单位 dB。

    返回：
        长度为 ``output_count`` 的等功率输出浮点列表。
    """
    count = max(1, int(output_count))
    loss_db = max(0.0, as_float(insertion_loss_db))
    amplitude_factor = math.sqrt(math.pow(10.0, -loss_db / 10.0) / count)
    output = as_float(sample) * amplitude_factor
    return [output] * count


def sp2t_switch(input_sample, selected_throw=0, off_value=0.0):
    """SP2T 单刀双掷开关。

    参数：
        input_sample：单刀端输入信号采样值。
        selected_throw：选择的掷端；0 选第一路，1 选第二路。
        off_value：未选通端和无效选择时的输出值。

    返回：
        ``(输出1, 输出2)`` 元组；无效选择时两路均为 ``off_value``。
    """
    try:
        selected = int(selected_throw)
    except (TypeError, ValueError):
        selected = -1
    off = as_float(off_value)
    signal = as_float(input_sample)
    if selected == 0:
        return signal, off
    if selected == 1:
        return off, signal
    return off, off


def split_rf_power_2_to_8(input_a, input_b, insertion_loss_db=0.0):
    """二分八功分：两路输入分别等功率分为四路。

    参数：
        input_a：A 组输入信号采样值。
        input_b：B 组输入信号采样值。
        insertion_loss_db：每组功分链路总插入损耗，单位 dB。

    返回：
        ``[A1, A2, A3, A4, B1, B2, B3, B4]`` 八路输出列表。
    """
    return _split_rf_power(input_a, 4, insertion_loss_db) + _split_rf_power(
        input_b,
        4,
        insertion_loss_db,
    )


def select_excitation_signal(excitation_inputs, selected_index=0, enabled=True, default=0.0):
    """激励信号选择。

    参数：
        excitation_inputs：候选激励信号采样值序列。
        selected_index：被选通的输入下标，从 0 开始计数。
        enabled：激励选择使能开关；为假时关闭输出。
        default：空输入、无效索引或未使能时的默认输出值。

    返回：
        选中的激励信号采样值，或默认值。
    """
    if not enabled:
        return as_float(default)
    return select_rf_switch(excitation_inputs, selected_index, default)


def control_excitation_power_split(
    excitation_sample,
    output_enables=None,
    gain_db=0.0,
    insertion_loss_db=0.0,
):
    """激励控制功分。

    参数：
        excitation_sample：输入激励信号采样值。
        output_enables：各功分支路使能序列；未提供时默认启用八路。
        gain_db：功分前激励放大增益，单位 dB。
        insertion_loss_db：激励功分链路总插入损耗，单位 dB。

    返回：
        与使能序列等长的输出元组。有效支路间等功率分配，未使能支路为 0。
    """
    enables = tuple(output_enables) if output_enables is not None else (True,) * 8
    active_count = sum(1 for enabled in enables if bool(enabled))
    if active_count == 0:
        return (0.0,) * len(enables)
    amplified = amplify_rf_excitation(excitation_sample, gain_db)
    loss_db = max(0.0, as_float(insertion_loss_db))
    amplitude_factor = math.sqrt(math.pow(10.0, -loss_db / 10.0) / active_count)
    active_output = amplified * amplitude_factor
    return tuple(active_output if bool(enabled) else 0.0 for enabled in enables)


def control_rf_channel_amplitude_phase(
    input_iq,
    previous_output_iq=(0.0, 0.0),
    input_gain_db=0.0,
    amplitude_weight=1.0,
    phase_weight_deg=0.0,
    scan_angle_deg=0.0,
    element_index=0,
    element_spacing_wavelength=0.5,
    output_filter_cutoff_hz=None,
    dt=0.0,
):
    """通道幅相控制：输入放大、输出滤波和波束扫描。

    参数：
        input_iq：当前通道输入，格式为 ``(I, Q)``。
        previous_output_iq：上一仿真步输出，用于 I/Q 滤波状态保持。
        input_gain_db：输入放大增益，单位 dB。
        amplitude_weight：通道幅度权重。
        phase_weight_deg：人工相位权重，单位度。
        scan_angle_deg：波束扫描角，单位度。
        element_index：当前阵元序号，从 0 开始。
        element_spacing_wavelength：阵元间距，以工作波长为单位。
        output_filter_cutoff_hz：可选的输出低通截止频率，单位 Hz。
        dt：仿真步长，单位秒。

    返回：
        控制后的 ``(I, Q)`` 输出元组；不设置截止频率时跳过滤波。
    """
    input_i, input_q = _as_iq_sample(input_iq)
    previous_i, previous_q = _as_iq_sample(previous_output_iq)
    gain = math.pow(10.0, as_float(input_gain_db) / 20.0)
    amplitude = gain * as_float(amplitude_weight, 1.0)
    scan_phase_deg = -360.0 * as_float(element_index) * as_float(
        element_spacing_wavelength,
        0.5,
    ) * math.sin(math.radians(as_float(scan_angle_deg)))
    phase_rad = math.radians(as_float(phase_weight_deg) + scan_phase_deg)
    cosine = math.cos(phase_rad)
    sine = math.sin(phase_rad)
    controlled_i = amplitude * (input_i * cosine - input_q * sine)
    controlled_q = amplitude * (input_i * sine + input_q * cosine)
    if output_filter_cutoff_hz is None:
        return controlled_i, controlled_q
    return (
        low_pass_rf_filter(controlled_i, previous_i, output_filter_cutoff_hz, dt),
        low_pass_rf_filter(controlled_q, previous_q, output_filter_cutoff_hz, dt),
    )


def control_signal_amplitude_phase(input_signal, amplitude_scale=1.0, phase_shift_deg=0.0):
    """对实数信号执行通用幅度和相位控制。

    参数：
        input_signal：输入实数信号采样值。
        amplitude_scale：线性幅度系数；例如 ``2`` 表示幅度加倍。
        phase_shift_deg：相位偏移，单位度；以实数同相分量投影实现。

    返回：
        控制后的实数信号。计算公式为
        ``input_signal * amplitude_scale * cos(phase_shift_deg)``。

    说明：
        单个实数采样不含正交分量，不能无损重建时移后的完整波形；若需要
        严格的相位旋转，请使用 ``control_rf_channel_amplitude_phase`` 的 I/Q 接口。
    """
    amplitude = as_float(input_signal) * as_float(amplitude_scale, 1.0)
    phase_rad = math.radians(as_float(phase_shift_deg))
    return amplitude * math.cos(phase_rad)


def select_rf_switch(inputs, selected_index=0, default=0.0):
    """射频多选一开关选择。

    参数：
        inputs：候选输入信号采样值序列。
        selected_index：选通输入下标，从 0 开始计数。
        default：输入为空或索引无效时返回的默认值。

    返回：
        选中的输入采样值；无效选择时返回默认值。
    """
    try:
        index = int(selected_index)
    except (TypeError, ValueError):
        return as_float(default)
    source = tuple(inputs or ())
    if index < 0 or index >= len(source):
        return as_float(default)
    return as_float(source[index], default)



def first_numeric(parameters, keys, fallback=0.0):
    """从参数字典中读取第一个有效数值。

    参数：
        parameters：待读取的参数字典；可为 ``None``。
        keys：按优先级排列的键名序列。
        fallback：没有有效数值时返回的默认值。

    返回：
        第一个存在且可转换为有限浮点数的参数值，或默认值。
    """
    source = parameters or {}
    for key in keys:
        if key in source:
            value = as_float(source[key], None)
            if value is not None:
                return value
    return as_float(fallback)


def first_order_response(previous, target, time_constant, dt):
    """计算一阶惯性环节在一个仿真步内的输出。

    参数：
        previous：上一仿真步输出状态。
        target：当前目标输入值。
        time_constant：一阶惯性时间常数，单位秒。
        dt：仿真步长，单位秒。

    返回：
        当前仿真步的一阶响应输出值。
    """
    previous_value = as_float(previous)
    target_value = as_float(target)
    step = max(0.0, as_float(dt))
    tau = max(0.0, as_float(time_constant))
    if step == 0.0:
        return previous_value
    if tau == 0.0:
        return target_value
    alpha = clamp(step / (tau + step), 0.0, 1.0)
    return previous_value + alpha * (target_value - previous_value)


def rate_limit(previous, target, rise_rate, fall_rate, dt):
    """按上升和下降速率限制信号变化。

    参数：
        previous：上一仿真步输出值。
        target：当前目标值。
        rise_rate：上升最大变化率，单位为幅度每秒。
        fall_rate：下降最大变化率，单位为幅度每秒。
        dt：仿真步长，单位秒。

    返回：
        受速率约束后的当前输出值。
    """
    previous_value = as_float(previous)
    target_value = as_float(target)
    step = max(0.0, as_float(dt))
    delta = target_value - previous_value
    limit = max(0.0, as_float(rise_rate if delta >= 0.0 else fall_rate)) * step
    return previous_value + clamp(delta, -limit, limit)


def periodic_gate(time, period, width, start=0.0):
    """判断时间点是否位于周期门控的高电平窗口内。

    参数：
        time：当前仿真时刻，单位秒。
        period：门控重复周期，单位秒。
        width：每周期高电平持续时间，单位秒。
        start：门控起始时刻，单位秒。

    返回：
        位于高电平窗口时返回 ``True``，否则返回 ``False``。
    """
    cycle = as_float(period)
    if cycle <= 0.0:
        return False
    elapsed = as_float(time) - as_float(start)
    if elapsed < 0.0:
        return False
    high_width = clamp(width, 0.0, cycle)
    return math.fmod(elapsed, cycle) < high_width


def pulse_train(time, amplitude, period, width, start=0.0, low_value=0.0):
    """生成指定时刻的矩形脉冲序列采样值。

    参数：
        time：当前仿真时刻，单位秒。
        amplitude：高电平脉冲幅度。
        period：脉冲重复周期，单位秒。
        width：脉冲宽度，单位秒。
        start：脉冲序列起始时刻，单位秒。
        low_value：低电平阶段输出值。

    返回：
        高电平窗口内返回 ``amplitude``，其余时间返回 ``low_value``。
    """
    return as_float(amplitude) if periodic_gate(time, period, width, start) else as_float(low_value)


def deterministic_noise(seed, step_index=0, time=0.0):
    """生成可复现的伪随机噪声。

    参数：
        seed：随机序列种子；相同种子产生相同序列。
        step_index：仿真步序号。
        time：当前仿真时刻，单位秒。

    返回：
        范围为 ``[-1, 1)`` 的浮点噪声样本。
    """
    phase = as_float(seed) * 12.9898 + as_float(step_index) * 78.233 + as_float(time) * 5.173
    raw = math.sin(phase) * 43758.5453
    return (raw - math.floor(raw)) * 2.0 - 1.0


def deterministic_gaussian_noise(seed, step_index=0, time=0.0):
    """Return a reproducible, zero-mean unit-variance Gaussian noise sample.

    RF source noise is evaluated once for every simulation sample.  Converting
    two independent deterministic uniform values with Box-Muller keeps runs
    repeatable while producing the broadband noise floor expected by the
    spectrum analyzer.
    """
    uniform_a = (deterministic_noise(seed, step_index, time) + 1.0) * 0.5
    uniform_b = (deterministic_noise(seed + 104729, step_index + 13007, time + 0.61803398875) + 1.0) * 0.5
    uniform_a = min(max(uniform_a, 1e-12), 1.0 - 1e-12)
    return math.sqrt(-2.0 * math.log(uniform_a)) * math.cos(2.0 * math.pi * uniform_b)

def select_rf_switch_n(inputs, number=0, mode=1):
    """射频多选N"""
    mode = max(1, int(mode))
    return inputs[(mode-1)*number:number*mode]

__all__ = [
    "apply_envelope_band_stop_filter",
    "apply_envelope_low_pass_filter",
    "as_float",
    "adc_convert_rf",
    "adc_codes_to_normalized_iq",
    "amplify_rf_excitation",
    "amplify_rf_final_power_2",
    "amplify_rf_power",
    "amplify_rf_relay",
    "amplify_rf_signal",
    "band_pass_fir_filter",
    "band_pass_rf_filter",
    "band_stop_rf_filter",
    "clamp",
    "combine_split_rf_power",
    "control_rf_beam_array",
    "control_rf_channel_amplitude_phase",
    "control_signal_amplitude_phase",
    "dac_convert_rf",
    "dbf_form_baseband_signal",
    "deterministic_noise",
    "deterministic_gaussian_noise",
    "downconvert_rf_signal",
    "extract_complex_envelope_pulse_features",
    "first_numeric",
    "first_order_response",
    "high_pass_rf_filter",
    "limit_rf_amplitude",
    "low_pass_rf_filter",
    "multiplex_wavelength_division",
    "normalized_iq_to_dac_codes",
    "periodic_gate",
    "power_combine",
    "pulse_train",
    "process_rf_frontend",
    "rate_limit",
    "select_excitation_signal",
    "select_rf_switch",
    "sp2t_switch",
    "split_rf_power_2_to_8",
    "control_excitation_power_split",
    "select_rf_switch_n",
    "upconvert_rf_signal",
]
