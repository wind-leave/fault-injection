from dataclasses import dataclass

from backend.schemas import SimulationBackendError, validate_executable_package


@dataclass(frozen=True)
class ExecutableNode:
    id: str
    type: str
    parameters: dict
    outputs: tuple
    module: object = None


@dataclass(frozen=True)
class ExecutableEdge:
    id: str
    source_node_id: str
    source_port_index: int
    target_node_id: str
    target_port_index: int


@dataclass(frozen=True)
class MeasurementBinding:
    id: str
    scope_node_id: str
    channel: str
    target_port_index: int


@dataclass(frozen=True)
class ExecutableGraph:
    nodes: dict
    edges: list
    incoming: dict
    measurements: list
    fault_instances: list
    duration: float
    step_size: float


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


def compile_graph(package, registry):
    validate_executable_package(package)
    raw_nodes = package["nodes"]
    nodes = {}
    for index, node in enumerate(raw_nodes):
        module = None
        if node["type"] == "simulation_block":
            binding = node.get("pythonBinding") or {}
            module_id = binding.get("moduleId")
            module = registry.require(module_id, f"nodes[{index}].pythonBinding.moduleId")
        nodes[node["id"]] = ExecutableNode(
            id=node["id"],
            type=node["type"],
            parameters=dict(node.get("parameters") or {}),
            outputs=tuple(
                str(output.get("name") or output.get("id") or f"output-{output_index}")
                for output_index, output in enumerate(node.get("outputs") or [])
                if isinstance(output, dict)
            ),
            module=module,
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
        input_key = (target_id, target_port_index)
        if input_key in occupied_inputs:
            raise SimulationBackendError("INPUT_PORT_CONFLICT", f"edges[{index}].targetPortIndex", f"duplicate input connection for {target_id}:{target_port_index}")
        occupied_inputs[input_key] = edge.get("id")
        compiled = ExecutableEdge(
            id=edge.get("id", f"edge-{index}"),
            source_node_id=source_id,
            source_port_index=_edge_port(edge, "sourcePortIndex"),
            target_node_id=target_id,
            target_port_index=target_port_index,
        )
        edges.append(compiled)
        incoming.setdefault(target_id, []).append(compiled)

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
        ))

    config = package["simulationConfig"]
    return ExecutableGraph(
        nodes=nodes,
        edges=edges,
        incoming=incoming,
        measurements=measurements,
        fault_instances=list(package.get("faultInstances", [])),
        duration=float(config["duration"]),
        step_size=float(config["stepSize"]),
    )
