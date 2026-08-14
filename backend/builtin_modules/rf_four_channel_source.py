"""四通道同步脉冲射频数据源仿真组件。"""

import math


def process(
    sample_1=1.0,
    sample_2=0.8,
    sample_3=0.6,
    sample_4=0.4,
    center_frequency_hz=100.0,
    pulse_width_seconds=1e-3,
    pulse_period_seconds=1e-3,
    phase_deg=0.0,
    time=0.0,
):
    """按仿真时间输出四路同步脉冲射频采样值。

    四个 ``sample_*`` 参数分别是四路载波的幅度。各路共用中心频率、
    脉宽、重周和初始相位；脉冲窗口外的输出为 0。
    """
    period = max(0.0, float(pulse_period_seconds))
    width = min(period, max(0.0, float(pulse_width_seconds)))
    if period <= 0.0 or width <= 0.0:
        return {"outputs": {"rf_samples": [0.0, 0.0, 0.0, 0.0]}}

    current_time = float(time)
    in_pulse = math.fmod(current_time, period) < width
    if not in_pulse:
        return {"outputs": {"rf_samples": [0.0, 0.0, 0.0, 0.0]}}

    phase = 2.0 * math.pi * max(0.0, float(center_frequency_hz)) * current_time
    phase += math.radians(float(phase_deg))
    carrier = math.cos(phase)
    return {
        "outputs": {
            "rf_samples": [
                float(sample_1) * carrier,
                float(sample_2) * carrier,
                float(sample_3) * carrier,
                float(sample_4) * carrier,
            ],
        },
    }
