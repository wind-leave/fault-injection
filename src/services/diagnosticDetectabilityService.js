const list = (value) => Array.isArray(value) ? value : [];

export function faultId(fault) {
  return fault?.id || fault?.faultModelId || fault?.faultTypeId || fault?.modelId || fault?.faultId || '';
}

export function affectedEdgeIds(fault, edges = []) {
  const available = new Map(list(edges).filter((edge) => edge?.id).map((edge) => [edge.id, edge]));
  const boundaryMappings = new Map();
  available.forEach((edge) => {
    if (!edge.subsystemBoundaryMapping || !available.has(edge.linkedExternalEdgeId)) return;
    const linked = boundaryMappings.get(edge.linkedExternalEdgeId) || [];
    linked.push(edge);
    boundaryMappings.set(edge.linkedExternalEdgeId, linked);
  });
  const mappingRole = (edge) => edge.subsystemBoundaryRole
    || (String(edge.id).includes('-auto-input-') ? 'input' : '')
    || (String(edge.id).includes('-auto-output-') ? 'output' : '');
  const targetKind = fault?.targetKind || fault?.target?.kind || '';
  const targetId = fault?.targetId || fault?.target?.id || '';
  const targetEdgeId = fault?.targetEdgeId || fault?.injectionDesign?.targetEdgeId
    || fault?.injectionTarget?.edgeId || (targetKind === 'edge' ? targetId : '') || '';
  const targetNodeId = fault?.targetNodeId || fault?.hostNodeId
    || fault?.injectionDesign?.targetNodeId || fault?.injectionTarget?.nodeId
    || (targetKind === 'node' ? targetId : '') || '';
  const explicit = [...list(fault?.affectedEdges), ...list(fault?.affectedTestPointEdges)]
    .filter((id) => available.has(id));
  if (explicit.length && (explicit.length > 1 || explicit[0] !== targetEdgeId)) {
    const affected = new Set(explicit);
    explicit.forEach((id) => {
      const edge = available.get(id);
      if (edge?.subsystemBoundaryMapping && available.has(edge.linkedExternalEdgeId)) {
        affected.add(edge.linkedExternalEdgeId);
      }
      list(boundaryMappings.get(id)).forEach((mapping) => affected.add(mapping.id));
    });
    return affected;
  }
  const outgoing = new Map();
  available.forEach((edge) => {
    const source = edge.sourceNodeId || edge.source || edge.from || edge.sourceId;
    if (!outgoing.has(source)) outgoing.set(source, []);
    outgoing.get(source).push(edge);
  });

  const reached = new Set();
  const queue = [];
  const addEdge = (edge) => {
    if (!edge || reached.has(edge.id)) return;
    reached.add(edge.id);
    if (edge.subsystemBoundaryMapping && available.has(edge.linkedExternalEdgeId)) {
      addEdge(available.get(edge.linkedExternalEdgeId));
    }
    const linkedMappings = boundaryMappings.get(edge.id) || [];
    linkedMappings.forEach(addEdge);
    // A subsystem input continues through its mapped child input. Traversing
    // the shell node would incorrectly mark every output of the subsystem.
    if (!linkedMappings.some((mapping) => mappingRole(mapping) === 'input')) {
      queue.push(edge.targetNodeId || edge.target || edge.to || edge.targetId);
    }
  };
  if (available.has(targetEdgeId)) addEdge(available.get(targetEdgeId));
  else list(outgoing.get(targetNodeId)).forEach(addEdge);
  // A physical parameter fault is local to the component configuration, but
  // its changed output can still be measured on downstream connections.
  const affectsParameter = fault?.layer === 'physical'
    || fault?.propagationMode === 'localParameter'
    || String(fault?.targetField || '').startsWith('params.');
  const localOnly = !affectsParameter
    && (fault?.canPropagate === false || fault?.propagationMode === 'localOnly');
  if (localOnly) return reached;

  for (let index = 0; index < queue.length; index += 1) {
    list(outgoing.get(queue[index])).forEach(addEdge);
  }
  return reached;
}

export function defaultDetectsFault(point, fault, edges = []) {
  return Boolean(point?.edgeId && affectedEdgeIds(fault, edges).has(point.edgeId));
}

export function effectiveDetects(point, faults = [], edges = []) {
  if (point?.detectabilityMode !== 'auto') return [...new Set(list(point?.detects))];
  const overrides = point.detectabilityOverrides || {};
  const inferred = list(faults).filter((fault) => {
    const id = faultId(fault);
    return id && (Object.prototype.hasOwnProperty.call(overrides, id)
      ? Boolean(overrides[id])
      : defaultDetectsFault(point, fault, edges));
  }).map(faultId);
  return [...new Set([...inferred, ...Object.keys(overrides).filter((id) => overrides[id] === true)])];
}

export function detectabilityOverrides(point, selectedFaultIds = [], faults = [], edges = []) {
  const selected = new Set(selectedFaultIds);
  const overrides = { ...(point?.detectabilityOverrides || {}) };
  list(faults).forEach((fault) => {
    const id = faultId(fault);
    if (!id) return;
    const value = selected.has(id);
    if (value === defaultDetectsFault(point, fault, edges)) delete overrides[id];
    else overrides[id] = value;
  });
  return overrides;
}
