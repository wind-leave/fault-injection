from backend.schemas import SimulationBackendError, ensure_number


def _text(value, fallback=""):
    if value is None:
        return fallback
    result = str(value).strip()
    return result or fallback


def _normalized_action_type(action):
    return _text(action.get("actionType") or action.get("type")).replace("_", "").replace("-", "").lower()


def _target_id(action):
    return _text(
        action.get("targetId")
        or action.get("componentId")
        or action.get("nodeId")
        or action.get("edgeId")
        or action.get("lineId")
    )


class PracticeActionRuntime:
    def __init__(self, simulation_session):
        self.simulation_session = simulation_session

    def skipped(self, action, warning="action skipped by business rules"):
        return {
            "status": "skipped",
            "actionType": action.get("actionType") or "",
            "changes": [],
            "warnings": [warning],
        }

    def apply(self, action):
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")

        action_type = _normalized_action_type(action)
        if action_type in {"replacecomponent", "repaircomponent"}:
            changes = self._replace_component(action)
        elif action_type == "replacewire":
            changes = self._replace_wire(action)
        elif action_type == "disconnectline":
            changes = self._disconnect_line(action)
        elif action_type == "reconnectline":
            changes = self._reconnect_line(action)
        elif action_type == "resetdevice":
            changes = self._reset_device(action)
        elif action_type == "adjustparameter":
            changes = self._adjust_parameters(action)
        else:
            return {
                "status": "ignored",
                "actionType": action.get("actionType") or "",
                "changes": [],
                "warnings": ["action does not modify simulation state"],
            }

        return {
            "status": "applied",
            "actionType": action.get("actionType") or "",
            "changes": changes,
            "warnings": [],
        }

    def _require_target(self, action, field):
        target_id = _target_id(action)
        if not target_id:
            raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} is required")
        return target_id

    def _require_node(self, node_id, field="targetId"):
        node = self.simulation_session.graph.nodes.get(node_id)
        if node is None:
            raise SimulationBackendError("TARGET_NOT_FOUND", field, f"node not found: {node_id}")
        return node

    def _require_edge(self, edge_id, field="targetId"):
        edge = next((item for item in self.simulation_session.graph.edges if item.id == edge_id), None)
        if edge is None:
            raise SimulationBackendError("TARGET_NOT_FOUND", field, f"edge not found: {edge_id}")
        return edge

    def _disable_target_faults(self, target_id):
        changes = []
        for fault in self.simulation_session.fault_runtime.fault_instances:
            if _text(fault.get("targetId")) != target_id or not bool(fault.get("enabled", True)):
                continue
            fault["enabled"] = False
            changes.append({
                "type": "fault_disabled",
                "faultId": fault.get("faultId") or "",
                "targetId": fault.get("targetId") or "",
                "previousEnabled": True,
                "newEnabled": False,
            })
        return changes

    def _replace_component(self, action):
        node_id = self._require_target(action, "targetId")
        self._require_node(node_id, "target.id")
        changes = self._disable_target_faults(node_id)
        changes.append({
            "type": "component_replaced",
            "componentId": node_id,
            "clearedFaultIds": [change["faultId"] for change in changes],
        })
        return changes

    def _replace_wire(self, action):
        edge_id = self._require_target(action, "targetId")
        self._require_edge(edge_id, "target.id")
        changes = self._disable_target_faults(edge_id)
        self.simulation_session.fault_runtime.reconnect_edge(edge_id)
        changes.append({
            "type": "wire_replaced",
            "wireId": edge_id,
            "clearedFaultIds": [change["faultId"] for change in changes],
        })
        return changes

    def _disconnect_line(self, action):
        edge_id = self._require_target(action, "targetId")
        self._require_edge(edge_id)
        self.simulation_session.fault_runtime.disconnect_edge(edge_id)
        return [{"type": "line_disconnected", "edgeId": edge_id}]

    def _reconnect_line(self, action):
        edge_id = self._require_target(action, "targetId")
        self._require_edge(edge_id)
        self.simulation_session.fault_runtime.reconnect_edge(edge_id)
        return [{"type": "line_reconnected", "edgeId": edge_id}]

    def _reset_device(self, action):
        node_id = self._require_target(action, "targetId")
        self._require_node(node_id)
        removed_modes = []
        for mode, states in self.simulation_session.module_states.items():
            if node_id in states:
                removed_modes.append(mode)
                states.pop(node_id, None)
        removed_previous = []
        for key in list(self.simulation_session.previous_values):
            if len(key) == 2 and key[1] == node_id:
                removed_previous.append(key[0])
                self.simulation_session.previous_values.pop(key, None)
        related_edges = [
            edge.id
            for edge in self.simulation_session.graph.edges
            if edge.source_node_id == node_id or edge.target_node_id == node_id
        ]
        for edge_id in related_edges:
            self.simulation_session.fault_runtime.edge_state.pop(edge_id, None)
        return [{
            "type": "device_state_reset",
            "nodeId": node_id,
            "clearedModes": removed_modes,
            "clearedPreviousValueModes": removed_previous,
            "clearedEdgeStateIds": related_edges,
        }]

    def _adjust_parameters(self, action):
        node_id = self._require_target(action, "targetId")
        node = self._require_node(node_id)
        updates = {}
        if isinstance(action.get("parameters"), dict):
            updates.update(action["parameters"])
        parameter = _text(action.get("parameter") or action.get("parameterName"))
        if parameter:
            if "value" not in action:
                raise SimulationBackendError("INVALID_SCHEMA", "value", "value is required")
            updates[parameter] = action.get("value")
        if not updates:
            raise SimulationBackendError("INVALID_SCHEMA", "parameter", "parameter or parameters is required")

        changes = []
        for name, raw_value in updates.items():
            parameter_name = _text(name)
            if not parameter_name:
                raise SimulationBackendError("INVALID_SCHEMA", "parameter", "parameter name is required")
            new_value = ensure_number(raw_value, f"parameters.{parameter_name}")
            old_value = node.parameters.get(parameter_name)
            node.parameters[parameter_name] = new_value
            changes.append({
                "type": "parameter_updated",
                "nodeId": node_id,
                "parameter": parameter_name,
                "previousValue": old_value,
                "newValue": new_value,
            })
        return changes
