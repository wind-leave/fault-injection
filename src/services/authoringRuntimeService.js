import { normalizeAuthoringPackage, upsertById } from './authoringModelService.js';
import {
  addFaultSlotToComponentTemplate,
  createComponentTemplateFromPython,
  createNodeFromComponentTemplate
} from './componentAuthoringService.js';
import {
  attachFaultTypeToTargetSlot,
  createFaultType
} from './faultAuthoringService.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function runtimeState() {
  return window.__GZ_STATE__ ?? null;
}

function slug(value, fallback = 'item') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return normalized || fallback;
}

function nextUniqueId(prefix, existingIds) {
  let index = 1;
  let id = `${prefix}-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function currentNodes(state) {
  return arrayOrEmpty(state?.modelNodes?.length ? state.modelNodes : state?.nodes);
}

function currentEdges(state) {
  return arrayOrEmpty(state?.modelEdges?.length ? state.modelEdges : state?.edges);
}

function ensureAuthoringPackage(state) {
  const base = normalizeAuthoringPackage(state?.activeModelPackage ?? {
    modelInfo: {
      modelId: 'runtime-authored-model',
      modelName: '当前编辑模型'
    }
  });

  return {
    ...base,
    systemModel: {
      ...base.systemModel,
      nodes: currentNodes(state),
      edges: currentEdges(state)
    },
    faultTypeCatalog: arrayOrEmpty(base.faultTypeCatalog?.length ? base.faultTypeCatalog : state?.faultLibrary),
    faultCapabilityMap: arrayOrEmpty(base.faultCapabilityMap),
    faultInstances: arrayOrEmpty(state?.faultInstances?.length ? state.faultInstances : base.faultInstances)
  };
}

function commitPackage(state, modelPackage) {
  state.activeModelPackage = clone(modelPackage);
  state.modelNodes = arrayOrEmpty(modelPackage.systemModel?.nodes);
  state.modelEdges = arrayOrEmpty(modelPackage.systemModel?.edges);
  state.nodes = state.modelNodes;
  state.edges = state.modelEdges;
  state.faultInstances = arrayOrEmpty(modelPackage.faultInstances);
  state.sysLoaded = true;
  state.systemSaved = false;
  state.workspaceSource = state.workspaceSource || 'authored';
  if (Array.isArray(modelPackage.faultTypeCatalog)) {
    state.faultLibrary = arrayOrEmpty(modelPackage.faultTypeCatalog);
    state.faults = state.faultLibrary;
  }
}

function refreshRuntime(selectedNodeId = '') {
  window.renderModelNodes?.();
  window.renderEdges?.();
  if (selectedNodeId) {
    window.selectNode?.(selectedNodeId);
  }
  window.updateUI?.();
}

function firstOutputSignal(parsedInterface, templateId) {
  const output = arrayOrEmpty(parsedInterface?.outputs)[0];
  return {
    signalId: output?.signalId || `${text(parsedInterface?.moduleName, templateId)}.${text(output?.name, 'output')}`,
    name: output?.displayName || output?.comment || output?.name || '输出信号'
  };
}

function buildDefaultParsedInterface(form = {}) {
  const moduleName = slug(form.displayName, 'custom_component').replace(/-/g, '_');
  return {
    fileName: `${moduleName}.py`,
    moduleName,
    description: text(form.displayName, '自定义组件'),
    entryFunction: 'process',
    inputs: [{ name: 'input_0', displayName: '输入 1', type: 'float' }],
    outputs: [{ name: 'output_0', displayName: '输出 1', type: 'float' }],
    middleVars: [],
    rawSource: ''
  };
}

function makeCapabilityEntry(node) {
  return {
    targetKind: 'node',
    targetId: node.id,
    targetName: node.props?.name || node.id,
    faultSlots: arrayOrEmpty(node.faultSlots)
  };
}

export function addAuthoredComponentToRuntime({
  parsedInterface,
  displayName,
  category = '仿真模块',
  geometry = 'rect',
  slotName = '',
  slotKind = 'output_signal',
  x,
  y
} = {}) {
  const state = runtimeState();
  if (!state) {
    return { ok: false, error: 'missing-runtime-state' };
  }

  const safeParsed = parsedInterface?.entryFunction
    ? clone(parsedInterface)
    : buildDefaultParsedInterface({ displayName });
  const templateId = slug(safeParsed.moduleName || displayName, 'custom-component');
  const signal = firstOutputSignal(safeParsed, templateId);
  const slotId = `${templateId}-${slug(signal.signalId, 'output')}-fault-slot`;
  const template = addFaultSlotToComponentTemplate(
    createComponentTemplateFromPython({
      templateId,
      displayName: text(displayName, safeParsed.description || templateId),
      category,
      geometry,
      parsedInterface: safeParsed
    }),
    {
      slotId,
      slotName: text(slotName, `${signal.name}故障位`),
      displayName: text(slotName, `${signal.name}故障位`),
      kind: slotKind,
      signalId: signal.signalId,
      allowedFaultTypeIds: []
    }
  );

  const existingIds = new Set(currentNodes(state).map((node) => node.id));
  const nodeId = nextUniqueId(`node-${templateId}`, existingIds);
  const node = createNodeFromComponentTemplate(template, {
    id: nodeId,
    x: Number.isFinite(x) ? x : 260 + existingIds.size * 36,
    y: Number.isFinite(y) ? y : 220 + existingIds.size * 18
  });

  const pkg = ensureAuthoringPackage(state);
  const nextNodes = [...arrayOrEmpty(pkg.systemModel.nodes), node];
  const capabilityEntry = makeCapabilityEntry(node);
  const nextCapabilityMap = [
    ...arrayOrEmpty(pkg.faultCapabilityMap).filter((entry) => !(entry.targetKind === 'node' && entry.targetId === node.id)),
    capabilityEntry
  ];
  const nextPkg = {
    ...pkg,
    componentTemplates: upsertById(pkg.componentTemplates, template, 'templateId'),
    systemModel: {
      ...pkg.systemModel,
      nodes: nextNodes,
      edges: currentEdges(state)
    },
    faultCapabilityMap: nextCapabilityMap
  };

  commitPackage(state, nextPkg);
  refreshRuntime(node.id);
  return { ok: true, node, template, package: nextPkg };
}

function defaultParameterSchema(runtimeBehavior, defaults = {}) {
  const start = { type: 'number', default: Number(defaults.start ?? 0) };
  const duration = { type: 'number', default: defaults.duration ?? '' };
  if (runtimeBehavior === 'drift') {
    return { rate: { type: 'number', default: Number(defaults.rate ?? 0.01) }, start, duration };
  }
  if (runtimeBehavior === 'noise') {
    return { amplitude: { type: 'number', default: Number(defaults.amplitude ?? 0.1) }, start, duration };
  }
  if (runtimeBehavior === 'intermittent') {
    return { probability: { type: 'number', default: Number(defaults.probability ?? 0.1) }, start, duration };
  }
  if (runtimeBehavior === 'lock') {
    return { lock_value: { type: 'number', default: Number(defaults.lock_value ?? 0) }, start, duration };
  }
  if (runtimeBehavior === 'tamper') {
    return { scale: { type: 'number', default: Number(defaults.scale ?? 1) }, start, duration };
  }
  return { bias: { type: 'number', default: Number(defaults.bias ?? 0.1) }, start, duration };
}

function ensureCapabilityTarget(pkg, target) {
  const targetKind = target.targetKind || 'node';
  const targetId = target.targetId;
  const slotId = target.slotId || 'default-fault-slot';
  const slot = {
    slotId,
    slotName: target.slotName || target.slotDisplayName || slotId,
    displayName: target.slotName || target.slotDisplayName || slotId,
    kind: target.slotKind || 'output_signal',
    signalId: target.signalId || '',
    allowedFaultTypeIds: []
  };
  const capabilityMap = arrayOrEmpty(pkg.faultCapabilityMap);
  const capabilityIndex = capabilityMap.findIndex((entry) => entry.targetKind === targetKind && entry.targetId === targetId);
  const nextCapabilityMap = capabilityIndex === -1
    ? [...capabilityMap, {
      targetKind,
      targetId,
      targetName: target.targetName || targetId,
      faultSlots: [slot]
    }]
    : capabilityMap.map((entry, index) => {
      if (index !== capabilityIndex) return entry;
      const slots = arrayOrEmpty(entry.faultSlots);
      return {
        ...entry,
        targetName: entry.targetName || target.targetName || targetId,
        faultSlots: slots.some((item) => item.slotId === slotId) ? slots : [...slots, slot]
      };
    });

  const section = targetKind === 'edge' ? 'edges' : 'nodes';
  const targets = arrayOrEmpty(pkg.systemModel?.[section]);
  const nextTargets = targets.map((item) => {
    if (item.id !== targetId) return item;
    const slots = arrayOrEmpty(item.faultSlots);
    return {
      ...item,
      faultSlots: slots.some((existing) => existing.slotId === slotId) ? slots : [...slots, slot]
    };
  });

  return {
    ...pkg,
    faultCapabilityMap: nextCapabilityMap,
    systemModel: {
      ...pkg.systemModel,
      [section]: nextTargets
    }
  };
}

export function addAuthoredFaultToRuntime({
  target,
  faultId,
  displayName,
  layer = 'electrical',
  faultClass = '自定义故障',
  runtimeBehavior = 'bias',
  parameters = {}
} = {}) {
  const state = runtimeState();
  if (!state) {
    return { ok: false, error: 'missing-runtime-state' };
  }
  if (!target?.targetId || !target?.slotId) {
    return { ok: false, error: 'missing-target-slot' };
  }

  const id = slug(faultId || displayName, `custom-fault-${Date.now()}`);
  const faultType = createFaultType({
    id,
    displayName: text(displayName, id),
    layer,
    faultClass,
    runtimeBehavior,
    formula: '',
    parameters: defaultParameterSchema(runtimeBehavior, parameters)
  });

  const pkg = ensureCapabilityTarget(ensureAuthoringPackage(state), {
    ...objectOrEmpty(target),
    targetKind: target.targetKind || 'node'
  });
  const withCatalog = {
    ...pkg,
    faultTypeCatalog: upsertById(pkg.faultTypeCatalog, faultType)
  };
  const nextPkg = attachFaultTypeToTargetSlot(withCatalog, {
    targetKind: target.targetKind || 'node',
    targetId: target.targetId,
    slotId: target.slotId,
    faultTypeId: faultType.id
  });

  commitPackage(state, nextPkg);
  refreshRuntime(target.targetKind === 'node' ? target.targetId : '');
  return { ok: true, faultType, package: nextPkg };
}

function findCapabilityEntry(state, targetKind, targetId) {
  return arrayOrEmpty(state?.activeModelPackage?.faultCapabilityMap).find(
    (entry) => entry.targetKind === targetKind && entry.targetId === targetId
  ) ?? null;
}

function getSelectedTargetForFaultAuthoring() {
  const state = runtimeState();
  if (!state) return null;
  const targetKind = state.selEdge ? 'edge' : 'node';
  const targetId = state.selEdge || state.selBlk || '';
  if (!targetId) return null;
  const target = targetKind === 'edge'
    ? currentEdges(state).find((edge) => edge.id === targetId)
    : currentNodes(state).find((node) => node.id === targetId);
  if (!target) return null;
  const capability = findCapabilityEntry(state, targetKind, targetId);
  const slot = arrayOrEmpty(target.faultSlots)[0] ?? arrayOrEmpty(capability?.faultSlots)[0] ?? null;
  if (!slot) return null;

  return {
    targetKind,
    targetId,
    targetName: target.props?.name || target.name || capability?.targetName || targetId,
    slotId: slot.slotId,
    slotName: slot.slotName || slot.displayName || slot.slotId,
    slotKind: slot.kind,
    signalId: slot.signalId
  };
}

export function openFaultAuthoringForSelectedTarget() {
  const target = getSelectedTargetForFaultAuthoring();
  if (!target) {
    return false;
  }
  window.dispatchEvent(new CustomEvent('gz:open-fault-authoring', {
    detail: { target }
  }));
  return true;
}

if (typeof window !== 'undefined') {
  window.__GZ_AUTHORING_RUNTIME__ = {
    ...(window.__GZ_AUTHORING_RUNTIME__ ?? {}),
    addAuthoredComponentToRuntime,
    addAuthoredFaultToRuntime,
    openFaultAuthoringForSelectedTarget
  };
}
