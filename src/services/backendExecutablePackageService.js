import {
  getRfVectorValues,
  getSignalSourceScalarFallback,
  isRfComplexEnvelopeOutput,
  isRfComplexEnvelopeVectorOutput,
  isRfVectorOutput,
  normalizeSignalSourceProps
} from './signalSourceDomainService.js';
import { DISPLAY_CONSOLE_INPUTS, DISPLAY_CONSOLE_PRESETS, createDisplayConsoleConfig, createDisplayConsoleVectorPort } from '../constants/displayConsoleConfig.js';

const SUPPORTED_NODE_TYPES = new Set([
  'signal_source',
  'flow_block',
  'simulation_block',
  'gain_block',
  'sum_block',
  'mux_block',
  'instrument_scope',
  'instrument_spectrum',
  'instrument_logger',
  'instrument_multimeter',
  'display_console'
]);

function sanitizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizeNumericVector(value) {
  if (!Array.isArray(value) || !value.length) {
    return null;
  }
  const vector = value.map((item) => Number(item));
  return vector.every(Number.isFinite) ? vector : null;
}

function pickNumericParameters(props = {}) {
  return Object.fromEntries(
    Object.entries(props)
      .flatMap(([key, value]) => {
        if (key === 'outputPortId') return [];
        const vector = key === 'value' ? sanitizeNumericVector(value) : null;
        if (vector) return [[key, vector]];
        return String(value ?? '').trim() !== '' && Number.isFinite(Number(value))
          ? [[key, Number(value)]]
          : [];
      })
  );
}

function parseFrequencyHz(value, unit = '') {
  const text = String(value ?? '').trim();
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const detectedUnit = text.match(/(GHz|MHz|kHz|Hz)\s*$/i)?.[1] || String(unit ?? '').trim();
  const multipliers = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
  return numeric * (multipliers[String(detectedUnit).toLowerCase()] ?? 1);
}

// 射频功率按标准 50 Ω 系统换算为正弦载波的峰值电压。
function parseRfPowerPeakVoltage(value, unit = 'dBm') {
  const text = String(value ?? '').trim();
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const detectedUnit = text.match(/(dBm|mW|W)\s*$/i)?.[1] || String(unit ?? '').trim();
  const normalizedUnit = detectedUnit.toLowerCase();
  const watts = normalizedUnit === 'dbm'
    ? 1e-3 * Math.pow(10, numeric / 10)
    : normalizedUnit === 'mw'
      ? numeric * 1e-3
      : numeric;
  return Math.sqrt(Math.max(0, watts) * 50 * 2);
}

function parseDurationSeconds(value, unit = '', fallback = 0) {
  const text = String(value ?? '').trim();
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (/ns\s*$/i.test(text)) return numeric * 1e-9;
  if (/(?:us|µs)\s*$/i.test(text)) return numeric * 1e-6;
  if (/ms\s*$/i.test(text)) return numeric * 1e-3;
  const normalizedUnit = String(unit ?? '').trim().toLowerCase().replace('µ', 'μ');
  if (normalizedUnit === 'ns') return numeric * 1e-9;
  if (normalizedUnit === 'us' || normalizedUnit === 'μs') return numeric * 1e-6;
  if (normalizedUnit === 'ms') return numeric * 1e-3;
  return numeric;
}

function addSignalSourceExecutionParameters(parameters, rawProps = {}, normalizedProps = {}) {
  if (String(rawProps.signalDomain ?? '').trim()) {
    parameters.signalDomain = normalizedProps.signalDomain;
  }
  if (String(rawProps.waveType ?? '').trim()) {
    parameters.waveType = String(rawProps.waveType).trim();
  }
  if (normalizedProps.signalDomain === 'rf') {
    const complexEnvelope = isRfComplexEnvelopeOutput(normalizedProps);
    const modulation = complexEnvelope ? 'pulse' : String(normalizedProps.modulation || 'cw').trim().toLowerCase();
    const centerFrequencyHz = parseFrequencyHz(
      normalizedProps.centerFrequency,
      normalizedProps.centerFrequencyUnit
    );
    const amplitude = parseRfPowerPeakVoltage(normalizedProps.power, normalizedProps.powerUnit);
    parameters.rfModulation = modulation;
    parameters.centerFrequencyHz = centerFrequencyHz;
    parameters.amplitude = amplitude;
    parameters.frequency = centerFrequencyHz;
    parameters.modulationRateHz = parseFrequencyHz(normalizedProps.modulationRate, 1);
    parameters.modulationDepthRatio = Math.max(0, Math.min(100, sanitizeNumber(normalizedProps.modulationDepth, 0))) / 100;
    parameters.frequencyDeviationHz = Math.max(0, parseFrequencyHz(normalizedProps.frequencyDeviation, 0));
    parameters.phaseDeviationRad = sanitizeNumber(normalizedProps.phaseDeviation, 0);
    parameters.initialPhaseRad = sanitizeNumber(normalizedProps.phase, 0);
    parameters.pulseWidthSeconds = Math.max(0, parseDurationSeconds(normalizedProps.pulseWidth, normalizedProps.pulseWidthUnit, 0));
    parameters.pulsePeriodSeconds = Math.max(0, parseDurationSeconds(normalizedProps.pulsePeriod, normalizedProps.pulsePeriodUnit, 0));
    if (!complexEnvelope) {
      parameters.riseTimeSeconds = Math.max(0, parseDurationSeconds(normalizedProps.riseTime, normalizedProps.riseTimeUnit, 0));
      parameters.fallTimeSeconds = Math.max(0, parseDurationSeconds(normalizedProps.fallTime, normalizedProps.fallTimeUnit, 0));
    }
    parameters.bandwidthHz = complexEnvelope ? 0 : Math.max(0, parseFrequencyHz(normalizedProps.bandwidth, 0));
    parameters.nominalBandwidthHz = parameters.bandwidthHz;
    parameters.impedanceOhm = 50;
    parameters.rfComplexEnvelopeOutput = complexEnvelope ? 1 : 0;
    parameters.symbolRateHz = Math.max(0, parseFrequencyHz(normalizedProps.symbolRate, 0));
    parameters.sampleRateHz = Math.max(0, parseFrequencyHz(normalizedProps.sampleRate, 0));
    parameters.snrDb = sanitizeNumber(normalizedProps.snr, 0);
    // Executable-package parameters have a numeric-only backend contract.
    // Use 0/1 rather than a boolean so adding RF noise cannot make backend
    // session creation fail and silently fall back to the legacy runtime.
    parameters.additiveNoiseEnabled = ['on', 'true', '1', 'yes'].includes(String(normalizedProps.noiseEnabled || '').trim().toLowerCase()) ? 1 : 0;
    parameters.additiveNoiseSnrDb = sanitizeNumber(normalizedProps.noiseSnr, 20);
    parameters.additiveNoiseBandwidthHz = Math.max(
      0,
      parseFrequencyHz(normalizedProps.noiseBandwidth, normalizedProps.noiseBandwidthUnit)
    );
    if (isRfVectorOutput(normalizedProps)) {
      parameters.rfVectorLength = Number(normalizedProps.rfVectorLength);
      parameters.rfVectorValues = getRfVectorValues(
        normalizedProps.rfVectorValues,
        normalizedProps.rfVectorLength
      );
    }
    if (isRfComplexEnvelopeVectorOutput(normalizedProps)) {
      parameters.rfComplexEnvelopeVectorLength = Number(normalizedProps.rfVectorLength);
    }
    if (modulation === 'cw') {
      // The backend already evaluates generic sine sources from these fields.
      // Map CW to that executable representation instead of its scalar fallback.
      parameters.waveType = 'sine';
      parameters.phase = 0;
      parameters.offset = 0;
    } else {
      parameters.waveType = `rf_${modulation}`;
    }
  }
}

function normalizeSumBlockSigns(signs, inputCount) {
  const source = Array.isArray(signs)
    ? signs
    : String(signs || '').split(/[,\s]+/).filter(Boolean);
  return Array.from({ length: Math.max(0, Math.trunc(inputCount)) }, (_, index) => (
    source[index] === '-' ? '-' : '+'
  ));
}

function addSumBlockExecutionParameters(parameters, rawProps = {}) {
  const inputCount = sanitizeNumber(rawProps.inputCount ?? parameters.inputCount, 2);
  parameters.inputCount = Math.max(2, Math.trunc(inputCount));
  parameters.signs = normalizeSumBlockSigns(rawProps.signs, parameters.inputCount);
}

function normalizePortDataType(value) {
  const text = String(value ?? 'scalar').trim().toLowerCase();
  if (['scalar', '标量', 'float', 'number'].includes(text)) return 'scalar';
  if (['vector', '向量'].includes(text)) return 'vector';
  if (['rf_complex_envelope', 'rf-complex-envelope', 'rfcomplexenvelope', '复数包络', '射频复数包络'].includes(text)) return 'rf_complex_envelope';
  return 'scalar';
}

function normalizeRfComplexEnvelopeValue(value, fallbackReferenceFrequencyHz = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const i = Number(value.i ?? value.re);
  const q = Number(value.q ?? value.im ?? 0);
  const referenceFrequencyHz = Number(value.referenceFrequencyHz ?? fallbackReferenceFrequencyHz);
  if (!Number.isFinite(i) || !Number.isFinite(q) || !Number.isFinite(referenceFrequencyHz) || referenceFrequencyHz < 0) {
    return null;
  }
  const normalized = { i, q, referenceFrequencyHz };
  const impedanceOhm = Number(value.impedanceOhm);
  if (Number.isFinite(impedanceOhm) && impedanceOhm > 0) normalized.impedanceOhm = impedanceOhm;
  if (String(value.unit ?? '').trim()) normalized.unit = String(value.unit).trim();
  return normalized;
}

function normalizeRfComplexEnvelopeVector(value, fallbackReferenceFrequencyHz = 0) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const envelopes = value.map((item) => normalizeRfComplexEnvelopeValue(item, fallbackReferenceFrequencyHz));
  return envelopes.every(Boolean) ? envelopes : null;
}

function normalizePorts(ports = []) {
  return Array.isArray(ports)
    ? ports.map((port) => {
      const name = String(port?.varName ?? port?.name ?? port?.label ?? '');
      const id = String(port?.portId ?? port?.id ?? port?.key ?? name);
      const dataType = normalizePortDataType(port?.dataType ?? port?.type);
      const shapeLength = Array.isArray(port?.shape) ? Number(port.shape[0]) : NaN;
      const vectorLength = Number(port?.vectorLength ?? port?.length ?? shapeLength);
      const vectorElementNames = Array.isArray(port?.vectorElementNames)
        ? port.vectorElementNames
          .map((elementName) => String(elementName ?? '').trim())
          .slice(0, vectorLength)
        : [];
      const elementNames = (Array.isArray(port?.elementNames) ? port.elementNames : [port?.elementName])
        .map((elementName) => String(elementName ?? '').trim())
        .filter(Boolean)
        .slice(0, 1);
      return {
        name,
        id,
        dataType,
        ...(port?.collectionKind === 'vector' ? { collectionKind: 'vector' } : {}),
        ...(port?.allowsVector ? { allowsVector: true } : {}),
        ...(port?.unit ? { unit: String(port.unit) } : {}),
        ...(dataType === 'rf_complex_envelope' && Number.isFinite(Number(port?.referenceFrequencyHz))
          ? { referenceFrequencyHz: Number(port.referenceFrequencyHz) }
          : {}),
        ...(dataType === 'rf_complex_envelope' && Number(port?.impedanceOhm) > 0
          ? { impedanceOhm: Number(port.impedanceOhm) }
          : {}),
        ...(elementNames.length ? { elementNames } : {}),
        ...((dataType === 'vector' || dataType === 'rf_complex_envelope') && Number.isInteger(vectorLength) && vectorLength > 0
          ? {
            vectorLength,
            ...(vectorElementNames.length ? { vectorElementNames } : {})
          }
          : {})
      };
    }).filter((port) => port.name)
    : [];
}

function normalizeNodePorts(node = {}, direction) {
  // Python-backed components keep their executable signal contract in
  // `node.ports`. Their `props.inputs` / `props.outputs` are also used by the
  // legacy property panel and can intentionally show the generic display type
  // “标量”. Exporting those display rows would downgrade a 复数包络 port to a
  // scalar port and make backend graph validation reject an otherwise valid
  // connection.
  const configured = normalizePorts(node?.pythonBinding?.portMapping?.[direction]);
  const declared = normalizePorts(node?.ports?.[direction]);
  const direct = declared.length
    ? declared
    : normalizePorts(node?.[direction] ?? node?.props?.[direction]);
  if (!direct.length) return configured;
  return direct.map((port, index) => {
    const configuredPort = configured[index];
    if (!configuredPort) return port;
    return {
      ...port,
      ...(Array.isArray(configuredPort.elementNames)
        ? { elementNames: configuredPort.elementNames }
        : {}),
      ...(Array.isArray(configuredPort.vectorElementNames)
        ? { vectorElementNames: configuredPort.vectorElementNames }
        : {})
    };
  });
}

function defaultScopeInput(index, props = {}) {
  const channel = `CH${index + 1}`;
  return {
    name: String(props[`inputPortNameCh${index + 1}`] || channel),
    id: channel.toLowerCase(),
    dataType: 'scalar'
  };
}

function normalizeScopeInputs(node = {}, props = {}) {
  const candidates = [node.inputs, node.props?.inputs, node.ports?.inputs];
  const declared = candidates
    .map(normalizePorts)
    .find((ports) => ports.length);
  return declared ?? [defaultScopeInput(0, props), defaultScopeInput(1, props)];
}

function normalizeDisplayConsoleInputs(node = {}, props = {}) {
  const preset = DISPLAY_CONSOLE_PRESETS[node.templateId || node.paletteKey];
  const config = preset ? createDisplayConsoleConfig(preset) : props.displayConfig;
  const inputs = Array.isArray(config?.inputs) ? config.inputs : [];
  const names = Array.isArray(props.inputPortNames) ? props.inputPortNames : [];
  const ports = Array.isArray(config?.ports) && config.ports.length ? config.ports : [{}];
  return ports.map((port, portIndex) => {
    const portInputs = Array.isArray(port?.inputs) ? port.inputs : inputs;
    const configured = Array.from({ length: DISPLAY_CONSOLE_INPUTS.length }, (_, index) => ({
      label: portInputs[index]?.label || inputs[index]?.label || names[index]
    }));
    return createDisplayConsoleVectorPort(configured, {
      id: port?.id || (portIndex === 0 ? 'console-input' : `console-input-${portIndex + 1}`),
      name: port?.name || (portIndex === 0 ? '七路参数输入' : `七路参数输入 ${portIndex + 1}`)
    });
  });
}

function alignScopeInputsWithConnectedSignals(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge) => {
    if (edge.lineType === 'power') return;
    const target = nodesById.get(edge.targetNodeId);
    if (target?.type !== 'instrument_scope') return;
    const source = nodesById.get(edge.sourceNodeId);
    const sourcePort = source?.outputs?.[Number(edge.sourcePortIndex) || 0];
    if (!sourcePort) return;

    const targetPortIndex = Math.max(0, Math.trunc(Number(edge.targetPortIndex) || 0));
    while (target.inputs.length <= targetPortIndex) {
      target.inputs.push(defaultScopeInput(target.inputs.length));
    }
    const current = target.inputs[targetPortIndex];
    target.inputs[targetPortIndex] = {
      ...current,
      dataType: sourcePort.dataType,
      ...(sourcePort.dataType === 'rf_complex_envelope' && Number.isFinite(Number(sourcePort.referenceFrequencyHz))
        ? { referenceFrequencyHz: Number(sourcePort.referenceFrequencyHz) }
        : {}),
      ...(sourcePort.dataType === 'rf_complex_envelope' && Number(sourcePort.impedanceOhm) > 0
        ? { impedanceOhm: Number(sourcePort.impedanceOhm) }
        : {}),
      ...(sourcePort.dataType === 'rf_complex_envelope' && String(sourcePort.unit || '').trim()
        ? { unit: String(sourcePort.unit).trim() }
        : {}),
      ...((sourcePort.dataType === 'vector' || sourcePort.dataType === 'rf_complex_envelope') && Number.isInteger(sourcePort.vectorLength)
        ? {
          vectorLength: sourcePort.vectorLength,
          ...(Array.isArray(sourcePort.vectorElementNames) && sourcePort.vectorElementNames.length
            ? { vectorElementNames: [...sourcePort.vectorElementNames] }
            : {})
        }
        : {})
    };
    if (sourcePort.dataType !== 'vector' && sourcePort.dataType !== 'rf_complex_envelope') {
      delete target.inputs[targetPortIndex].vectorLength;
      delete target.inputs[targetPortIndex].vectorElementNames;
    }
    if (sourcePort.dataType !== 'rf_complex_envelope') {
      delete target.inputs[targetPortIndex].referenceFrequencyHz;
      delete target.inputs[targetPortIndex].impedanceOhm;
      delete target.inputs[targetPortIndex].unit;
    }
  });
}

function alignSignalGeneratorOutputsWithTargetPorts(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.componentId !== 'XHFSQ') continue;
    const shapes = edges
      .filter((edge) => edge.sourceNodeId === node.id && edge.lineType !== 'power')
      .map((edge) => {
        const target = nodesById.get(edge.targetNodeId);
        const port = target?.inputs?.[edge.targetPortIndex];
        const length = Number(port?.vectorLength);
        return port?.collectionKind === 'vector' && Number.isInteger(length) && length > 0
          ? length : 0;
      });
    const length = shapes[0] ?? 0;
    if (shapes.some((item) => item !== length)) {
      throw new Error('信号发生器连接的输入端口需要相同的输出形态和向量长度');
    }
    const output = node.outputs[0];
    if (!output) continue;
    delete output.collectionKind;
    delete output.vectorLength;
    delete node.parameters.rfVectorLength;
    delete node.parameters.rfComplexEnvelopeVectorLength;
    delete node.parameters.value;
    if (length > 0) {
      output.collectionKind = 'vector';
      output.vectorLength = length;
      node.parameters.rfComplexEnvelopeVectorLength = length;
    }
  }
}

function normalizePowerPorts(ports = []) {
  return Array.isArray(ports)
    ? ports.map((port, index) => ({
      id: String(port?.portId ?? port?.id ?? `power-${index}`),
      name: String(port?.name ?? port?.displayName ?? `power-${index}`),
      voltage: String(port?.voltage ?? ''),
      supplyType: String(port?.supplyType ?? 'DC').toUpperCase() === 'AC' ? 'AC' : 'DC'
    })).filter((port) => port.name)
    : [];
}

function simulationBlockRequiresPower(node, props = {}) {
  if (props.requiresPower === false) return false;
  return !new Set(['DZDK_A', 'DZDK_B', 'DZDK_C', 'DZDK_D']).has(String(node?.templateId ?? node?.pythonBinding?.moduleId ?? ''));
}

function pickDeclaredSimulationParameters(props = {}) {
  const definitions = Array.isArray(props.parameters) ? props.parameters : [];
  const configured = props.parameterValues && typeof props.parameterValues === 'object'
    ? props.parameterValues
    : {};
  return Object.fromEntries(definitions.flatMap((definition) => {
    const key = String(definition?.key ?? definition?.varName ?? definition?.name ?? '').trim();
    if (!key) return [];
    const value = configured[key] ?? definition?.value ?? definition?.default;
    return Number.isFinite(Number(value)) ? [[key, Number(value)]] : [];
  }));
}

function normalizeSignalSourceOutputs(node, props) {
  // Older canvases can carry an empty top-level `outputs` array while the
  // actual port declaration lives in props (or is implicit for a source).
  // An empty declaration must not cause graph compilation to classify a
  // normal signal edge as a power edge and silently drop the source value.
  const directOutputs = normalizePorts(node.outputs);
  const outputs = directOutputs.length
    ? directOutputs
    : normalizePorts(node.props?.outputs);
  const primary = outputs[0] ?? {};
  const primaryId = props.signalDomain === 'rf'
    ? String(props.outputPortId || primary.id || 'signal')
    : (primary.id || 'signal');
  if (isRfComplexEnvelopeOutput(props)) {
    return [{
      name: primary.name || String(props.outputPortName || '输出'),
      id: primaryId,
      dataType: 'rf_complex_envelope',
      ...(isRfComplexEnvelopeVectorOutput(props)
        ? { collectionKind: 'vector', vectorLength: Number(props.rfVectorLength) }
        : {}),
      referenceFrequencyHz: parseFrequencyHz(props.centerFrequency, props.centerFrequencyUnit),
      impedanceOhm: 50,
      unit: 'V'
    }];
  }
  if (!isRfVectorOutput(props)) {
    return outputs.length
      ? (props.signalDomain === 'rf'
        ? outputs.map((output, index) => index === 0 ? { ...output, id: primaryId } : output)
        : outputs)
      : [{
      name: String(props.outputPortName || 'output'),
      id: primaryId,
      dataType: 'scalar'
    }];
  }
  const vectorLength = Number(props.rfVectorLength);
  return [{
    name: primary.name || String(props.outputPortName || '输出'),
    id: primaryId,
    dataType: 'vector',
    ...(Number.isInteger(vectorLength) && vectorLength > 0 ? { vectorLength } : {})
  }];
}

function normalizeNode(node) {
  const rawProps = node.templateId === 'XHFSQ'
    ? {
        ...(node.props ?? node.parameters ?? {}),
        signalDomain: 'rf',
        outputFormat: '复数包络',
        outputPortId: 'XHFSQ_X1'
      }
    : (node.props ?? node.parameters ?? {});
  const props = node.type === 'signal_source'
    ? normalizeSignalSourceProps(rawProps)
    : rawProps;
  const sourceOutputs = node.type === 'signal_source'
    ? normalizeSignalSourceOutputs(node, props)
    : null;
  const parameters = {
    ...pickNumericParameters(rawProps),
    ...(node.type === 'simulation_block' ? pickDeclaredSimulationParameters(rawProps) : {})
  };
  if (node.type === 'signal_source') {
    addSignalSourceExecutionParameters(parameters, rawProps, props);
    const primaryOutput = sourceOutputs[0];
    const complexEnvelope = primaryOutput?.dataType === 'rf_complex_envelope'
      ? (normalizeRfComplexEnvelopeVector(rawProps.value, primaryOutput.referenceFrequencyHz)
        ?? normalizeRfComplexEnvelopeValue(rawProps.value, primaryOutput.referenceFrequencyHz))
      : null;
    parameters.value = complexEnvelope
      ?? (isRfVectorOutput(props)
        ? getRfVectorValues(props.rfVectorValues, props.rfVectorLength)
        : (sanitizeNumericVector(rawProps.value) ?? getSignalSourceScalarFallback(props)));
  }
  if (node.type === 'sum_block') {
    addSumBlockExecutionParameters(parameters, rawProps);
  }

  const normalized = {
    id: String(node.id),
    name: String(node.props?.name ?? node.name ?? node.label ?? node.id),
    type: node.type,
    parameters,
    inputs: node.type === 'instrument_scope'
      ? normalizeScopeInputs(node, props)
      : node.type === 'display_console'
        ? normalizeDisplayConsoleInputs(node, props)
        : normalizeNodePorts(node, 'inputs'),
    outputs: node.type === 'signal_source'
      ? sourceOutputs
      : normalizeNodePorts(node, 'outputs')
  };

  if (node.templateId === 'XHFSQ') {
    normalized.componentId = 'XHFSQ';
  }

  if (node.type === 'simulation_block') {
    const moduleId = String(node.pythonBinding?.moduleId ?? '').trim() || 'passthrough';
    normalized.pythonBinding = {
      // A blank simulation block is a connection-only component until a
      // Python model is bound.  It must not make the whole backend session
      // invalid merely because it is present on the canvas.
      moduleId,
      entryFunction: String(node.pythonBinding?.entryFunction ?? 'process')
    };
    // Power terminals are deliberately separate from model signal ports: they
    // carry the execution precondition, rather than an argument to Python.
    normalized.powerInputs = simulationBlockRequiresPower(node, rawProps)
      ? normalizePowerPorts(rawProps.powerInputs)
      : [];
    normalized.powerOutputs = [];
  }

  return normalized;
}

function normalizeEdge(edge) {
  return {
    id: String(edge.id),
    label: String(edge.label ?? edge.name ?? edge.signalId ?? edge.id),
    labelCustomized: Boolean(edge.labelCustomized),
    sourceNodeId: String(edge.sourceNodeId),
    sourcePortIndex: sanitizeNumber(edge.sourcePortIndex, 0),
    targetNodeId: String(edge.targetNodeId),
    targetPortIndex: sanitizeNumber(edge.targetPortIndex, 0),
    lineType: ['power', 'can'].includes(edge.lineType) ? edge.lineType : 'normal'
  };
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '') ?? '';
}

function normalizeParameterTargetField(value) {
  const targetField = String(value ?? '').trim();
  const match = targetField.match(/^(?:params|parameter|parameters)\.([A-Za-z_$][\w$]*)$/i);
  return match ? `params.${match[1]}` : targetField;
}

function normalizeFaultType(fault = {}) {
  const key = String(firstPresent(
    fault.faultType,
    fault.backendFaultType,
    fault.runtimeBehavior,
    fault.faultTypeId,
    fault.modelId,
    fault.faultModelId
  )).trim().toLowerCase();
  const injectionForm = String(fault.injectionForm ?? '').trim().toLowerCase();
  const targetField = normalizeParameterTargetField(fault.targetField).toLowerCase();
  const parameterFault = targetField.startsWith('params.')
    || (injectionForm === 'module-variable'
      && Boolean(String(fault.parameterKey ?? fault.targetParameter ?? '').trim()));

  if (parameterFault) {
    if (/degradation|degrade|scale/.test(key)) {
      return 'parameter_degradation';
    }
    if (/freeze/.test(key)) {
      return 'parameter_freeze';
    }
    if (/random|noise/.test(key)) {
      return 'parameter_random';
    }
    if (/drift/.test(key) || fault.parameters?.rate !== undefined) {
      return 'parameter_drift';
    }
    if (/step/.test(key) || fault.parameters?.target_value !== undefined || fault.parameters?.targetValue !== undefined || fault.parameters?.step_value !== undefined || fault.parameters?.stepValue !== undefined) {
      return 'parameter_step';
    }
    if (/bias|offset|parameter/.test(key) || fault.parameters?.bias !== undefined || fault.parameters?.offset !== undefined) {
      return 'parameter_bias';
    }
  }

  if (/loss|dropout|packet/.test(key)) {
    return 'link_loss';
  }
  if (/delay|jitter/.test(key)) {
    return 'link_delay';
  }
  if (/stuck|freeze|lock/.test(key)) {
    return 'signal_stuck';
  }
  if (/data_cutoff|disconnect|cutoff/.test(key)) {
    return 'signal_cutoff';
  }
  if (/noise/.test(key)) {
    return 'noise_increase';
  }
  if (/attenuation|attenuate/.test(key)) {
    return 'signal_attenuation';
  }
  if (/efficiency/.test(key)) {
    return 'motor_efficiency_loss';
  }
  if (/physical_parameter_step|parameter_step/.test(key)) {
    return 'parameter_step';
  }
  if (/physical_parameter_drift|parameter_drift/.test(key)) {
    return 'parameter_drift';
  }
  if (/physical_parameter_bias|parameter_bias|parameter_scale/.test(key)) {
    return 'parameter_bias';
  }
  if (/bias|offset|drift|step|sensor_additive/.test(key)) {
    return 'sensor_bias';
  }

  return key || 'sensor_bias';
}

function normalizeFaultParameters(fault = {}) {
  const parameters = { ...(fault.parameters ?? {}) };
  const bias = firstPresent(parameters.bias, parameters.offset, parameters.delta_p, fault.bias, fault.offset);
  if (bias !== '') {
    parameters.bias = sanitizeNumber(bias, 0);
  }
  const targetValue = firstPresent(
    parameters.targetValue,
    parameters.target_value,
    parameters.value,
    parameters.stepValue,
    parameters.step_value,
    parameters.step,
    parameters.delta_p
  );
  if (targetValue !== '') {
    parameters.targetValue = sanitizeNumber(targetValue, 0);
  }
  const driftRate = firstPresent(parameters.rate, parameters.driftRate);
  if (driftRate !== '') {
    parameters.rate = sanitizeNumber(driftRate, 0);
  }
  const amplitude = firstPresent(parameters.amplitude, parameters.std);
  if (amplitude !== '') {
    parameters.amplitude = sanitizeNumber(amplitude, 0.1);
  }
  const delaySteps = firstPresent(parameters.delaySteps, parameters.delay_steps);
  if (delaySteps !== '') {
    parameters.delaySteps = Math.max(0, Math.trunc(sanitizeNumber(delaySteps, 1)));
  }
  const efficiency = firstPresent(parameters.efficiency, parameters.scale);
  if (efficiency !== '') {
    parameters.efficiency = sanitizeNumber(efficiency, 0.5);
  }
  if (parameters.scale !== undefined) {
    parameters.scale = sanitizeNumber(parameters.scale, 1);
  }
  if (parameters.attenuation_db !== undefined || parameters.attenuationDb !== undefined) {
    parameters.attenuation_db = Math.max(0, sanitizeNumber(firstPresent(parameters.attenuation_db, parameters.attenuationDb), 0));
  }
  if (parameters.seed !== undefined) {
    parameters.seed = sanitizeNumber(parameters.seed, 1);
  }
  if (parameters.std !== undefined) {
    parameters.std = Math.max(0, sanitizeNumber(parameters.std, 0));
  }
  const value = firstPresent(parameters.value, parameters.hold_value, parameters.lock_value, parameters.fault_value);
  if (value !== '') {
    parameters.value = sanitizeNumber(value, 0);
  }
  return parameters;
}

function normalizeFaultParameterKey(fault = {}) {
  const explicit = String(fault.parameterKey ?? fault.targetParameter ?? '').trim();
  if (explicit) {
    return explicit;
  }
  const targetField = normalizeParameterTargetField(fault.targetField);
  const match = targetField.match(/^params\.([A-Za-z_$][\w$]*)$/);
  return match ? match[1] : '';
}

function normalizeFaultInstance(fault = {}, index = 0) {
  const parameters = normalizeFaultParameters(fault);
  const faultTypeId = String(firstPresent(fault.faultTypeId, fault.modelId, fault.faultModelId, fault.faultType));
  const targetId = String(firstPresent(fault.targetId, fault.targetNodeId, fault.targetEdgeId));
  const slotId = String(firstPresent(fault.slotId, fault.targetSlotId));
  const fallbackId = [faultTypeId || 'fault', targetId, slotId].filter(Boolean).join('::') || `fault-${index + 1}`;

  return {
    ...fault,
    faultId: String(firstPresent(fault.faultId, fault.instanceId, fault.id, fallbackId)),
    faultType: normalizeFaultType(fault),
    targetId,
    targetField: normalizeParameterTargetField(fault.targetField),
    parameterKey: normalizeFaultParameterKey(fault),
    enabled: fault.enabled ?? fault.active !== false,
    startTime: sanitizeNumber(firstPresent(fault.startTime, fault.start, parameters.start), 0),
    duration: sanitizeNumber(firstPresent(fault.duration, parameters.duration), 0),
    parameters
  };
}

function isActiveFaultInstance(fault = {}) {
  return fault.active !== false && fault.enabled !== false;
}

function scopeChannelName(portIndex) {
  const index = Math.max(0, Math.trunc(sanitizeNumber(portIndex, 0)));
  return `ch${index + 1}`;
}

function channelPortIndex(channel) {
  const match = String(channel ?? '').trim().toLowerCase().match(/^ch(\d+)$/);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

function channelNameFromPoint(point = {}) {
  const idMatch = String(point.id ?? '').trim().toLowerCase().match(/\.ch(\d+)$/);
  if (idMatch) {
    return `ch${Math.max(1, Number(idMatch[1]))}`;
  }
  return String(point.channel ?? 'ch1').trim().toLowerCase() || 'ch1';
}

function normalizeMeasurementVectorIndex(value) {
  const selectedChannel = Math.trunc(Number(value));
  return Number.isFinite(selectedChannel) && selectedChannel > 0 ? selectedChannel - 1 : 0;
}

function vectorIndexForScopeChannel(scopeNode = {}, targetPortIndex, edges = [], nodesById = new Map()) {
  const edge = edges.find((item) => (
    item.targetNodeId === scopeNode.id && Number(item.targetPortIndex) === Number(targetPortIndex)
  ));
  const sourceNode = edge ? nodesById.get(edge.sourceNodeId) : null;
  const sourcePort = sourceNode?.outputs?.[Number(edge?.sourcePortIndex) || 0];
  if (sourcePort?.dataType !== 'vector') {
    return null;
  }
  const property = Number(targetPortIndex) === 1 ? 'vectorChannelCh2' : 'vectorChannelCh1';
  return normalizeMeasurementVectorIndex(scopeNode?.parameters?.[property]);
}

function normalizeMeasurementPoint(point = {}, edges = []) {
  const scopeNodeId = String(point.scopeNodeId);
  const channel = channelNameFromPoint(point);
  const byChannel = channelPortIndex(channel);
  const targetPortIndex = edges.find((edge) => (
    edge.targetNodeId === scopeNodeId && edge.targetPortIndex === byChannel
  ))?.targetPortIndex ?? byChannel;

  return {
    ...point,
    id: String(point.id ?? `${scopeNodeId}.${scopeChannelName(targetPortIndex)}`),
    scopeNodeId,
    channel: scopeChannelName(targetPortIndex),
    targetPortIndex
  };
}

function buildMeasurementPoints(state, nodes, edges) {
  const scopeNodeIds = new Set(nodes.filter((node) => node.type === 'instrument_scope').map((node) => node.id));
  const scopeNodes = new Map(nodes.filter((node) => node.type === 'instrument_scope').map((node) => [node.id, node]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const explicitPoints = Array.isArray(state.measurementPoints)
    ? state.measurementPoints
      .filter((point) => scopeNodeIds.has(String(point?.scopeNodeId)))
      .map((point) => {
        const normalized = normalizeMeasurementPoint(point, edges);
        const vectorIndex = point.vectorIndex == null
          ? vectorIndexForScopeChannel(scopeNodes.get(normalized.scopeNodeId), normalized.targetPortIndex, edges, nodesById)
          : Math.max(0, Math.trunc(Number(point.vectorIndex) || 0));
        return vectorIndex === null ? normalized : { ...normalized, vectorIndex };
      })
    : [];
  const pointsById = new Map(explicitPoints.map((point) => [String(point.id ?? ''), point]));

  edges
    .filter((edge) => scopeNodeIds.has(edge.targetNodeId))
    .forEach((edge) => {
      const channel = scopeChannelName(edge.targetPortIndex);
      const id = `${edge.targetNodeId}.${channel}`;
      if (!pointsById.has(id)) {
        const scopeNode = scopeNodes.get(edge.targetNodeId);
        const vectorIndex = vectorIndexForScopeChannel(scopeNode, edge.targetPortIndex, edges, nodesById);
        pointsById.set(id, {
          id,
          scopeNodeId: edge.targetNodeId,
          channel,
          ...(vectorIndex === null ? {} : { vectorIndex })
        });
      }
    });

  return [...pointsById.values()];
}

function configuredDiagnosticPoints(state = {}) {
  return [
    ...(Array.isArray(state.manualDiagnosticTestPoints) ? state.manualDiagnosticTestPoints : []),
    ...(Array.isArray(state.diagnosticTestPoints) ? state.diagnosticTestPoints : []),
    ...(Array.isArray(state.testPoints) ? state.testPoints : []),
    ...(Array.isArray(state.diagnosticModel?.testPoints) ? state.diagnosticModel.testPoints : []),
    ...(Array.isArray(state.activeModelPackage?.diagnosticModel?.testPoints)
      ? state.activeModelPackage.diagnosticModel.testPoints
      : [])
  ];
}

function tracePointEdgeId(point = {}) {
  return String(
    point.edgeId
    ?? point.edgeID
    ?? point.targetEdgeId
    ?? point.targetId
    ?? ''
  ).trim();
}

function buildReportedNodeIds(state, nodes, edges, edgeIdMap) {
  // Component traces are intentionally restricted to consumers that are
  // visible outside the simulation engine.  Diagnostic test points can be
  // attached to ordinary signal wires, so they must be included alongside
  // display consoles and measurement instruments.
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const instrumentTypes = new Set([
    'instrument_scope',
    'instrument_spectrum',
    'instrument_logger',
    'instrument_multimeter'
  ]);
  const selected = new Set(nodes
    .filter((node) => node.type === 'display_console')
    .map((node) => node.id));

  edges.forEach((edge) => {
    const target = nodesById.get(edge.targetNodeId);
    if (edge.lineType !== 'power' && (target?.type === 'display_console' || instrumentTypes.has(target?.type))) {
      selected.add(edge.sourceNodeId);
    }
  });

  const points = configuredDiagnosticPoints(state);
  const pointEdgeIds = new Set(points.map(tracePointEdgeId).filter(Boolean));
  const flattenedPointEdgeIds = new Set([...pointEdgeIds].map((id) => edgeIdMap.get(id) ?? id));
  edges.forEach((edge) => {
    if (flattenedPointEdgeIds.has(edge.id) && edge.lineType !== 'power') {
      selected.add(edge.sourceNodeId);
    }
  });

  points.forEach((point) => {
    const sourceNodeId = String(point?.measurementSourceNodeId ?? point?.sourceNodeId ?? point?.nodeId ?? '').trim();
    if (nodesById.has(sourceNodeId)) {
      selected.add(sourceNodeId);
    }
  });

  return [...selected];
}

function endpointKey(direction, nodeId, portIndex = 0) {
  return `${direction}:${String(nodeId)}:${Math.max(0, Math.trunc(Number(portIndex) || 0))}`;
}

function parseEndpointKey(key) {
  const [direction, ...parts] = String(key).split(':');
  const portIndex = Number(parts.pop());
  return {
    direction,
    nodeId: parts.join(':'),
    portIndex: Math.max(0, Math.trunc(Number(portIndex) || 0))
  };
}

function subsystemInterface(node, role) {
  const items = node?.props?.interface?.[role];
  return Array.isArray(items) ? items : [];
}

function boundaryNodeForInterface(canvas, role, item, index) {
  const type = role === 'inputs' ? 'subsystem_in_port' : 'subsystem_out_port';
  const boundaries = (canvas?.nodes ?? []).filter((node) => node?.type === type);
  return boundaries.find((node) => Number(node?.props?.order) === index)
    ?? boundaries.find((node) => String(node?.props?.interfacePortId ?? '') === String(item?.id ?? ''));
}

function reachableCanvasRecords(state = {}) {
  const canvases = state.canvases && typeof state.canvases === 'object' ? state.canvases : null;
  if (!canvases) {
    return [{
      id: state.rootCanvasId || 'canvas-root',
      nodes: state.modelNodes ?? state.nodes ?? [],
      edges: state.modelEdges ?? state.edges ?? []
    }];
  }
  const rootCanvasId = canvases[state.rootCanvasId]
    ? state.rootCanvasId
    : canvases['canvas-root']
      ? 'canvas-root'
      : Object.keys(canvases)[0];
  if (!rootCanvasId) return [];

  const records = [];
  const visited = new Set();
  const visit = (canvasId) => {
    if (!canvasId || visited.has(canvasId) || !canvases[canvasId]) return;
    visited.add(canvasId);
    const canvas = canvases[canvasId];
    records.push(canvas);
    (canvas.nodes ?? [])
      .filter((node) => node?.type === 'subsystem_block')
      .forEach((node) => visit(node.targetCanvasId));
  };
  visit(rootCanvasId);
  return records;
}

function subsystemExportContext(state = {}, reservedIds = new Set()) {
  const context = {
    nodes: [],
    nodeSubsystemPaths: new Map(),
    resultIdBySubsystemNodeId: new Map()
  };
  if (!state.includeSubsystemNodes || !state.canvases || typeof state.canvases !== 'object') return context;

  const rootCanvasId = state.canvases[state.rootCanvasId]
    ? state.rootCanvasId
    : state.canvases['canvas-root']
      ? 'canvas-root'
      : Object.keys(state.canvases)[0];
  const visited = new Set();
  const reserveResultId = (node) => {
    const internalId = String(node?.id ?? '').trim();
    const baseId = String(node?.props?.subsystemId ?? '').trim() || internalId;
    if (!baseId) return '';
    let id = baseId;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    reservedIds.add(id);
    context.resultIdBySubsystemNodeId.set(internalId, id);
    context.nodes.push({
      id,
      name: String(node.props?.name ?? node.name ?? id),
      type: 'subsystem_block',
      parameters: {},
      inputs: [],
      outputs: []
    });
    return id;
  };
  const visit = (canvasId, subsystemPath = []) => {
    if (!canvasId || visited.has(canvasId) || !state.canvases[canvasId]) return;
    visited.add(canvasId);
    const canvas = state.canvases[canvasId];
    const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
    nodes.forEach((node) => {
      if (node?.id) context.nodeSubsystemPaths.set(String(node.id), [...subsystemPath]);
    });
    nodes.filter((node) => node?.type === 'subsystem_block').forEach((node) => {
      reserveResultId(node);
      visit(node.targetCanvasId, [...subsystemPath, String(node.id)]);
    });
  };
  visit(rootCanvasId, []);
  return context;
}

function remapSubsystemBoundaryEdge(edge, context) {
  const sourcePath = context.nodeSubsystemPaths.get(String(edge?.sourceNodeId)) ?? [];
  const targetPath = context.nodeSubsystemPaths.get(String(edge?.targetNodeId)) ?? [];
  let commonLength = 0;
  while (commonLength < sourcePath.length
    && commonLength < targetPath.length
    && sourcePath[commonLength] === targetPath[commonLength]) {
    commonLength += 1;
  }
  const sourceSubsystemNodeId = sourcePath[commonLength];
  const targetSubsystemNodeId = targetPath[commonLength];
  return {
    ...edge,
    sourceNodeId: sourceSubsystemNodeId
      ? (context.resultIdBySubsystemNodeId.get(sourceSubsystemNodeId) ?? edge.sourceNodeId)
      : edge.sourceNodeId,
    targetNodeId: targetSubsystemNodeId
      ? (context.resultIdBySubsystemNodeId.get(targetSubsystemNodeId) ?? edge.targetNodeId)
      : edge.targetNodeId
  };
}

export function remapSubsystemBoundaryReferences(state = {}, records = []) {
  if (!state.includeSubsystemNodes || !Array.isArray(records)) return records;
  const flattened = flattenSubsystemGraph(state);
  const reservedIds = new Set(flattened.nodes.map((node) => String(node.id)));
  const context = subsystemExportContext(state, reservedIds);
  const edgesById = new Map(flattened.edges
    .map((edge) => remapSubsystemBoundaryEdge(edge, context))
    .map((edge) => [String(edge.id), edge]));

  return records.map((record) => {
    const originalEdgeId = String(record?.edgeId ?? record?.edgeID ?? record?.targetEdgeId ?? record?.targetId ?? '');
    const lookupEdgeId = flattened.edgeIdMap.get(originalEdgeId) ?? originalEdgeId;
    const edge = edgesById.get(lookupEdgeId);
    if (!edge) return { ...record };
    const next = { ...record };
    ['measurementSourceNodeId', 'sourceNodeId', 'sourceDeviceId'].forEach((key) => {
      if (Object.hasOwn(next, key)) next[key] = edge.sourceNodeId;
    });
    ['measurementTargetNodeId', 'targetNodeId', 'targetDeviceId'].forEach((key) => {
      if (Object.hasOwn(next, key)) next[key] = edge.targetNodeId;
    });
    return next;
  });
}

function flattenedEdgeId(pathEdges, usedIds) {
  const preferred = pathEdges.find((edge) => !edge?.subsystemBoundaryMapping)?.id
    || pathEdges[0]?.id
    || 'flattened-edge';
  let id = String(preferred);
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${preferred}::flat-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function flattenedEdgeLabel(pathEdges, fallbackId) {
  const edge = pathEdges.find(item => item?.label || item?.name || item?.signalId);
  return String(edge?.label ?? edge?.name ?? edge?.signalId ?? fallbackId);
}

function flattenedLineType(pathEdges) {
  if (pathEdges.some((edge) => edge?.lineType === 'power')) return 'power';
  if (pathEdges.some((edge) => edge?.lineType === 'can')) return 'can';
  return 'normal';
}

function flattenSubsystemGraph(state = {}) {
  const canvases = reachableCanvasRecords(state);
  const allNodes = canvases.flatMap((canvas) => Array.isArray(canvas?.nodes) ? canvas.nodes : []);
  const allEdges = canvases.flatMap((canvas) => Array.isArray(canvas?.edges) ? canvas.edges : []);
  const nodeById = new Map(allNodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const executableNodes = allNodes.filter((node) => node?.id && SUPPORTED_NODE_TYPES.has(node.type));
  const executableNodeIds = new Set(executableNodes.map((node) => String(node.id)));
  const adjacency = new Map();
  const addTransition = (from, to, pathEdges = []) => {
    if (!from || !to) return;
    const transitions = adjacency.get(from) ?? [];
    transitions.push({ to, pathEdges });
    adjacency.set(from, transitions);
  };

  allEdges.forEach((edge) => {
    if (!nodeById.has(String(edge?.sourceNodeId)) || !nodeById.has(String(edge?.targetNodeId))) return;
    addTransition(
      endpointKey('out', edge.sourceNodeId, edge.sourcePortIndex),
      endpointKey('in', edge.targetNodeId, edge.targetPortIndex),
      [edge]
    );
  });

  canvases.forEach((canvas) => {
    (canvas?.nodes ?? []).filter((node) => node?.type === 'subsystem_block').forEach((subsystemNode) => {
      const childCanvas = state.canvases?.[subsystemNode.targetCanvasId];
      if (!childCanvas) return;
      subsystemInterface(subsystemNode, 'inputs').forEach((item, index) => {
        const boundary = boundaryNodeForInterface(childCanvas, 'inputs', item, index);
        if (boundary) {
          addTransition(endpointKey('in', subsystemNode.id, index), endpointKey('out', boundary.id, 0));
        } else if (item?.componentNodeId) {
          addTransition(
            endpointKey('in', subsystemNode.id, index),
            endpointKey('in', item.componentNodeId, item.componentPortIndex)
          );
        }
      });
      subsystemInterface(subsystemNode, 'outputs').forEach((item, index) => {
        const boundary = boundaryNodeForInterface(childCanvas, 'outputs', item, index);
        if (boundary) {
          addTransition(endpointKey('in', boundary.id, 0), endpointKey('out', subsystemNode.id, index));
        } else if (item?.componentNodeId) {
          addTransition(
            endpointKey('out', item.componentNodeId, item.componentPortIndex),
            endpointKey('out', subsystemNode.id, index)
          );
        }
      });
    });
  });

  const flattenedEdges = [];
  const usedIds = new Set();
  const edgeIdMap = new Map();
  const connectionIdsBySignature = new Map();
  const walk = (source, currentKey, pathEdges, visited) => {
    if (visited.has(currentKey)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(currentKey);
    const endpoint = parseEndpointKey(currentKey);
    if (endpoint.direction === 'in' && executableNodeIds.has(endpoint.nodeId)) {
      const signature = `${source.nodeId}:${source.portIndex}>${endpoint.nodeId}:${endpoint.portIndex}`;
      if (connectionIdsBySignature.has(signature)) {
        const existingId = connectionIdsBySignature.get(signature);
        pathEdges.forEach((edge) => {
          if (edge?.id) edgeIdMap.set(String(edge.id), existingId);
        });
        return;
      }
      const id = flattenedEdgeId(pathEdges, usedIds);
      connectionIdsBySignature.set(signature, id);
      const flattened = {
        id,
        label: flattenedEdgeLabel(pathEdges, id),
        labelCustomized: pathEdges.some((edge) => edge?.labelCustomized === true),
        sourceNodeId: source.nodeId,
        sourcePortIndex: source.portIndex,
        targetNodeId: endpoint.nodeId,
        targetPortIndex: endpoint.portIndex,
        lineType: flattenedLineType(pathEdges)
      };
      flattenedEdges.push(flattened);
      pathEdges.forEach((edge) => {
        if (edge?.id) edgeIdMap.set(String(edge.id), id);
      });
      return;
    }
    (adjacency.get(currentKey) ?? []).forEach((transition) => {
      walk(source, transition.to, [...pathEdges, ...transition.pathEdges], nextVisited);
    });
  };

  executableNodes.forEach((node) => {
    const nodeId = String(node.id);
    [...adjacency.keys()]
      .filter((key) => {
        const endpoint = parseEndpointKey(key);
        return endpoint.direction === 'out' && endpoint.nodeId === nodeId;
      })
      .forEach((key) => {
        const endpoint = parseEndpointKey(key);
        walk({ nodeId, portIndex: endpoint.portIndex }, key, [], new Set());
      });
  });

  return { nodes: executableNodes, edges: flattenedEdges, edgeIdMap };
}

function executableFaultInstances(state, nodeIds, edgeIds, edgeIdMap) {
  return (Array.isArray(state.faultInstances) ? state.faultInstances : [])
    .filter(isActiveFaultInstance)
    .map((fault) => {
      const targetId = String(firstPresent(fault.targetId, fault.targetNodeId, fault.targetEdgeId));
      const remappedTargetId = edgeIdMap.get(targetId) ?? targetId;
      return { ...fault, targetId: remappedTargetId };
    })
    .filter((fault) => nodeIds.has(String(fault.targetId)) || edgeIds.has(String(fault.targetId)))
    .map(normalizeFaultInstance);
}

export function buildBackendExecutablePackage(state = {}) {
  const simulationConfig = state.simulationConfig ?? {};
  const flattened = flattenSubsystemGraph(state);
  const allExecutableNodes = flattened.nodes.map(normalizeNode);
  const reservedNodeIds = new Set(allExecutableNodes.map((node) => node.id));
  const subsystemContext = subsystemExportContext(state, reservedNodeIds);
  const visibleSubsystemResultIds = new Set(
    [...subsystemContext.resultIdBySubsystemNodeId.entries()]
      .filter(([nodeId]) => (
        (subsystemContext.nodeSubsystemPaths.get(String(nodeId)) ?? []).length === 0
      ))
      .map(([, resultId]) => resultId)
  );
  const nodes = [
    // Public result data keeps the executable components visible, including
    // components inside a subsystem. Only subsystem-boundary connections are
    // projected onto the subsystem node; the internal component itself must
    // not disappear from the public device catalogue.
    ...allExecutableNodes,
    ...subsystemContext.nodes.filter((node) => visibleSubsystemResultIds.has(node.id))
  ];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedEdges = flattened.edges.map(normalizeEdge);
  const presentationEdges = state.includeSubsystemNodes
    ? normalizedEdges.map((edge) => remapSubsystemBoundaryEdge(edge, subsystemContext))
    : normalizedEdges;
  const edges = presentationEdges.filter((edge) => (
    nodeIds.has(String(edge?.sourceNodeId)) && nodeIds.has(String(edge?.targetNodeId))
  ));
  // Infer from executable endpoints: presentation edges can end at a
  // subsystem shell, which has no executable input-port declaration.
  alignSignalGeneratorOutputsWithTargetPorts(nodes, normalizedEdges);
  alignScopeInputsWithConnectedSignals(nodes, edges);
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return {
    schemaVersion: 1,
    packageId: String(state.packageId ?? state.modelPackageId ?? 'frontend-package'),
    simulationConfig: {
      duration: sanitizeNumber(simulationConfig.duration, 10),
      stepSize: sanitizeNumber(simulationConfig.stepSize, 0.1)
    },
    nodes,
    edges,
    faultInstances: executableFaultInstances(state, nodeIds, edgeIds, flattened.edgeIdMap),
    measurementPoints: buildMeasurementPoints(state, nodes, edges),
    reportedNodeIds: buildReportedNodeIds(state, nodes, edges, flattened.edgeIdMap)
  };
}
