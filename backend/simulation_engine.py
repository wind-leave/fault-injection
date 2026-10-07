import copy
import math
import re
import threading
import time

from backend.fault_runtime import FaultRuntime
from backend.schemas import (
    SimulationBackendError,
    ensure_number,
    ensure_rf_complex_envelope,
    ensure_rf_complex_envelope_batch,
)
from backend.simulation_functions import deterministic_gaussian_noise, deterministic_noise, first_numeric as _first_numeric, periodic_gate


# The one-shot endpoint is primarily used for offline runs.  It may process a
# long envelope timeline, while interactive session calls remain capped by the
# separate per-response limit below.
MAX_FULL_RUN_SAMPLES = 20_000_000
DEFAULT_SIMULATION_SESSION_IDLE_TIMEOUT_SECONDS = 900.0


def _validate_full_run_sample_count(sample_count):
    if sample_count > MAX_FULL_RUN_SAMPLES:
        raise SimulationBackendError(
            "SIMULATION_LIMIT_EXCEEDED",
            "simulationConfig.samples",
            f"full simulation sample count exceeds the limit of {MAX_FULL_RUN_SAMPLES}",
        )


def _round_time(value):
    # Preserve a 0.01 ps (1e-14 s) simulation step in emitted timelines.
    return round(float(value) + 0.0, 18)


def _text(value):
    return str(value or "").strip().lower()


def _rf_noise(node_id, step_index, time):
    seed = sum(ord(char) for char in str(node_id or "rf"))
    return deterministic_noise(seed, step_index, time)


def _rf_gaussian_noise(node_id, time):
    """Generate one independent wideband RF-noise sample per simulation time."""
    seed = sum(ord(char) for char in str(node_id or "rf"))
    # Timelines preserve 10 fs precision.  This makes adjacent RF simulation
    # samples distinct without relying on mutable source-node state.
    sample_index = int(round(float(time) * 1e15))
    return deterministic_gaussian_noise(seed, sample_index, 0.0)


def _add_configured_rf_noise(node, value, time):
    """Apply configurable broadband Gaussian noise after RF modulation.

    The noise is deliberately sampled at every RF simulation point rather
    than being held for the configured noise-bandwidth interval.  The old
    hold behavior produced a near-DC offset over an FFT window, leaving the
    spectrum baseline empty instead of creating a broadband noise floor.
    """
    params = node.parameters
    enabled = str(params.get("additiveNoiseEnabled", "")).strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return value
    snr = _first_numeric(params, ("additiveNoiseSnrDb",), 20.0)
    bandwidth = max(1.0, _first_numeric(params, ("additiveNoiseBandwidthHz",), 1e6))
    reference_amplitude = abs(_first_numeric(params, ("amplitude", "power", "value"), 0.0))
    noise_scale = math.pow(10.0, -snr / 20.0) * math.sqrt(bandwidth / 1e6)
    # The carrier is represented by peak voltage, whereas Gaussian noise is
    # specified by RMS magnitude.  Retain the existing bandwidth normalization
    # so the source's noise-bandwidth control continues to set noise density.
    noise_rms = reference_amplitude / math.sqrt(2.0) * noise_scale
    return value + noise_rms * _rf_gaussian_noise(node.id, time)


def _add_configured_rf_complex_noise(node, envelope, time):
    params = node.parameters
    enabled = str(params.get("additiveNoiseEnabled", "")).strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return envelope
    snr = _first_numeric(params, ("additiveNoiseSnrDb",), 20.0)
    bandwidth = max(1.0, _first_numeric(params, ("additiveNoiseBandwidthHz",), 1e6))
    reference_amplitude = abs(_first_numeric(params, ("amplitude", "power"), 0.0))
    noise_scale = math.pow(10.0, -snr / 20.0) * math.sqrt(bandwidth / 1e6)
    component_rms = reference_amplitude * noise_scale / math.sqrt(2.0)
    return {
        **envelope,
        "i": envelope["i"] + component_rms * _rf_gaussian_noise(f"{node.id}:i", time),
        "q": envelope["q"] + component_rms * _rf_gaussian_noise(f"{node.id}:q", time),
    }


def _trapezoid_pulse_gate(time, period, width, rise_time, fall_time):
    if period <= 0.0 or width <= 0.0:
        return 0.0
    phase = time % period
    if phase >= width:
        return 0.0
    rise = min(max(0.0, rise_time), width)
    fall = min(max(0.0, fall_time), width)
    if rise + fall > width and rise + fall > 0.0:
        scale = width / (rise + fall)
        rise *= scale
        fall *= scale
    if rise > 0.0 and phase < rise:
        return phase / rise
    if fall > 0.0 and phase >= width - fall:
        return max(0.0, (width - phase) / fall)
    return 1.0


def _rf_complex_envelope_source_value(node, time):
    """Generate I/Q directly; the RF carrier is represented by its reference frequency."""
    params = node.parameters
    amplitude = _first_numeric(params, ("amplitude", "power"), 0.0)
    modulation = "pulse" if _first_numeric(params, ("rfComplexEnvelopeOutput",), 0.0) > 0.0 else (_text(params.get("rfModulation")) or "cw")
    reference_frequency = max(0.0, _first_numeric(params, ("centerFrequencyHz", "frequency"), 0.0))
    impedance = 50.0
    modulation_rate = max(1e-6, _first_numeric(params, ("modulationRateHz",), 1.0))
    modulation_phase = 2.0 * math.pi * modulation_rate * time
    magnitude = amplitude
    phase = _first_numeric(params, ("initialPhaseRad", "phase"), 0.0)

    if modulation == "am":
        depth = min(1.0, max(0.0, _first_numeric(params, ("modulationDepthRatio",), 0.0)))
        magnitude *= 1.0 + depth * math.sin(modulation_phase)
    elif modulation == "fm":
        deviation = max(0.0, _first_numeric(params, ("frequencyDeviationHz",), 0.0))
        phase += min(deviation / modulation_rate, 1000.0) * math.sin(modulation_phase)
    elif modulation == "pm":
        phase += _first_numeric(params, ("phaseDeviationRad",), 0.0) * math.sin(modulation_phase)
    elif modulation == "pulse":
        period = _first_numeric(params, ("pulsePeriodSeconds",), 0.0)
        if period <= 0.0:
            period = 1.0 / max(1e-6, _first_numeric(params, ("prfHz",), 1.0))
        width = min(period, max(0.0, _first_numeric(params, ("pulseWidthSeconds",), 0.0)))
        # RF complex envelopes have an ideal rectangular pulse contract;
        # rise/fall controls are intentionally not exported or applied.
        magnitude *= _trapezoid_pulse_gate(
            time,
            period,
            width,
            0.0,
            0.0,
        )
    elif modulation == "digital":
        bandwidth = max(1e-6, _first_numeric(params, ("bandwidthHz",), 1.0))
        symbol_rate = max(1e-6, _first_numeric(params, ("symbolRateHz",), bandwidth))
        sample_rate = _first_numeric(params, ("sampleRateHz",), symbol_rate * 2.0)
        effective_rate = min(symbol_rate, max(sample_rate / 2.0, 1e-6))
        symbol_index = math.floor(time * effective_rate)
        magnitude *= 1.0 if _rf_noise(node.id, symbol_index, time) >= 0.0 else -1.0

    envelope = {
        "i": magnitude * math.cos(phase),
        "q": magnitude * math.sin(phase),
        "referenceFrequencyHz": reference_frequency,
        "impedanceOhm": impedance,
        "unit": "V",
    }
    if modulation == "noise":
        snr = _first_numeric(params, ("snrDb",), 0.0)
        bandwidth = max(1.0, _first_numeric(params, ("bandwidthHz",), 1e6))
        component_rms = abs(amplitude) * math.pow(10.0, -snr / 20.0) * math.sqrt(bandwidth / 1e6) / math.sqrt(2.0)
        envelope["i"] += component_rms * _rf_gaussian_noise(f"{node.id}:mod-i", time)
        envelope["q"] += component_rms * _rf_gaussian_noise(f"{node.id}:mod-q", time)
    return _add_configured_rf_complex_noise(node, envelope, time)


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
        return _add_configured_rf_noise(node, power * (1.0 + depth * math.sin(modulation_phase)) * carrier, time)
    if modulation == "fm":
        deviation = max(0.0, _first_numeric(params, ("frequencyDeviationHz",), 0.0))
        index = min(deviation / modulation_rate, 1000.0)
        return _add_configured_rf_noise(node, power * math.sin(carrier_phase + index * math.sin(modulation_phase)), time)
    if modulation == "pm":
        deviation = _first_numeric(params, ("phaseDeviationRad",), 0.0)
        return _add_configured_rf_noise(node, power * math.sin(carrier_phase + deviation * math.sin(modulation_phase)), time)
    if modulation == "pulse":
        period = _first_numeric(params, ("pulsePeriodSeconds",), 0.0)
        if period <= 0.0:
            # Compatibility with executable packages created before 重周
            # replaced PRF in the signal-source configuration.
            prf = max(1e-6, _first_numeric(params, ("prfHz",), 1.0))
            period = 1.0 / prf
        width = min(period, max(0.0, _first_numeric(params, ("pulseWidthSeconds",), 0.0)))
        return _add_configured_rf_noise(node, power * carrier if periodic_gate(time, period, width) else 0.0, time)
    if modulation == "digital":
        bandwidth = max(1e-6, _first_numeric(params, ("bandwidthHz",), 1.0))
        symbol_rate = max(1e-6, _first_numeric(params, ("symbolRateHz",), bandwidth))
        sample_rate = _first_numeric(params, ("sampleRateHz",), symbol_rate * 2.0)
        effective_rate = min(symbol_rate, max(sample_rate / 2.0, 1e-6))
        symbol_index = math.floor(time * effective_rate)
        symbol = 1.0 if _rf_noise(node.id, symbol_index, time) >= 0.0 else -1.0
        return _add_configured_rf_noise(node, power * symbol * carrier, time)
    if modulation == "noise":
        snr = _first_numeric(params, ("snrDb",), 0.0)
        bandwidth = max(1.0, _first_numeric(params, ("bandwidthHz",), 1e6))
        noise_scale = math.pow(10.0, -snr / 20.0) * math.sqrt(bandwidth / 1e6)
        signal = power * carrier + abs(power) / math.sqrt(2.0) * noise_scale * _rf_gaussian_noise(node.id, time)
        return _add_configured_rf_noise(node, signal, time)
    return _add_configured_rf_noise(node, power * carrier, time)


def _source_value(node, time):
    params = node.parameters
    output_ports = getattr(node, "output_ports", ())
    if output_ports and output_ports[0]["dataType"] == "rf_complex_envelope":
        vector_length = int(_first_numeric(params, ("rfComplexEnvelopeVectorLength",), 0.0))
        if vector_length > 0:
            envelope = _rf_complex_envelope_source_value(node, time)
            return [dict(envelope) for _ in range(vector_length)]
        if isinstance(params.get("value"), list):
            return ensure_rf_complex_envelope_batch(params["value"], "parameters.value")
        if _text(params.get("signalDomain")) == "rf" or _first_numeric(params, ("rfComplexEnvelopeOutput",), 0.0) > 0.0:
            return _rf_complex_envelope_source_value(node, time)
        value = params.get("value")
        if isinstance(value, dict):
            return ensure_rf_complex_envelope(value, "parameters.value")
        return _default_output_value(node, 0)
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


def _rf_input_descriptor(graph, node, input_index, mode, fault_runtime, time):
    """Describe a directly connected RF source without sampling its carrier."""
    edge = next(
        (
            candidate for candidate in graph.incoming.get(node.id, [])
            if candidate.target_port_index == input_index
        ),
        None,
    )
    if edge is None:
        return None
    source = graph.nodes[edge.source_node_id]
    if source.type != "signal_source" or _text(source.parameters.get("signalDomain")) != "rf":
        return None

    params = source.parameters
    amplitude = _first_numeric(params, ("amplitude", "power", "value"), 0.0)
    modulation = _text(params.get("rfModulation")) or "cw"
    phase_rad = _first_numeric(params, ("phase",), 0.0)
    modulation_rate = max(1e-6, _first_numeric(params, ("modulationRateHz",), 1.0))
    modulation_phase = 2.0 * math.pi * modulation_rate * time
    if modulation == "am":
        depth = min(1.0, max(0.0, _first_numeric(params, ("modulationDepthRatio",), 0.0)))
        amplitude *= 1.0 + depth * math.sin(modulation_phase)
    elif modulation == "fm":
        deviation = max(0.0, _first_numeric(params, ("frequencyDeviationHz",), 0.0))
        phase_rad += min(deviation / modulation_rate, 1000.0) * math.sin(modulation_phase)
    elif modulation == "pm":
        phase_rad += _first_numeric(params, ("phaseDeviationRad",), 0.0) * math.sin(modulation_phase)
    elif modulation == "pulse":
        period = _first_numeric(params, ("pulsePeriodSeconds",), 0.0)
        width = min(period, max(0.0, _first_numeric(params, ("pulseWidthSeconds",), 0.0)))
        if period <= 0.0 or not periodic_gate(time, period, width):
            amplitude = 0.0
    elif modulation == "digital":
        symbol_rate = max(1e-6, _first_numeric(params, ("symbolRateHz", "bandwidthHz"), 1.0))
        symbol = 1.0 if _rf_noise(source.id, math.floor(time * symbol_rate), time) >= 0.0 else -1.0
        amplitude *= symbol
    elif modulation == "noise":
        # Preserve the sampled implementation for noise-like waveforms.
        return None
    if mode == "actual":
        amplitude = fault_runtime.apply_edge_value(edge.id, amplitude, time)
        input_name = node.module.inputs[input_index] if input_index < len(node.module.inputs) else "rf_input"
        amplitude = fault_runtime.apply_node_input(node.id, input_name, amplitude, time)
    return {
        "frequency_hz": max(0.0, _first_numeric(params, ("centerFrequencyHz", "frequency"), 0.0)),
        "amplitude": amplitude,
        "phase_rad": phase_rad,
    }


def _default_input_value(node, index):
    if index < len(node.input_ports):
        port = node.input_ports[index]
        if port["dataType"] == "vector":
            return [0.0] * int(port["vectorLength"])
        if port["dataType"] == "rf_complex_envelope":
            return _default_rf_complex_envelope(port)
    return 0.0


def _default_outputs(node):
    return {
        output_name: _default_output_value(node, index)
        for index, output_name in enumerate(node.output_names)
    }


def _default_output_value(node, index):
    if index < len(node.output_ports):
        port = node.output_ports[index]
        if port["dataType"] == "vector":
            return [0.0] * int(port["vectorLength"])
        if port["dataType"] == "rf_complex_envelope":
            return _default_rf_complex_envelope(port)
    return 0.0


def _default_rf_complex_envelope(port):
    value = {
        "i": 0.0,
        "q": 0.0,
        "referenceFrequencyHz": float(port.get("referenceFrequencyHz") or 0.0),
    }
    impedance = port.get("impedanceOhm")
    if isinstance(impedance, (int, float)) and not isinstance(impedance, bool) and impedance > 0.0:
        value["impedanceOhm"] = float(impedance)
    if str(port.get("unit", "")).strip():
        value["unit"] = str(port["unit"]).strip()
    vector_length = port.get("vectorLength")
    if isinstance(vector_length, int) and not isinstance(vector_length, bool) and vector_length > 0:
        return [dict(value) for _ in range(vector_length)]
    return value


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
    if port["dataType"] == "rf_complex_envelope":
        vector_length = port.get("vectorLength")
        if isinstance(vector_length, int) and (not isinstance(value, list) or len(value) != vector_length):
            raise SimulationBackendError(
                "PORT_SHAPE_MISMATCH",
                f"nodes.{node.id}.{direction}s[{index}]",
                f"{port['name']} must be a complex-envelope vector of length {vector_length}",
            )
        if isinstance(value, list):
            return ensure_rf_complex_envelope_batch(value, f"nodes.{node.id}.{direction}s[{index}]")
        return ensure_rf_complex_envelope(value, f"nodes.{node.id}.{direction}s[{index}]")
    if port.get("allowsVector") and isinstance(value, list):
        return [ensure_number(item, f"nodes.{node.id}.{direction}s[{index}][{item_index}]") for item_index, item in enumerate(value)]
    return ensure_number(value, f"nodes.{node.id}.{direction}s[{index}]")


def _ensure_normalized_output_port_value(node, index, value):
    """Check a module output's port shape after generic value normalization.

    PreparedModuleCall has already checked every numeric value and made an
    independent list/dict. Only the declared port shape can still differ.
    Fall back to the full validator for invalid values so errors stay precise.
    """
    if index >= len(node.output_ports):
        return value
    port = node.output_ports[index]
    data_type = port["dataType"]
    if data_type == "vector":
        if isinstance(value, list) and len(value) == port["vectorLength"] and isinstance(value[0], float):
            return value
    elif data_type == "rf_complex_envelope":
        length = port.get("vectorLength")
        if isinstance(value, dict) and not isinstance(length, int):
            return value
        if isinstance(value, list) and value and isinstance(value[0], dict) and (
            not isinstance(length, int) or len(value) == length
        ):
            return value
    elif isinstance(value, float) or (port.get("allowsVector") and isinstance(value, list) and isinstance(value[0], float)):
        return value
    return _ensure_port_value(node, "output", index, value)


def _scale_signal(value, scale):
    if isinstance(value, list):
        return [_scale_signal(item, scale) for item in value]
    if isinstance(value, dict):
        envelope = ensure_rf_complex_envelope(value, "signal")
        return {
            **envelope,
            "i": envelope["i"] * float(scale),
            "q": envelope["q"] * float(scale),
        }
    return float(value) * float(scale)


def _add_signal(left, right):
    if isinstance(left, list) or isinstance(right, list):
        if not isinstance(left, list) or not isinstance(right, list) or len(left) != len(right):
            raise SimulationBackendError("PORT_SHAPE_MISMATCH", "sum_block", "sum inputs must have identical vector lengths")
        return [_add_signal(left_item, right_item) for left_item, right_item in zip(left, right)]
    if isinstance(left, dict) or isinstance(right, dict):
        if not isinstance(left, dict) or not isinstance(right, dict):
            raise SimulationBackendError("PORT_TYPE_MISMATCH", "sum_block", "sum inputs must use the same signal type")
        left_envelope = ensure_rf_complex_envelope(left, "sum_block.left")
        right_envelope = ensure_rf_complex_envelope(right, "sum_block.right")
        if left_envelope["referenceFrequencyHz"] != right_envelope["referenceFrequencyHz"]:
            raise SimulationBackendError(
                "PORT_FREQUENCY_MISMATCH",
                "sum_block",
                "RF complex-envelope inputs must share a reference frequency",
            )
        return {
            **left_envelope,
            "i": left_envelope["i"] + right_envelope["i"],
            "q": left_envelope["q"] + right_envelope["q"],
        }
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


def _copy_normalized_signal(value):
    """Copy a validated port value without traversing immutable metadata.

    Port validation restricts values to numbers, numeric lists, flat RF
    envelopes, and lists of flat RF envelopes. Each consumer still owns its
    list and envelope dictionaries, including when a component mutates input.
    """
    if isinstance(value, dict):
        return value.copy()
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            return [envelope.copy() for envelope in value]
        return value.copy()
    return value


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
    value = source_outputs.get(edge.source_output_name, 0.0)
    if mode != "actual" or (not fault_runtime.fault_instances and edge.id not in fault_runtime.disconnected_edge_ids):
        # A declared output port validates and normalizes its signal before
        # caching it. Legacy outputs without metadata retain the general copy.
        if edge.source_output_validated:
            return _copy_normalized_signal(value)
        return copy.deepcopy(value)
    # The fault runtime owns copies used by delayed, held, or disconnected edges.
    return fault_runtime.apply_edge_value(edge.id, value, time)


def _power_type(port):
    declared = str(port.get("supplyType", "")).upper()
    if declared in {"AC", "DC"}:
        return declared
    unit = str(port.get("unit", "")).upper()
    if "AC" in unit:
        return "AC"
    if "DC" in unit:
        return "DC"
    return ""


def _source_supply_type(node, port):
    """Resolve an electrical source's supply type even if port units are absent."""
    declared = _power_type(port)
    if declared:
        return declared
    module_id = getattr(node.module, "module_id", "")
    if module_id in {"electrical_dc_power_source", "electrical_ac_dc_matching", "electrical_dc_boost"}:
      return "DC"
    if module_id == "electrical_ac_power_source":
        return "AC"
    return ""


def _power_voltage(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().upper()
    match = re.search(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _source_power_voltage(graph, node, visited=None):
    """Resolve a source's rated output voltage, including electrical converters."""
    visited = set(visited or ())
    if node.id in visited:
        return None
    visited.add(node.id)

    for key in ("voltage_rms", "output_voltage", "voltage", "value"):
        value = _power_voltage(node.parameters.get(key))
        if value is not None:
            return value

    module_id = getattr(node.module, "module_id", "")
    if module_id not in {"electrical_ac_dc_matching", "electrical_dc_boost"}:
        return None

    source_voltage = None
    for edge in graph.edges:
        if edge.target_node_id != node.id or edge.target_port_index >= len(node.input_ports):
            continue
        source_node = graph.nodes[edge.source_node_id]
        source_voltage = _source_power_voltage(graph, source_node, visited)
        if source_voltage is not None:
            break
    if source_voltage is None:
        return None

    if module_id == "electrical_ac_dc_matching":
        return source_voltage * max(0.0, float(node.parameters.get("conversion_gain", 1.0)))
    return source_voltage * max(0.0, float(node.parameters.get("boost_ratio", 1.0))) * max(
        0.0, float(node.parameters.get("efficiency", 1.0))
    )


def _input_rated_voltage(graph, node):
    """Return the rated voltage of the first connected signal input source."""
    for edge in graph.edges:
        if edge.target_node_id != node.id or edge.target_port_index >= len(node.input_ports):
            continue
        voltage = _source_power_voltage(graph, graph.nodes[edge.source_node_id])
        if voltage is not None:
            return voltage
    return None


def _is_powered(graph, node):
    """A supply must be connected with the configured type and rated voltage."""
    if not node.requires_power:
        return True
    supply_start = len(node.input_ports)
    for power_index, required_port in enumerate(node.power_input_ports):
        matched = False
        for edge in graph.edges:
            if edge.target_node_id != node.id or edge.target_port_index != supply_start + power_index:
                continue
            source_node = graph.nodes[edge.source_node_id]
            if edge.source_port_index >= len(source_node.output_ports):
                continue
            source_port = source_node.output_ports[edge.source_port_index]
            if _source_supply_type(source_node, source_port) != _power_type(required_port):
                continue
            source_voltage = _source_power_voltage(graph, source_node)
            required_voltage = _power_voltage(required_port.get("voltage"))
            if source_voltage is None or required_voltage is None:
                continue
            if abs(source_voltage - required_voltage) <= max(0.01, abs(required_voltage) * 0.01):
                matched = True
                break
        if not matched:
            return False
    return True


def _evaluate_node(graph, node_id, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values, component_outputs):
    key = (mode, node_id)
    if key in cache:
        return cache[key]
    if key in visiting:
        if key in previous_values:
            return copy.deepcopy(previous_values[key])
        return _default_outputs(graph.nodes[node_id])

    visiting.add(key)
    node = graph.nodes[node_id]
    incoming_edges, input_count, missing_input_indices = graph.input_plans[node_id]
    inputs = [0.0] * input_count
    for index in missing_input_indices:
        inputs[index] = _default_input_value(node, index)
    # Keep the original edge order: feedback paths depend on traversal order.
    for edge in incoming_edges:
        upstream = _edge_value(graph, edge, mode, time, cache, fault_runtime, module_states, dt, visiting, previous_values, next_values, component_outputs)
        inputs[edge.target_port_index] = upstream

    output_names = node.output_names
    if node.type == "signal_source":
        value = _source_value(node, time)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}
    elif node.type == "simulation_block" and not _is_powered(graph, node):
        outputs = _default_outputs(node)
    elif node.type == "simulation_block":
        module_inputs = {}
        has_faults = bool(fault_runtime.fault_instances)
        for index, input_name in node.module_input_bindings:
            input_value = inputs[index] if index < len(inputs) else 0.0
            module_inputs[input_name] = (
                fault_runtime.apply_node_input(node_id, input_name, input_value, time)
                if mode == "actual" and has_faults
                else input_value
            )
        if mode == "actual" and has_faults:
            module_parameters = {
                name: spec.get("default", 0.0)
                for name, spec in node.module.parameters.items()
            }
            module_parameters.update(node.parameters)
            module_parameters = fault_runtime.apply_node_parameters(node_id, module_parameters, time)
        else:
            # RegisteredModule resolves missing defaults. Reuse the node's
            # parameter mapping so the prepared call can detect changes.
            module_parameters = node.parameters
        mode_states = module_states.setdefault(mode, {})
        module_state = dict(mode_states.get(node_id, {}))
        if node.module.module_id == "electrical_ac_dc_matching":
            input_rms = _input_rated_voltage(graph, node)
            if input_rms is not None:
                module_state["ac_input_rms"] = input_rms
        if node.module.module_id == "rf_downconverter":
            selected_index = 1 if int(float(module_parameters.get("input_mode", 1))) == 2 else 0
            descriptor = _rf_input_descriptor(graph, node, selected_index, mode, fault_runtime, time)
            if descriptor is None:
                module_state.pop("rf_input_descriptor", None)
            else:
                module_state["rf_input_descriptor"] = descriptor
        if node.prepared_call is not None:
            module_result = node.prepared_call.call(
                module_inputs,
                module_parameters,
                time=time,
                dt=dt,
                state=module_state,
                validated_inputs=node.prepared_call.trusted_inputs and (
                    mode == "reference" or (not has_faults and not fault_runtime.disconnected_edge_ids)
                ),
            )
        else:
            module_result = node.module.call(
                module_inputs,
                module_parameters,
                time=time,
                dt=dt,
                state=module_state,
            )
        mode_states[node_id] = dict(module_result.get("state") or {})
        output_map = module_result["outputs"]
        outputs = {}
        for index, output_name, module_output_name in node.module_output_bindings:
            output_value = (
                output_map[module_output_name]
                if module_output_name in output_map
                else _default_output_value(node, index)
            )
            outputs[output_name] = (
                _ensure_normalized_output_port_value(node, index, output_value)
                if node.prepared_call is not None
                else _ensure_port_value(node, "output", index, output_value)
            )
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
    elif node.type == "display_console":
        outputs = {
            output_name: _ensure_port_value(node, "output", index, inputs[index] if index < len(inputs) else 0.0)
            for index, output_name in enumerate(output_names)
        }
    else:
        value = inputs[0] if inputs else _default_input_value(node, 0)
        outputs = {output_names[0]: _ensure_port_value(node, "output", 0, value)}

    if mode == "actual" and fault_runtime.fault_instances:
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

    # Downstream edges receive their own values. The step-local cache and
    # previous-step state can share these outputs; reported values are copied
    # when they are added to the public trace.
    cache[key] = outputs
    next_values[key] = outputs
    component_outputs.setdefault(mode, {})[node_id] = outputs
    visiting.remove(key)
    return cache[key]


def _time_values(duration, step_size):
    values = []
    current = 0.0
    tolerance = math.ulp(max(abs(float(duration)), abs(float(step_size)))) * 8
    while current < duration - tolerance:
        values.append(_round_time(current))
        current += step_size
    return values


def _step_count(duration, step_size):
    return max(0, int(math.ceil(float(duration) / float(step_size) - 1e-12)))


def _evaluate_measurement(graph, measurement, mode, time, cache, fault_runtime, module_states, dt, previous_values, next_values, component_outputs):
    node = graph.nodes[measurement.scope_node_id]
    if node.type != "instrument_scope":
        return copy.deepcopy(_evaluate_node(
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
        ))

    edge = measurement.source_edge
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


def _reported_component_outputs(graph, component_outputs):
    selected = graph.recorded_node_ids
    return {
        mode: {
            node_id: copy.deepcopy(outputs)
            for node_id, outputs in values.items()
            if node_id in selected
        }
        for mode, values in component_outputs.items()
    }


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
    def __init__(
        self,
        graph,
        run_id="",
        idle_timeout_seconds=DEFAULT_SIMULATION_SESSION_IDLE_TIMEOUT_SECONDS,
    ):
        self.lock = threading.RLock()
        self.graph = graph
        self.run_id = run_id
        self.created_at = time.time()
        self.last_activity_at = self.created_at
        self.idle_timeout_seconds = idle_timeout_seconds
        # Keep the timeline implicit. High-frequency simulations can have a
        # very large number of possible samples, while interactive sessions
        # request only a small batch at a time.
        self.total_steps = _step_count(graph.duration, graph.step_size)
        self.step_index = 0
        self.fault_runtime = FaultRuntime(graph.fault_instances)
        self.module_states = {"actual": {}, "reference": {}}
        self.previous_values = {}
        self._single_path_was_used = False
        self._paths_diverged = False
        self._actual_only_run_requested = False

    @property
    def done(self):
        return self.step_index >= self.total_steps

    @property
    def current_time(self):
        if self.done:
            return _round_time(self.graph.duration)
        return _round_time(self.step_index * self.graph.step_size)

    def touch(self, now=None):
        self.last_activity_at = time.time() if now is None else float(now)

    def is_expired(self, now=None):
        if self.idle_timeout_seconds is None:
            return False
        checked_at = time.time() if now is None else float(now)
        return checked_at - self.last_activity_at >= self.idle_timeout_seconds

    def restart(self):
        current_faults = self.fault_runtime.fault_instances
        self.step_index = 0
        self.fault_runtime = FaultRuntime(current_faults)
        self.module_states = {"actual": {}, "reference": {}}
        self.previous_values = {}
        self._single_path_was_used = False
        self._paths_diverged = False

    def create_state_snapshot(self):
        """Capture all mutable simulation state touched by a practice action."""
        return {
            "stepIndex": self.step_index,
            "graphFaultInstances": copy.deepcopy(self.graph.fault_instances),
            "faultRuntime": copy.deepcopy(self.fault_runtime),
            "nodeParameters": {
                node_id: copy.deepcopy(node.parameters)
                for node_id, node in self.graph.nodes.items()
            },
            "moduleStates": copy.deepcopy(self.module_states),
            "previousValues": copy.deepcopy(self.previous_values),
            "singlePathWasUsed": self._single_path_was_used,
            "pathsDiverged": self._paths_diverged,
        }

    def restore_state_snapshot(self, snapshot):
        """Restore a snapshot while preserving graph container identities."""
        self.step_index = snapshot["stepIndex"]

        for node_id, parameters in snapshot["nodeParameters"].items():
            node = self.graph.nodes[node_id]
            node.parameters.clear()
            node.parameters.update(copy.deepcopy(parameters))

        self.graph.fault_instances[:] = copy.deepcopy(snapshot["graphFaultInstances"])
        restored_fault_runtime = copy.deepcopy(snapshot["faultRuntime"])
        # FaultRuntime and the executable graph intentionally share fault
        # dictionaries so that repairs are visible to subsequent reruns.
        restored_fault_runtime.fault_instances = self.graph.fault_instances
        self.fault_runtime = restored_fault_runtime

        self.module_states.clear()
        self.module_states.update(copy.deepcopy(snapshot["moduleStates"]))
        self.previous_values.clear()
        self.previous_values.update(copy.deepcopy(snapshot["previousValues"]))
        self._single_path_was_used = bool(snapshot.get("singlePathWasUsed", False))
        self._paths_diverged = bool(snapshot.get("pathsDiverged", False))

    def _materialize_actual_path_from_reference(self):
        """Fork state from a previously shared reference path.

        This is needed if an interactive line-disconnect action turns a
        previously fault-free session into a dual-path session.
        """
        self.module_states["actual"] = copy.deepcopy(self.module_states["reference"])
        for key in [key for key in self.previous_values if key[0] == "actual"]:
            del self.previous_values[key]
        for (mode, node_id), value in list(self.previous_values.items()):
            if mode == "reference":
                self.previous_values[("actual", node_id)] = copy.deepcopy(value)

    def run_from_zero(self):
        _validate_full_run_sample_count(self.total_steps)
        self.restart()
        paths = ("actual",) if self._actual_only_run_requested else ("actual", "reference")
        return self.step(self.total_steps, paths=paths)

    def run_actual_from_zero(self):
        """Restart and run only the fault-bearing actual simulation path."""
        self._actual_only_run_requested = True
        try:
            # Route through run_from_zero so existing instrumentation and
            # transactional failure hooks continue to observe full reruns.
            return self.run_from_zero()
        finally:
            self._actual_only_run_requested = False

    def step(self, steps=1, *, paths=("actual", "reference")):
        self.touch()
        requested_steps = max(0, int(steps))
        remaining_steps = max(0, self.total_steps - self.step_index)
        sample_count = min(requested_steps, remaining_steps)
        actual_only = tuple(paths) == ("actual",)
        times = []
        channels = _empty_channels(self.graph)
        component_output_steps = []
        events = []

        for _ in range(sample_count):
            time = _round_time(self.step_index * self.graph.step_size)
            times.append(time)
            cache = {}
            next_values = {}
            component_outputs = {"actual": {}, "reference": {}}
            events.extend(self.fault_runtime.collect_events(time))
            single_path = (
                not actual_only
                and self.fault_runtime.can_use_single_path()
                and not self._paths_diverged
            )
            if not single_path and self._single_path_was_used:
                self._materialize_actual_path_from_reference()
                self._single_path_was_used = False
            if not single_path and not actual_only:
                self._paths_diverged = True

            if actual_only:
                for measurement in self.graph.measurements:
                    actual = _evaluate_measurement(
                        self.graph, measurement, "actual", time, cache,
                        self.fault_runtime, self.module_states, self.graph.step_size,
                        self.previous_values, next_values, component_outputs,
                    )
                    channels[f"{measurement.id}.actual"].append(actual)
                _evaluate_all_component_outputs(
                    self.graph, "actual", time, cache, self.fault_runtime,
                    self.module_states, self.graph.step_size, self.previous_values,
                    next_values, component_outputs,
                )
            elif single_path:
                for measurement in self.graph.measurements:
                    reference = _evaluate_measurement(
                        self.graph, measurement, "reference", time, cache,
                        self.fault_runtime, self.module_states, self.graph.step_size,
                        self.previous_values, next_values, component_outputs,
                    )
                    channels[f"{measurement.id}.reference"].append(reference)
                    channels[f"{measurement.id}.actual"].append(copy.deepcopy(reference))
                _evaluate_all_component_outputs(
                    self.graph, "reference", time, cache, self.fault_runtime,
                    self.module_states, self.graph.step_size, self.previous_values,
                    next_values, component_outputs,
                )
                component_outputs["actual"] = copy.deepcopy(component_outputs["reference"])
                self._single_path_was_used = True
            else:
                for measurement in self.graph.measurements:
                    actual = _evaluate_measurement(
                        self.graph, measurement, "actual", time, cache,
                        self.fault_runtime, self.module_states, self.graph.step_size,
                        self.previous_values, next_values, component_outputs,
                    )
                    reference = _evaluate_measurement(
                        self.graph, measurement, "reference", time, cache,
                        self.fault_runtime, self.module_states, self.graph.step_size,
                        self.previous_values, next_values, component_outputs,
                    )
                    channels[f"{measurement.id}.actual"].append(actual)
                    channels[f"{measurement.id}.reference"].append(reference)
                _evaluate_all_component_outputs(
                    self.graph, "actual", time, cache, self.fault_runtime,
                    self.module_states, self.graph.step_size, self.previous_values,
                    next_values, component_outputs,
                )
                _evaluate_all_component_outputs(
                    self.graph, "reference", time, cache, self.fault_runtime,
                    self.module_states, self.graph.step_size, self.previous_values,
                    next_values, component_outputs,
                )
            reported_outputs = _reported_component_outputs(self.graph, component_outputs)
            component_output_steps.append({
                "time": time,
                "actual": reported_outputs["actual"],
                "reference": reported_outputs["reference"],
            })
            self.previous_values.update(next_values)
            self.step_index += 1

        return {
            "runId": self.run_id,
            "status": "success",
            "curves": {
                "time": times,
                "channels": channels,
            },
            "componentOutputs": {
                "time": [step["time"] for step in component_output_steps],
                "steps": component_output_steps,
            },
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
    return session.run_from_zero()
