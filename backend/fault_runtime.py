class FaultRuntime:
    def __init__(self, fault_instances):
        self.fault_instances = list(fault_instances or [])
        self.edge_state = {}
        self.started_fault_ids = set()
        self.ended_fault_ids = set()
        self.disconnected_edge_ids = set()

    def disconnect_edge(self, edge_id):
        self.disconnected_edge_ids.add(edge_id)

    def reconnect_edge(self, edge_id):
        self.disconnected_edge_ids.discard(edge_id)

    def _is_active(self, fault, time):
        if not fault.get("enabled", True):
            return False
        start = float(fault.get("startTime", 0.0))
        duration = float(fault.get("duration", 0.0))
        end = start + max(duration, 0.0)
        return time >= start and (duration == 0.0 or time <= end)

    def apply_node_output(self, node_id, value, time):
        result = float(value)
        for fault in self.fault_instances:
            if fault.get("targetId") != node_id or not self._is_active(fault, time):
                continue
            params = fault.get("parameters") or {}
            fault_type = fault.get("faultType")
            if fault_type == "sensor_bias":
                result += float(params.get("bias", 0.0))
            elif fault_type == "noise_increase":
                amplitude = float(params.get("amplitude", 0.1))
                result += amplitude
            elif fault_type == "signal_stuck":
                result = float(params.get("value", result))
            elif fault_type == "motor_efficiency_loss":
                result *= float(params.get("efficiency", 0.5))
            elif fault_type == "parameter_bias":
                result += float(params.get("bias", params.get("delta_p", 0.1)))
                result *= float(params.get("scale", 1.0))
            elif fault_type == "parameter_step":
                result += float(params.get("stepValue", params.get("step_value", 0.1)))
            elif fault_type == "parameter_drift":
                start = float(fault.get("startTime", params.get("start", 0.0)))
                result += float(params.get("rate", 0.01)) * max(0.0, time - start)
        return result

    def apply_edge_value(self, edge_id, value, time):
        result = float(value)
        state = self.edge_state.setdefault(edge_id, {"last": result})
        if edge_id in self.disconnected_edge_ids:
            state["last"] = 0.0
            return 0.0
        for fault in self.fault_instances:
            if fault.get("targetId") != edge_id or not self._is_active(fault, time):
                continue
            fault_type = fault.get("faultType")
            if fault_type == "link_loss":
                result = float(state.get("last", result))
            elif fault_type == "link_delay":
                queue = state.setdefault("queue", [])
                queue.append(result)
                delay_steps = int((fault.get("parameters") or {}).get("delaySteps", 1))
                result = queue.pop(0) if len(queue) > delay_steps else float(state.get("last", result))
        state["last"] = result
        return result

    def collect_events(self, time):
        events = []
        for fault in self.fault_instances:
            fault_id = fault.get("faultId", "")
            if not fault_id:
                continue
            active = self._is_active(fault, time)
            if active and fault_id not in self.started_fault_ids:
                self.started_fault_ids.add(fault_id)
                events.append({"time": time, "type": "fault_started", "relatedFaultId": fault_id})
            start = float(fault.get("startTime", 0.0))
            duration = float(fault.get("duration", 0.0))
            if (
                duration > 0
                and fault_id in self.started_fault_ids
                and time > start + duration
                and fault_id not in self.ended_fault_ids
            ):
                self.ended_fault_ids.add(fault_id)
                events.append({"time": time, "type": "fault_ended", "relatedFaultId": fault_id})
        return events
