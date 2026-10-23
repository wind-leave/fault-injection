import copy
import hashlib
from backend.noise_runtime import NOISE_FAULT_TYPES, sample_noise


class FaultRuntime:
    def __init__(self, fault_instances):
        self.fault_instances = list(fault_instances or [])
        self.edge_state = {}
        self.frozen_parameters = {}
        self.frozen_signals = {}
        self.noise_state = {}
        self.started_fault_ids = set()
        self.ended_fault_ids = set()
        self.disconnected_edge_ids = set()

    def disconnect_edge(self, edge_id):
        self.disconnected_edge_ids.add(edge_id)

    def reconnect_edge(self, edge_id):
        self.disconnected_edge_ids.discard(edge_id)

    def can_use_single_path(self):
        """Whether actual and reference paths are guaranteed to be identical.

        A configured fault may affect state before or after its active window
        (for example, a delayed or held edge value), so merely checking whether
        a fault is active at one timestamp is not sufficient.  The simulation
        engine may share a path only when the run has no configured faults and
        no line is manually disconnected.
        """
        return not self.fault_instances and not self.disconnected_edge_ids

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

    @classmethod
    def _parameter_keys(cls, fault):
        configured = fault.get("parameterKeys")
        keys = []
        if isinstance(configured, list):
            for value in configured:
                key = str(value or "").strip()
                if key and key not in keys:
                    keys.append(key)
        primary = cls._parameter_key(fault)
        if primary and primary not in keys:
            keys.insert(0, primary)
        return keys

    def _is_module_parameter_fault(self, fault):
        return bool(self._parameter_keys(fault)) and fault.get("injectionForm") == "module-variable"

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
        if FaultRuntime._is_complex_envelope(value):
            result = copy.deepcopy(value)
            result["i"] = 0.0
            result["q"] = 0.0
            return result
        if isinstance(value, list):
            return [FaultRuntime._zero_like(item) for item in value]
        return 0.0

    @staticmethod
    def _is_complex_envelope(value):
        if not isinstance(value, dict):
            return False
        try:
            float(value.get("i"))
            float(value.get("q"))
            float(value.get("referenceFrequencyHz"))
        except (TypeError, ValueError):
            return False
        return True

    def _apply_complex_envelope_fault(self, fault, target_id, target_field, value, time):
        """Apply the frontend layered signal subset to one complete I/Q frame."""
        result = copy.deepcopy(value)
        params = fault.get("parameters") or {}
        fault_type = fault.get("faultType")
        if fault_type == "signal_attenuation":
            if "scale" in params:
                scale = float(params.get("scale", 1.0))
            else:
                attenuation_db = max(0.0, float(params.get("attenuation_db", params.get("attenuationDb", 0.0))))
                scale = 10.0 ** (-attenuation_db / 20.0)
            result["i"] = float(result["i"]) * scale
            result["q"] = float(result["q"]) * scale
            return result
        if fault_type == "signal_cutoff":
            result["i"] = 0.0
            result["q"] = 0.0
            return result
        if fault_type == "signal_stuck":
            # A hold fault must retain the whole frame, including reference
            # frequency and impedance metadata, rather than one I/Q component.
            return self._frozen_signal_value(fault, target_id, target_field, result)
        if fault_type in {"sensor_bias", "parameter_bias", "parameter_drift", "parameter_step", "intermittent", "data_tamper", "random_packet_loss", "link_delay"} | NOISE_FAULT_TYPES:
            result["i"] = self._apply_signal_fault(fault, target_id, f"{target_field}.i", value["i"], time)
            result["q"] = self._apply_signal_fault(fault, target_id, f"{target_field}.q", value["q"], time)
            return result
        return result

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
        # Protocol faults affect an entire transported message.  Vector
        # payloads are not independently selectable at the protocol layer.
        scope = "all" if fault.get("injectionForm") == "protocol-bus" else self._vector_injection_scope(fault)
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

    def _with_noise_overlay(self, fault, target_id, target_field, value, time):
        params = fault.get("parameters") or {}
        enabled = str(params.get("noiseEnabled", 0)).lower() in {"1", "true", "on"}
        noise_type = params.get("noiseType")
        if not enabled or noise_type not in NOISE_FAULT_TYPES:
            return value
        noise_params = {
            key: params[f"noise{key[0].upper()}{key[1:]}"]
            for key in ("mean", "std", "amplitude", "alpha", "seed")
            if f"noise{key[0].upper()}{key[1:]}" in params
        }
        stream = f"{target_id}/{fault.get('faultId', '')}/{target_field}/overlay"
        if self._is_complex_envelope(value):
            return {**value, **{
                key: float(value[key]) + sample_noise(noise_type, noise_params, time, f"{stream}/{key}", self.noise_state)
                for key in ("i", "q")
            }}
        return float(value) + sample_noise(noise_type, noise_params, time, stream, self.noise_state)

    def _apply_signal_fault(self, fault, target_id, target_field, value, time):
        # Lists recurse through this wrapper so only selected lanes receive noise.
        if isinstance(value, list):
            return self._apply_signal_fault_base(fault, target_id, target_field, value, time)
        base_fault = {**fault, "parameters": {**(fault.get("parameters") or {}), "noiseEnabled": 0}}
        result = self._apply_signal_fault_base(base_fault, target_id, target_field, value, time)
        return self._with_noise_overlay(fault, target_id, target_field, result, time)

    def _apply_signal_fault_base(self, fault, target_id, target_field, value, time):
        if isinstance(value, list):
            return self._apply_vector_fault(
                fault,
                target_id,
                target_field,
                value,
                time,
                lambda item_field, item: self._apply_signal_fault(fault, target_id, item_field, item, time),
            )
        if self._is_complex_envelope(value):
            return self._apply_complex_envelope_fault(
                fault, target_id, target_field, value, time
            )
        params = fault.get("parameters") or {}
        fault_type = fault.get("faultType")
        result = float(value)
        if fault_type == "data_tamper":
            return result * float(params.get("scale", 1.0)) + float(params.get("bias", 0.0))
        if fault_type == "link_delay":
            stream = (str(fault.get("faultId", "")), target_id, target_field)
            state = self.edge_state.setdefault(stream, {})
            queue = state.setdefault("queue", [])
            queue.append(result)
            steps = max(0, int(params.get("delaySteps", params.get("delay_steps", 1))))
            result = queue.pop(0) if len(queue) > steps else state.get("last", 0.0)
            state["last"] = result
            return result
        if fault_type == "random_packet_loss":
            stream = (str(fault.get("faultId", "")), target_id, target_field)
            previous = self.frozen_signals.get(stream, 0.0)
            rate = min(1.0, max(0.0, float(params.get("drop_rate", 0.08))))
            dropped = (self._bounded_noise(params.get("seed", 1), fault.get("faultId", ""), time) + 1) / 2 <= rate
            if dropped:
                return 0.0 if params.get("strategy") == "zero" else previous
            self.frozen_signals[stream] = result
            return result
        if fault_type in NOISE_FAULT_TYPES:
            stream = f"{target_id}/{fault.get('faultId', '')}/{target_field}"
            return result + sample_noise(fault_type, params, time, stream, self.noise_state)
        # Keep the original output-level physical fault behaviour for legacy
        # packages that do not name a concrete signal field.
        if fault_type == "motor_efficiency_loss":
            return result * float(params.get("efficiency", 1.0))
        if fault_type == "parameter_bias":
            return (result + float(params.get("bias", params.get("delta_p", 0.0)))) * float(
                params.get("scale", 1.0)
            )
        if fault_type == "parameter_step":
            return float(params.get("targetValue", params.get("target_value", params.get("value", params.get("stepValue", params.get("step_value", params.get("step", result)))))))
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
            if "value" in params:
                return float(params["value"])
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
            return self._apply_parameter_fault_base(fault, parameter_key, target_field, value, time)
        base_fault = {**fault, "parameters": {**(fault.get("parameters") or {}), "noiseEnabled": 0}}
        result = self._apply_parameter_fault_base(base_fault, parameter_key, target_field, value, time)
        return self._with_noise_overlay(fault, fault.get("targetId", ""), target_field, result, time)

    def _apply_parameter_fault_base(self, fault, parameter_key, target_field, value, time):
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
            return float(params.get("targetValue", params.get("target_value", params.get("value", params.get("stepValue", params.get("step_value", params.get("step", result)))))))
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
        if fault_type in NOISE_FAULT_TYPES:
            stream = f"{fault.get('targetId', '')}/{fault.get('faultId', '')}/{target_field}"
            return result + sample_noise(fault_type, params, time, stream, self.noise_state)
        if fault_type in {"intermittent", "data_tamper", "random_packet_loss", "link_delay", "signal_cutoff"}:
            return self._apply_signal_fault(
                fault, fault.get("targetId", ""), target_field, result, time
            )
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
            for parameter_key in self._parameter_keys(fault):
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
        state = self.edge_state.get(edge_id)
        if state is None:
            state = {"last": copy.deepcopy(result)}
            self.edge_state[edge_id] = state
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
                delay_states = state.setdefault("fault_delays", {})
                delay_state = delay_states.setdefault(str(fault.get("faultId", "")), {})
                queue = delay_state.setdefault("queue", [])
                queue.append(copy.deepcopy(result))
                delay_steps = max(0, int((fault.get("parameters") or {}).get("delaySteps", (fault.get("parameters") or {}).get("delay_steps", 1))))
                result = queue.pop(0) if len(queue) > delay_steps else copy.deepcopy(delay_state.get("last", result))
                delay_state["last"] = copy.deepcopy(result)
                result = self._apply_vector_fault(fault, edge_id, "edge", result, time,
                    lambda field, item: self._with_noise_overlay(fault, edge_id, field, item, time)) if isinstance(result, list) else self._with_noise_overlay(fault, edge_id, "edge", result, time)
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
