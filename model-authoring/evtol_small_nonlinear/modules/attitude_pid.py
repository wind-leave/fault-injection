"""
Module: attitude_pid
Description: Simplified attitude PID control block
"""


def process(
    attitude_error: float,
    rate_feedback: float,
    dt: float = 0.01,
    kp: float = 1.2,
    ki: float = 0.25,
    kd: float = 0.08
):
    # @observable
    integral_state = attitude_error * dt  # integral state
    # @observable
    derivative_state = -rate_feedback * kd  # derivative term
    command = kp * attitude_error + ki * integral_state + derivative_state
    return command
