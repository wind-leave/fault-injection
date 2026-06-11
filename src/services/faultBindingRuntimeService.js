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

function list(value) {
  return Array.isArray(value) ? value : [];
}

function faultModelIdOf(value = {}) {
  return value.faultModelId || value.faultTypeId || value.modelId || value.faultId || '';
}

function instanceMatches(left = {}, right = {}) {
  if (left.instanceId && right.instanceId && left.instanceId === right.instanceId) {
    return true;
  }
  return Boolean(left.faultTypeId && right.faultTypeId && left.faultTypeId === right.faultTypeId)
    && (left.targetKind || '') === (right.targetKind || '')
    && (left.targetId || '') === (right.targetId || '')
    && (left.slotId || '') === (right.slotId || '');
}

function runtimeRecordMatches(record = {}, payload = {}) {
  return Boolean(record.instanceId && payload.instanceId && record.instanceId === payload.instanceId)
    || Boolean(record.modelId && payload.modelId && record.modelId === payload.modelId)
    || Boolean(record.faultModelId && payload.modelId && record.faultModelId === payload.modelId)
    || Boolean(record.faultTypeId && payload.modelId && record.faultTypeId === payload.modelId);
}

function removalIdOf(value = {}) {
  return value?.faultModelId
    || value?.faultTypeId
    || value?.modelId
    || value?.faultId
    || value?.id
    || value?.injectedFault?.faultModelId
    || value?.injectedFault?.faultTypeId
    || value?.injectedFault?.modelId
    || value?.injectedFault?.faultId
    || '';
}

function removalInstanceIdOf(value = {}) {
  return value?.instanceId || value?.injectedFault?.instanceId || '';
}

function removalSlotIdOf(value = {}) {
  return value?.slotId || value?.targetSlotId || value?.injectedFault?.slotId || value?.target?.slotId || '';
}

function removalTargetKindOf(value = {}, fallback = 'node') {
  return value?.targetKind || value?.target?.targetKind || value?.target?.kind || value?.injectedFault?.targetKind || fallback;
}

function removalTargetIdOf(value = {}, fallback = '') {
  return value?.targetId
    || value?.target?.targetId
    || value?.target?.id
    || value?.injectedFault?.targetId
    || value?.targetNodeId
    || value?.targetEdgeId
    || fallback;
}

function recordMatchesRemovalRef(record = {}, ref = {}) {
  if (!record || !ref) {
    return false;
  }
  const recordTargetKind = removalTargetKindOf(record, ref.targetKind);
  const recordTargetId = removalTargetIdOf(record, ref.targetId);
  if (recordTargetId && recordTargetId !== ref.targetId) {
    return false;
  }
  if (recordTargetKind && recordTargetKind !== ref.targetKind) {
    return false;
  }

  const recordInstanceId = removalInstanceIdOf(record);
  if (ref.instanceId && recordInstanceId && recordInstanceId === ref.instanceId) {
    return true;
  }

  const recordFaultId = removalIdOf(record);
  if (ref.faultId && recordFaultId && recordFaultId === ref.faultId) {
    const recordSlotId = removalSlotIdOf(record);
    return !ref.slotId || !recordSlotId || recordSlotId === ref.slotId;
  }

  return false;
}

function recordMatchesAnyRemovalRef(record = {}, refs = []) {
  return refs.some((ref) => recordMatchesRemovalRef(record, ref));
}

function hasRemainingActiveFaultId(state = {}, faultId = '') {
  if (!faultId) {
    return false;
  }

  return [
    ...list(state.faultInstances),
    ...list(state.activeFaults),
    ...list(state.injectedFaults),
    ...list(state.appliedFaults)
  ].some((item) => item?.active !== false && removalIdOf(item) === faultId);
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

export function upsertFaultInstanceRecord(records = [], instance = {}) {
  return [
    ...list(records).filter((item) => !instanceMatches(item, instance)),
    clone(instance)
  ];
}

export function upsertFaultRuntimeRecord(records = [], payload = {}) {
  const modelId = payload.modelId || payload.faultTypeId || payload.faultModelId || '';
  const record = {
    ...clone(payload),
    faultId: modelId,
    faultTypeId: modelId,
    status: 'active'
  };

  return [
    ...list(records).filter((item) => !runtimeRecordMatches(item, { ...payload, modelId })),
    record
  ];
}

export function upsertInjectedFaultMap(map = {}, payload = {}) {
  const modelId = payload.modelId || payload.faultTypeId || payload.faultModelId || '';
  if (!modelId) {
    return { ...(map || {}) };
  }
  return {
    ...(map || {}),
    [modelId]: {
      ...clone(payload),
      status: 'active'
    }
  };
}

export function upsertFaultTagRecord(records = [], tag = {}) {
  const modelId = faultModelIdOf(tag);
  return [
    ...list(records).filter((item) => !modelId || faultModelIdOf(item) !== modelId),
    clone(tag)
  ];
}

export function upsertFaultTagLinkRecord(records = [], link = {}) {
  const modelId = faultModelIdOf(link);
  return [
    ...list(records).filter((item) => !modelId || faultModelIdOf(item) !== modelId),
    clone(link)
  ];
}

export function removeFaultRuntimeArtifactsFromState(state = {}, refs = [], options = {}) {
  const normalizedRefs = list(refs).filter((ref) => ref && (ref.instanceId || ref.faultId || ref.bindingId));
  const nextState = { ...(state || {}) };
  const removedTagIds = new Set();
  let changed = false;

  if (!normalizedRefs.length) {
    return { state: nextState, changed, removedTagIds: [] };
  }

  ['activeFaults', 'injectedFaults', 'appliedFaults', 'selectedFaults', 'faultInjectionResults'].forEach((key) => {
    if (!Array.isArray(nextState[key])) {
      return;
    }
    const filtered = nextState[key].filter((item) => !recordMatchesAnyRemovalRef(item, normalizedRefs));
    if (filtered.length !== nextState[key].length) {
      nextState[key] = filtered;
      changed = true;
    }
  });

  if (Array.isArray(nextState.faultInstances)) {
    const disabledAt = options.now || new Date().toISOString();
    const disabledReason = options.disabledReason || 'fault-cleared-from-property-panel';
    nextState.faultInstances = nextState.faultInstances.map((instance) => {
      if (!recordMatchesAnyRemovalRef(instance, normalizedRefs) || instance.active === false) {
        return instance;
      }
      changed = true;
      return {
        ...instance,
        active: false,
        enabled: false,
        disabledAt,
        disabledReason
      };
    });
  }

  if (Array.isArray(nextState.faultTags)) {
    nextState.faultTags
      .filter((tag) => recordMatchesAnyRemovalRef(tag, normalizedRefs))
      .map((tag) => tag.id)
      .filter(Boolean)
      .forEach((tagId) => removedTagIds.add(tagId));

    const filteredTags = nextState.faultTags.filter((tag) => !recordMatchesAnyRemovalRef(tag, normalizedRefs));
    if (filteredTags.length !== nextState.faultTags.length) {
      nextState.faultTags = filteredTags;
      changed = true;
    }
  }

  if (Array.isArray(nextState.faultInjectionLinks) && removedTagIds.size) {
    const targetId = options.target?.id || '';
    const filteredLinks = nextState.faultInjectionLinks.filter((link) => {
      if (removedTagIds.has(link.sourceTagId)) {
        return false;
      }
      if (targetId && (link.targetNodeId === targetId || link.targetEdgeId === targetId)) {
        return !normalizedRefs.some((ref) => ref.faultId && removalIdOf(link) === ref.faultId);
      }
      return true;
    });
    if (filteredLinks.length !== nextState.faultInjectionLinks.length) {
      nextState.faultInjectionLinks = filteredLinks;
      changed = true;
    }
  }

  if (nextState.injectedFaultMap && typeof nextState.injectedFaultMap === 'object') {
    const nextMap = { ...nextState.injectedFaultMap };
    normalizedRefs.forEach((ref) => {
      if (
        ref.faultId
        && !hasRemainingActiveFaultId(nextState, ref.faultId)
        && Object.prototype.hasOwnProperty.call(nextMap, ref.faultId)
      ) {
        delete nextMap[ref.faultId];
        changed = true;
      }
    });
    nextState.injectedFaultMap = nextMap;
  }

  return { state: nextState, changed, removedTagIds: [...removedTagIds] };
}
