from backend.fault_runtime import FaultRuntime


def _round_time(value):
    return round(float(value) + 0.0, 10)


def _source_value(node, time):
    params = node.parameters
    if "value" in params:
        return float(params["value"])
    amplitude = float(params.get("amplitude", 1.0))
    return amplitude


def _evaluate_node(graph, node_id, mode, time, cache, fault_runtime):
    key = (mode, node_id)
    if key in cache:
        return cache[key]

    node = graph.nodes[node_id]
    incoming_edges = graph.incoming.get(node_id, [])
    inputs = []
    for edge in incoming_edges:
        upstream = _evaluate_node(graph, edge.source_node_id, mode, time, cache, fault_runtime)
        if mode == "actual":
            upstream = fault_runtime.apply_edge_value(edge.id, upstream, time)
        inputs.append(upstream)

    if node.type == "signal_source":
        value = _source_value(node, time)
    elif node.type == "simulation_block":
        module_inputs = {}
        for index, input_name in enumerate(node.module.inputs):
            module_inputs[input_name] = inputs[index] if index < len(inputs) else 0.0
        output_map = node.module.call(module_inputs, node.parameters)["outputs"]
        value = float(output_map.get(node.module.outputs[0], 0.0)) if node.module.outputs else 0.0
    elif node.type == "gain_block":
        value = (inputs[0] if inputs else 0.0) * float(node.parameters.get("gain", 1.0))
    elif node.type == "sum_block":
        value = sum(inputs)
    elif node.type == "mux_block":
        value = inputs[0] if inputs else 0.0
    elif node.type == "instrument_scope":
        value = inputs[0] if inputs else 0.0
    else:
        value = inputs[0] if inputs else 0.0

    if mode == "actual":
        value = fault_runtime.apply_node_output(node_id, value, time)

    cache[key] = float(value)
    return cache[key]


def _time_values(duration, step_size):
    values = []
    current = 0.0
    while current < duration - 1e-12:
        values.append(_round_time(current))
        current += step_size
    return values


def run_simulation(graph, run_id=""):
    times = _time_values(graph.duration, graph.step_size)
    fault_runtime = FaultRuntime(graph.fault_instances)
    channels = {}
    for measurement in graph.measurements:
        channels[f"{measurement.id}.actual"] = []
        channels[f"{measurement.id}.reference"] = []

    events = []
    for time in times:
        cache = {}
        events.extend(fault_runtime.collect_events(time))
        for measurement in graph.measurements:
            actual = _evaluate_node(graph, measurement.scope_node_id, "actual", time, cache, fault_runtime)
            reference = _evaluate_node(graph, measurement.scope_node_id, "reference", time, cache, fault_runtime)
            channels[f"{measurement.id}.actual"].append(actual)
            channels[f"{measurement.id}.reference"].append(reference)

    return {
        "runId": run_id,
        "status": "success",
        "curves": {"time": times, "channels": channels},
        "events": events,
        "metrics": {"sampleCount": len(times)},
        "warnings": [],
    }
