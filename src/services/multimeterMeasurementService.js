const MODE_ALIASES = Object.freeze({
  'DC Voltage': '直流电压',
  'AC Voltage': '交流电压',
  'DC Current': '直流电流',
  'AC Current': '交流电流',
  Resistance: '电阻',
  Continuity: '通断'
});

export function normalizeMultimeterMode(value) {
  const mode = String(value ?? '').trim();
  return MODE_ALIASES[mode] || mode || '直流电压';
}

export function getMultimeterMeasurementKind(mode) {
  const normalized = normalizeMultimeterMode(mode);
  if (normalized.includes('电流')) return 'current';
  if (normalized.includes('电阻')) return 'resistance';
  if (normalized.includes('通断')) return 'continuity';
  return 'voltage';
}

export function getMultimeterTargetKind(mode) {
  return getMultimeterMeasurementKind(mode) === 'current' ? 'edge' : 'node';
}

export function normalizeMultimeterBinding(props = {}) {
  const expectedTargetKind = getMultimeterTargetKind(props.measurementMode);
  const targetId = String(props.measurementTargetId ?? '').trim();
  const storedKind = String(props.measurementTargetKind ?? '').trim();

  return {
    measurementTargetKind: storedKind === 'node' || storedKind === 'edge'
      ? storedKind
      : expectedTargetKind,
    measurementTargetId: targetId
  };
}

export function normalizeMultimeterLead(lead = {}) {
  const direction = String(lead.direction ?? '').trim();
  const portIndex = Number(lead.portIndex);
  return {
    nodeId: String(lead.nodeId ?? '').trim(),
    direction: direction === 'input' || direction === 'output' ? direction : '',
    portIndex: Number.isInteger(portIndex) && portIndex >= 0 ? portIndex : 0
  };
}

export function encodeMultimeterLead(lead = {}) {
  const normalized = normalizeMultimeterLead(lead);
  return normalized.nodeId && normalized.direction
    ? `${normalized.nodeId}|${normalized.direction}|${normalized.portIndex}`
    : '';
}

export function parseMultimeterLead(value = '') {
  const [nodeId = '', direction = '', portIndex = '0'] = String(value).split('|');
  return normalizeMultimeterLead({ nodeId, direction, portIndex });
}

export function evaluateMultimeterLeads({ positiveLead, negativeLead } = {}, nodes = [], edges = []) {
  const positive = normalizeMultimeterLead(positiveLead);
  const negative = normalizeMultimeterLead(negativeLead);
  if (!positive.nodeId || !negative.nodeId || !positive.direction || !negative.direction) {
    return { valid: false, reason: 'lead-not-connected' };
  }

  if (positive.nodeId === negative.nodeId) {
    if (positive.direction === 'input' && negative.direction === 'output') {
      return { valid: true, targetKind: 'component', polarity: 1, componentNodeId: positive.nodeId, inputPortIndex: positive.portIndex };
    }
    if (positive.direction === 'output' && negative.direction === 'input') {
      return { valid: true, targetKind: 'component', polarity: -1, componentNodeId: positive.nodeId, inputPortIndex: negative.portIndex };
    }
  }

  const matchingEdge = edges.find((edge) => (
    edge.sourceNodeId === positive.nodeId
    && Number(edge.sourcePortIndex ?? 0) === positive.portIndex
    && edge.targetNodeId === negative.nodeId
    && Number(edge.targetPortIndex ?? 0) === negative.portIndex
    && positive.direction === 'output'
    && negative.direction === 'input'
  ));
  if (matchingEdge) {
    return { valid: true, targetKind: 'edge', polarity: 1, edgeId: matchingEdge.id };
  }

  const reversedEdge = edges.find((edge) => (
    edge.sourceNodeId === negative.nodeId
    && Number(edge.sourcePortIndex ?? 0) === negative.portIndex
    && edge.targetNodeId === positive.nodeId
    && Number(edge.targetPortIndex ?? 0) === positive.portIndex
    && positive.direction === 'input'
    && negative.direction === 'output'
  ));
  if (reversedEdge) {
    return { valid: true, targetKind: 'edge', polarity: -1, edgeId: reversedEdge.id };
  }

  return { valid: false, reason: 'lead-pair-invalid' };
}

export function readElectricalProperty(node = {}, names = []) {
  const props = node?.props ?? {};
  const candidates = [props, node, ...[props.parameters, props.modelParameters, node.parameters]
    .filter(Array.isArray)
    .map((items) => Object.fromEntries(items.map((item) => [item?.key ?? item?.name, item?.value ?? item?.default])) )];

  for (const source of candidates) {
    for (const name of names) {
      const value = Number(source?.[name]);
      if (Number.isFinite(value)) return value;
    }
  }
  return NaN;
}
