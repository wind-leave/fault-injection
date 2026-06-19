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

export function buildBackendExecutablePackage(state = {}) {
  const simulationConfig = state.simulationConfig ?? {};
  return {
    schemaVersion: 1,
    packageId: String(state.packageId ?? state.modelPackageId ?? 'frontend-package'),
    simulationConfig: {
      duration: sanitizeNumber(simulationConfig.duration, 10),
      stepSize: sanitizeNumber(simulationConfig.stepSize, 0.1)
    },
    nodes: (state.modelNodes ?? state.nodes ?? [])
      .filter((node) => node?.id && SUPPORTED_NODE_TYPES.has(node.type))
      .map(normalizeNode),
    edges: (state.modelEdges ?? state.edges ?? []).map(normalizeEdge),
    faultInstances: Array.isArray(state.faultInstances) ? state.faultInstances.map((fault) => ({ ...fault })) : [],
    measurementPoints: Array.isArray(state.measurementPoints) ? state.measurementPoints.map((point) => ({ ...point })) : []
  };
}
