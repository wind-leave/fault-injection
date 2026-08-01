import copy
import math

from backend.fault_runtime import FaultRuntime
from backend.schemas import SimulationBackendError, ensure_number
from backend.simulation_functions import deterministic_noise, first_numeric as _first_numeric, periodic_gate


def _round_time(value):
    return round(float(value) + 0.0, 10)


def _text(value):
    return str(value or "").strip().lower()


def _rf_noise(node_id, step_index, time):
    seed = sum(ord(char) for char in str(node_id or "rf"))
    return deterministic_noise(seed, step_index, time)


def _rf_source_value(node, time):
    params = node.parameters
    power = _first_numeric(params, ("amplitude", "power", "value"), 0.0)
    modulation = _text(params.get("rfModulation")) or "cw"
    center_frequency = max(0.0, _first_numeric(params, ("centerFrequencyHz", "frequency"), 0.0))
    carrier_phase = 2.0 * math.pi * center_frequency * time
    carrier = math.sin(carrier_phase)
    modulation_rate = max(1e-6, _first_numeric(params, ("modulationRateHz",), 1.0))
    modulation_phase = 2.0 * math.pi * modulation_rate * time

    if modulation == "am":
        depth = min(1.0, max(0.0, _first_numeric(params, ("modulationDepthRatio",), 0.0)))
        return power * (1.0 + depth * math.sin(modulation_phase)) * carrier
    if modulation == "fm":
        deviation = max(0.0, _first_numeric(params, ("frequencyDeviationHz",), 0.0))
        index = min(deviation / modulation_rate, 1000.0)
        return power * math.sin(carrier_phase + index * math.sin(modulation_phase))
    if modulation == "pm":
        deviation = _first_numeric(params, ("phaseDeviationRad",), 0.0)
        return power * math.sin(carrier_phase + deviation * math.sin(modulation_phase))
    if modulation == "pulse":
        period = _first_numeric(params, ("pulsePeriodSeconds",), 0.0)
        if period <= 0.0:
            # Compatibility with executable packages created before 重周
            # replaced PRF in the signal-source configuration.
            prf = max(1e-6, _first_numeric(params, ("prfHz",), 1.0))
            period = 1.0 / prf
        width = min(period, max(0.0, _first_numeric(params, ("pulseWidthSeconds",), 0.0)))
        return power * carrier if periodic_gate(time, period, width) else 0.0
    if modulation == "digital":
        bandwidth = max(1e-6, _first_numeric(params, ("bandwidthHz",), 1.0))
        symbol_rate = max(1e-6, _first_numeric(params, ("symbolRateHz",), bandwidth))
        sample_rate = _first_numeric(params, ("sampleRateHz",), symbol_rate * 2.0)
        effective_rate = min(symbol_rate, max(sample_rate / 2.0, 1e-6))
        symbol_index = math.floor(time * effective_rate)
        symbol = 1.0 if _rf_noise(node.id, symbol_index, time) >= 0.0 else -1.0
        return power * symbol * carrier
    if modulation == "noise":
        snr = _first_numeric(params, ("snrDb",), 0.0)
        bandwidth = max(1.0, _first_numeric(params, ("bandwidthHz",), 1e6))
        noise_scale = math.pow(10.0, -snr / 20.0) * math.sqrt(bandwidth / 1e6)
        return power * carrier + abs(power) * noise_scale * _rf_noise(node.id, math.floor(time * 1000), time)
    return power * carrier


def _source_value(node, time):
    params = node.parameters
    if isinstance(params.get("value"), list):
        return [ensure_number(item, f"parameters.value[{index}]") for index, item in enumerate(params["value"])]
    if _text(params.get("signalDomain")) == "rf":
        return _rf_source_value(node, time)
    wave_type = _text(params.get("waveType"))
    if wave_type:
        amplitude = _first_numeric(params, ("amplitude", "value"), 0.0)
        frequency = _first_numeric(params, ("frequency",), 1.0)
        phase = _first_numeric(params, ("phase",), 0.0)
        offset = _first_numeric(params, ("offset",), 0.0)
        if wave_type in {"constant", "常值"}:
            return amplitude
        if wave_type in {"step", "阶跃"}:
            initial_value = _first_numeric(params, ("initialValue",), 0.0)
            final_value = _first_numeric(params, ("finalValue", "amplitude"), amplitude)
            step_time = max(0.0, _first_numeric(params, ("stepTime", "frequency"), 1.0))
            return final_value if time >= step_time else initial_value
        if wave_type in {"ramp", "slope"}:
            initial_value = _first_numeric(params, ("initialValue", "offset"), offset)
            slope = _first_numeric(params, ("slope", "amplitude"), amplitude)
            start_time = max(0.0, _first_numeric(params, ("startTime",), 0.0))
            return initial_value + (slope * (time - start_time) if time >= start_time else 0.0)
        if wave_type in {"pulse", "脉冲"}:
            low_value = _first_numeric(params, ("lowValue",), 0.0)
            if frequency <= 0.0:
                return low_value
            raw_duty = _first_numeric(params, ("dutyCycle",), 50.0)
            duty_cycle = raw_duty / 100.0 if raw_duty > 1.0 else raw_duty
            duty_cycle = min(1.0, max(0.0, duty_cycle))
            cycle = ((2.0 * math.pi * frequency * time + phase) % (2.0 * math.pi)) / (2.0 * math.pi)
            return amplitude if cycle < duty_cycle else low_value
        if wave_type in {"noise", "random"}:
            pseudo_random = math.sin((time + phase) * 12.9898) * 43758.5453
            return offset + amplitude * ((pseudo_random - math.floor(pseudo_random)) * 2.0 - 1.0)
        if wave_type in {"sine", "sin", "正弦"}:
            return offset + amplitude * math.sin(2.0 * math.pi * frequency * time + phase)

    return _first_numeric(
        params,
        ("value", "amplitude", "initialState", "payloadValue", "commandValue", "power"),
        0.0,
    )


def _node_output_names(node):
    return tuple(node.outputs or ("output",))


def _default_input_value(node, index):
    if index < len(node.input_ports):
        port = node.input_ports[index]
        if port["dataType"] == "vector":
            return [0.0] * int(port["vectorLength"])
    return 0.0


def _default_outputs(node):
    output_names = _node_output_names(node)
    return {
        output_name: _default_output_value(node, index)
        for index, output_name in enumerate(output_names)
    }


def _default_output_value(node, index):
    if index < len(node.output_ports):
        port = node.output_ports[index]
        if port["dataType"] == "vector":
            return [0.0] * int(port["vectorLength"])
    return 0.0


def _ordered_input_values(node, values_by_port):
    max_index = max(values_by_port, default=-1)
    max_index = max(max_index, len(node.input_ports) - 1)
    return [values_by_port.get(index, _default_input_value(node, index)) for index in range(max_index + 1)]


def _ensure_port_value(node, direction, index, value):
    ports = node.output_ports if direction == "output" else node.input_ports
    if index >= len(ports):
        return value
    port = ports[index]
    if port["dataType"] == "vector":
        if not isinstance(value, list) or len(value) != port["vectorLength"]:
            raise SimulationBackendError(
                "PORT_SHAPE_MISMATCH",
                f"nodes.{node.id}.{direction}s[{index}]",
                f"{port['name']} must be a vector of length {port['vectorLength']}",
            )
        return [ensure_number(item, f"nodes.{node.id}.{direction}s[{index}][{item_index}]") for item_index, item in enumerate(value)]
    return ensure_number(value, f"nodes.{node.id}.{direction}s[{index}]")


def _scale_signal(value, scale):
    if isinstance(value, list):
        return [_scale_signal(item, scale) for item in value]
    return float(value) * float(scale)


def _add_signal(left, right):
    if isinstance(left, list) or isinstance(right, list):
        if not isinstance(left, list) or not isinstance(right, list) or len(left) != len(right):
            raise SimulationBackendError("PORT_SHAPE_MISMATCH", "sum_block", "sum inputs must have identical vector lengths")
        return [_add_signal(left_item, right_item) for left_item, right_item in zip(left, right)]
    return float(left) + float(right)


def _normal_signs(value):
    if isinstance(value, list):
        source = value
    else:
        source = str(value or "").replace(",", " ").split()
    return tuple("-" if str(item).strip() == "-" else "+" for item in source)


def _sum_block_value(inputs, parameters):
    signs = _normal_signs(parameters.get("signs"))
    input_count = int(_first_numeric(parameters, ("inputCount",), max(len(inputs), len(signs))))
    total_count = max(len(inputs), len(signs), input_count)
    total = None
    for index in range(total_count):
        value = inputs[index] if index < len(inputs) else 0.0
        sign = -1.0 if index < len(signs) and signs[index] == "-" else 1.0
        signed_value = _scale_signal(value, sign)
        total = signed_value if total is None else _add_signal(total, signed_value)
    return 0.0 if total is None else total


def _edge_value(graph, edge, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values, component_outputs):
    source_outputs = _evaluate_node(
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
        component_outputs,
    )
    output_names = _node_output_names(graph.nodes[edge.source_node_id])
    output_name = output_names[edge.source_port_index] if edge.source_port_index < len(output_names) else output_names[0]
    value = copy.deepcopy(source_outputs.get(output_name, 0.0))
    return fault_runtime.apply_edge_value(edge.id, value, time) if mode == "actual" else value


def _evaluate_node(graph, node_id, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values, component_outputs):
    key = (mode, node_id)
    if key in cache:
        return cache[key]
    if key in visiting:
        return copy.deepcopy(previous_values.get(key, _default_outputs(graph.nodes[node_id])))

    visiting.add(key)
    node = graph.nodes[node_id]
    incoming_edges = graph.incoming.get(node_id, [])
    values_by_port = {}
    for edge in incoming_edges:
        upstream = _edge_value(graph, edge, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values, component_outputs)
        values_by_port[edge.target_port_index] = upstream
    inputs = _ordered_input_values(node, values_by_port)

    output_names = _node_output_names(node)
    if node.type == "signal_source":
        value = _source_value(node, time)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    elif node.type == "simulation_block":
        module_inputs = {}
        for index, input_name in enumerate(node.module.inputs):
            input_value = inputs[index] if index < len(inputs) else 0.0
            module_inputs[input_name] = (
                fault_runtime.apply_node_input(node_id, input_name, input_value, time)
                if mode == "actual"
                else input_value
            )
        module_parameters = {
            name: spec.get("default", 0.0)
            for name, spec in node.module.parameters.items()
        }
        module_parameters.update(node.parameters)
        module_parameters = (
            fault_runtime.apply_node_parameters(node_id, module_parameters, time)
            if mode == "actual"
            else module_parameters
        )
        mode_states = module_states.setdefault(mode, {})
        module_result = node.module.call(
            module_inputs,
            module_parameters,
            time=time,
            dt=dt,
            state=mode_states.get(node_id, {}),
        )
        mode_states[node_id] = dict(module_result.get("state") or {})
        output_map = module_result["outputs"]
        module_output_names = tuple(node.module.outputs or ())
        outputs = {}
        for index, output_name in enumerate(output_names):
            module_output_name = module_output_names[index] if index < len(module_output_names) else output_name
            outputs[output_name] = _ensure_port_value(node, "output", index, output_map.get(module_output_name, _default_output_value(node, index)))
    elif node.type == "gain_block":
        value = _scale_signal(inputs[0] if inputs else _default_input_value(node, 0), node.parameters.get("gain", 1.0))
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    elif node.type == "sum_block":
        value = _sum_block_value(inputs, node.parameters)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    elif node.type == "mux_block":
        value = list(inputs)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    elif node.type == "instrument_scope":
        value = inputs[0] if inputs else _default_input_value(node, 0)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    else:
        value = inputs[0] if inputs else _default_input_value(node, 0)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}

    if mode == "actual":
        for index, output_name in enumerate(output_names):
            outputs[output_name] = fault_runtime.apply_node_output(
                node_id,
                outputs.get(output_name, 0.0),
                time,
                output_name=output_name,
                is_primary=index == 0,
            )
        for index, output_name in enumerate(output_names):
            outputs[output_name] = _ensure_port_value(node, "output", index, outputs[output_name])

    cache[key] = copy.deepcopy(outputs)
    next_values[key] = copy.deepcopy(outputs)
    component_outputs.setdefault(mode, {})[node_id] = copy.deepcopy(outputs)
    visiting.remove(key)
    return cache[key]


def _time_values(duration, step_size):
    values = []
    current = 0.0
    while current < duration - 1e-12:
        values.append(_round_time(current))
        current += step_size
    return values


def _evaluate_measurement(graph, measurement, mode, time, cache, fault_runtime, module_states, dt, previous_values, next_values, component_outputs):
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
            component_outputs,
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

    value = _edge_value(graph, edge, mode, time, cache, fault_runtime, module_states, dt, set(), previous_values, next_values, component_outputs)
    if isinstance(value, list):
        return value[min(max(measurement.vector_index, 0), len(value) - 1)] if value else 0.0
    return value


def _empty_channels(graph):
    channels = {}
    for measurement in graph.measurements:
        channels[f"{measurement.id}.actual"] = []
        channels[f"{measurement.id}.reference"] = []
    return channels


def _evaluate_all_component_outputs(graph, mode, time, cache, fault_runtime, module_states, dt, previous_values, next_values, component_outputs):
    for node_id in graph.nodes:
        _evaluate_node(
            graph,
            node_id,
            mode,
            time,
            cache,
            fault_runtime,
            module_states,
            dt,
            set(),
            previous_values,
            next_values,
            component_outputs,
        )


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

    def restart(self):
        current_faults = self.fault_runtime.fault_instances
        self.step_index = 0
        self.fault_runtime = FaultRuntime(current_faults)
        self.module_states = {"actual": {}, "reference": {}}
        self.previous_values = {}

    def run_from_zero(self):
        self.restart()
        return self.step(len(self.times))

    def step(self, steps=1):
        requested_steps = max(0, int(steps))
        remaining_steps = max(0, len(self.times) - self.step_index)
        sample_count = min(requested_steps, remaining_steps)
        times = []
        channels = _empty_channels(self.graph)
        component_output_steps = []
        events = []

        for _ in range(sample_count):
            time = self.times[self.step_index]
            times.append(time)
            cache = {}
            next_values = {}
            component_outputs = {"actual": {}, "reference": {}}
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
                    component_outputs,
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
                    component_outputs,
                )
                channels[f"{measurement.id}.actual"].append(actual)
                channels[f"{measurement.id}.reference"].append(reference)
            _evaluate_all_component_outputs(
                self.graph,
                "actual",
                time,
                cache,
                self.fault_runtime,
                self.module_states,
                self.graph.step_size,
                self.previous_values,
                next_values,
                component_outputs,
            )
            _evaluate_all_component_outputs(
                self.graph,
                "reference",
                time,
                cache,
                self.fault_runtime,
                self.module_states,
                self.graph.step_size,
                self.previous_values,
                next_values,
                component_outputs,
            )
            component_output_steps.append({
                "time": time,
                "actual": component_outputs["actual"],
                "reference": component_outputs["reference"],
            })
            self.previous_values.update(next_values)
            self.step_index += 1

        return {
            "runId": self.run_id,
            "status": "success",
            "curves": {"time": times, "channels": channels},
            "componentOutputs": {"time": times, "steps": component_output_steps},
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
