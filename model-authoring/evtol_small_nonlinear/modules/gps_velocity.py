"""
Module: gps_velocity
Description: GPS velocity channel with held-sample freeze approximation
"""


def process(true_velocity: float, held_velocity: float = 0.0, freeze: float = 0.0):
    # @observable
    reported_velocity = held_velocity if freeze >= 1.0 else true_velocity  # gps report
    return reported_velocity
