"""
Module: barometer
Description: Barometric altitude channel with drift
"""


def process(altitude: float, drift: float = 0.0):
    # @observable
    estimated_altitude = altitude + drift  # barometer estimate
    return estimated_altitude
