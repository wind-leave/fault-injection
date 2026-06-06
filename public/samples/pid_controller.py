"""
Module: pid_controller
Description: PID 控制器计算模块
"""


def process(
    error: float,           # 输入：误差信号
    dt: float = 0.01,       # 输入：时间步长
    kp: float = 1.0,        # 输入：比例系数
    ki: float = 0.1,        # 输入：积分系数
    kd: float = 0.05        # 输入：微分系数
) -> tuple:
    """
    主处理函数，系统将自动识别此函数作为模块的计算入口。
    """
    # @observable
    integral = error * dt

    # @observable
    derivative = error / dt if dt else 0.0

    output = kp * error + ki * integral + kd * derivative

    # @observable
    saturated_output = max(-1.0, min(1.0, output))

    return output, saturated_output
