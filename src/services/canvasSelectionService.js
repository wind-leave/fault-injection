function list(value) {
  return Array.isArray(value) ? value : [];
}

export function getNode(state = {}, id = '') {
  return list(state.modelNodes).find((node) => node?.id === id);
}

export function getEdge(state = {}, id = '') {
  return list(state.modelEdges).find((edge) => edge?.id === id);
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - start.x - ratio * dx, point.y - start.y - ratio * dy);
}

export function rankCanvasEdgesByClientPoint(paths, options = {}) {
  const { clientX, clientY, stagePoint, scale = 1, threshold = 14 } = options;
  if (!stagePoint || !Number.isFinite(stagePoint.x) || !Number.isFinite(stagePoint.y)) return [];
  const zoom = Math.max(Number(scale) || 1, 0.001);
  const nearestById = new Map();

  for (const path of paths) {
    const id = path?.dataset?.edgeId;
    if (!id || typeof path.getTotalLength !== 'function' || typeof path.getPointAtLength !== 'function') continue;
    const bounds = path.getBoundingClientRect?.();
    if (bounds && (bounds.width > 0 || bounds.height > 0) && (
      clientX < bounds.left - threshold || clientX > bounds.right + threshold ||
      clientY < bounds.top - threshold || clientY > bounds.bottom + threshold
    )) continue;

    try {
      const total = path.getTotalLength();
      if (!Number.isFinite(total) || total < 0) continue;
      const sampleCount = Math.max(1, Math.ceil(total * zoom / 8));
      let previous = path.getPointAtLength(0);
      let distance = Math.hypot(stagePoint.x - previous.x, stagePoint.y - previous.y);
      for (let index = 1; index <= sampleCount; index += 1) {
        const current = path.getPointAtLength(total * index / sampleCount);
        distance = Math.min(distance, distanceToSegment(stagePoint, previous, current));
        previous = current;
      }
      const screenDistance = distance * zoom;
      if (screenDistance <= threshold && screenDistance < (nearestById.get(id) ?? Infinity)) {
        nearestById.set(id, screenDistance);
      }
    } catch {
      // A path being replaced during an incremental render is not selectable.
    }
  }

  return [...nearestById].map(([id, distance]) => ({ id, distance }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

export function chooseCanvasEdgeForClick(nearby, previous = {}, click = {}, fallbackId = '') {
  const closest = nearby[0]?.distance ?? Infinity;
  const ambiguous = nearby.filter((item) => item.distance <= closest + 5);
  const repeated = click.time - previous.time < 1400 &&
    Math.hypot(click.x - previous.x, click.y - previous.y) <= 6;
  const previousIndex = ambiguous.findIndex((item) => item.id === previous.id);
  return ambiguous[repeated && previousIndex >= 0 ? (previousIndex + 1) % ambiguous.length : 0]?.id || fallbackId;
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
