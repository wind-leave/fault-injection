import { createDefaultPythonBinding } from '../composables/useWorkbenchState.js';
import { initializeSimulationInterfaceLock } from './simulationInterfaceLockService.js';

const ROOT_CANVAS_ID = 'canvas-root';
const ROOT_CANVAS_NAME = '顶层';
// This analyzer was superseded by the ordinary spectrum analyzer.  Keep only
// this import-time compatibility marker so an old workspace cannot revive it.
const REMOVED_COMPONENT_TYPES = new Set(['instrument_complex_envelope_spectrum']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSimulationConfig(value) {
  const config = isPlainObject(value) ? value : {};
  const duration = Number(config.duration);
  const stepSize = Number(config.stepSize);
  return {
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 10,
    stepSize: Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 0.1
  };
}

function normalizeSimulationRequestSteps(value) {
  const requested = Number.parseInt(value, 10);
  if (!Number.isFinite(requested)) {
    return 1000;
  }
  return Math.min(100000, Math.max(1, requested));
}

function normalizePortMapping(bindingPortMapping) {
  const safePortMapping = clone(bindingPortMapping ?? {});

  return {
    inputs: Array.isArray(safePortMapping.inputs) ? clone(safePortMapping.inputs) : [],
    outputs: Array.isArray(safePortMapping.outputs) ? clone(safePortMapping.outputs) : [],
    middleVars: Array.isArray(safePortMapping.middleVars) ? clone(safePortMapping.middleVars) : []
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

  delete safeBinding.executionConfig;
  // Python implementation files are deployed and registered by the backend.
  // Model snapshots persist only the file/entry reference, never source code.
  delete safeBinding.rawSource;
  delete safeBinding.source;
  if (isPlainObject(safeBinding.parsedInterface)) {
    delete safeBinding.parsedInterface.rawSource;
    delete safeBinding.parsedInterface.source;
  }
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
  const normalizedNode = {
    ...safeNode,
    pythonBinding: safeNode.type === 'simulation_block'
      ? normalizePythonBinding(safeNode.pythonBinding)
      : safeNode.pythonBinding ?? null
  };

  if (normalizedNode.type === 'subsystem_block') {
    const props = isPlainObject(normalizedNode.props) ? normalizedNode.props : {};
    normalizedNode.props = {
      ...props,
      subsystemId: String(props.subsystemId ?? normalizedNode.subsystemId ?? normalizedNode.id ?? '').trim()
    };
    delete normalizedNode.subsystemId;
  }

  return normalizedNode.type === 'simulation_block'
    ? initializeSimulationInterfaceLock(normalizedNode)
    : normalizedNode;
}

function normalizeEdge(edge) {
  return isPlainObject(edge) ? clone(edge) : {};
}

function normalizeCanvasItems(nodes, edges) {
  const allNodes = toSafeArray(nodes).map(normalizeNode);
  const removedNodeIds = new Set(allNodes
    .filter((node) => REMOVED_COMPONENT_TYPES.has(node.type))
    .map((node) => node.id));
  const normalizedNodes = allNodes
    .filter((node) => !REMOVED_COMPONENT_TYPES.has(node.type));

  return {
    nodes: normalizedNodes,
    edges: toSafeArray(edges)
      .map(normalizeEdge)
      .filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId))
  };
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
  const items = normalizeCanvasItems(safeCanvas.nodes, safeCanvas.edges);

  return {
    id: safeCanvas.id ?? fallbackId,
    name: safeCanvas.name ?? (fallbackId === ROOT_CANVAS_ID ? ROOT_CANVAS_NAME : '未命名画布'),
    parentSubsystemNodeId: safeCanvas.parentSubsystemNodeId ?? null,
    viewport: {
      scale: safeCanvas.viewport?.scale ?? 1,
      offsetX: safeCanvas.viewport?.offsetX ?? 0,
      offsetY: safeCanvas.viewport?.offsetY ?? 0
    },
    ...items
  };
}

function buildLayeredSnapshotFields(source) {
  const safeSource = isPlainObject(source) ? source : {};
  const safeCanvases = isPlainObject(safeSource.canvases) ? safeSource.canvases : null;

  if (!safeCanvases) {
    const rootCanvas = createEmptyCanvas();
    Object.assign(rootCanvas, normalizeCanvasItems(safeSource.modelNodes, safeSource.modelEdges));

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
    taskName: typeof safeState.taskName === 'string' ? safeState.taskName : '',
    workspaceSource: typeof safeState.workspaceSource === 'string' ? safeState.workspaceSource : '',
    simulationConfig: normalizeSimulationConfig(safeState.simulationConfig),
    simulationRequestSteps: normalizeSimulationRequestSteps(safeState.simulationRequestSteps),
    faultedBlks: toSafeArray(safeState.faultedBlks),
    importedFaultModels: toSafeArray(safeState.importedFaultModels),
    faultInstances: toSafeArray(safeState.faultInstances),
    faultTags: toSafeArray(safeState.faultTags),
    faultInjectionLinks: toSafeArray(safeState.faultInjectionLinks),
    diagnosticModel: isPlainObject(safeState.diagnosticModel) ? clone(safeState.diagnosticModel) : null,
    diagnosticTestPoints: toSafeArray(safeState.diagnosticTestPoints),
    testPoints: toSafeArray(safeState.testPoints),
    manualDiagnosticTestPoints: toSafeArray(safeState.manualDiagnosticTestPoints),
    installedDiagnosticTestPointIds: toSafeArray(safeState.installedDiagnosticTestPointIds),
    diagnosticTestPointManualCleared: Boolean(safeState.diagnosticTestPointManualCleared)
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
    taskName: typeof safeSnapshot.taskName === 'string' ? safeSnapshot.taskName : '',
    workspaceSource: typeof safeSnapshot.workspaceSource === 'string' ? safeSnapshot.workspaceSource : '',
    simulationConfig: normalizeSimulationConfig(safeSnapshot.simulationConfig),
    simulationRequestSteps: normalizeSimulationRequestSteps(safeSnapshot.simulationRequestSteps),
    faultedBlks: toSafeArray(safeSnapshot.faultedBlks),
    importedFaultModels: toSafeArray(safeSnapshot.importedFaultModels),
    faultInstances: toSafeArray(safeSnapshot.faultInstances),
    faultTags: toSafeArray(safeSnapshot.faultTags),
    faultInjectionLinks: toSafeArray(safeSnapshot.faultInjectionLinks),
    diagnosticModel: isPlainObject(safeSnapshot.diagnosticModel) ? clone(safeSnapshot.diagnosticModel) : null,
    diagnosticTestPoints: toSafeArray(safeSnapshot.diagnosticTestPoints),
    testPoints: toSafeArray(safeSnapshot.testPoints),
    manualDiagnosticTestPoints: toSafeArray(safeSnapshot.manualDiagnosticTestPoints),
    installedDiagnosticTestPointIds: toSafeArray(safeSnapshot.installedDiagnosticTestPointIds),
    diagnosticTestPointManualCleared: Boolean(safeSnapshot.diagnosticTestPointManualCleared)
  });
}
