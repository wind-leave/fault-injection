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

function inferTargetKind(target = {}) {
  return target?.sourceNodeId && target?.targetNodeId ? 'edge' : 'node';
}

function normalizeFaultLayer(value = '') {
  const raw = String(value || '').trim();
  if (raw === 'physical' || raw === 'electrical' || raw === 'protocol') {
    return raw;
  }
  return '';
}

function normalizeFaultTargetKindFilter(value = '') {
  const raw = String(value || '').trim();
  if (raw === 'edge' || raw === 'line') {
    return 'edge';
  }
  if (raw === 'node' || raw === 'module' || raw === 'component') {
    return 'node';
  }
  return raw === 'any' ? 'any' : '';
}

function normalizeFaultOptionFilters(filters = {}) {
  const source = typeof filters === 'string' ? { layer: filters } : (filters || {});
  return {
    layer: normalizeFaultLayer(source.layer || source.layerKey || source.injectorLayer || source.faultLayer),
    targetKind: normalizeFaultTargetKindFilter(source.targetKind || source.kind || source.targetKindFilter)
  };
}

function getBindingObject(slot = {}) {
  return firstText(slot.bindingObject, slot.targetVariable, slot.variableKey, slot.parameterKey, slot.varName, slot.key);
}

function getFaultInjectionForm(target = {}, layer = '') {
  const targetKind = inferTargetKind(target);
  const normalizedLayer = normalizeFaultLayer(layer);
  if (targetKind === 'edge' && normalizedLayer === 'protocol') {
    return 'protocol-bus';
  }
  if (targetKind === 'edge') {
    return 'signal-edge';
  }
  return 'module-variable';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function getCapabilitySlots(entry = {}) {
  if (!entry) {
    return [];
  }
  if (list(entry.faultSlots).length) {
    return list(entry.faultSlots);
  }
  if (entry.slotId || list(entry.allowedFaultIds).length || list(entry.allowedFaultTypeIds).length) {
    return [entry];
  }
  return [];
}

function getAllowedFaultIds(slot = {}) {
  return list(slot.allowedFaultIds).length ? list(slot.allowedFaultIds) : list(slot.allowedFaultTypeIds);
}

function getCapabilitySlotLayer(slot = {}) {
  const layer = String(slot.layer || slot.layerKey || '').trim();
  return layer || 'electrical';
}

function normalizedFaultText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getCapabilitySlotModelTokens(slot = {}) {
  return [
    ...list(slot.allowedModels),
    ...list(slot.allowedFaultModels),
    ...list(slot.runtimeBehaviors)
  ].map(normalizedFaultText).filter(Boolean);
}

function getFaultModelTokens(model = {}) {
  const tokens = [
    model.id,
    model.faultTypeId,
    model.runtimeBehavior,
    model.modelClass,
    model.faultClass,
    model.faultKind
  ].map(normalizedFaultText).filter(Boolean);
  if (tokens.includes('additive_bias') || tokens.includes('parameter_bias')) {
    tokens.push('bias');
  }
  if (tokens.includes('packet_loss')) {
    tokens.push('dropout');
  }
  if (tokens.includes('fixed_delay') || tokens.includes('jitter_delay')) {
    tokens.push('delay');
  }
  if (tokens.includes('freeze')) {
    tokens.push('stale');
  }
  if (tokens.includes('tamper')) {
    tokens.push('tamper');
  }
  return [...new Set(tokens)];
}

function capabilitySlotAllowsModel(slot = {}, model = {}) {
  const modelId = model.id || model.faultTypeId || '';
  const allowedIds = getAllowedFaultIds(slot);
  if (allowedIds.length) {
    return allowedIds.includes(modelId);
  }
  const slotLayer = getCapabilitySlotLayer(slot);
  const modelLayer = model.layer || model.layerKey || 'electrical';
  if (slotLayer !== modelLayer) {
    return false;
  }
  const allowedModelTokens = getCapabilitySlotModelTokens(slot);
  if (!allowedModelTokens.length) {
    return true;
  }
  const modelTokens = getFaultModelTokens(model);
  return allowedModelTokens.some((token) => modelTokens.includes(token));
}

function faultOptionMatchesFilters(option = {}, target = {}, filters = {}) {
  const normalized = normalizeFaultOptionFilters(filters);
  if (normalized.targetKind && normalized.targetKind !== 'any' && inferTargetKind(target) !== normalized.targetKind) {
    return false;
  }
  if (normalized.layer) {
    const slotLayer = normalizeFaultLayer(getCapabilitySlotLayer(option.slot));
    const modelLayer = normalizeFaultLayer(option.model?.layer || option.model?.layerKey || slotLayer);
    return slotLayer === normalized.layer && (!modelLayer || modelLayer === normalized.layer);
  }
  return true;
}

function defaultsFromParameterSchema(parameters = {}) {
  return Object.fromEntries(Object.entries(parameters || {}).map(([key, value]) => [
    key,
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'default') ? value.default : value
  ]));
}

function normalizeCapabilityFaultModel(model = {}) {
  if (!model) {
    return null;
  }
  const id = model.id || model.faultTypeId || '';
  const defaultParameters = Object.keys(model.defaultParameters || {}).length
    ? model.defaultParameters
    : defaultsFromParameterSchema(model.parameters);
  return {
    ...model,
    id,
    name: model.name || model.displayName || id,
    displayName: model.displayName || model.name || id,
    defaultParameters: clone(defaultParameters || {})
  };
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

export function createFaultRemovalRef(targetKind = 'node', target = {}, binding = null, index = 0) {
  const source = binding || target?.injectedFault || {};
  const bindingId = binding ? (binding.bindingId || `legacy-${removalIdOf(binding) || index}`) : '';

  return {
    targetKind,
    targetId: target?.id || '',
    bindingId,
    instanceId: removalInstanceIdOf(source),
    faultId: removalIdOf(source),
    slotId: removalSlotIdOf(source)
  };
}

export function faultRecordMatchesRemovalRef(record = {}, ref = {}) {
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
  return refs.some((ref) => faultRecordMatchesRemovalRef(record, ref));
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

export function syncFaultPayloadFromBindings(target = {}) {
  const nextTarget = { ...(target || {}) };
  const activeBindings = Array.isArray(target?.faultBindings)
    ? target.faultBindings.filter((binding) => binding && binding.active !== false)
    : [];

  if (activeBindings.length > 0) {
    const binding = activeBindings[0];
    const nextPayload = binding.injectedFault || target.injectedFault || {
      modelId: binding.faultModelId,
      name: binding.name,
      layer: binding.layer,
      runtimeBehavior: binding.runtimeBehavior,
      parameters: binding.parameters || {}
    };

    const previous = JSON.stringify(nextTarget.injectedFault ?? null);
    const next = JSON.stringify(nextPayload ?? null);
    nextTarget.injectedFault = clone(nextPayload);

    return {
      target: nextTarget,
      changed: previous !== next
    };
  }

  const hadInjectedFault = Object.prototype.hasOwnProperty.call(nextTarget, 'injectedFault');
  delete nextTarget.injectedFault;

  return {
    target: nextTarget,
    changed: hadInjectedFault
  };
}

export function refreshFaultCancellationState(state = {}, simulation = {}, options = {}) {
  const target = options.target || {};
  const targetKind = options.targetKind || 'node';
  const targetId = target?.id || '';
  const targetSync = syncFaultPayloadFromBindings(target);
  const nextState = { ...(state || {}) };
  const nextSimulation = {
    ...(simulation || {}),
    actual: {
      ...(simulation?.actual || {})
    }
  };
  let changed = targetSync.changed;
  const hasActiveFault = options.hasActiveFault ?? (
    Boolean(targetSync.target?.injectedFault)
    || (Array.isArray(targetSync.target?.faultBindings)
      && targetSync.target.faultBindings.some((binding) => binding && binding.active !== false))
  );

  if (targetKind === 'node' && targetId && !hasActiveFault) {
    if (Array.isArray(nextState.faultedBlks)) {
      const nextFaultedBlks = nextState.faultedBlks.filter((id) => id !== targetId);
      if (nextFaultedBlks.length !== nextState.faultedBlks.length) {
        nextState.faultedBlks = nextFaultedBlks;
        changed = true;
      }
    }

    if (simulation?.actual?.nodeStates?.[targetId]?.bindingStates) {
      nextSimulation.actual.nodeStates = {
        ...(simulation.actual.nodeStates || {}),
        [targetId]: {
          ...(simulation.actual.nodeStates[targetId] || {})
        }
      };
      delete nextSimulation.actual.nodeStates[targetId].bindingStates;
      changed = true;
    }
  }

  if (targetKind === 'edge' && targetId && simulation?.actual?.edgeStates?.[targetId]) {
    nextSimulation.actual.edgeStates = { ...(simulation.actual.edgeStates || {}) };
    delete nextSimulation.actual.edgeStates[targetId];
    changed = true;
  }

  return {
    target: targetSync.target,
    state: nextState,
    simulation: nextSimulation,
    changed
  };
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

export function getCompatibleFaultOptionsForTarget(target = {}, options = {}) {
  if (!target?.id) {
    return [];
  }
  const targetKind = inferTargetKind(target);
  const capability = list(options.capabilityMap).find((entry) => (
    entry?.targetId === target.id && (entry.targetKind || targetKind) === targetKind
  )) || null;
  if (!capability) {
    return [];
  }

  const slots = getCapabilitySlots(capability);
  const models = list(options.faultModels)
    .map(normalizeCapabilityFaultModel)
    .filter(Boolean);
  const seen = new Set();

  return slots.flatMap((slot, index) => {
    const slotId = getSlotId(slot, `slot-${index + 1}`);
    return models
      .filter((model) => capabilitySlotAllowsModel(slot, model))
      .map((model) => {
        const key = `${model.id}::${slotId}`;
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);
        return { model, slot, slotId };
      })
      .filter(Boolean);
  }).filter((option) => faultOptionMatchesFilters(option, target, options.filters));
}

export function getCompatibleFaultModelsForTarget(target = {}, options = {}) {
  const seen = new Set();
  return getCompatibleFaultOptionsForTarget(target, options)
    .map((option) => option.model)
    .filter((model) => {
      if (!model?.id || seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
}

export function getCompatibleSlotForFault(target = {}, faultTypeId = '', slotId = '', options = {}) {
  const matches = getCompatibleFaultOptionsForTarget(target, options)
    .filter((option) => option.model?.id === faultTypeId);
  if (slotId) {
    return matches.find((option) => option.slotId === slotId)?.slot || null;
  }
  return matches[0]?.slot || null;
}

export function createFaultInstancePlan(options = {}) {
  const target = options.target || {};
  const model = options.model || null;
  const slot = options.slot || null;
  if (!target?.id || !model || !slot) {
    return { ok: false, error: 'incompatible-target' };
  }

  const targetKind = options.targetKind || inferTargetKind(target);
  const slotId = getSlotId(slot, options.slotId || '');
  const faultTypeId = model.id || model.faultTypeId || model.modelId || '';
  const duplicate = list(options.existingInstances).find((instance) => (
    instance?.active !== false
    && instance.targetKind === targetKind
    && instance.targetId === target.id
    && instance.faultTypeId === faultTypeId
    && (!slotId || instance.slotId === slotId)
  )) || null;

  if (duplicate) {
    return {
      ok: false,
      error: 'duplicate-fault-instance',
      instance: duplicate,
      model,
      slot
    };
  }

  const parameters = {
    ...(model.defaultParameters || {}),
    ...(options.parameterOverrides || {})
  };
  const bindingObject = options.bindingObject || getBindingObject(slot);
  const injectionForm = options.injectionForm || getFaultInjectionForm(target, model.layer || slot.layer || options.layer);
  const instance = createFaultInstanceRecord({
    target,
    model,
    slot,
    targetKind,
    slotId,
    parameters,
    bindingObject,
    injectionForm,
    instanceId: options.instanceId
  });

  return {
    ok: true,
    instance,
    model,
    slot,
    targetKind,
    slotId,
    parameters,
    bindingObject,
    injectionForm
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

export function createFaultBindingRecord(options = {}) {
  const target = options.target || {};
  const model = options.model || {};
  const instance = options.instance || {};
  const payload = clone(options.payload || {});
  const targetKind = instance.targetKind || options.targetKind || (target.sourceNodeId && target.targetNodeId ? 'edge' : 'node');
  const propagationMode = options.propagationMode || (payload.layer === 'protocol' ? 'protocolEdge' : 'signalTransform');

  return {
    bindingId: options.bindingId || `${payload.instanceId || payload.modelId || payload.name || 'fault'}::${target.id || ''}`,
    faultModelId: payload.modelId || instance.faultTypeId || model.id || '',
    faultTypeId: payload.faultTypeId || payload.modelId || instance.faultTypeId || model.id || '',
    name: payload.name || instance.displayName || model.displayName || model.name || model.id || '鏁呴殰妯″瀷',
    layer: payload.layer || instance.layer || model.layer || 'electrical',
    runtimeBehavior: payload.runtimeBehavior || model.runtimeBehavior || '',
    parameters: clone(payload.parameters || instance.parameters || {}),
    targetKind,
    targetId: target.id || instance.targetId || '',
    slotId: payload.slotId || instance.slotId || '',
    slotName: payload.slotName || instance.slotName || '',
    bindingObject: payload.bindingObject || instance.bindingObject || '',
    targetVariable: payload.targetVariable || instance.targetVariable || payload.bindingObject || instance.bindingObject || '',
    targetField: payload.targetField || instance.targetField || '',
    injectionForm: payload.injectionForm || instance.injectionForm || '',
    visualRole: options.visualRole || 'fault-source',
    propagationMode,
    canPropagate: options.canPropagate ?? propagationMode !== 'localOnly',
    active: options.active ?? true,
    injectedFault: payload
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

export function applyFaultBindingToState(state = {}, target = {}, options = {}) {
  const model = options.model || {};
  const instance = options.instance || {};
  const payload = options.payload || createRuntimePayloadFromInstance({
    model,
    instance,
    parameters: instance.parameters || model.defaultParameters || {},
    basePayload: options.basePayload || {}
  });
  const nextTarget = {
    ...(target || {}),
    injectedFault: clone(payload)
  };
  const binding = options.binding || createFaultBindingRecord({
    target,
    model,
    instance,
    payload,
    targetKind: options.targetKind,
    bindingId: options.bindingId,
    propagationMode: options.propagationMode,
    canPropagate: options.canPropagate,
    visualRole: options.visualRole
  });
  const currentBindings = list(target.faultBindings);
  const bindingIndex = currentBindings.findIndex((item) => item.bindingId === binding.bindingId || item.faultModelId === binding.faultModelId);
  nextTarget.faultBindings = bindingIndex >= 0
    ? currentBindings.map((item, index) => (index === bindingIndex ? clone(binding) : item))
    : [...currentBindings, clone(binding)];

  const nextState = { ...(state || {}) };
  nextState.faultInstances = upsertFaultInstanceRecord(nextState.faultInstances, instance);
  nextState.injectedFaults = upsertFaultRuntimeRecord(nextState.injectedFaults, payload);
  nextState.activeFaults = upsertFaultRuntimeRecord(nextState.activeFaults, payload);
  nextState.appliedFaults = upsertFaultRuntimeRecord(nextState.appliedFaults, payload);
  nextState.injectedFaultMap = upsertInjectedFaultMap(nextState.injectedFaultMap, payload);

  if (nextState.activeModelPackage) {
    nextState.activeModelPackage = {
      ...nextState.activeModelPackage,
      faultInstances: clone(nextState.faultInstances)
    };
  }

  const targetKind = binding.targetKind || instance.targetKind || options.targetKind || 'node';
  const hostNodeId = options.tag?.hostNodeId || (targetKind === 'node' ? (target.id || instance.targetId || '') : (target.sourceNodeId || ''));
  if (targetKind !== 'edge' && hostNodeId) {
    const faultedBlks = list(nextState.faultedBlks);
    nextState.faultedBlks = faultedBlks.includes(hostNodeId) ? faultedBlks : [...faultedBlks, hostNodeId];
  }

  if (options.tag !== false) {
    const tag = options.tagRecord || createFaultTagRecord({
      instance,
      model,
      target,
      payload,
      box: options.tag?.box,
      hostNodeId,
      targetName: options.tag?.targetName,
      layerLabel: options.tag?.layerLabel,
      fallbackModelClass: options.tag?.fallbackModelClass,
      tagId: options.tag?.tagId
    });
    const link = options.linkRecord || createFaultTagLinkRecord({
      instance,
      tag,
      id: options.link?.id,
      label: options.link?.label
    });
    nextState.faultTags = upsertFaultTagRecord(nextState.faultTags, tag);
    nextState.faultInjectionLinks = upsertFaultTagLinkRecord(nextState.faultInjectionLinks, link);
  }

  return {
    target: nextTarget,
    state: nextState,
    payload,
    binding
  };
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
