import math


SUPPORTED_NODE_TYPES = {
    "signal_source",
    "flow_block",
    "simulation_block",
    "gain_block",
    "sum_block",
    "mux_block",
    "instrument_scope",
    "instrument_spectrum",
    "instrument_logger",
    "instrument_multimeter",
    "display_console",
    "subsystem_block",
}

LIMITS = {
    "max_duration": 1000.0,
    # 0.01 ps supports a 10 THz carrier with ten samples per cycle.
    "min_step_size": 1e-14,
    "max_step_size": 1.0,
    "max_nodes": 200,
    "max_edges": 400,
    "max_faults": 50,
    "max_measurement_points": 100,
}


class SimulationBackendError(Exception):
    def __init__(self, error_code, field, message):
        super().__init__(message)
        self.error_code = error_code
        self.field = field
        self.message = message

    def to_response(self, run_id=""):
        return {
            "runId": run_id,
            "status": "error",
            "errorCode": self.error_code,
            "field": self.field,
            "message": self.message,
        }


def ensure_mapping(value, field):
    if not isinstance(value, dict):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be an object")
    return value


def ensure_list(value, field):
    if not isinstance(value, list):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be an array")
    return value


def ensure_number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be a finite number")
    return float(value)


def ensure_rf_complex_envelope(value, field):
    """Validate one JSON-safe I/Q sample and its RF frequency context."""
    ensure_mapping(value, field)
    i_value = value.get("i", value.get("re"))
    q_value = value.get("q", value.get("im"))
    if i_value is None:
        raise SimulationBackendError("INVALID_SCHEMA", f"{field}.i", "I component is required")
    if q_value is None:
        raise SimulationBackendError("INVALID_SCHEMA", f"{field}.q", "Q component is required")
    if "referenceFrequencyHz" not in value:
        raise SimulationBackendError(
            "INVALID_SCHEMA",
            f"{field}.referenceFrequencyHz",
            "referenceFrequencyHz is required",
        )
    reference_frequency = ensure_number(value["referenceFrequencyHz"], f"{field}.referenceFrequencyHz")
    if reference_frequency < 0.0:
        raise SimulationBackendError(
            "INVALID_SCHEMA",
            f"{field}.referenceFrequencyHz",
            "referenceFrequencyHz must be non-negative",
        )
    normalized = {
        "i": ensure_number(i_value, f"{field}.i"),
        "q": ensure_number(q_value, f"{field}.q"),
        "referenceFrequencyHz": reference_frequency,
    }
    if "impedanceOhm" in value:
        impedance = ensure_number(value["impedanceOhm"], f"{field}.impedanceOhm")
        if impedance <= 0.0:
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}.impedanceOhm", "impedanceOhm must be positive")
        normalized["impedanceOhm"] = impedance
    if "unit" in value:
        if not isinstance(value["unit"], str) or not value["unit"].strip():
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}.unit", "unit must be a non-empty string")
        normalized["unit"] = value["unit"].strip()
    return normalized


def ensure_rf_complex_envelope_batch(value, field):
    """Validate a non-empty collection of independent RF I/Q frames."""
    ensure_list(value, field)
    if not value:
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must not be an empty envelope collection")
    return [
        ensure_rf_complex_envelope(item, f"{field}[{index}]")
        for index, item in enumerate(value)
    ]


def ensure_signal_value(value, field):
    """Validate a scalar, numeric vector, RF frame, or collection of RF frames."""
    if isinstance(value, dict):
        return ensure_rf_complex_envelope(value, field)
    if isinstance(value, list):
        if not value:
            raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must not be an empty vector")
        if all(isinstance(item, dict) for item in value):
            return ensure_rf_complex_envelope_batch(value, field)
        return [ensure_number(item, f"{field}[{index}]") for index, item in enumerate(value)]
    return ensure_number(value, field)


def normalize_port_data_type(value):
    text = str(value or "scalar").strip().lower()
    if text in {"scalar", "标量", "float", "number"}:
        return "scalar"
    if text in {"vector", "向量"}:
        return "vector"
    if text in {"rf_complex_envelope", "rf-complex-envelope", "rfcomplexenvelope", "复数包络", "射频复数包络"}:
        return "rf_complex_envelope"
    return text


def validate_ports(value, field):
    ports = ensure_list(value or [], field)
    for index, port in enumerate(ports):
        ensure_mapping(port, f"{field}[{index}]")
        data_type = normalize_port_data_type(port.get("dataType", port.get("type", "scalar")))
        if data_type not in {"scalar", "vector", "rf_complex_envelope"}:
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].dataType", "only scalar, vector, and rf_complex_envelope ports are supported")
        if data_type == "vector":
            length = port.get("vectorLength", port.get("length"))
            if isinstance(length, bool) or not isinstance(length, int) or not 1 <= length <= 1024:
                raise SimulationBackendError(
                    "INVALID_SCHEMA",
                    f"{field}[{index}].vectorLength",
                    "vectorLength must be an integer from 1 to 1024",
                )
        if data_type == "rf_complex_envelope":
            if "vectorLength" in port:
                length = port["vectorLength"]
                if isinstance(length, bool) or not isinstance(length, int) or not 1 <= length <= 1024:
                    raise SimulationBackendError(
                        "INVALID_SCHEMA",
                        f"{field}[{index}].vectorLength",
                        "vectorLength must be an integer from 1 to 1024",
                    )
            if "referenceFrequencyHz" in port:
                reference_frequency = ensure_number(port["referenceFrequencyHz"], f"{field}[{index}].referenceFrequencyHz")
                if reference_frequency < 0.0:
                    raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].referenceFrequencyHz", "referenceFrequencyHz must be non-negative")
            if "impedanceOhm" in port:
                impedance = ensure_number(port["impedanceOhm"], f"{field}[{index}].impedanceOhm")
                if impedance <= 0.0:
                    raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].impedanceOhm", "impedanceOhm must be positive")
    return ports


def validate_power_ports(value, field):
    ports = ensure_list(value or [], field)
    for index, port in enumerate(ports):
        ensure_mapping(port, f"{field}[{index}]")
    return ports


SIGNAL_SOURCE_TEXT_PARAMETERS = {"signalDomain", "waveType", "outputFormat", "rfModulation"}


def ensure_sign_sequence(value, field):
    if not isinstance(value, list):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be an array")
    for index, item in enumerate(value):
        if item not in {"+", "-"}:
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}]", f"{field}[{index}] must be '+' or '-'")
    return value


def validate_numeric_parameters(parameters, field, text_parameters=None, complex_envelope_parameters=None):
    if parameters is None:
        return {}
    ensure_mapping(parameters, field)
    allowed_text = set(text_parameters or ())
    allowed_complex_envelopes = set(complex_envelope_parameters or ())
    for key, value in parameters.items():
        if key in allowed_text and isinstance(value, str):
            continue
        if key in allowed_complex_envelopes and isinstance(value, dict):
            ensure_rf_complex_envelope(value, f"{field}.{key}")
            continue
        if key in allowed_complex_envelopes and isinstance(value, list):
            ensure_rf_complex_envelope_batch(value, f"{field}.{key}")
            continue
        if isinstance(value, list):
            ensure_signal_value(value, f"{field}.{key}")
            continue
        ensure_number(value, f"{field}.{key}")
    return parameters


def _validate_unique_ids(items, collection, key, default_factory=None):
    seen = {}
    for index, item in enumerate(items):
        ensure_mapping(item, f"{collection}[{index}]")
        value = item.get(key)
        if value is None and default_factory is not None:
            value = default_factory(item, index)
        field = f"{collection}[{index}].{key}"
        if not isinstance(value, str) or not value.strip():
            raise SimulationBackendError("INVALID_SCHEMA", field, f"{key} is required")
        if value in seen:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                field,
                f"duplicate {key}: {value}; first declared at {collection}[{seen[value]}].{key}",
            )
        seen[value] = index


def validate_sum_block_parameters(parameters, field):
    if parameters is None:
        return {}
    ensure_mapping(parameters, field)
    for key, value in parameters.items():
        if key == "signs":
            ensure_sign_sequence(value, f"{field}.{key}")
            continue
        ensure_number(value, f"{field}.{key}")
    return parameters


def validate_executable_package(package):
    ensure_mapping(package, "request")
    if package.get("schemaVersion") != 1:
        raise SimulationBackendError("INVALID_SCHEMA", "schemaVersion", "schemaVersion must be 1")

    config = ensure_mapping(package.get("simulationConfig"), "simulationConfig")
    duration = ensure_number(config.get("duration"), "simulationConfig.duration")
    step_size = ensure_number(config.get("stepSize"), "simulationConfig.stepSize")
    if duration <= 0 or duration > LIMITS["max_duration"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "simulationConfig.duration", "duration is outside the allowed range")
    if step_size < LIMITS["min_step_size"] or step_size > LIMITS["max_step_size"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "simulationConfig.stepSize", "stepSize is outside the allowed range")
    # Avoid rejecting an exact boundary such as 0.1 s / 1 µs because of a
    # tiny floating-point remainder (for example, 100000.00000000001).
    nodes = ensure_list(package.get("nodes"), "nodes")
    edges = ensure_list(package.get("edges"), "edges")
    faults = ensure_list(package.get("faultInstances", []), "faultInstances")
    measurement_points = ensure_list(package.get("measurementPoints", []), "measurementPoints")
    reported_node_ids = ensure_list(package.get("reportedNodeIds", []), "reportedNodeIds")

    if len(nodes) > LIMITS["max_nodes"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "nodes", "too many nodes")
    if len(edges) > LIMITS["max_edges"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "edges", "too many edges")
    if len(faults) > LIMITS["max_faults"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "faultInstances", "too many fault instances")
    if len(measurement_points) > LIMITS["max_measurement_points"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "measurementPoints", "too many measurement points")
    if len(reported_node_ids) > LIMITS["max_nodes"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "reportedNodeIds", "too many reported node ids")

    _validate_unique_ids(nodes, "nodes", "id")
    _validate_unique_ids(
        edges,
        "edges",
        "id",
        default_factory=lambda _item, index: f"edge-{index}",
    )
    _validate_unique_ids(
        measurement_points,
        "measurementPoints",
        "id",
        default_factory=lambda item, _index: f"{item.get('scopeNodeId')}.ch1",
    )
    _validate_unique_ids(faults, "faultInstances", "faultId")
    for index, node_id in enumerate(reported_node_ids):
        if not isinstance(node_id, str) or not node_id:
            raise SimulationBackendError("INVALID_SCHEMA", f"reportedNodeIds[{index}]", "reported node id must be a non-empty string")

    for index, node in enumerate(nodes):
        ensure_mapping(node, f"nodes[{index}]")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise SimulationBackendError("INVALID_SCHEMA", f"nodes[{index}].id", "node id is required")
        node_type = node.get("type")
        if node_type not in SUPPORTED_NODE_TYPES:
            raise SimulationBackendError("UNSUPPORTED_NODE_TYPE", f"nodes[{index}].type", f"unsupported node type: {node_type}")
        validate_ports(node.get("inputs", []), f"nodes[{index}].inputs")
        validate_ports(node.get("outputs", []), f"nodes[{index}].outputs")
        if node_type == "simulation_block":
            validate_power_ports(node.get("powerInputs", []), f"nodes[{index}].powerInputs")
            validate_power_ports(node.get("powerOutputs", []), f"nodes[{index}].powerOutputs")
        if node_type == "sum_block":
            validate_sum_block_parameters(node.get("parameters", {}), f"nodes[{index}].parameters")
        else:
            text_parameters = SIGNAL_SOURCE_TEXT_PARAMETERS if node_type == "signal_source" else None
            source_has_rf_complex_output = node_type == "signal_source" and any(
                normalize_port_data_type(port.get("dataType", port.get("type", "scalar"))) == "rf_complex_envelope"
                for port in node.get("outputs", [])
                if isinstance(port, dict)
            )
            validate_numeric_parameters(
                node.get("parameters", {}),
                f"nodes[{index}].parameters",
                text_parameters,
                complex_envelope_parameters={"value"} if source_has_rf_complex_output else None,
            )

    return package
