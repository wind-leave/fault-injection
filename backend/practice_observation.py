import math


DEFAULT_OBSERVATION_RULE = {
    "method": "absoluteDelta",
    "normalThreshold": 0.05,
    "abnormalThreshold": 0.2,
}


def _arr(value):
    return value if isinstance(value, list) else []


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def _number(value, fallback):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return fallback
    return float(value)


def _point_code(action):
    return _text(action.get("pointCode") or action.get("shortName") or action.get("pointId"))


def _find_point(d_matrix, point_code):
    for point in _arr((d_matrix or {}).get("points")):
        if _text(point.get("shortName")) == point_code or _text(point.get("pointId")) == point_code:
            return point
    return {}


def _resolve_rule(point):
    raw_rule = point.get("observationRule") if isinstance(point, dict) else None
    raw_rule = raw_rule if isinstance(raw_rule, dict) else {}
    return {
        "method": _text(raw_rule.get("method")) or DEFAULT_OBSERVATION_RULE["method"],
        "normalThreshold": _number(raw_rule.get("normalThreshold"), DEFAULT_OBSERVATION_RULE["normalThreshold"]),
        "abnormalThreshold": _number(raw_rule.get("abnormalThreshold"), DEFAULT_OBSERVATION_RULE["abnormalThreshold"]),
        "channel": _text(raw_rule.get("channel")),
    }


def _channel(point, rule, action):
    return rule.get("channel") or _text(point.get("channel")) or _text(action.get("targetId"))


def _series(channels, name):
    values = channels.get(name)
    return values if isinstance(values, list) else []


def evaluate_observation(d_matrix, action, simulation_result):
    point_code = _point_code(action)
    point = _find_point(d_matrix, point_code)
    rule = _resolve_rule(point)
    channel = _channel(point, rule, action)
    channels = ((simulation_result or {}).get("curves") or {}).get("channels") or {}
    actual = _series(channels, f"{channel}.actual")
    reference = _series(channels, f"{channel}.reference")

    base = {
        "pointCode": point_code,
        "pointId": point.get("pointId") or "",
        "channel": channel,
        "method": rule["method"],
        "normalThreshold": rule["normalThreshold"],
        "abnormalThreshold": rule["abnormalThreshold"],
        "source": "backend",
    }
    if not actual or not reference:
        return {
            **base,
            "observed": "unknown",
            "metricValue": None,
            "reason": "missing-channel-data",
        }

    sample_count = min(len(actual), len(reference))
    if sample_count <= 0:
        return {
            **base,
            "observed": "unknown",
            "metricValue": None,
            "reason": "missing-channel-data",
        }

    metric_value = max(abs(float(actual[index]) - float(reference[index])) for index in range(sample_count))
    if metric_value <= rule["normalThreshold"]:
        observed = "normal"
        reason = "metric-below-normal-threshold"
    elif metric_value >= rule["abnormalThreshold"]:
        observed = "abnormal"
        reason = "metric-above-abnormal-threshold"
    else:
        observed = "unknown"
        reason = "metric-between-thresholds"
    return {
        **base,
        "observed": observed,
        "metricValue": metric_value,
        "reason": reason,
    }
