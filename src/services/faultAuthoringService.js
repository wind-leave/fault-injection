import { normalizeAuthoringPackage } from './authoringModelService.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function defaultsFromParameterSchema(parameters) {
  return Object.fromEntries(
    Object.entries(objectOrEmpty(parameters)).map(([key, schema]) => [
      key,
      schema && typeof schema === 'object' && hasOwn(schema, 'default') ? clone(schema.default) : ''
    ])
  );
}

function getTargetList(pkg, targetKind) {
  if (targetKind === 'edge') {
    return {
      section: 'edges',
      targets: arrayOrEmpty(pkg.systemModel?.edges)
    };
  }

  return {
    section: 'nodes',
    targets: arrayOrEmpty(pkg.systemModel?.nodes)
  };
}

function slotAllowedFaultIds(slot) {
  return arrayOrEmpty(slot?.allowedFaultTypeIds ?? slot?.allowedFaultIds);
}

function findSystemTargetSlot(pkg, { targetKind, targetId, slotId }) {
  const { section, targets } = getTargetList(pkg, targetKind);
  const targetIndex = targets.findIndex((target) => target?.id === targetId);
  if (targetIndex === -1) {
    return null;
  }

  const target = targets[targetIndex];
  const faultSlots = arrayOrEmpty(target.faultSlots);
  const slotIndex = faultSlots.findIndex((slot) => slot?.slotId === slotId);
  if (slotIndex === -1) {
    return null;
  }

  return { section, targets, targetIndex, faultSlots, slotIndex, slot: faultSlots[slotIndex] };
}

function findCapabilitySlot(pkg, { targetKind, targetId, slotId }) {
  const capabilityMap = arrayOrEmpty(pkg.faultCapabilityMap);
  const capabilityIndex = capabilityMap.findIndex(
    (entry) => entry?.targetId === targetId && (entry.targetKind || targetKind) === targetKind
  );
  if (capabilityIndex === -1) {
    return null;
  }

  const faultSlots = arrayOrEmpty(capabilityMap[capabilityIndex].faultSlots);
  const slotIndex = faultSlots.findIndex((slot) => slot?.slotId === slotId);
  if (slotIndex === -1) {
    return null;
  }

  return { capabilityMap, capabilityIndex, faultSlots, slotIndex, slot: faultSlots[slotIndex] };
}

function findTargetSlot(pkg, target) {
  return {
    systemSlot: findSystemTargetSlot(pkg, target),
    capabilitySlot: findCapabilitySlot(pkg, target)
  };
}

function updateSlotAllowedFaultTypes(slot, faultTypeId) {
  return {
    ...slot,
    allowedFaultTypeIds: [...new Set([...slotAllowedFaultIds(slot), faultTypeId])]
  };
}

function updateSystemSlot(pkg, slotRef, faultTypeId) {
  const nextSlot = updateSlotAllowedFaultTypes(slotRef.slot, faultTypeId);
  const nextFaultSlots = slotRef.faultSlots.map((slot, index) =>
    index === slotRef.slotIndex ? nextSlot : slot
  );
  const nextTargets = slotRef.targets.map((target, index) =>
    index === slotRef.targetIndex ? { ...target, faultSlots: nextFaultSlots } : target
  );

  return {
    ...pkg,
    systemModel: {
      ...pkg.systemModel,
      [slotRef.section]: nextTargets
    }
  };
}

function updateCapabilitySlot(pkg, slotRef, faultTypeId) {
  const nextSlot = updateSlotAllowedFaultTypes(slotRef.slot, faultTypeId);
  const nextFaultSlots = slotRef.faultSlots.map((slot, index) =>
    index === slotRef.slotIndex ? nextSlot : slot
  );

  return {
    ...pkg,
    faultCapabilityMap: slotRef.capabilityMap.map((entry, index) =>
      index === slotRef.capabilityIndex ? { ...entry, faultSlots: nextFaultSlots } : entry
    )
  };
}

function hasAllowedFault(slot, faultTypeId) {
  return slotAllowedFaultIds(slot).includes(faultTypeId);
}

function hasCompatibleSlot(pkg, target) {
  const { systemSlot, capabilitySlot } = findTargetSlot(pkg, target);
  return Boolean(
    (systemSlot && hasAllowedFault(systemSlot.slot, target.faultTypeId)) ||
      (capabilitySlot && hasAllowedFault(capabilitySlot.slot, target.faultTypeId))
  );
}

function hasDuplicateActiveInstance(pkg, target) {
  return arrayOrEmpty(pkg.faultInstances).some(
    (instance) =>
      instance?.active !== false &&
      instance.targetKind === target.targetKind &&
      instance.targetId === target.targetId &&
      instance.slotId === target.slotId &&
      instance.faultTypeId === target.faultTypeId
  );
}

function createInstanceId() {
  return `fault-inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createFaultType({
  id,
  displayName,
  layer = 'electrical',
  faultClass = '故障',
  runtimeBehavior,
  formula = '',
  parameters = {}
} = {}) {
  if (!id) {
    throw new Error('Missing fault type id');
  }
  if (!runtimeBehavior) {
    throw new Error('Missing runtime behavior');
  }

  return {
    id,
    displayName: displayName || id,
    name: displayName || id,
    layer,
    faultClass,
    modelClass: faultClass,
    runtimeBehavior,
    formula,
    parameters: objectOrEmpty(parameters),
    defaultParameters: defaultsFromParameterSchema(parameters)
  };
}

export function attachFaultTypeToTargetSlot(modelPackage, { targetKind, targetId, slotId, faultTypeId } = {}) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const { systemSlot, capabilitySlot } = findTargetSlot(pkg, { targetKind, targetId, slotId });

  if (!systemSlot && !capabilitySlot) {
    throw new Error('Missing target slot');
  }

  let nextPkg = pkg;
  if (systemSlot) {
    nextPkg = updateSystemSlot(nextPkg, systemSlot, faultTypeId);
  }
  if (capabilitySlot) {
    nextPkg = updateCapabilitySlot(nextPkg, capabilitySlot, faultTypeId);
  }

  return nextPkg;
}

export function createFaultInstance(
  modelPackage,
  { targetKind, targetId, slotId, faultTypeId, parameters = {} } = {}
) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const faultType = pkg.faultTypeCatalog.find((item) => item?.id === faultTypeId);
  const target = { targetKind, targetId, slotId, faultTypeId };

  if (!faultType || !hasCompatibleSlot(pkg, target)) {
    return { ok: false, error: 'incompatible-target', package: pkg };
  }

  if (hasDuplicateActiveInstance(pkg, target)) {
    return { ok: false, error: 'duplicate-fault-instance', package: pkg };
  }

  const defaultParameters = Object.keys(objectOrEmpty(faultType.defaultParameters)).length
    ? objectOrEmpty(faultType.defaultParameters)
    : defaultsFromParameterSchema(faultType.parameters);
  const instance = {
    instanceId: createInstanceId(),
    targetKind,
    targetId,
    slotId,
    faultTypeId,
    parameters: {
      ...defaultParameters,
      ...objectOrEmpty(parameters)
    },
    active: true
  };

  return {
    ok: true,
    package: {
      ...pkg,
      faultInstances: [...arrayOrEmpty(pkg.faultInstances), instance]
    },
    instance
  };
}

export function removeFaultInstance(modelPackage, instanceId) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const faultInstances = arrayOrEmpty(pkg.faultInstances);

  if (!faultInstances.some((instance) => instance?.instanceId === instanceId)) {
    return pkg;
  }

  return {
    ...pkg,
    faultInstances: faultInstances.map((instance) =>
      instance?.instanceId === instanceId ? { ...instance, active: false } : instance
    )
  };
}
