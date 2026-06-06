"""
Module: imu_gyro
Description: Gyro sensing with optional bias injection
"""


def process(body_rate: float, bias: float = 0.0, scale: float = 1.0):
    # @observable
    measured_rate = (body_rate + bias) * scale  # gyro measurement
    return measured_rate
