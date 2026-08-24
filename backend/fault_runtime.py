import copy
import hashlib


class FaultRuntime:
    def __init__(self, fault_instances):
        self.fault_instances = list(fault_instances or [])
        self.edge_state = {}
        self.frozen_parameters = {}
        self.frozen_signals = {}
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

    @staticmethod
    def _parameter_key(fault):
        key = str(fault.get("parameterKey") or fault.get("targetParameter") or "").strip()
        if key:
            return key
        target_field = str(fault.get("targetField") or "").strip()
        normalized_target_field = target_field.lower()
        for prefix in ("params.", "parameter.", "parameters."):
            if normalized_target_field.startswith(prefix):
                return target_field[len(prefix):]
        return ""

    def _is_module_parameter_fault(self, fault):
        return bool(self._parameter_key(fault)) and fault.get("injectionForm") == "module-variable"

    @staticmethod
    def _signal_binding_name(fault):
        return str(
            fault.get("bindingObject")
            or fault.get("targetVariable")
            or ""
        ).strip().lower()

    def _matches_node_signal(self, fault, node_id, direction, signal_name, is_primary):
        if fault.get("targetId") != node_id or self._is_module_parameter_fault(fault):
            return False
        target_field = str(fault.get("targetField") or "").strip().lower()
        normalized_name = str(signal_name or "").strip().lower()
        if not target_field:
            return bool(is_primary)
        return target_field == f"{direction}.{normalized_name}" or (
            self._signal_binding_name(fault) == normalized_name
        )

    def _frozen_signal_value(self, fault, target_id, target_field, value, cycle=None):
        key = (str(fault.get("faultId", "")), str(target_id), str(target_field), cycle)
        if key not in self.frozen_signals:
            self.frozen_signals[key] = copy.deepcopy(value)
        return copy.deepcopy(self.frozen_signals[key])

    @staticmethod
    def _zero_like(value):
        if isinstance(value, list):
            return [FaultRuntime._zero_like(item) for item in value]
        return 0.0

    @staticmethod
    def _vector_injection_scope(fault):
        scope = str(fault.get("vectorInjectionScope", fault.get("vectorScope", ""))).strip().lower()
        if scope == "item":
            return "item"
        return "items" if scope in {"items", "selected", "partial"} else "all"

    @staticmethod
    def _vector_injection_index(fault, length):
        try:
            index = int(fault.get("vectorIndex", 0))
        except (TypeError, ValueError):
            index = 0
        return min(max(index, 0), max(length - 1, 0))

    @classmethod
    def _vector_injection_indices(cls, fault, length):
        raw_indices = fault.get("vectorIndices")
        if not isinstance(raw_indices, list):
            raw_indices = [fault.get("vectorIndex", 0)]
        indices = []
        for raw_index in raw_indices:
            try:
                index = min(max(int(raw_index), 0), max(length - 1, 0))
            except (TypeError, ValueError):
                continue
            if index not in indices:
                indices.append(index)
        return indices

    def _apply_vector_fault(self, fault, target_id, target_field, value, time, apply_item):
        scope = self._vector_injection_scope(fault)
        if scope == "item":
            index = self._vector_injection_index(fault, len(value))
            return [
                apply_item(f"{target_field}[{item_index}]", item) if item_index == index else copy.deepcopy(item)
                for item_index, item in enumerate(value)
            ]
        if scope == "items":
            indices = set(self._vector_injection_indices(fault, len(value)))
            return [
                apply_item(f"{target_field}[{item_index}]", item) if item_index in indices else copy.deepcopy(item)
                for item_index, item in enumerate(value)
            ]
        return [
            apply_item(f"{target_field}[{item_index}]", item)
            for item_index, item in enumerate(value)
        ]

    def _apply_signal_fault(self, fault, target_id, target_field, value, time):
        if isinstance(value, list):
            return self._apply_vector_fault(
                fault,
                target_id,
                target_field,
                value,
                time,
                lambda item_field, item: self._apply_signal_fault(fault, target_id, item_field, item, time),
            )
        params = fault.get("parameters") or {}
        fault_type = fault.get("faultType")
        result = float(value)
        # Keep the original output-level physical fault behaviour for legacy
        # packages that do not name a concrete signal field.
        if fault_type == "motor_efficiency_loss":
            return result * float(params.get("efficiency", 1.0))
        if fault_type == "parameter_bias":
            return (result + float(params.get("bias", params.get("delta_p", 0.0)))) * float(
                params.get("scale", 1.0)
            )
        if fault_type == "parameter_step":
            return result + float(params.get("stepValue", params.get("step_value", 0.0)))
        if fault_type == "parameter_drift":
            start = float(fault.get("startTime", params.get("start", 0.0)))
            return result + float(params.get("rate", 0.0)) * max(0.0, time - start)
        if fault_type == "sensor_bias":
            return result + float(params.get("bias", 0.0))
        if fault_type == "signal_attenuation":
            if "scale" in params:
                return result * float(params.get("scale", 1.0))
            attenuation_db = max(0.0, float(params.get("attenuation_db", params.get("attenuationDb", 0.0))))
            return result * (10.0 ** (-attenuation_db / 20.0))
        if fault_type == "noise_increase":
            amplitude = float(params.get("amplitude", params.get("std", 0.1)))
            return result + self._bounded_noise(
                params.get("seed", 1),
                fault.get("faultId", ""),
                time,
            ) * abs(amplitude)
        if fault_type == "signal_stuck":
            if "value" in params:
                return float(params["value"])
            return self._frozen_signal_value(fault, target_id, target_field, result)
        if fault_type == "signal_cutoff":
            return 0.0
        if fault_type == "intermittent":
            start = float(fault.get("startTime", params.get("start", 0.0)))
            period = max(float(params.get("period", 1.0)), 1e-9)
            duty = min(1.0, max(0.0, float(params.get("duty", 0.5))))
            elapsed = max(0.0, time - start)
            if (elapsed % period) / period >= duty:
                return result
            mode = str(params.get("mode", "hold")).strip().lower()
            if mode in {"bias", "add"}:
                return result + float(params.get("bias", 0.0))
            if mode in {"noise", "random"}:
                amplitude = float(params.get("amplitude", params.get("std", 0.1)))
                return result + self._bounded_noise(
                    params.get("seed", 1),
                    fault.get("faultId", ""),
                    time,
                ) * abs(amplitude)
            if mode == "zero":
                return 0.0
            if mode in {"multiply", "scale"}:
                return result * float(params.get("scale", 1.0))
            cycle = int(elapsed / period)
            return self._frozen_signal_value(fault, target_id, target_field, result, cycle)
        return result

    def _apply_parameter_fault(self, fault, parameter_key, target_field, value, time):
        if isinstance(value, list):
            return self._apply_vector_fault(
                fault,
                fault.get("targetId", ""),
                target_field,
                value,
                time,
                lambda item_field, item: self._apply_parameter_fault(
                    fault, parameter_key, item_field, item, time
                ),
            )
        params = fault.get("parameters") or {}
        result = float(value)
        fault_type = fault.get("faultType")
        if fault_type == "parameter_bias":
            return result + float(params.get("bias", params.get("delta_p", 0.0)))
        if fault_type == "parameter_degradation":
            return result * float(params.get("scale", 1.0))
        if fault_type == "parameter_step":
            return result + float(params.get("stepValue", params.get("step_value", params.get("step", 0.0))))
        if fault_type == "parameter_drift":
            start = float(fault.get("startTime", params.get("start", 0.0)))
            return result + float(params.get("rate", 0.0)) * max(0.0, time - start)
        if fault_type == "parameter_freeze":
            freeze_key = (str(fault.get("faultId", "")), target_field)
            return self.frozen_parameters.setdefault(freeze_key, result)
        if fault_type == "parameter_random":
            return result + self._bounded_noise(
                params.get("seed", 1),
                f"{fault.get('faultId', '')}:{target_field}",
                time,
            ) * abs(float(params.get("std", 0.0)))
        return result

    def apply_node_input(self, node_id, input_name, value, time):
        result = copy.deepcopy(value)
        for fault in self.fault_instances:
            if not self._is_active(fault, time):
                continue
            if self._matches_node_signal(fault, node_id, "inputs", input_name, False):
                result = self._apply_signal_fault(
                    fault,
                    node_id,
                    f"inputs.{input_name}",
                    result,
                    time,
                )
        return result

    @staticmethod
    def _bounded_noise(seed, fault_id, time):
        value = f"{seed}:{fault_id}:{float(time):.10f}".encode("utf-8")
        raw = int.from_bytes(hashlib.sha256(value).digest()[:8], "big")
        return (raw / ((1 << 64) - 1)) * 2.0 - 1.0

    def apply_node_parameters(self, node_id, parameters, time):
        result = dict(parameters or {})
        for fault in self.fault_instances:
            if fault.get("targetId") != node_id or not self._is_active(fault, time):
                continue
            if not self._is_module_parameter_fault(fault):
                continue
            parameter_key = self._parameter_key(fault)
            value = result.get(parameter_key, 1.0)
            result[parameter_key] = self._apply_parameter_fault(
                fault, parameter_key, f"params.{parameter_key}", value, time
            )
        return result

    def apply_node_output(self, node_id, value, time, output_name=None, is_primary=True):
        result = copy.deepcopy(value)
        for fault in self.fault_instances:
            if not self._is_active(fault, time):
                continue
            if not self._matches_node_signal(
                fault,
                node_id,
                "outputs",
                output_name or "",
                is_primary,
            ):
                continue
            result = self._apply_signal_fault(
                fault,
                node_id,
                f"outputs.{output_name or ''}",
                result,
                time,
            )
        return result

    def apply_edge_value(self, edge_id, value, time):
        result = copy.deepcopy(value)
        state = self.edge_state.setdefault(edge_id, {"last": copy.deepcopy(result)})
        if edge_id in self.disconnected_edge_ids:
            state["last"] = self._zero_like(result)
            return copy.deepcopy(state["last"])
        for fault in self.fault_instances:
            if fault.get("targetId") != edge_id or not self._is_active(fault, time):
                continue
            fault_type = fault.get("faultType")
            if fault_type == "link_loss":
                result = copy.deepcopy(state.get("last", result))
            elif fault_type == "link_delay":
                queue = state.setdefault("queue", [])
                queue.append(copy.deepcopy(result))
                delay_steps = int((fault.get("parameters") or {}).get("delaySteps", 1))
                result = queue.pop(0) if len(queue) > delay_steps else copy.deepcopy(state.get("last", result))
            else:
                result = self._apply_signal_fault(fault, edge_id, "edge", result, time)
        state["last"] = copy.deepcopy(result)
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
