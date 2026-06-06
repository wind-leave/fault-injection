import { createDefaultPythonBinding } from '../composables/useWorkbenchState.js';

const ROOT_CANVAS_ID = 'canvas-root';
const ROOT_CANVAS_NAME = '顶层';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePortMapping(bindingPortMapping) {
  const safePortMapping = clone(bindingPortMapping ?? {});

  return {
    inputs: Array.isArray(safePortMapping.inputs) ? clone(safePortMapping.inputs) : [],
    outputs: Array.isArray(safePortMapping.outputs) ? clone(safePortMapping.outputs) : [],
    middleVars: Array.isArray(safePortMapping.middleVars) ? clone(safePortMapping.middleVars) : []
  };
}

function normalizeExecutionConfig(bindingExecutionConfig) {
  const safeExecutionConfig = clone(bindingExecutionConfig ?? {});

  return {
    ...createDefaultPythonBinding().executionConfig,
    ...safeExecutionConfig
  };
}

function normalizePythonBinding(binding) {
  if (!binding || typeof binding !== 'object') {
    return createDefaultPythonBinding();
  }

  const safeBinding = {
    ...createDefaultPythonBinding(),
    ...clone(binding)
  };

  safeBinding.executionConfig = normalizeExecutionConfig(binding.executionConfig);
  safeBinding.portMapping = {
    ...createDefaultPythonBinding().portMapping,
    ...normalizePortMapping(binding.portMapping)
  };

  return safeBinding;
}

function inferSequence(items, prefix) {
  return items.reduce((max, item) => {
    const numeric = Number(String(item?.id ?? '').replace(`${prefix}-`, ''));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
}

function collectCanvasItems(canvases, key) {
  return Object.values(isPlainObject(canvases) ? canvases : {}).flatMap((canvas) => {
    if (!isPlainObject(canvas)) {
      return [];
    }

    return toSafeArray(canvas[key]);
  });
}

function inferLayeredSequence(canvases, key, prefix) {
  return inferSequence(collectCanvasItems(canvases, key), prefix);
}

function normalizeNode(node) {
  const safeNode = isPlainObject(node) ? clone(node) : {};

  return {
    ...safeNode,
    pythonBinding: safeNode.type === 'simulation_block'
      ? normalizePythonBinding(safeNode.pythonBinding)
      : safeNode.pythonBinding ?? null
  };
}

function normalizeEdge(edge) {
  return isPlainObject(edge) ? clone(edge) : {};
}

function createEmptyCanvas(id = ROOT_CANVAS_ID, name = ROOT_CANVAS_NAME) {
  return {
    id,
    name,
    parentSubsystemNodeId: null,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    nodes: [],
    edges: []
  };
}

function normalizeCanvas(canvas, fallbackId = ROOT_CANVAS_ID) {
  const safeCanvas = isPlainObject(canvas) ? clone(canvas) : {};

  return {
    id: safeCanvas.id ?? fallbackId,
    name: safeCanvas.name ?? (fallbackId === ROOT_CANVAS_ID ? ROOT_CANVAS_NAME : '未命名画布'),
    parentSubsystemNodeId: safeCanvas.parentSubsystemNodeId ?? null,
    viewport: {
      scale: safeCanvas.viewport?.scale ?? 1,
      offsetX: safeCanvas.viewport?.offsetX ?? 0,
      offsetY: safeCanvas.viewport?.offsetY ?? 0
    },
    nodes: toSafeArray(safeCanvas.nodes).map(normalizeNode),
    edges: toSafeArray(safeCanvas.edges).map(normalizeEdge)
  };
}

function buildLayeredSnapshotFields(source) {
  const safeSource = isPlainObject(source) ? source : {};
  const safeCanvases = isPlainObject(safeSource.canvases) ? safeSource.canvases : null;

  if (!safeCanvases) {
    const rootCanvas = createEmptyCanvas();
    rootCanvas.nodes = toSafeArray(safeSource.modelNodes).map(normalizeNode);
    rootCanvas.edges = toSafeArray(safeSource.modelEdges).map(normalizeEdge);

    return {
      rootCanvasId: ROOT_CANVAS_ID,
      activeCanvasId: ROOT_CANVAS_ID,
      canvasTrail: [ROOT_CANVAS_ID],
      canvases: {
        [ROOT_CANVAS_ID]: rootCanvas
      }
    };
  }

  const rootCanvasId = safeSource.rootCanvasId ?? ROOT_CANVAS_ID;
  const normalizedCanvases = {};

  Object.entries(safeCanvases).forEach(([canvasId, canvas]) => {
    normalizedCanvases[canvasId] = normalizeCanvas(canvas, canvasId);
  });

  if (!normalizedCanvases[rootCanvasId]) {
    normalizedCanvases[rootCanvasId] = createEmptyCanvas(rootCanvasId);
  }

  const activeCanvasId = normalizedCanvases[safeSource.activeCanvasId]
    ? safeSource.activeCanvasId
    : rootCanvasId;
  const canvasTrail = toSafeArray(safeSource.canvasTrail)
    .filter((canvasId) => typeof canvasId === 'string' && normalizedCanvases[canvasId]);
  const normalizedTrail = canvasTrail.length > 0 ? canvasTrail : [rootCanvasId];

  if (normalizedTrail[normalizedTrail.length - 1] !== activeCanvasId) {
    normalizedTrail.push(activeCanvasId);
  }

  return {
    rootCanvasId,
    activeCanvasId,
    canvasTrail: normalizedTrail,
    canvases: normalizedCanvases
  };
}

export function createWorkbenchSnapshot(state) {
  const safeState = isPlainObject(state) ? clone(state) : {};
  const layeredFields = buildLayeredSnapshotFields(safeState);
  const activeCanvasViewport = layeredFields.canvases[layeredFields.activeCanvasId]?.viewport ?? {};
  if (layeredFields.canvases[layeredFields.activeCanvasId]) {
    layeredFields.canvases[layeredFields.activeCanvasId].viewport = {
      scale: Number.isFinite(safeState.canvasScale) ? safeState.canvasScale : (activeCanvasViewport.scale ?? 1),
      offsetX: Number.isFinite(safeState.canvasOffsetX) ? safeState.canvasOffsetX : (activeCanvasViewport.offsetX ?? 0),
      offsetY: Number.isFinite(safeState.canvasOffsetY) ? safeState.canvasOffsetY : (activeCanvasViewport.offsetY ?? 0)
    };
  }
  const activeCanvas = layeredFields.canvases[layeredFields.activeCanvasId] ?? createEmptyCanvas(
    layeredFields.activeCanvasId,
    layeredFields.activeCanvasId === layeredFields.rootCanvasId ? ROOT_CANVAS_NAME : '未命名画布'
  );
  const modelNodes = activeCanvas.nodes;
  const modelEdges = activeCanvas.edges;

  return clone({
    version: safeState.version ?? 1,
    modelNodes,
    modelEdges,
    nodeSeq: safeState.nodeSeq ?? inferLayeredSequence(layeredFields.canvases, 'nodes', 'node'),
    edgeSeq: safeState.edgeSeq ?? inferLayeredSequence(layeredFields.canvases, 'edges', 'edge'),
    rootCanvasId: layeredFields.rootCanvasId,
    activeCanvasId: layeredFields.activeCanvasId,
    canvasTrail: layeredFields.canvasTrail,
    canvases: layeredFields.canvases,
    activeLineType: safeState.activeLineType ?? 'normal',
    workspaceSource: typeof safeState.workspaceSource === 'string' ? safeState.workspaceSource : '',
    faultedBlks: toSafeArray(safeState.faultedBlks),
    importedFaultModels: toSafeArray(safeState.importedFaultModels),
    faultInstances: toSafeArray(safeState.faultInstances),
    faultTags: toSafeArray(safeState.faultTags),
    faultInjectionLinks: toSafeArray(safeState.faultInjectionLinks)
  });
}

export function restoreWorkbenchSnapshot(snapshot) {
  const safeSnapshot = isPlainObject(snapshot) ? clone(snapshot) : {};
  const layeredFields = buildLayeredSnapshotFields(safeSnapshot);
  const activeCanvas = layeredFields.canvases[layeredFields.activeCanvasId] ?? createEmptyCanvas(
    layeredFields.activeCanvasId,
    layeredFields.activeCanvasId === layeredFields.rootCanvasId ? ROOT_CANVAS_NAME : '未命名画布'
  );
  const modelNodes = activeCanvas.nodes;
  const modelEdges = activeCanvas.edges;

  return clone({
    version: safeSnapshot.version ?? 1,
    modelNodes,
    modelEdges,
    nodeSeq: safeSnapshot.nodeSeq ?? inferLayeredSequence(layeredFields.canvases, 'nodes', 'node'),
    edgeSeq: safeSnapshot.edgeSeq ?? inferLayeredSequence(layeredFields.canvases, 'edges', 'edge'),
    rootCanvasId: layeredFields.rootCanvasId,
    activeCanvasId: layeredFields.activeCanvasId,
    canvasTrail: layeredFields.canvasTrail,
    canvases: layeredFields.canvases,
    activeLineType: safeSnapshot.activeLineType ?? 'normal',
    workspaceSource: typeof safeSnapshot.workspaceSource === 'string' ? safeSnapshot.workspaceSource : '',
    faultedBlks: toSafeArray(safeSnapshot.faultedBlks),
    importedFaultModels: toSafeArray(safeSnapshot.importedFaultModels),
    faultInstances: toSafeArray(safeSnapshot.faultInstances),
    faultTags: toSafeArray(safeSnapshot.faultTags),
    faultInjectionLinks: toSafeArray(safeSnapshot.faultInjectionLinks)
  });
}
