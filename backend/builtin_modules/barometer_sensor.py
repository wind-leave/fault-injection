"""
Module: barometer_sensor
Description: Barometric altitude sensor with bias and scale parameters.
"""


def process(true_altitude=0.0, bias=0.0, scale=1.0):
    measured_altitude = (float(true_altitude) + float(bias)) * float(scale)
    return {
        "outputs": {
            "measured_altitude": measured_altitude,
        },
    }
