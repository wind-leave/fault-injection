from dataclasses import dataclass, field

from backend.schemas import SimulationBackendError, normalize_port_data_type, validate_executable_package


@dataclass(frozen=True)
class ExecutableNode:
    id: str
    type: str
    parameters: dict
    outputs: tuple
    output_port_ids: tuple
    input_ports: tuple
    output_ports: tuple
    power_input_ports: tuple
    power_output_ports: tuple
    requires_power: bool
    module: object = None
    prepared_call: object = None
    component_id: str = ""
    output_names: tuple = field(init=False)
    module_input_bindings: tuple = field(init=False)
    module_output_bindings: tuple = field(init=False)

    def __post_init__(self):
        output_names = (
            tuple(port["name"] for port in self.input_ports)
            if self.type == "display_console" and self.input_ports
            else tuple(self.outputs or ("output",))
        )
        module_outputs = tuple(self.module.outputs or ()) if self.module is not None else ()
        object.__setattr__(self, "output_names", output_names)
        object.__setattr__(self, "module_input_bindings", tuple(enumerate(self.module.inputs)) if self.module is not None else ())
        object.__setattr__(self, "module_output_bindings", tuple(
            (index, name, module_outputs[index] if index < len(module_outputs) else name)
            for index, name in enumerate(output_names)
        ))


@dataclass(frozen=True)
class ExecutableEdge:
    id: str
    source_node_id: str
    source_port_index: int
    target_node_id: str
    target_port_index: int
    is_power: bool
    source_output_name: str = "output"
    source_output_validated: bool = False


@dataclass(frozen=True)
class MeasurementBinding:
    id: str
    scope_node_id: str
    channel: str
    target_port_index: int
    vector_index: int = 0
    source_edge: object = None


@dataclass(frozen=True)
class ExecutableGraph:
    nodes: dict
    edges: list
    incoming: dict
    measurements: list
    reported_node_ids: frozenset
    fault_instances: list
    duration: float
    step_size: float
    input_plans: dict = field(init=False, repr=False)
    recorded_node_ids: frozenset = field(init=False)

    def __post_init__(self):
        # Cache topology only; parameters and fault state remain live at each step.
        plans = {}
        selected = set(self.reported_node_ids)
        for node_id, node in self.nodes.items():
            incoming = tuple(self.incoming.get(node_id, ()))
            connected = {edge.target_port_index for edge in incoming}
            count = max(len(node.input_ports), max(connected, default=-1) + 1)
            missing = tuple(index for index in range(count) if index not in connected)
            plans[node_id] = (incoming, count, missing)
            if node.type == "display_console":
                selected.add(node_id)
        for edge in self.edges:
            if not edge.is_power and self.nodes[edge.target_node_id].type in {
                "instrument_scope", "instrument_spectrum", "instrument_logger", "instrument_multimeter",
            }:
                selected.add(edge.source_node_id)
        object.__setattr__(self, "input_plans", plans)
        object.__setattr__(self, "recorded_node_ids", frozenset(selected))


def _edge_port(edge, key):
    value = edge.get(key, 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _measurement_port(point):
    value = point.get("targetPortIndex")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    channel = str(point.get("channel", "ch1")).strip().lower()
    if channel.startswith("ch"):
        try:
            index = int(channel[2:])
        except ValueError:
            return 0
        return max(index - 1, 0)
    return 0


def _measurement_vector_index(point):
    value = point.get("vectorIndex", 0)
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _port_definition(port, index, direction):
    name = str(port.get("name") or port.get("id") or f"{direction}-{index}")
    return {
        "id": str(port.get("id") or port.get("portId") or port.get("key") or name),
        "name": name,
        "dataType": normalize_port_data_type(port.get("dataType", port.get("type", "scalar"))),
        "vectorLength": port.get("vectorLength", port.get("length")),
        "collectionKind": str(port.get("collectionKind", "")),
        "allowsVector": bool(port.get("allowsVector", False)),
        "unit": str(port.get("unit", "")),
        "referenceFrequencyHz": port.get("referenceFrequencyHz"),
        "impedanceOhm": port.get("impedanceOhm"),
        "voltage": port.get("voltage"),
        "supplyType": str(port.get("supplyType", "")).upper(),
    }


def compile_graph(package, registry):
    validate_executable_package(package)
    raw_nodes = package["nodes"]
    nodes = {}
    for index, node in enumerate(raw_nodes):
        raw_inputs = [input_port for input_port in node.get("inputs") or [] if isinstance(input_port, dict)]
        raw_outputs = [output for output in node.get("outputs") or [] if isinstance(output, dict)]
        raw_power_inputs = [port for port in node.get("powerInputs") or [] if isinstance(port, dict)]
        raw_power_outputs = [port for port in node.get("powerOutputs") or [] if isinstance(port, dict)]
        module = None
        if node["type"] == "simulation_block":
            binding = node.get("pythonBinding") or {}
            module_id = binding.get("moduleId")
            module = registry.require(module_id, f"nodes[{index}].pythonBinding.moduleId")
        input_ports = tuple(_port_definition(port, port_index, "input") for port_index, port in enumerate(raw_inputs))
        output_ports = tuple(_port_definition(port, port_index, "output") for port_index, port in enumerate(raw_outputs))
        power_input_ports = tuple(_port_definition(port, port_index, "power-input") for port_index, port in enumerate(raw_power_inputs))
        power_output_ports = tuple(_port_definition(port, port_index, "power-output") for port_index, port in enumerate(raw_power_outputs))
        outputs = tuple(
            str(output.get("name") or output.get("id") or f"output-{output_index}")
            for output_index, output in enumerate(raw_outputs)
        )
        output_port_ids = tuple(
            str(output.get("id") or output.get("portId") or output.get("key") or output.get("name") or f"output-{output_index}")
            for output_index, output in enumerate(raw_outputs)
        )
        nodes[node["id"]] = ExecutableNode(
            id=node["id"],
            type=node["type"],
            parameters=dict(node.get("parameters") or {}),
            outputs=outputs,
            output_port_ids=output_port_ids,
            input_ports=input_ports,
            output_ports=output_ports,
            power_input_ports=power_input_ports,
            power_output_ports=power_output_ports,
            requires_power=bool(raw_power_inputs),
            module=module,
            prepared_call=module.prepare() if module is not None else None,
            component_id=str(node.get("componentId") or ""),
        )

    edges = []
    incoming = {}
    occupied_inputs = {}
    for index, edge in enumerate(package["edges"]):
        source_id = edge.get("sourceNodeId")
        target_id = edge.get("targetNodeId")
        if source_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"edges[{index}].sourceNodeId", f"source node not found: {source_id}")
        if target_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"edges[{index}].targetNodeId", f"target node not found: {target_id}")
        target_port_index = _edge_port(edge, "targetPortIndex")
        source_port_index = _edge_port(edge, "sourcePortIndex")
        source_node = nodes[source_id]
        target_node = nodes[target_id]
        source_ports = source_node.output_ports + source_node.power_output_ports
        target_ports = target_node.input_ports + target_node.power_input_ports
        # Legacy signal-source nodes may omit their output-port metadata even
        # though their first graphical output and a normal signal edge exist.
        # The engine supplies that implicit output as ``output``; do not
        # misclassify the edge as power and silently remove it from `incoming`.
        implicit_source_output = (
            source_node.type == "signal_source"
            and source_port_index == 0
            and not source_node.output_ports
            and target_port_index < len(target_node.input_ports)
            and edge.get("lineType") != "power"
        )
        is_power = (
            edge.get("lineType") == "power"
            or (
                not implicit_source_output
                and (
                    source_port_index >= len(source_node.output_ports)
                    or target_port_index >= len(target_node.input_ports)
                )
            )
        )
        if not is_power and source_port_index < len(source_ports) and target_port_index < len(target_ports):
            source_port = source_ports[source_port_index]
            target_port = target_ports[target_port_index]
            if source_port["dataType"] != target_port["dataType"]:
                raise SimulationBackendError("PORT_TYPE_MISMATCH", f"edges[{index}]", "source and target port data types do not match")
            if source_port["dataType"] == "vector" and source_port["vectorLength"] != target_port["vectorLength"]:
                raise SimulationBackendError("PORT_SHAPE_MISMATCH", f"edges[{index}]", "source and target vector lengths do not match")
        input_key = (target_id, target_port_index)
        if input_key in occupied_inputs:
            raise SimulationBackendError("INPUT_PORT_CONFLICT", f"edges[{index}].targetPortIndex", f"duplicate input connection for {target_id}:{target_port_index}")
        occupied_inputs[input_key] = edge.get("id")
        compiled = ExecutableEdge(
            id=edge.get("id", f"edge-{index}"),
            source_node_id=source_id,
            source_port_index=source_port_index,
            target_node_id=target_id,
            target_port_index=target_port_index,
            is_power=is_power,
            source_output_name=source_node.output_names[
                source_port_index if source_port_index < len(source_node.output_names) else 0
            ],
            source_output_validated=source_port_index < len(source_node.output_ports),
        )
        edges.append(compiled)
        if not is_power:
            incoming.setdefault(target_id, []).append(compiled)

    for node in nodes.values():
        if node.prepared_call is not None:
            node.prepared_call.trusted_inputs = all(
                edge.source_port_index < len(nodes[edge.source_node_id].output_ports)
                and edge.target_port_index < len(node.input_ports)
                for edge in incoming.get(node.id, ())
            )

    incoming_by_port = {
        (edge.target_node_id, edge.target_port_index): edge
        for edge in edges if not edge.is_power
    }
    measurements = []
    for index, point in enumerate(package.get("measurementPoints", [])):
        scope_node_id = point.get("scopeNodeId")
        if scope_node_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"measurementPoints[{index}].scopeNodeId", f"scope node not found: {scope_node_id}")
        measurements.append(MeasurementBinding(
            id=point.get("id", f"{scope_node_id}.ch1"),
            scope_node_id=scope_node_id,
            channel=point.get("channel", "ch1"),
            target_port_index=_measurement_port(point),
            vector_index=_measurement_vector_index(point),
            source_edge=incoming_by_port.get((scope_node_id, _measurement_port(point))),
        ))

    config = package["simulationConfig"]
    return ExecutableGraph(
        nodes=nodes,
        edges=edges,
        incoming=incoming,
        measurements=measurements,
        reported_node_ids=frozenset(
            node_id
            for node_id in package.get("reportedNodeIds", [])
            if node_id in nodes
        ),
        fault_instances=list(package.get("faultInstances", [])),
        duration=float(config["duration"]),
        step_size=float(config["stepSize"]),
    )
