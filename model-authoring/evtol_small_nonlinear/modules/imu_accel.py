"""
Module: imu_accel
Description: Accelerometer sensing with scale distortion
"""


def process(vertical_accel: float, scale: float = 1.0, offset: float = 0.0):
    # @observable
    measured_accel = vertical_accel * scale + offset  # accel measurement
    return measured_accel
