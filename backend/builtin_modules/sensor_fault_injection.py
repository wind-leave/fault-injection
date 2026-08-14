def process(attitude=0.0, body_rate=0.0, altitude=0.0):
    residual = abs(float(attitude)) * 0.04 + abs(float(body_rate)) * 0.08
    return {
        "outputs": {
            "attitude_feedback": float(attitude),
            "rate_feedback": float(body_rate),
            "altitude_feedback": float(altitude),
        },
        "state": {},
        "middleVars": {"sensor_residual": residual},
    }
