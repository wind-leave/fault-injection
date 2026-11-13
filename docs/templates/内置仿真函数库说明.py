"""内置仿真函数接口说明。实际实现位于 backend/simulation_functions.py。"""


# 复数包络

def coerce_envelope(value):
    """统一字段和数值类型，补齐参考频率、阻抗和单位的默认值。

    参数：
        value: 单路包络字典。I/Q 可用 i/q 或 re/im。缺省 I/Q 和参考频率按 0 处理。

    返回：
        字典，字段固定为
        i、q                同相、正交分量（float）
        referenceFrequencyHz 参考频率（float，Hz，负值按 0 处理）
        impedanceOhm        阻抗（float，Ω，缺省或非正时为 50.0）
        unit                幅值单位（str，缺省为 "V"）
    """
    ...


def is_envelope_collection(value):
    """判断输入是否是 Python 列表。

    参数：
        value: 要判断的对象。只检查它是否为列表。

    返回：
        bool。value 是列表时为 True，其余为 False。
    """
    ...


def coerce_envelope_collection(value):
    """规范化单路或多路 I/Q 包络，并保持输入结构。

    参数：
        value: 单路包络字典或非空包络列表。

    返回：
        单路返回规范化包络字典，多路返回等长的包络列表。
        每个包络的字段同 coerce_envelope。
    """
    ...


def coerce_envelope_vector(value, length=4):
    """检查输入路数并规范化每一路包络。

    参数：
        value: 要检查并规范化的包络列表。
        length: 要求的通道路数，必须为正，默认 4。

    返回：
        list，包含 length 个规范化包络字典，顺序与输入相同。
        每个包络的字段同 coerce_envelope。
    """
    ...


def map_envelopes(value, transform):
    """规范化包络，再逐路执行自定义变换。

    参数：
        value: 要处理的单路包络字典或非空包络列表。
        transform: 逐路调用的函数，接收规范化包络和从 0 开始的通道索引。

    返回：
        单路返回 transform(envelope, 0) 的结果，多路按通道顺序返回结果列表。
        元素类型由 transform 决定。
    """
    ...


def map_envelope_vector(value, transform, length=4):
    """校验固定路数，再逐路执行自定义变换。

    参数：
        value: 要处理的固定路数包络列表。
        transform: 逐路调用的函数，接收规范化包络和从 0 开始的通道索引。
        length: 要求的通道路数，必须为正，默认 4。

    返回：
        长度为 length 的列表，按通道顺序存放 transform 的结果。
    """
    ...


def with_iq(envelope, i_value, q_value):
    """复制包络并替换 I/Q，保留规范化后的参考频率、阻抗和单位。

    参数：
        envelope: 要保留其参考频率、阻抗和单位的原始包络。
        i_value: 替换后的同相分量。
        q_value: 替换后的正交分量。

    返回：
        一个包络字典，字段同 coerce_envelope。i、q 为指定的新值，其他字段来自原包络的规范化结果。
    """
    ...


def magnitude(envelope):
    """计算 sqrt(I² + Q²)。

    参数：
        envelope: 用于计算线性幅值的单路包络。

    返回：
        float，sqrt(i² + q²)。
    """
    ...


def rotate_iq(i_value, q_value, phase_rad):
    """旋转 I/Q 向量，正角度为逆时针。

    参数：
        i_value: 旋转前的同相分量。
        q_value: 旋转前的正交分量。
        phase_rad: 旋转角，单位为弧度，正值为逆时针。

    返回：
        (rotated_i, rotated_q) 元组，两项依次为旋转后的同相、正交分量。
    """
    ...


def apply_envelope_gain(input_envelope, gain_db=0.0):
    """将每路 I/Q 同比乘以 10 ** (gain_db / 20)。

    参数：
        input_envelope: 待放大的单路包络字典或非空包络列表。
        gain_db: 电压增益，单位 dB。0 dB 保持原幅度。

    返回：
        单路返回包络字典，多路返回等长列表。字段同 coerce_envelope，
        其中 i、q 为增益处理后的值，参考频率、阻抗和单位沿用输入。
    """
    ...


def apply_envelope_amplitude_phase_modulation(
    input_envelope,
    amplitude_scale=1.0,
    phase_shift_deg=0.0,
):
    """对各路 I/Q 缩放和旋转，负幅度倍率按 0 处理。

    参数：
        input_envelope: 待调制的单路包络字典或非空包络列表。
        amplitude_scale: 线性幅度倍率，负值按 0 处理。
        phase_shift_deg: 相移，单位度，正值为逆时针。

    返回：
        单路返回包络字典，多路返回等长列表。字段同 coerce_envelope，
        其中 i、q 为缩放和旋转后的分量，参考频率、阻抗和单位沿用输入。
    """
    ...


def apply_envelope_upconversion(
    input_envelope,
    lo_frequency_hz=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """在参考频率上加本振频率，并对 I/Q 施加相移和增益。

    参数：
        input_envelope: 待上变频的单路包络字典或非空包络列表。
        lo_frequency_hz: 本振频率，单位 Hz，负值按 0 处理。
        lo_phase_deg: 本振相位，单位度，用于旋转 I/Q。
        conversion_gain: 线性幅度增益，负值按 0 处理。

    返回：
        单路返回包络字典，多路返回等长列表。字段同 coerce_envelope，
        其中 i、q 为变换后的分量，referenceFrequencyHz 为输入参考频率加本振频率。
    """
    ...


def apply_envelope_downconversion(
    input_envelope,
    lo_frequency_hz=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """将参考频率设为差频的绝对值，按差频方向处理相移和频谱反转。

    参数：
        input_envelope: 待下变频的单路包络字典或非空包络列表。
        lo_frequency_hz: 本振频率，单位 Hz，用于计算输入参考频率与本振的差频。
        lo_phase_deg: 本振相位，单位度，实际旋转方向由差频符号决定。
        conversion_gain: 线性幅度增益，负值按 0 处理。

    返回：
        单路返回包络字典，多路返回等长列表。字段同 coerce_envelope，
        其中 i、q 为变换后的分量，referenceFrequencyHz 为差频的绝对值。
    """
    ...


def apply_envelope_low_pass_filter(
    input_envelope,
    cutoff_frequency_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """逐路对 I/Q 做一阶低通，参考频率变化时重置对应通道历史。

    参数：
        input_envelope: 待滤波的单路包络字典或非空包络列表。
        cutoff_frequency_hz: I/Q 低通截止频率，单位 Hz。
        dt: 相邻仿真步间隔，单位秒，用来计算平滑系数。
        state: 上次返回的状态字典，首次调用可传 None。

    返回：
        {"outputs": {"filtered_envelope": [...]}, "state": {"lanes": [...]}}
        outputs.filtered_envelope 为各路滤波后的包络列表，单路输入也返回一项列表。
        state.lanes 为下一步的逐路状态，每项含 output_i、output_q、referenceFrequencyHz。
    """
    ...


def apply_envelope_band_pass_filter(
    input_envelope,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """根据各路参考频率判断通带，平滑通带内信号并抑制通带外信号。

    参数：
        input_envelope: 待滤波的单路包络字典或非空包络列表。
        center_frequency_hz: 射频通带中心频率，单位 Hz。
        bandwidth_hz: 通带总宽度，单位 Hz，通带为中心频率 ± 半带宽。
        dt: 相邻仿真步间隔，单位秒，非正时直接使用本步目标值。
        state: 上次返回的状态字典，首次调用可传 None。

    返回：
        {"outputs": {"filtered_envelope": [...]}, "state": {"lanes": [...]}}
        outputs.filtered_envelope 为各路带通后的包络列表，单路输入也返回一项列表。
        state.lanes 为下一步的逐路状态，每项含 output_i 和 output_q。
    """
    ...


def apply_envelope_band_stop_filter(
    input_envelope,
    center_frequency_hz=1_000_000.0,
    bandwidth_hz=100_000.0,
    dt=0.0,
    state=None,
):
    """根据各路参考频率判断阻带，抑制阻带内信号并保留阻带外信号。

    参数：
        input_envelope: 待滤波的单路包络字典或非空包络列表。
        center_frequency_hz: 射频阻带中心频率，单位 Hz。
        bandwidth_hz: 阻带总宽度，单位 Hz，阻带为中心频率 ± 半带宽。
        dt: 相邻仿真步间隔，单位秒，非正时直接使用本步目标值。
        state: 上次返回的状态字典，首次调用可传 None。

    返回：
        {"outputs": {"filtered_envelope": [...]}, "state": {"lanes": [...]}}
        outputs.filtered_envelope 为各路带阻后的包络列表，单路输入也返回一项列表。
        state.lanes 为下一步的逐路状态，每项含 output_i 和 output_q。
    """
    ...


def power_divide(input_envelope, output_count):
    """按 1 / sqrt(路数) 缩放每路 I/Q，实现等功率分配。

    参数：
        input_envelope: 待分配的一路包络字典。
        output_count: 等功率分配的输出路数，须为正整数或整数值浮点数。

    返回：
        长度为 output_count 的包络列表。每项字段同 coerce_envelope，i、q 为分配后该路的分量。
    """
    ...


def power_combine(input_envelopes):
    """相干求和 I/Q，再按 1 / sqrt(路数) 缩放。

    参数：
        input_envelopes: 待合路的包络列表，至少两路且路数为偶数，各路参考频率、阻抗和单位须一致。

    返回：
        一个包络字典，字段同 coerce_envelope。i、q 为合路后的分量，
        参考频率、阻抗和单位取自第一路输入。
    """
    ...


def limit_envelope_amplitude(input_envelope, limit_amplitude):
    """超限时等比例缩小 I/Q，保持相位。

    参数：
        input_envelope: 待限幅的单路包络字典或非空包络列表。
        limit_amplitude: 每路线性幅值上限，负值按 0 处理。

    返回：
        单路返回限幅后的包络字典，多路返回等长列表。包络字段同 coerce_envelope。
    """
    ...


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
    """用 FFT 估计中心频率，用幅值越过门限的时刻检测脉冲。

    参数：
        input_envelope: 单路或多路包络。多路时选第一路非零包络，全为零时用最后一路。
        fft_size: 用于基带频率估计的 FFT 点数，调整为至少 4 的 2 的整数次幂。
        adc_full_scale: 对应 ADC 码 255 的包络幅度满量程。
        envelope_threshold_adc: 判定脉冲有效的 ADC 门限，限制在 0 到 255。
        envelope_smoothing: 幅度平滑系数，限制在 0 到 1，值为 1 时直接使用当前幅度。
        time: 当前仿真时刻，单位秒，用于记录脉冲边沿。
        dt: 仿真步长，单位秒，用于将 FFT 频点换算成 Hz。
        state: 上次返回的状态字典，首次调用可传 None。

    返回：
        {"outputs": {...}, "state": {...}}
        outputs 的字段
            center_frequency_hz      参考频率加带符号基带峰频（Hz）
            pulse_period_seconds     相邻上升沿的间隔（秒）
            pulse_width_seconds      最近完整脉冲的宽度（秒）
            pulse_amplitude_adc       当前或最近一次脉冲的峰值码（0 到 255）
            pulse_count               累计检测到的上升沿数量
        state 供下一步原样传回，含以下字段
            samples                  FFT 采样缓冲区，元素为复数
            sample_write_index       环形缓冲区的下一写入索引
            samples_since_fft        距上次 FFT 更新后的样本计数
            fft_size                 实际 FFT 点数
            sample_period            用于 FFT 的采样周期（秒）
            reference_frequency_hz   当前参考频率（Hz）
            baseband_frequency_hz    最近一次估计的带符号基带频率（Hz）
            envelope                 平滑后的检测幅值（ADC 码刻度）
            active                   本步是否处于脉冲高电平窗口
            rising_time              最近上升沿的时刻（秒），未检测到时为 None
            previous_rising_time     再前一个上升沿的时刻（秒），缺失时为 None
            pulse_period_seconds、pulse_width_seconds、pulse_count 同 outputs。
            pulse_peak 为正在检测的脉冲峰值码，pulse_amplitude_adc 为最近已完成脉冲的峰值码。
    """
    ...


# 频谱、量化和数模转换

def floor_power_of_two(value):
    """把 FFT 点数等配置调整为基 2 算法支持的长度。

    参数：
        value: 待下调的数值，例如用户填写的 FFT 点数。

    返回：
        int，不大于有效输入的最大 2 的整数次幂。输入小于 1 或无效时为 1。
    """
    ...


def fft_radix2(values):
    """计算基 2 快速傅里叶变换。

    参数：
        values: 实数或复数时域样本序列，长度须为正的 2 的整数次幂。

    返回：
        list[complex]，长度与输入相同。第 k 项为第 k 个 FFT 频点的复数值。
    """
    ...


def estimate_fft_peak_frequency(samples, sample_period, window="hann"):
    """在单边 FFT 中搜索主峰，跳过直流和奈奎斯特点。

    参数：
        samples: 等间隔实数采样，样本数须为 2 的整数次幂。
        sample_period: 相邻采样的间隔，单位秒。
        window: 窗函数，hann 为汉宁窗，rectangular 为矩形窗。

    返回：
        float，最强正频点（Hz）。样本不足 4 个或采样周期非正时返回 0.0。
    """
    ...


def estimate_complex_fft_positive_peak_frequency(samples, sample_period, window="hann"):
    """搜索复数频谱的正频主峰，排除负频混频镜像。

    参数：
        samples: 等间隔 I+jQ 复数样本，样本数须为 2 的整数次幂。
        sample_period: 相邻采样的间隔，单位秒。
        window: 窗函数，hann 为汉宁窗，rectangular 为矩形窗。

    返回：
        float，最强正频点（Hz）。样本不足 4 个或采样周期非正时返回 0.0。
    """
    ...


def quantize_bipolar_sample(sample, full_scale_amplitude=1.0, maximum_code=255):
    """将双极性幅度线性映射成无符号码，超量程时饱和。

    参数：
        sample: 待量化的双极性模拟采样。
        full_scale_amplitude: 正、负满量程幅度的绝对值。
        maximum_code: 无符号码上限，例如 8 位对应 255。

    返回：
        int，无符号码。负满量程映射到 0，正满量程映射到有效最大码值。
    """
    ...


def dequantize_bipolar_code(code, full_scale_amplitude=1.0, maximum_code=255):
    """限制码值范围，再反向换算模拟幅度。

    参数：
        code: 要恢复为模拟幅度的无符号码值。
        full_scale_amplitude: 应与量化时使用的正、负满量程绝对幅度一致。
        maximum_code: 应与量化时使用的最大码值一致。

    返回：
        float，按无符号码恢复的模拟幅度，位于正负满量程之间。
    """
    ...


def adc_convert_rf(sample, resolution_bits=12, full_scale_amplitude=1.0, offset=0.0):
    """叠加输入偏置后进行双极性饱和量化。

    参数：
        sample: 待量化的模拟采样。
        resolution_bits: ADC 量化位数，限制在 1 到 32。
        full_scale_amplitude: 输入正、负满量程幅度的绝对值。
        offset: 在量化之前加到输入上的直流偏置。

    返回：
        int，范围为 0 到 2 ** 有效位数 - 1。满量程为 0 时返回 0。
    """
    ...


def dac_convert_rf(code, resolution_bits=12, full_scale_amplitude=1.0, offset=0.0):
    """对数字码取整、限幅并恢复模拟幅度，再加输出偏置。

    参数：
        code: 待转换的无符号数字码。
        resolution_bits: DAC 转换位数，限制在 1 到 32。
        full_scale_amplitude: 输出正、负满量程幅度的绝对值。
        offset: 在数字码转换为模拟量之后加上的直流偏置。

    返回：
        float，换算后的模拟幅度加 offset。满量程为 0 时返回 offset。
    """
    ...


def adc_codes_to_normalized_iq(
    i_code,
    q_code,
    resolution_bits=12,
    full_scale_amplitude=1.0,
    i_offset=0.0,
    q_offset=0.0,
):
    """分别恢复 I/Q 幅度，去除量化前偏置，再按满量程归一化。

    参数：
        i_code: I 路 ADC 码。
        q_code: Q 路 ADC 码。
        resolution_bits: 两路 ADC 的量化位数。
        full_scale_amplitude: ADC 输入满量程幅度的绝对值，用于恢复幅度和归一化。
        i_offset: I 路 ADC 量化前所加的偏置，恢复时减去。
        q_offset: Q 路 ADC 量化前所加的偏置，恢复时减去。

    返回：
        (i_normalized, q_normalized) 元组，两项均限制在 [-1, 1]。满量程为 0 时返回 (0.0, 0.0)。
    """
    ...


def normalized_iq_to_dac_codes(i_value, q_value, resolution_bits=12, full_scale_amplitude=1.0):
    """限制归一化幅度并分别量化 I/Q。

    参数：
        i_value: 归一化同相分量，限制在 [-1, 1]。
        q_value: 归一化正交分量，限制在 [-1, 1]。
        resolution_bits: 两路 DAC 的位数。
        full_scale_amplitude: 两路 DAC 输出满量程幅度的绝对值。

    返回：
        (i_code, q_code) 整数元组，依次为 I 路和 Q 路的 DAC 输入码。满量程为 0 时返回 (0, 0)。
    """
    ...


# 实数射频放大、功分和开关

def limit_rf_amplitude(sample, maximum_amplitude):
    """对正负幅度做对称限幅。

    参数：
        sample: 待限幅的实数时域采样。
        maximum_amplitude: 输出绝对幅度上限，负值按绝对值处理。

    返回：
        float，限制在 [-abs(maximum_amplitude), abs(maximum_amplitude)] 内的样本。
    """
    ...


def amplify_rf_signal(sample, gain_db=0.0, maximum_amplitude=None):
    """按 dB 增益放大实数射频采样。

    参数：
        sample: 待放大的实数时域采样。
        gain_db: 幅度增益，单位 dB。
        maximum_amplitude: 可选的输出绝对幅度上限，None 时不做饱和限幅。

    返回：
        float，按 gain_db 放大后的样本。设置幅度上限时为对称限幅后的样本。
    """
    ...


def amplify_rf_excitation(sample, gain_db=0.0, maximum_output_amplitude=None):
    """模拟激励级或驱动级放大。

    参数：
        sample: 待放大的激励级或驱动级采样。
        gain_db: 驱动级幅度增益，单位 dB。
        maximum_output_amplitude: 可选的输出绝对幅度上限，None 时不做饱和限幅。

    返回：
        float，按驱动级增益放大并按需限幅的激励样本。
    """
    ...


def amplify_rf_power(
    sample,
    gain_db=0.0,
    maximum_output_power_watts=None,
    impedance_ohms=50.0,
):
    """按功率和阻抗换算正弦峰值电压上限，模拟功放饱和。

    参数：
        sample: 输入正弦信号的瞬时电压样本。
        gain_db: 功放增益，单位 dB。
        maximum_output_power_watts: 可选的最大平均输出功率，单位 W，用于换算峰值电压上限。
        impedance_ohms: 负载阻抗，单位 Ω，默认 50 Ω。

    返回：
        float，放大后的瞬时电压。设置功率上限时按 sqrt(2 * P * R) 对称限幅。
    """
    ...


def amplify_rf_final_power_2(
    small_signal_inputs,
    gate_controls=None,
    gain_db=0.0,
    maximum_output_power_watts=None,
    impedance_ohms=50.0,
    gate_threshold=0.5,
):
    """按栅极状态分别模拟两路末级功放。

    参数：
        small_signal_inputs: 两路小信号序列或给两路共用的单个输入，序列缺项按 0 补齐。
        gate_controls: 各路栅极控制量或公共控制量，None 时默认两路导通。
        gain_db: 每路功放增益，单位 dB。
        maximum_output_power_watts: 可选的每路最大平均输出功率，单位 W。
        impedance_ohms: 每路负载阻抗，单位 Ω。
        gate_threshold: 数值型栅极控制量的导通阈值，达到阈值即导通。

    返回：
        (output_1, output_2) 元组，依次为两路末级功放输出电压。未导通的支路为 0.0。
    """
    ...


def amplify_rf_relay(sample, gain_db=0.0, enabled=True, maximum_output_amplitude=None):
    """模拟中继放大及可选饱和限幅。

    参数：
        sample: 待放大的输入样本。
        gain_db: 中继幅度增益，单位 dB。
        enabled: 中继使能，为假时关闭输出。
        maximum_output_amplitude: 可选的输出绝对幅度上限。

    返回：
        float，使能时为放大并按需限幅的样本，关闭时为 0.0。
    """
    ...


def combine_split_rf_power(input_samples, output_count=1, insertion_loss_db=0.0):
    """将输入相干相加，再计入插损并分配到各路。

    参数：
        input_samples: 待相干合路的同频实数电压样本序列。
        output_count: 合路后的等功率输出路数，最小为 1。
        insertion_loss_db: 分配链路的总插入损耗，单位 dB。

    返回：
        实数列表，长度为有效输出路数。各项为合路总幅度经插损和等功率分配后的同值样本。
    """
    ...


def split_rf_power_2_to_8(input_a, input_b, insertion_loss_db=0.0):
    """将两路输入分别等功率分成四路。

    参数：
        input_a: A 组的实数输入样本。
        input_b: B 组的实数输入样本。
        insertion_loss_db: 每组功分链路的总插入损耗，单位 dB。

    返回：
        [A1, A2, A3, A4, B1, B2, B3, B4]，前四项属于 A 组，后四项属于 B 组。
    """
    ...


def control_excitation_power_split(
    excitation_sample,
    output_enables=None,
    gain_db=0.0,
    insertion_loss_db=0.0,
):
    """先放大激励，再在开启的支路间等功率分配。

    参数：
        excitation_sample: 待放大和功分的激励样本。
        output_enables: 各支路的使能序列，None 时默认启用八路。
        gain_db: 功分前的激励放大增益，单位 dB。
        insertion_loss_db: 功分链路的总插入损耗，单位 dB。

    返回：
        tuple，长度与使能序列相同。开启的支路为对应功分幅度，关闭的支路为 0.0。
    """
    ...


def sp2t_switch(input_sample, selected_throw=0, off_value=0.0):
    """单刀双掷选路，无效索引时两路都输出 off_value。

    参数：
        input_sample: 单刀端的输入样本。
        selected_throw: 掷端索引，0 选第一路，1 选第二路。
        off_value: 未选通端使用的输出值。

    返回：
        (output_1, output_2) 元组。选第一路时为 (signal, off_value)，
        选第二路时为 (off_value, signal)，索引无效时两项均为 off_value。
    """
    ...


def select_rf_switch(inputs, selected_index=0, default=0.0):
    """实现射频多选一。

    参数：
        inputs: 可选择的射频样本序列。
        selected_index: 选通输入的零基索引。
        default: 输入缺失、选择无效或样本不可转换时的备用值。

    返回：
        float，选中的样本。选择或样本无效时为 default。
    """
    ...


def select_excitation_signal(excitation_inputs, selected_index=0, enabled=True, default=0.0):
    """实现带使能控制的激励选路。

    参数：
        excitation_inputs: 可选择的激励样本序列。
        selected_index: 选通输入的零基索引。
        enabled: 激励选择使能，为假时直接输出备用值。
        default: 关闭、选择无效或样本不可转换时的备用值。

    返回：
        float，选中的样本。未使能、选择无效或样本无效时为 default。
    """
    ...


def select_rf_switch_n(inputs, number=0, mode=1):
    """按组选择连续的多个射频输入。

    参数：
        inputs: 可按下标切片的输入序列。
        number: 每组包含的连续输入项数。
        mode: 要选取的组号，从 1 开始。

    返回：
        inputs[(mode - 1) * number : mode * number]，mode 最小按 1 处理。
        返回类型由输入序列的切片类型决定，末组可少于 number 项。
    """
    ...


def multiplex_wavelength_division(channel_samples, wavelengths_nm):
    """按下标将样本与波长配对，长度取两序列较短者。

    参数：
        channel_samples: 各光通道的数值样本序列。
        wavelengths_nm: 按相同顺序给出的通道波长序列，单位 nm。

    返回：
        ((wavelength_nm, sample), ...) 元组。每项先放波长（nm），再放同下标的通道样本。
    """
    ...


# 实数滤波、混频和 I/Q 波束控制

def low_pass_rf_filter(sample, previous_output, cutoff_frequency_hz, dt):
    """执行一阶低通，截止频率或步长非正时保持上一输出。

    参数：
        sample: 当前实数输入样本。
        previous_output: 上一步低通输出，用作滤波状态。
        cutoff_frequency_hz: 低通截止频率，单位 Hz。
        dt: 仿真步长，单位秒。

    返回：
        float，本步低通输出。截止频率或步长非正时返回上一输出。
    """
    ...


def high_pass_rf_filter(sample, previous_input, previous_output, cutoff_frequency_hz, dt):
    """执行一阶高通，截止频率为负或步长非正时保持上一输出。

    参数：
        sample: 当前实数输入样本。
        previous_input: 上一步输入样本，用于计算输入变化量。
        previous_output: 上一步高通输出，用作滤波状态。
        cutoff_frequency_hz: 高通截止频率，单位 Hz，允许为 0。
        dt: 仿真步长，单位秒。

    返回：
        float，本步高通输出。截止频率为负或步长非正时返回上一输出。
    """
    ...


def band_pass_rf_filter(
    sample,
    previous_input,
    previous_high_pass_output,
    previous_output,
    low_cutoff_frequency_hz,
    high_cutoff_frequency_hz,
    dt,
):
    """将一阶高通与低通串联，保留指定频段。

    参数：
        sample: 当前实数输入样本。
        previous_input: 上一步输入样本。
        previous_high_pass_output: 上一步高通级输出，用作高通状态。
        previous_output: 上一步带通输出，用作低通级状态。
        low_cutoff_frequency_hz: 通带下截止频率，单位 Hz，允许为 0。
        high_cutoff_frequency_hz: 通带上截止频率，单位 Hz，须大于下截止频率。
        dt: 仿真步长，单位秒。

    返回：
        (high_pass_output, band_pass_output) 元组，依次为本步高通级和带通级输出。
        频段无效或步长非正时返回对应的两个历史值。
    """
    ...


def band_stop_rf_filter(
    sample,
    previous_input,
    previous_high_pass_output,
    previous_output,
    low_cutoff_frequency_hz,
    high_cutoff_frequency_hz,
    dt,
):
    """用当前输入减去对应的带通分量，抑制指定频段。

    参数：
        sample: 当前实数输入样本。
        previous_input: 上一步输入样本。
        previous_high_pass_output: 上一步高通级输出，用于计算带通分量。
        previous_output: 上一步带阻输出，用于恢复上一带通分量。
        low_cutoff_frequency_hz: 阻带下截止频率，单位 Hz，允许为 0。
        high_cutoff_frequency_hz: 阻带上截止频率，单位 Hz，须大于下截止频率。
        dt: 仿真步长，单位秒。

    返回：
        float，本步带阻输出，即当前样本减去带通分量。频段无效或步长非正时返回上一带阻输出。
    """
    ...


def band_pass_fir_filter(
    sample,
    center_frequency_hz,
    bandwidth_hz,
    dt,
    state=None,
    tap_count=129,
):
    """执行带 Blackman 窗的线性相位 FIR 带通滤波。

    参数：
        sample: 当前实数输入样本。
        center_frequency_hz: 设计通带的中心频率，单位 Hz。
        bandwidth_hz: 设计通带的总宽度，单位 Hz。
        dt: 仿真步长，单位秒，用于确定采样率和奈奎斯特频率。
        state: 上一调用返回的状态字典，首次调用可传 None。
        tap_count: FIR 抽头数，应为至少 3 的奇数，无效时使用 129。

    返回：
        (filtered_sample, next_state, metadata) 三元组
            filtered_sample      当前滤波样本（float）
            next_state           下一步状态，含 configuration、input_history、taps
                configuration    [采样率 Hz, 实际下截止频率 Hz, 实际上截止频率 Hz, 抽头数]
                input_history    保留到下一步的历史输入样本
                taps             FIR 抽头系数列表
            metadata             low_cutoff_hz、high_cutoff_hz 为实际截止频率，
                                 group_delay_samples 为以采样点计的群时延。
        步长或通带无效时，样本为 0.0，状态为空字典，metadata 三个值均为 0.0。
    """
    ...


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
    """将实数射频信号与正交本振混频，可再做基带低通。

    参数：
        rf_sample: 当前实数射频采样。
        lo_frequency_hz: 本振频率，单位 Hz。
        time: 当前仿真时刻，单位秒，用于计算瞬时本振相位。
        lo_phase_deg: 本振初相位，单位度。
        conversion_gain: 线性幅度转换增益。
        previous_output_iq: 上一步低通后的 (I, Q)，用于延续两路滤波状态。
        low_pass_cutoff_hz: 可选的基带低通截止频率，单位 Hz，None 时直接返回混频结果。
        dt: 仿真步长，单位秒，仅用于可选的低通滤波。

    返回：
        (output_i, output_q) 浮点元组。设置了低通截止频率时，两项均为低通后的分量。
    """
    ...


def upconvert_rf_signal(
    input_iq,
    lo_frequency_hz,
    time=0.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
):
    """将基带信号与正交本振混频，合成实数射频输出。

    参数：
        input_iq: 当前基带信号，可为 (I, Q)、复数或实数。
        lo_frequency_hz: 本振频率，单位 Hz。
        time: 当前仿真时刻，单位秒，用于计算瞬时本振相位。
        lo_phase_deg: 本振初相位，单位度。
        conversion_gain: 线性幅度转换增益。

    返回：
        float，线性增益乘以 I * cos(本振相位) - Q * sin(本振相位) 得到的实数样本。
    """
    ...


def control_signal_amplitude_phase(input_signal, amplitude_scale=1.0, phase_shift_deg=0.0):
    """将输入乘以幅度倍率和相位角的余弦，计算同相投影。

    参数：
        input_signal: 待调节的实数样本。
        amplitude_scale: 线性幅度倍率。
        phase_shift_deg: 相位偏移，单位度，用于计算同相投影。

    返回：
        float，input_signal * amplitude_scale * cos(相位偏移)。
    """
    ...


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
    """对单阵元做幅相控制、波束扫描相移和可选的输出低通。

    参数：
        input_iq: 当前阵元的 (I, Q) 输入。
        previous_output_iq: 本阵元上一步的 (I, Q) 输出，用于延续滤波状态。
        input_gain_db: 输入放大增益，单位 dB。
        amplitude_weight: 本阵元的线性幅度权重。
        phase_weight_deg: 本阵元的附加相位权重，单位度。
        scan_angle_deg: 波束扫描角，单位度。
        element_index: 当前阵元的零基序号，用于计算扫描相位。
        element_spacing_wavelength: 阵元间距，以工作波长为单位。
        output_filter_cutoff_hz: 可选的输出低通截止频率，单位 Hz。
        dt: 仿真步长，单位秒，仅用于可选的输出低通。

    返回：
        (output_i, output_q) 浮点元组，依次为本阵元幅相控制及可选滤波后的 I/Q。
    """
    ...


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
    """逐阵元做幅相控制和波束扫描相移，可对各路输出低通。

    参数：
        channel_inputs: 各阵元的 (I, Q) 输入序列。
        previous_outputs_iq: 上一步的各阵元输出，用于延续各路滤波状态。
        input_gain_db: 各阵元共用的输入增益，单位 dB。
        amplitude_weights: 逐阵元线性幅度权重序列，缺项默认 1。
        phase_weights_deg: 逐阵元相位权重序列，单位度，缺项默认 0。
        scan_angle_deg: 波束扫描角，单位度。
        element_spacing_wavelength: 阵元间距，以工作波长为单位。
        output_filter_cutoff_hz: 可选的每通道输出低通截止频率，单位 Hz。
        dt: 仿真步长，单位秒，仅用于可选的输出低通。

    返回：
        ((output_i, output_q), ...) 元组。每项为一个阵元的输出，顺序和长度与输入一致。
    """
    ...


def dbf_form_baseband_signal(samples, amplitude_weights=None, phase_weights_deg=None):
    """逐路做幅相加权后直接求和，完成数字波束形成。

    参数：
        samples: 通道基带样本序列，每项可为 (I, Q)、复数或实数。
        amplitude_weights: 逐通道线性幅度权重，缺项默认 1。
        phase_weights_deg: 逐通道相位权重，单位度，缺项默认 0。

    返回：
        (total_i, total_q) 浮点元组，为各通道加权后的同相、正交分量之和。
    """
    ...


def process_rf_frontend(
    input_iq,
    previous_output_iq=(0.0, 0.0),
    enabled=True,
    lna_gain_db=0.0,
    maximum_output_amplitude=None,
    output_filter_cutoff_hz=None,
    dt=0.0,
):
    """模拟射频前端增益、矢量限幅及可选的输出滤波。

    参数：
        input_iq: 当前基带 (I, Q) 输入。
        previous_output_iq: 上一步 (I, Q) 输出，用于延续滤波状态。
        enabled: 前端使能，为假时关闭输出。
        lna_gain_db: 低噪声放大器的幅度增益，单位 dB。
        maximum_output_amplitude: 可选的 I/Q 合成矢量幅值上限。
        output_filter_cutoff_hz: 可选的输出低通截止频率，单位 Hz。
        dt: 仿真步长，单位秒，仅用于可选的输出低通。

    返回：
        (output_i, output_q) 浮点元组。未使能时返回 (0.0, 0.0)，否则为前端处理后的 I/Q。
    """
    ...


# 通用数值、动态响应和信号生成

def as_float(value, default=0.0):
    """将数值或字符串安全转换为浮点数。

    参数：
        value: 要转换的数值或字符串。
        default: 转换失败或结果非有限时使用的值，可传 None。

    返回：
        转换成功时返回有限 float。转换失败或结果非有限时返回 float(default)，default 为 None 时返回 None。
    """
    ...


def clamp(value, minimum, maximum):
    """对数值限幅，上下限反序时自动交换。

    参数：
        value: 待限制的数值。
        minimum: 闭区间的下限。
        maximum: 闭区间的上限。

    返回：
        float，限制在有效下限和上限之间的数值。
    """
    ...


def first_numeric(parameters, keys, fallback=0.0):
    """按优先级从多个参数名中读取数值。

    参数：
        parameters: 待读取的参数字典，可传 None。
        keys: 按优先级排列的候选键名序列。
        fallback: 未找到有效值时使用的备用值。

    返回：
        float，第一个有效数值。未找到时返回 fallback 转换后的数值。
    """
    ...


def first_order_response(previous, target, time_constant, dt):
    """计算一阶惯性环节，按 dt / (时间常数 + dt) 向目标靠近。

    参数：
        previous: 上一仿真步的输出。
        target: 本步目标值。
        time_constant: 惯性环节的时间常数，单位秒，非正时无惯性。
        dt: 仿真步长，单位秒，非正时保持上一输出。

    返回：
        float，本步响应。步长非正时为上一输出，步长为正且时间常数非正时为目标值。
    """
    ...


def rate_limit(previous, target, rise_rate, fall_rate, dt):
    """按变化方向限制单步最大变化量。

    参数：
        previous: 上一仿真步的输出。
        target: 本步目标值。
        rise_rate: 上升的最大速率，单位为幅度每秒。
        fall_rate: 下降的最大速率，单位为幅度每秒。
        dt: 仿真步长，单位秒，用于将速率换算为单步最大变化量。

    返回：
        float，从上一输出朝目标移动后的新值，单步变化量受相应速率限制。
    """
    ...


def periodic_gate(time, period, width, start=0.0):
    """按周期判断门控窗口，窗口包含起点并排除终点。

    参数：
        time: 待判断的当前时刻，单位秒。
        period: 门控重复周期，单位秒。
        width: 每周期高电平持续时间，单位秒。
        start: 门控开始时刻，单位秒。

    返回：
        bool。当前时刻落在高电平窗口内时为 True，其他情况为 False。
    """
    ...


def pulse_train(time, amplitude, period, width, start=0.0, low_value=0.0):
    """生成矩形脉冲序列的单步样本。

    参数：
        time: 要取样的当前时刻，单位秒。
        amplitude: 高电平脉冲幅度。
        period: 脉冲重复周期，单位秒。
        width: 每周期高电平持续时间，单位秒。
        start: 首个脉冲的开始时刻，单位秒。
        low_value: 未处于高电平窗口时的低电平幅度。

    返回：
        float。高电平窗口内返回 amplitude，其他时刻返回 low_value。
    """
    ...


def deterministic_noise(seed, step_index=0, time=0.0):
    """从同一组输入生成可复现的噪声。

    参数：
        seed: 控制伪随机序列的种子。
        step_index: 当前仿真步序号，用于区分不同采样步。
        time: 当前仿真时刻，单位秒，也参与确定样本值。

    返回：
        float，范围为 [-1, 1) 的伪随机样本。
    """
    ...


def deterministic_gaussian_noise(seed, step_index=0, time=0.0):
    """用 Box–Muller 变换生成高斯噪声。

    参数：
        seed: 控制伪随机序列的种子。
        step_index: 当前仿真步序号，用于区分不同采样步。
        time: 当前仿真时刻，单位秒，也参与确定样本值。

    返回：
        float，零均值、单位方差的高斯噪声样本。
    """
    ...


# 库内部辅助函数

def _estimate_envelope_baseband_frequency(samples, sample_period):
    """对包络做 Hann 窗 FFT，为脉冲特征提取提供频率估计。

    参数：
        samples: 用于 FFT 的等间隔复数包络样本。
        sample_period: 相邻采样间隔，单位秒，用于换算基带频率。

    返回：
        float，最强的带符号基带频率（Hz）。样本不足、点数不合规或采样周期非正时返回 0.0。
    """
    ...


def _as_iq_sample(sample):
    """统一基带样本表示，实数用作 I 并将 Q 设为 0。

    参数：
        sample: 待拆分的实数、复数或 I/Q 序列。

    返回：
        (i, q) 浮点元组。复数取实部和虚部，I/Q 序列取前两项，实数的 q 为 0.0。
    """
    ...


def _weight_at(weights, index, default):
    """为阵列幅相控制和波束形成读取逐路权重。

    参数：
        weights: 逐通道权重序列，可传 None。
        index: 要取权重的通道索引。
        default: 对应项缺失或无效时的备用权重。

    返回：
        float，指定通道的有效权重。缺项或无效时使用 default。
    """
    ...


def _valid_rf_band(low_cutoff_frequency_hz, high_cutoff_frequency_hz):
    """检查下限非负且上限大于下限。

    参数：
        low_cutoff_frequency_hz: 频段的下截止频率，单位 Hz，须非负。
        high_cutoff_frequency_hz: 频段的上截止频率，单位 Hz，须大于下截止频率。

    返回：
        (low_cutoff, high_cutoff) 浮点元组。频段无效时返回 None。
    """
    ...


def _split_rf_power(sample, output_count, insertion_loss_db = 0.0):
    """计算含插入损耗的功分幅度。

    参数：
        sample: 待分配的单路实数射频采样。
        output_count: 输出路数，最小为 1。
        insertion_loss_db: 功分链路的总插入损耗，单位 dB。

    返回：
        实数列表，长度为有效路数。每项为同一个计入插入损耗的功分幅度。
    """
    ...
