"""
Module: motor_model
Description: Motor efficiency and saturation model
"""


def process(
    left_cmd: float,
    right_cmd: float,
    efficiency: float = 1.0,
    left_lock: float = 0.0,
    saturation: float = 20.0
):
    # @observable
    left_efficiency = 0.0 if left_lock >= 1.0 else efficiency  # left motor availability
    # @observable
    left_thrust = min(max(left_cmd * left_efficiency, 0.0), saturation)  # left thrust
    # @observable
    right_thrust = min(max(right_cmd * efficiency, 0.0), saturation)  # right thrust
    return left_thrust, right_thrust
