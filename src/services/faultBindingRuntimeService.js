function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeFaultId(value = 'fault') {
  return String(value || 'fault').replace(/[^A-Za-z0-9_-]/g, '-');
}

function firstText(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value) !== '') ?? '';
}

function getSlotId(slot = {}, fallback = '') {
  return firstText(slot.slotId, slot.id, fallback);
}

function getSlotName(slot = {}) {
  return firstText(slot.slotName, slot.name, slot.label);
}

export function createFaultInstanceRecord(options = {}) {
  const target = options.target || {};
  const model = options.model || {};
  const slot = options.slot || {};
  const parameters = clone(options.parameters || {});
  const bindingObject = options.bindingObject || slot.bindingObject || slot.targetVariable || slot.varName || slot.variableKey || slot.key || '';

  return {
    instanceId: options.instanceId || `fault-inst-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    faultTypeId: model.id || model.faultTypeId || model.modelId || '',
    targetKind: options.targetKind || (target.sourceNodeId && target.targetNodeId ? 'edge' : 'node'),
    targetId: target.id || '',
    slotId: getSlotId(slot, options.slotId || ''),
    slotName: getSlotName(slot),
    layer: model.layer || slot.layer || 'electrical',
    injectionForm: options.injectionForm || '',
    bindingObject,
    targetVariable: options.targetVariable || bindingObject,
    targetField: options.targetField || slot.targetField || '',
    displayName: model.displayName || model.name || model.id || model.faultTypeId || '',
    parameters,
    active: options.active ?? true,
    visual: clone(options.visual || { expanded: false })
  };
}

export function createRuntimePayloadFromInstance(options = {}) {
  const model = options.model || {};
  const instance = options.instance || {};
  const basePayload = clone(options.basePayload || {});
  const parameters = clone(options.parameters || instance.parameters || basePayload.parameters || {});
  const modelId = instance.faultTypeId || model.id || model.faultTypeId || basePayload.modelId || '';

  return {
    ...basePayload,
    modelId,
    faultTypeId: modelId,
    instanceId: instance.instanceId || basePayload.instanceId || '',
    name: instance.displayName || model.displayName || model.name || basePayload.name || modelId,
    layer: basePayload.layer || instance.layer || model.layer || 'electrical',
    runtimeBehavior: basePayload.runtimeBehavior || model.runtimeBehavior || '',
    faultKind: basePayload.faultKind || model.faultClass || model.modelClass || '',
    modelClass: basePayload.modelClass || model.modelClass || model.faultClass || '',
    parameters,
    slotId: instance.slotId || basePayload.slotId || '',
    slotName: instance.slotName || basePayload.slotName || '',
    bindingObject: instance.bindingObject || basePayload.bindingObject || '',
    targetVariable: instance.targetVariable || basePayload.targetVariable || instance.bindingObject || basePayload.bindingObject || '',
    targetField: instance.targetField || basePayload.targetField || '',
    injectionForm: instance.injectionForm || basePayload.injectionForm || ''
  };
}

export function createFaultTagRecord(options = {}) {
  const instance = options.instance || {};
  const model = options.model || {};
  const target = options.target || {};
  const payload = clone(options.payload || {});
  const faultModelId = instance.faultTypeId || payload.modelId || model.id || model.faultTypeId || '';
  const targetKind = instance.targetKind || (target.sourceNodeId && target.targetNodeId ? 'edge' : 'node');
  const box = options.box || {};
  const fallbackName = instance.displayName || model.displayName || model.name || faultModelId;

  return {
    id: options.tagId || `fault-tag-${safeFaultId(faultModelId)}`,
    type: 'fault_tag',
    faultModelId,
    faultModelName: fallbackName,
    name: fallbackName,
    layer: options.layerLabel || model.layer || instance.layer || payload.layer || '',
    modelClass: model.modelClass || model.faultClass || options.fallbackModelClass || '故障',
    runtimeBehavior: model.runtimeBehavior || payload.runtimeBehavior || '',
    targetKind,
    targetId: instance.targetId || target.id || '',
    hostNodeId: options.hostNodeId || (targetKind === 'node' ? (target.id || '') : (target.sourceNodeId || '')),
    targetName: options.targetName || target.props?.name || target.name || target.label || target.id || '',
    slotId: instance.slotId || payload.slotId || '',
    slotName: instance.slotName || payload.slotName || '',
    bindingObject: instance.bindingObject || payload.bindingObject || '',
    targetVariable: instance.targetVariable || payload.targetVariable || instance.bindingObject || payload.bindingObject || '',
    targetField: instance.targetField || payload.targetField || '',
    injectionForm: instance.injectionForm || payload.injectionForm || '',
    active: options.active ?? true,
    positionMode: options.positionMode || 'manual',
    expanded: options.expanded ?? false,
    collapsed: options.collapsed ?? true,
    parameters: clone(instance.parameters || payload.parameters || {}),
    injectedFault: payload,
    x: box.x || 0,
    y: box.y || 0,
    w: box.w || 204,
    h: box.h || 76
  };
}

export function createFaultTagLinkRecord(options = {}) {
  const instance = options.instance || {};
  const tag = options.tag || {};
  const faultModelId = tag.faultModelId || instance.faultTypeId || '';
  const targetKind = instance.targetKind || tag.targetKind || 'node';

  return {
    id: options.id || `fault-link-${safeFaultId(faultModelId)}-target`,
    faultModelId,
    sourceTagId: tag.id || '',
    targetNodeId: targetKind === 'edge' ? null : (instance.targetId || tag.targetId || null),
    targetEdgeId: targetKind === 'edge' ? (instance.targetId || tag.targetId || null) : null,
    role: 'fault-tag-attachment',
    label: options.label || '故障注入'
  };
}
