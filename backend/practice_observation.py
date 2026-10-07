def _arr(value):
    return value if isinstance(value, list) else []


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def _point_type(point):
    value = _text((point or {}).get("pointType") or (point or {}).get("type")).lower()
    return value if value in {"physical", "virtual"} else "physical"


def _find_point(d_matrix, point_code):
    for point in _arr((d_matrix or {}).get("points")):
        if _text(point.get("shortName")) == point_code or _text(point.get("pointId")) == point_code:
            return point
    return {}


def find_point(d_matrix, point_code):
    return _find_point(d_matrix, point_code)


def point_type(d_matrix, point_code):
    return _point_type(_find_point(d_matrix, point_code))


def compare_physical_snapshots(before, after):
    before_abnormal = set(_arr((before or {}).get("abnormalPointCodes")))
    after_abnormal = set(_arr((after or {}).get("abnormalPointCodes")))
    recovered = sorted(before_abnormal - after_abnormal)
    remaining = sorted(after_abnormal)
    unchanged = sorted(before_abnormal & after_abnormal)
    new_abnormal = sorted(after_abnormal - before_abnormal)
    if not isinstance(before, dict) or not isinstance(after, dict) or (not before and not after):
        status = "unknown"
    elif not remaining and recovered:
        status = "recovered"
    elif recovered:
        status = "improved"
    elif new_abnormal:
        status = "worse"
    elif remaining or unchanged:
        status = "unchanged"
    else:
        status = "unchanged"
    return {
        "effective": bool(recovered) and status in {"recovered", "improved"},
        "recoveredPointCodes": recovered,
        "newAbnormalPointCodes": new_abnormal,
        "remainingAbnormalPointCodes": remaining,
        "unchangedAbnormalPointCodes": unchanged,
        "status": status,
    }
