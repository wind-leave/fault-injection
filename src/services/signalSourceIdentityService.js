const COMPONENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const PORT_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

const NODE_REFERENCE_KEYS = new Set([
  'nodeId', 'componentId', 'sourceNodeId', 'targetNodeId', 'componentNodeId',
  'sourceComponentId', 'targetComponentId', 'parentSubsystemNodeId',
  'hostNodeId', 'measurementMeterId', 'measurementTargetId',
  'controlTargetId', 'deviceId', 'sourceDeviceId', 'targetDeviceId',
  'targetId', 'sourceId'
]);

function replaceNodeReferences(value, oldId, newId, visited = new WeakSet()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const [key, item] of Object.entries(value)) {
    if ((NODE_REFERENCE_KEYS.has(key) || /(?:Node|Component|Device)Id$/.test(key)) && item === oldId) {
      value[key] = newId;
    } else if (item && typeof item === 'object') {
      replaceNodeReferences(item, oldId, newId, visited);
    }
  }
}

function replaceSelectedId(state, key, oldId, newId) {
  if (state[key] === oldId) state[key] = newId;
}

function updateConnectedPortIds(canvas, sourceId, portId) {
  for (const edge of canvas.edges || []) {
    if (edge.sourceNodeId !== sourceId || Number(edge.sourcePortIndex || 0) !== 0) continue;
    for (const key of ['sourcePortMeta', 'sourcePort']) {
      if (!edge[key] || typeof edge[key] !== 'object') edge[key] = {};
      edge[key].portId = portId;
    }
    if ('sourcePortId' in edge) edge.sourcePortId = portId;
  }
}

export function updateRfSignalSourceIdentity(state, node, requested = {}) {
  if (node?.type !== 'signal_source' || node.props?.signalDomain !== 'rf') {
    return { ok: false, error: '当前组件不是射频信号源' };
  }

  const canvases = Object.values(state?.canvases || {});
  const oldId = node.id;
  const componentId = String(requested.componentId ?? oldId).trim();
  const portId = String(requested.outputPortId ?? node.props?.outputPortId ?? 'signal').trim();
  if (!COMPONENT_ID_PATTERN.test(componentId)) {
    return { ok: false, error: '组件 ID 只能包含英文字母、数字、下划线和连字符，且不能为空' };
  }
  if (!PORT_ID_PATTERN.test(portId)) {
    return { ok: false, error: '端口 ID 只能包含英文字母、数字、下划线、连字符、点和冒号，且不能为空' };
  }
  if (componentId !== oldId && canvases.some((canvas) =>
    (canvas.nodes || []).some((other) => other !== node && other?.id === componentId))) {
    return { ok: false, error: '组件 ID 已存在，请使用其他 ID' };
  }

  for (const canvas of canvases) updateConnectedPortIds(canvas, oldId, portId);
  node.props.outputPortId = portId;

  if (componentId !== oldId) {
    for (const canvas of canvases) replaceNodeReferences(canvas, oldId, componentId);
    for (const key of [
      'faultTags', 'faultInjectionLinks', 'diagnosticModel', 'diagnosticTestPoints',
      'testPoints', 'manualDiagnosticTestPoints', 'pendingConnection',
      'measurementScenario', 'measurementResponse'
    ]) replaceNodeReferences(state[key], oldId, componentId);
    for (const key of [
      'selBlk', 'selectionAnchorId', 'injectTargetId', 'injectSelectionId',
      'protocolInjectTargetId', 'protocolInjectSelectionId'
    ]) replaceSelectedId(state, key, oldId, componentId);
    for (const key of ['selectedNodeIds', 'faultedBlks']) {
      if (Array.isArray(state[key])) {
        state[key] = state[key].map((id) => id === oldId ? componentId : id);
      }
    }
    node.id = componentId;
    const sequence = /^node-(\d+)$/.exec(componentId);
    if (sequence) state.nodeSeq = Math.max(Number(state.nodeSeq) || 0, Number(sequence[1]));
  }

  return { ok: true, componentId, outputPortId: portId };
}
