import {
  getSignalSourceScalarFallback,
  normalizeSignalSourceProps
} from './signalSourceDomainService.js';

const SUPPORTED_NODE_TYPES = new Set([
  'signal_source',
  'flow_block',
  'simulation_block',
  'gain_block',
  'sum_block',
  'mux_block',
  'instrument_scope'
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
    const modulation = String(normalizedProps.modulation || 'cw').trim().toLowerCase();
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
    parameters.pulseWidthSeconds = Math.max(0, parseDurationSeconds(normalizedProps.pulseWidth, normalizedProps.pulseWidthUnit, 0));
    parameters.pulsePeriodSeconds = Math.max(0, parseDurationSeconds(normalizedProps.pulsePeriod, normalizedProps.pulsePeriodUnit, 0));
    parameters.bandwidthHz = Math.max(0, parseFrequencyHz(normalizedProps.bandwidth, 0));
    parameters.symbolRateHz = Math.max(0, parseFrequencyHz(normalizedProps.symbolRate, 0));
    parameters.sampleRateHz = Math.max(0, parseFrequencyHz(normalizedProps.sampleRate, 0));
    parameters.snrDb = sanitizeNumber(normalizedProps.snr, 0);
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
  return 'scalar';
}

function normalizePorts(ports = []) {
  return Array.isArray(ports)
    ? ports.map((port) => {
      const name = String(port?.varName ?? port?.name ?? port?.label ?? '');
      const id = String(port?.portId ?? port?.id ?? port?.key ?? name);
      const dataType = normalizePortDataType(port?.dataType ?? port?.type);
      const shapeLength = Array.isArray(port?.shape) ? Number(port.shape[0]) : NaN;
      const vectorLength = Number(port?.vectorLength ?? port?.length ?? shapeLength);
      return {
        name,
        id,
        dataType,
        ...(dataType === 'vector' && Number.isInteger(vectorLength) && vectorLength > 0
          ? { vectorLength }
          : {})
      };
    }).filter((port) => port.name)
    : [];
}

function normalizeNode(node) {
  const rawProps = node.props ?? node.parameters ?? {};
  const props = node.type === 'signal_source'
    ? normalizeSignalSourceProps(rawProps)
    : rawProps;
  const parameters = pickNumericParameters(rawProps);
  if (node.type === 'signal_source') {
    addSignalSourceExecutionParameters(parameters, rawProps, props);
    parameters.value = sanitizeNumericVector(rawProps.value) ?? getSignalSourceScalarFallback(props);
  }
  if (node.type === 'sum_block') {
    addSumBlockExecutionParameters(parameters, rawProps);
  }

  const normalized = {
    id: String(node.id),
    type: node.type,
    parameters,
    inputs: normalizePorts(node.inputs ?? node.props?.inputs),
    outputs: normalizePorts(node.outputs ?? node.props?.outputs)
  };

  if (node.type === 'simulation_block') {
    normalized.pythonBinding = {
      moduleId: String(node.pythonBinding?.moduleId ?? ''),
      entryFunction: String(node.pythonBinding?.entryFunction ?? 'process')
    };
  }

  return normalized;
}

function normalizeEdge(edge) {
  return {
    id: String(edge.id),
    sourceNodeId: String(edge.sourceNodeId),
    sourcePortIndex: sanitizeNumber(edge.sourcePortIndex, 0),
    targetNodeId: String(edge.targetNodeId),
    targetPortIndex: sanitizeNumber(edge.targetPortIndex, 0)
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
    if (/step/.test(key) || fault.parameters?.step_value !== undefined || fault.parameters?.stepValue !== undefined) {
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
  if (/noise/.test(key)) {
    return 'noise_increase';
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
  const stepValue = firstPresent(parameters.stepValue, parameters.step_value, parameters.step, parameters.delta_p);
  if (stepValue !== '') {
    parameters.stepValue = sanitizeNumber(stepValue, 0);
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

export function buildBackendExecutablePackage(state = {}) {
  const simulationConfig = state.simulationConfig ?? {};
  const nodes = (state.modelNodes ?? state.nodes ?? [])
    .filter((node) => node?.id && SUPPORTED_NODE_TYPES.has(node.type))
    .map(normalizeNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (state.modelEdges ?? state.edges ?? [])
    .filter((edge) => nodeIds.has(String(edge?.sourceNodeId)) && nodeIds.has(String(edge?.targetNodeId)))
    .map(normalizeEdge);
  return {
    schemaVersion: 1,
    packageId: String(state.packageId ?? state.modelPackageId ?? 'frontend-package'),
    simulationConfig: {
      duration: sanitizeNumber(simulationConfig.duration, 10),
      stepSize: sanitizeNumber(simulationConfig.stepSize, 0.1)
    },
    nodes,
    edges,
    faultInstances: Array.isArray(state.faultInstances)
      ? state.faultInstances.filter(isActiveFaultInstance).map(normalizeFaultInstance)
      : [],
    measurementPoints: buildMeasurementPoints(state, nodes, edges)
  };
}
