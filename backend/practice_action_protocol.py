from backend.schemas import SimulationBackendError


SUPPORTED_ACTION_TARGETS = {
    "replaceComponent": "component",
    "replaceWire": "wire",
    "measurePoint": "testPoint",
}


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def _require_text(payload, field):
    value = _text(payload.get(field))
    if not value:
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", field, f"{field} is required")
    return value


def _validate_steps(value):
    if value is None:
        return 1
    if isinstance(value, bool) or not isinstance(value, int):
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", "steps", "steps must be an integer")
    if value < 1 or value > 1000:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "steps", "steps is outside the allowed range")
    return value


def normalize_practice_action(action):
    if not isinstance(action, dict):
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", "action", "action must be an object")

    action_type = _require_text(action, "actionType")
    expected_target_type = SUPPORTED_ACTION_TARGETS.get(action_type)
    if expected_target_type is None:
        raise SimulationBackendError("UNSUPPORTED_ACTION_TYPE", "actionType", f"unsupported action type: {action_type}")

    target = action.get("target")
    if not isinstance(target, dict):
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", "target", "target must be an object")

    target_type = _require_text(target, "type")
    if target_type != expected_target_type:
        raise SimulationBackendError(
            "INVALID_ACTION_SCHEMA",
            "target.type",
            f"target.type must be {expected_target_type} for {action_type}",
        )
    target_id = _require_text(target, "id")
    normalized = {
        "protocolVersion": _text(action.get("protocolVersion")) or "1.0",
        "operationId": _text(action.get("operationId")),
        "actionType": action_type,
        "target": {"type": target_type, "id": target_id},
        "targetId": target_id,
        "steps": _validate_steps(action.get("steps")),
        "safetyState": action.get("safetyState") if isinstance(action.get("safetyState"), dict) else {},
        "rawAction": action.get("rawAction") if isinstance(action.get("rawAction"), dict) else {},
    }
    if action_type == "measurePoint":
        normalized["pointCode"] = _require_text(action, "pointCode")
    else:
        fault_id = _text(action.get("faultId"))
        if fault_id:
            normalized["faultId"] = fault_id
    client_time = _text(action.get("clientTime"))
    if client_time:
        normalized["clientTime"] = client_time
    return normalized
