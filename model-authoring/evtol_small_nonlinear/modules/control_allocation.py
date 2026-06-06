"""
Module: control_allocation
Description: Convert total thrust and roll command into left and right motor references
"""


def process(total_thrust: float, roll_command: float):
    # @observable
    left_cmd = total_thrust * 0.5 - roll_command * 0.5  # left motor command
    # @observable
    right_cmd = total_thrust * 0.5 + roll_command * 0.5  # right motor command
    return left_cmd, right_cmd
