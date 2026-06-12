"""
Module: airspeed_sensor
Description: Airspeed sensor model with bias and scale parameters.
"""


def process(true_airspeed: float, bias: float = 0.0, scale: float = 1.0):
    # @observable
    measured_airspeed = (true_airspeed + bias) * scale
    return measured_airspeed
