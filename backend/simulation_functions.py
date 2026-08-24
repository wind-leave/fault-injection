"""后端射频仿真函数库。

本模块仅依赖 Python 标准库，兼容 Python 3.8.10。后续仿真组件可直接导入
本文件中的函数；每个函数的文档字符串均说明输入参数和返回值。
"""

import math


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

def select_rf_switch_n(inputs, number=0, mode=1):
    """射频多选N"""
    mode = max(1, int(mode))
    return inputs[(mode-1)*number:number*mode]

__all__ = [
    "as_float",
    "adc_convert_rf",
    "adc_codes_to_normalized_iq",
    "amplify_rf_excitation",
    "amplify_rf_final_power_2",
    "amplify_rf_power",
    "amplify_rf_relay",
    "amplify_rf_signal",
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
    "downconvert_rf_signal",
    "first_numeric",
    "first_order_response",
    "high_pass_rf_filter",
    "limit_rf_amplitude",
    "low_pass_rf_filter",
    "multiplex_wavelength_division",
    "normalized_iq_to_dac_codes",
    "periodic_gate",
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
