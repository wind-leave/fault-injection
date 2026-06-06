"""
Module: vehicle_dynamics
Description: Reduced-order vertical and roll dynamics
"""


def process(
    left_thrust: float,
    right_thrust: float,
    mass: float = 8.0,
    drag: float = 0.12
):
    total_thrust = left_thrust + right_thrust
    # @observable
    roll_moment = right_thrust - left_thrust  # roll moment
    vertical_accel = total_thrust / max(mass, 0.1) - drag
    return vertical_accel, roll_moment
