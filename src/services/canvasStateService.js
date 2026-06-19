export const DEFAULT_ROOT_CANVAS_ID = 'canvas-root';
export const DEFAULT_ROOT_CANVAS_NAME = '顶层';

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function ensureStateDefaults(state = {}) {
  state.rootCanvasId = state.rootCanvasId || DEFAULT_ROOT_CANVAS_ID;
  state.activeCanvasId = state.activeCanvasId || state.rootCanvasId;
  return state;
}

export function createEmptyCanvasRecord(id, name, parentSubsystemNodeId = null) {
  return {
    id,
    name,
    parentSubsystemNodeId,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    nodes: [],
    edges: []
  };
}

export function ensureWorkbenchCanvasState(state = {}) {
  ensureStateDefaults(state);

  if (!state.canvases || typeof state.canvases !== 'object') {
    state.canvases = {};
  }
  if (!state.canvases[state.rootCanvasId]) {
    state.canvases[state.rootCanvasId] = createEmptyCanvasRecord(state.rootCanvasId, DEFAULT_ROOT_CANVAS_NAME, null);
  }
  if (!state.activeCanvasId || !state.canvases[state.activeCanvasId]) {
    state.activeCanvasId = state.rootCanvasId;
  }
  if (!Array.isArray(state.canvasTrail) || state.canvasTrail.length === 0) {
    state.canvasTrail = [state.rootCanvasId];
  }

  const existingTrail = state.canvasTrail
    .filter(Boolean)
    .filter((canvasId) => state.canvases[canvasId]);
  const withoutRoot = existingTrail.filter((canvasId) => canvasId !== state.rootCanvasId);
  state.canvasTrail = [state.rootCanvasId, ...withoutRoot];

  if (state.canvasTrail[state.canvasTrail.length - 1] !== state.activeCanvasId) {
    state.canvasTrail = [
      ...state.canvasTrail.filter((canvasId) => canvasId !== state.activeCanvasId),
      state.activeCanvasId
    ];
  }

  if (!state.canvases[state.activeCanvasId]) {
    state.canvases[state.activeCanvasId] = createEmptyCanvasRecord(
      state.activeCanvasId,
      state.activeCanvasId === state.rootCanvasId ? DEFAULT_ROOT_CANVAS_NAME : '未命名画布',
      null
    );
  }

  return state;
}

export function getCanvasRecord(state = {}, canvasId = state.activeCanvasId) {
  ensureWorkbenchCanvasState(state);
  return state.canvases[canvasId] || null;
}

export function getActiveCanvasRecord(state = {}) {
  return getCanvasRecord(state, state.activeCanvasId);
}

export function syncActiveCanvasViewportFromState(state = {}) {
  ensureWorkbenchCanvasState(state);
  const canvas = getActiveCanvasRecord(state);
  if (!canvas) {
    return null;
  }
  canvas.viewport = {
    scale: state.canvasScale,
    offsetX: state.canvasOffsetX,
    offsetY: state.canvasOffsetY
  };
  return canvas.viewport;
}

export function restoreActiveCanvasViewport(state = {}, canvasId = state.activeCanvasId) {
  ensureWorkbenchCanvasState(state);
  const viewport = getCanvasRecord(state, canvasId)?.viewport || {};
  state.canvasScale = finiteNumber(viewport.scale, 1);
  state.canvasOffsetX = finiteNumber(viewport.offsetX, 0);
  state.canvasOffsetY = finiteNumber(viewport.offsetY, 0);
  return {
    scale: state.canvasScale,
    offsetX: state.canvasOffsetX,
    offsetY: state.canvasOffsetY
  };
}

export function setActiveCanvasRecord(state = {}, canvasId, trail = null) {
  ensureWorkbenchCanvasState(state);
  if (!state.canvases[canvasId]) {
    return false;
  }

  syncActiveCanvasViewportFromState(state);
  state.activeCanvasId = canvasId;
  if (Array.isArray(trail) && trail.length) {
    const normalizedTrail = trail.filter(Boolean);
    if (normalizedTrail[0] !== state.rootCanvasId) {
      normalizedTrail.unshift(state.rootCanvasId);
    }
    state.canvasTrail = normalizedTrail;
  } else {
    state.canvasTrail = canvasId === state.rootCanvasId ? [state.rootCanvasId] : [state.rootCanvasId, canvasId];
  }
  restoreActiveCanvasViewport(state, canvasId);
  return true;
}

export function getSubsystemCanvasId(nodeId) {
  return `canvas-${nodeId}`;
}

export function createSubsystemCanvas(state = {}, node = {}) {
  ensureWorkbenchCanvasState(state);
  const canvasId = getSubsystemCanvasId(node.id);
  if (!state.canvases[canvasId]) {
    state.canvases[canvasId] = createEmptyCanvasRecord(canvasId, node.props?.name || '子系统', node.id);
  }
  node.targetCanvasId = canvasId;
  return state.canvases[canvasId];
}

export function openCanvasRecord(state = {}, canvasId, trail = null) {
  if (!setActiveCanvasRecord(state, canvasId, trail)) {
    return false;
  }
  state.selBlk = null;
  state.selEdge = null;
  state.pendingConnection = null;
  return true;
}
