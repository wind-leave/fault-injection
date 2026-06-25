from backend.fault_runtime import FaultRuntime


def _round_time(value):
    return round(float(value) + 0.0, 10)


def _source_value(node, time):
    params = node.parameters
    if "value" in params:
        return float(params["value"])
    amplitude = float(params.get("amplitude", 1.0))
    return amplitude


def _evaluate_node(graph, node_id, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values):
    key = (mode, node_id)
    if key in cache:
        return cache[key]
    if key in visiting:
        return float(previous_values.get(key, 0.0))

    visiting.add(key)
    node = graph.nodes[node_id]
    incoming_edges = graph.incoming.get(node_id, [])
    inputs = []
    for edge in incoming_edges:
        upstream = _evaluate_node(
            graph,
            edge.source_node_id,
            mode,
            time,
            cache,
            fault_runtime,
            module_states,
            dt,
            visiting,
            previous_values,
            next_values,
        )
        if mode == "actual":
            upstream = fault_runtime.apply_edge_value(edge.id, upstream, time)
        inputs.append(upstream)

    if node.type == "signal_source":
        value = _source_value(node, time)
    elif node.type == "simulation_block":
        module_inputs = {}
        for index, input_name in enumerate(node.module.inputs):
            module_inputs[input_name] = inputs[index] if index < len(inputs) else 0.0
        mode_states = module_states.setdefault(mode, {})
        module_result = node.module.call(
            module_inputs,
            node.parameters,
            time=time,
            dt=dt,
            state=mode_states.get(node_id, {}),
        )
        mode_states[node_id] = dict(module_result.get("state") or {})
        output_map = module_result["outputs"]
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
    next_values[key] = cache[key]
    visiting.remove(key)
    return cache[key]


def _time_values(duration, step_size):
    values = []
    current = 0.0
    while current < duration - 1e-12:
        values.append(_round_time(current))
        current += step_size
    return values


def _evaluate_measurement(graph, measurement, mode, time, cache, fault_runtime, module_states, dt, previous_values, next_values):
    node = graph.nodes[measurement.scope_node_id]
    if node.type != "instrument_scope":
        return _evaluate_node(
            graph,
            measurement.scope_node_id,
            mode,
            time,
            cache,
            fault_runtime,
            module_states,
            dt,
            set(),
            previous_values,
            next_values,
        )

    edge = next(
        (
            edge
            for edge in graph.incoming.get(measurement.scope_node_id, [])
            if edge.target_port_index == measurement.target_port_index
        ),
        None,
    )
    if edge is None:
        return 0.0

    value = _evaluate_node(
        graph,
        edge.source_node_id,
        mode,
        time,
        cache,
        fault_runtime,
        module_states,
        dt,
        set(),
        previous_values,
        next_values,
    )
    if mode == "actual":
        value = fault_runtime.apply_edge_value(edge.id, value, time)
    return float(value)


def _empty_channels(graph):
    channels = {}
    for measurement in graph.measurements:
        channels[f"{measurement.id}.actual"] = []
        channels[f"{measurement.id}.reference"] = []
    return channels


class SimulationSession:
    def __init__(self, graph, run_id=""):
        self.graph = graph
        self.run_id = run_id
        self.times = _time_values(graph.duration, graph.step_size)
        self.step_index = 0
        self.fault_runtime = FaultRuntime(graph.fault_instances)
        self.module_states = {"actual": {}, "reference": {}}
        self.previous_values = {}

    @property
    def done(self):
        return self.step_index >= len(self.times)

    @property
    def current_time(self):
        if self.done:
            return _round_time(self.graph.duration)
        return self.times[self.step_index]

    def step(self, steps=1):
        requested_steps = max(0, int(steps))
        remaining_steps = max(0, len(self.times) - self.step_index)
        sample_count = min(requested_steps, remaining_steps)
        times = []
        channels = _empty_channels(self.graph)
        events = []

        for _ in range(sample_count):
            time = self.times[self.step_index]
            times.append(time)
            cache = {}
            next_values = {}
            events.extend(self.fault_runtime.collect_events(time))
            for measurement in self.graph.measurements:
                actual = _evaluate_measurement(
                    self.graph,
                    measurement,
                    "actual",
                    time,
                    cache,
                    self.fault_runtime,
                    self.module_states,
                    self.graph.step_size,
                    self.previous_values,
                    next_values,
                )
                reference = _evaluate_measurement(
                    self.graph,
                    measurement,
                    "reference",
                    time,
                    cache,
                    self.fault_runtime,
                    self.module_states,
                    self.graph.step_size,
                    self.previous_values,
                    next_values,
                )
                channels[f"{measurement.id}.actual"].append(actual)
                channels[f"{measurement.id}.reference"].append(reference)
            self.previous_values.update(next_values)
            self.step_index += 1

        return {
            "runId": self.run_id,
            "status": "success",
            "curves": {"time": times, "channels": channels},
            "events": events,
            "metrics": {
                "sampleCount": sample_count,
                "stepIndex": self.step_index,
                "time": self.current_time,
                "done": self.done,
            },
            "warnings": [],
        }


def run_simulation(graph, run_id=""):
    session = SimulationSession(graph, run_id=run_id)
    return session.step(len(session.times))
