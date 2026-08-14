function list(value) {
  return Array.isArray(value) ? value : [];
}

export function getNode(state = {}, id = '') {
  return list(state.modelNodes).find((node) => node?.id === id);
}

export function getEdge(state = {}, id = '') {
  return list(state.modelEdges).find((edge) => edge?.id === id);
}

export function clearCanvasSelectionState(state = {}) {
  state.selBlk = null;
  state.selEdge = null;
  state.selFaultTag = null;
  state.selectedNodeIds = [];
  state.selectionAnchorId = '';
  return state;
}

export function normalizeSelectedNodeIds(state = {}) {
  const next = [
    ...new Set(list(state.selectedNodeIds).filter((id) => typeof id === 'string' && Boolean(getNode(state, id))))
  ];

  state.selectedNodeIds = next;
  if (state.selectionAnchorId && !next.includes(state.selectionAnchorId)) {
    state.selectionAnchorId = next[next.length - 1] || '';
  }
  if (!next.length) {
    state.selBlk = null;
    state.selectionAnchorId = '';
  } else if (!next.includes(state.selBlk)) {
    state.selBlk = next[next.length - 1];
  }

  return next;
}

export function applyNodeSelection(state = {}, ids = [], focusId = '') {
  const next = [
    ...new Set(list(ids).filter((id) => typeof id === 'string' && Boolean(getNode(state, id))))
  ];

  state.selectedNodeIds = next;
  state.selectionAnchorId = focusId && next.includes(focusId) ? focusId : (next[next.length - 1] || '');
  state.selBlk = next.length ? (state.selectionAnchorId || next[next.length - 1]) : null;
  state.selEdge = null;
  return next;
}

export function markTopologyDirty(state = {}, simulation = null, scope = 'system', options = {}) {
  if (scope === 'system') {
    state.systemSaved = false;
  }
  state.simDone = false;

  if (typeof options.clearSimLoop === 'function') {
    options.clearSimLoop();
  }

  if (simulation && typeof simulation === 'object') {
    // Backend sessions capture component parameters at creation time.  Keep
    // the old ID for asynchronous cleanup, but invalidate it immediately so
    // a subsequent Run/Step cannot use stale parameters.
    if (simulation.backendSessionId) {
      simulation.staleBackendSessionId = simulation.backendSessionId;
    }
    simulation.backendSessionId = '';
    simulation.backendRunId = '';
    simulation.inited = false;
    simulation.running = false;
    simulation.paused = false;
    simulation.hasSamples = false;
    simulation.time = 0;
    simulation.stepIndex = 0;
    if (simulation.actual) {
      simulation.actual.scopeSamples = {};
      simulation.actual.instrumentSamples = {};
    }
    if (simulation.reference) {
      simulation.reference.scopeSamples = {};
      simulation.reference.instrumentSamples = {};
    }
    simulation.componentOutputs = { time: [], steps: [] };
    simulation.spectrumSampling = {};
    simulation.spectrumAnalyzerTraces = {};
  }

  if (scope === 'system') {
    if (state.step !== 1) {
      state.step = 1;
    }
    return state;
  }

  if (state.systemSaved) {
    state.step = 2;
  }

  return state;
}
