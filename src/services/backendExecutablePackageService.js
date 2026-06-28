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

function pickNumericParameters(props = {}) {
  return Object.fromEntries(
    Object.entries(props)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function normalizePorts(ports = []) {
  return Array.isArray(ports)
    ? ports.map((port) => ({ name: String(port?.name ?? port?.label ?? '') })).filter((port) => port.name)
    : [];
}

function normalizeNode(node) {
  const normalized = {
    id: String(node.id),
    type: node.type,
    parameters: pickNumericParameters(node.props ?? node.parameters ?? {}),
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

function normalizeFaultType(fault = {}) {
  const key = String(firstPresent(
    fault.faultType,
    fault.backendFaultType,
    fault.runtimeBehavior,
    fault.faultTypeId,
    fault.modelId,
    fault.faultModelId
  )).trim().toLowerCase();

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
  const stepValue = firstPresent(parameters.stepValue, parameters.step_value, parameters.delta_p);
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
  const value = firstPresent(parameters.value, parameters.hold_value, parameters.lock_value, parameters.fault_value);
  if (value !== '') {
    parameters.value = sanitizeNumber(value, 0);
  }
  return parameters;
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
  const explicitPoints = Array.isArray(state.measurementPoints)
    ? state.measurementPoints
      .filter((point) => scopeNodeIds.has(String(point?.scopeNodeId)))
      .map((point) => normalizeMeasurementPoint(point, edges))
    : [];
  const pointsById = new Map(explicitPoints.map((point) => [String(point.id ?? ''), point]));

  edges
    .filter((edge) => scopeNodeIds.has(edge.targetNodeId))
    .forEach((edge) => {
      const channel = scopeChannelName(edge.targetPortIndex);
      const id = `${edge.targetNodeId}.${channel}`;
      if (!pointsById.has(id)) {
        pointsById.set(id, {
          id,
          scopeNodeId: edge.targetNodeId,
          channel
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
