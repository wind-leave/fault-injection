"""DZDK_B: scalar limiter."""


def process(socket01=0.0, lower_limit=-1.0, upper_limit=1.0):
    lower = float(lower_limit)
    upper = float(upper_limit)
    if lower > upper:
        lower, upper = upper, lower
    return {"socket02": max(lower, min(upper, float(socket01)))}
