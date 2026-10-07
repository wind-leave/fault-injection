from backend.schemas import SimulationBackendError


SUPPORTED_ACTION_TARGETS = {
    "adjustDisplayConsoleParameter": "displayConsole",
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


def _measurement_endpoint(action):
    component_id = _require_text(action, "componentId")
    port_id = _require_text(action, "portId")
    return {"componentId": component_id, "portId": port_id}


def _wire_endpoints(action):
    fields = {
        "sourceComponentId": _text(action.get("sourceComponentId") or action.get("sourceDeviceId")),
        "sourcePortId": _text(action.get("sourcePortId") or action.get("sourcePort")),
        "targetComponentId": _text(action.get("targetComponentId") or action.get("targetDeviceId")),
        "targetPortId": _text(action.get("targetPortId") or action.get("targetPort")),
    }
    if not any(fields.values()):
        return None
    missing = [field for field, value in fields.items() if not value]
    if missing:
        raise SimulationBackendError(
            "INVALID_ACTION_SCHEMA",
            missing[0],
            "replaceWire requires sourceComponentId, sourcePortId, targetComponentId and targetPortId",
        )
    return fields


def normalize_practice_action(action):
    if not isinstance(action, dict):
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", "action", "action must be an object")

    action_type = _require_text(action, "actionType")
    expected_target_type = SUPPORTED_ACTION_TARGETS.get(action_type)
    if expected_target_type is None:
        raise SimulationBackendError("UNSUPPORTED_ACTION_TYPE", "actionType", f"unsupported action type: {action_type}")

    target = action.get("target")
    endpoint = _measurement_endpoint(action) if action_type == "measurePoint" else None
    wire_endpoints = _wire_endpoints(action) if action_type == "replaceWire" else None
    if not isinstance(target, dict):
        if action_type == "measurePoint":
            target = {"type": expected_target_type, "id": f"{endpoint['componentId']}::{endpoint['portId']}"}
        elif action_type == "replaceWire" and wire_endpoints is not None:
            target = {"type": expected_target_type}
        else:
            raise SimulationBackendError("INVALID_ACTION_SCHEMA", "target", "target must be an object")

    target_type = _require_text(target, "type")
    if target_type != expected_target_type:
        raise SimulationBackendError(
            "INVALID_ACTION_SCHEMA",
            "target.type",
            f"target.type must be {expected_target_type} for {action_type}",
        )
    target_id = _text(target.get("id"))
    if not target_id and action_type == "measurePoint":
        target_id = f"{endpoint['componentId']}::{endpoint['portId']}"
    if not target_id and wire_endpoints is None:
        raise SimulationBackendError("INVALID_ACTION_SCHEMA", "target.id", "target.id is required")
    normalized = {
        "protocolVersion": _text(action.get("protocolVersion")) or "1.0",
        "operationId": _text(action.get("operationId")),
        "actionType": action_type,
        "target": {
            "type": target_type,
            **({"id": target_id} if target_id else {}),
        },
        **({"targetId": target_id} if target_id else {}),
        "steps": _validate_steps(action.get("steps")),
        "safetyState": action.get("safetyState") if isinstance(action.get("safetyState"), dict) else {},
        "rawAction": action.get("rawAction") if isinstance(action.get("rawAction"), dict) else {},
    }
    if wire_endpoints is not None:
        normalized.update(wire_endpoints)
    if action_type == "measurePoint":
        normalized.update(endpoint)
        normalized["elementName"] = _require_text(action, "elementName")
    elif action_type == "adjustDisplayConsoleParameter":
        parameters = action.get("parameters") if isinstance(action.get("parameters"), dict) else {}
        parameter = _text(action.get("parameter") or action.get("parameterName"))
        if parameter:
            if "value" not in action:
                raise SimulationBackendError("INVALID_ACTION_SCHEMA", "value", "value is required")
            parameters = {**parameters, parameter: action.get("value")}
        if not parameters:
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "parameters",
                "parameters or parameter/value is required",
            )
        if len(parameters) != 1:
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "parameters",
                "only one display-console parameter may be adjusted per action",
            )
        normalized["parameters"] = dict(parameters)
        component_id = _text(action.get("componentId") or action.get("targetComponentId"))
        if component_id:
            normalized["componentId"] = component_id
    else:
        fault_id = _text(action.get("faultId"))
        if fault_id:
            normalized["faultId"] = fault_id
    client_time = _text(action.get("clientTime"))
    if client_time:
        normalized["clientTime"] = client_time
    return normalized
