import { normalizeSignalSourceProps } from './signalSourceDomainService.js';
import { NOISE_FAULT_DEFINITIONS } from './noiseFaultRuntime.js';

export const FAULT_MATH_MODEL_DEFINITIONS = Object.freeze({
  physical: [
    {
      id: 'step',
      name: '状态突变',
      formula: 'p_fault = targetValue',
      defaultParameters: { targetValue: 0, start: 0, duration: '' }
    },
    {
      id: 'freeze',
      name: '信号阻塞',
      formula: 'p_fault = p(start)',
      defaultParameters: { start: 0, duration: '' }
    },
    {
      id: 'intermittent',
      name: '间歇故障',
      formula: 'p_fault = ((t - start) % period < period * duty) ? value : p',
      defaultParameters: { value: 0, period: 1, duty: 0.5, start: 0, duration: '' }
    }
  ],
  electrical: [
    {
      id: 'bias',
      name: '偏差',
      formula: 'y_fault = y + bias',
      defaultParameters: { bias: 0.1, start: 0, duration: '' }
    },
    {
      id: 'freeze',
      name: '卡位',
      formula: 'y_fault = y(start)',
      defaultParameters: { start: 0, duration: '' }
    },
    {
      id: 'drift',
      name: '渐变',
      formula: 'y_fault = y + rate * (t - start)',
      defaultParameters: { rate: 0.006, start: 0, duration: '' }
    },
    {
      id: 'step',
      name: '突变',
      formula: 'y_fault = targetValue',
      defaultParameters: { targetValue: 0, start: 0, duration: '' }
    },
    ...NOISE_FAULT_DEFINITIONS
  ],
  protocol: [
    {
      id: 'bias',
      name: '偏差',
      formula: 'payload_fault = payload + bias',
      defaultParameters: { bias: 0.1, start: 0, duration: '' }
    },
    {
      id: 'freeze',
      name: '卡位',
      formula: 'payload_fault = payload(start)',
      defaultParameters: { start: 0, duration: '' }
    },
    {
      id: 'drift',
      name: '渐变',
      formula: 'payload_fault = payload + rate * (t - start)',
      defaultParameters: { rate: 0.006, start: 0, duration: '' }
    },
    {
      id: 'step',
      name: '突变',
      formula: 'payload_fault = targetValue',
      defaultParameters: { targetValue: 0, start: 0, duration: '' }
    },
    ...NOISE_FAULT_DEFINITIONS
  ]
});

const EDGE_ELECTRICAL_MODELS = Object.freeze(
  FAULT_MATH_MODEL_DEFINITIONS.electrical.map((model) => model.id)
);
const EDGE_PROTOCOL_MODELS = Object.freeze(FAULT_MATH_MODEL_DEFINITIONS.protocol.map((model) => model.id));
const FAULT_LAYERS = Object.freeze(['physical', 'electrical', 'protocol']);
const NODE_LAYER_MODELS = Object.freeze({
  physical: FAULT_MATH_MODEL_DEFINITIONS.physical.map((model) => model.id),
  electrical: EDGE_ELECTRICAL_MODELS.slice(),
  protocol: EDGE_PROTOCOL_MODELS.slice()
});

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function valueText(value, fallback = '') {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  const stringValue = String(raw ?? '').trim();
  return stringValue || fallback;
}

function lowerText(value) {
  return text(value).toLowerCase();
}

function uniqueTextArray(value) {
  return Array.from(new Set(arrayOrEmpty(value).map((item) => text(item)).filter(Boolean)));
}

function normalizeSlotLayer(slot = {}, fallback = 'electrical') {
  const layer = text(slot.layer ?? slot.layerKey, fallback);
  return FAULT_LAYERS.includes(layer) ? layer : fallback;
}

function normalizeFaultSlot(slot = {}, target = {}, fallback = {}) {
  const fallbackLayer = fallback.layer
    ?? (target.sourceNodeId && target.targetNodeId && isProtocolEdge(target) ? 'protocol' : 'electrical');
  const layer = normalizeSlotLayer(slot, fallbackLayer);
  const slotId = text(
    slot.slotId ?? slot.id,
    fallback.slotId ?? `${layer}:${target.id || 'target'}:${fallback.index ?? 0}`
  );
  const allowedModels = uniqueTextArray(slot.allowedModels).length
    ? uniqueTextArray(slot.allowedModels)
    : uniqueTextArray(fallback.allowedModels);

  return {
    ...clone(slot),
    slotId,
    slotName: text(slot.slotName ?? slot.name ?? slot.label, fallback.slotName ?? slotId),
    layer,
    targetField: text(slot.targetField, fallback.targetField ?? ''),
    allowedModels
  };
}

function vectorLengthOf(item = {}) {
  const shapeLength = Array.isArray(item?.shape) ? Number(item.shape[0]) : NaN;
  const literal = item?.default ?? item?.value ?? item?.initialValue;
  let literalLength = NaN;
  if (Array.isArray(literal)) {
    literalLength = literal.length;
  } else if (typeof literal === 'string') {
    try {
      const parsed = JSON.parse(literal);
      literalLength = Array.isArray(parsed) ? parsed.length : NaN;
    } catch {
      // A non-JSON default is not a fixed-length vector declaration.
    }
  }
  return [item?.vectorLength, item?.length, shapeLength, literalLength]
    .map(Number)
    .find((value) => Number.isInteger(value) && value > 1) ?? 0;
}

function isExplicitScalarType(value) {
  return ['scalar', 'number', 'float', 'int', 'integer', 'boolean', 'bool', '标量', '数值', '浮点']
    .includes(text(value).toLowerCase());
}

function vectorMetadataOf(item = {}) {
  const dataType = text(item?.dataType ?? item?.type ?? item?.format);
  // Saved interface declarations can retain an obsolete vectorLength after a
  // port has been changed to scalar.  Its explicit type takes precedence.
  if (isExplicitScalarType(dataType)) {
    return { dataType };
  }
  const vectorLength = vectorLengthOf(item);
  const vectorElementNames = vectorLength > 0 && Array.isArray(item?.vectorElementNames)
    ? item.vectorElementNames
      .map((name) => text(name))
      .slice(0, vectorLength)
    : [];
  return vectorLength > 1
    ? {
        dataType: dataType || 'vector',
        vectorLength,
        ...(vectorElementNames.length ? { vectorElementNames } : {})
      }
    : {};
}

function createPortSlot(layer, role, item = {}, index = 0) {
  const key = text(item.varName ?? item.key ?? item.id ?? item.name, `${role}_${index + 1}`)
    .replace(/\s+/g, '_');
  const targetGroup = role === 'middle' ? 'middleVars' : `${role}s`;
  const bindingObject = text(item.varName ?? item.key ?? item.id ?? item.name, key);

  return {
    slotId: `${layer}:${role}:${key}`,
    slotName: text(item.name ?? item.label ?? item.varName, `${role} ${index + 1}`),
    layer,
    targetField: text(item.targetField, `${targetGroup}.${key}`),
    bindingObject,
    targetVariable: bindingObject,
    allowedModels: layer === 'physical'
      ? FAULT_MATH_MODEL_DEFINITIONS.physical.map((model) => model.id)
      : EDGE_ELECTRICAL_MODELS.slice(),
    parameterKey: text(item.key ?? item.id ?? item.name ?? item.varName),
    unit: text(item.unit),
    ...vectorMetadataOf(item)
  };
}

function normalizeVariableKey(value, fallback = '') {
  return valueText(value, fallback).replace(/\s+/g, '_');
}

function defaultVariableTargetField(role, key) {
  if (role === 'parameter') {
    return `params.${key}`;
  }
  if (role === 'input') {
    return `inputs.${key}`;
  }
  if (role === 'output') {
    return `outputs.${key}`;
  }
  if (role === 'middle') {
    return `middleVars.${key}`;
  }
  if (role === 'protocol') {
    return `protocol.${key}`;
  }
  return key;
}

function createComponentFaultVariable(role, item = {}, index = 0) {
  const source = isPlainObject(item) ? item : {};
  const rawKey = valueText(
    source.key ?? source.id ?? source.varName ?? source.name,
    `${role}_${index + 1}`
  );
  const key = normalizeVariableKey(
    rawKey,
    `${role}_${index + 1}`
  );
  const name = text(
    source.displayName ?? source.name ?? source.label ?? source.varName ?? source.key ?? source.id,
    key
  );
  const bindingObject = valueText(
    source.bindingObject ?? source.targetVariable ?? source.varName ?? source.key ?? source.id ?? source.name,
    key
  );

  return {
    key,
    name,
    role,
    targetField: text(source.targetField, defaultVariableTargetField(role, key)),
    bindingObject,
    targetVariable: valueText(source.targetVariable, bindingObject),
    signalId: text(source.signalId),
    unit: text(source.unit),
    type: text(source.dataType ?? source.type ?? source.format),
    parameterKey: role === 'parameter' ? key : '',
    default: source.default,
    ...vectorMetadataOf(source)
  };
}

function pushUniqueVariable(list, seen, role, item, index) {
  if (!isPlainObject(item)) {
    return;
  }
  const variable = createComponentFaultVariable(role, item, index);
  const identity = variable.key;
  if (!variable.key || seen.has(identity)) {
    return;
  }
  seen.add(identity);
  list.push(variable);
}

function hasDefaultParameterValue(item = {}) {
  return isPlainObject(item)
    && Object.prototype.hasOwnProperty.call(item, 'default')
    && item.default !== null
    && item.default !== undefined;
}

function pythonBindingParameterInputs(node = {}) {
  const binding = isPlainObject(node.pythonBinding) ? node.pythonBinding : {};
  const parsedInputs = arrayOrEmpty(binding.parsedInterface?.inputs);
  const source = parsedInputs.length ? parsedInputs : arrayOrEmpty(binding.portMapping?.inputs);

  return source.filter(hasDefaultParameterValue);
}

function variableAliasValues(item = {}) {
  if (!isPlainObject(item)) {
    return [];
  }
  return [
    item.key,
    item.id,
    item.varName,
    item.name,
    item.displayName,
    item.label,
    item.comment
  ].map((value) => text(value)).filter(Boolean);
}

function pythonBindingInterfaceItems(node = {}, group = 'inputs') {
  const binding = isPlainObject(node.pythonBinding) ? node.pythonBinding : {};
  const parsedItems = arrayOrEmpty(binding.parsedInterface?.[group]);
  return parsedItems.length ? parsedItems : arrayOrEmpty(binding.portMapping?.[group]);
}

export function getComponentFaultVariables(node = {}) {
  const props = isPlainObject(node.props) ? node.props : {};
  const variables = [];
  const seen = new Set();
  const inputItems = arrayOrEmpty(props.inputs);
  const outputItems = arrayOrEmpty(props.outputs);
  const middleItems = arrayOrEmpty(props.middleVars);
  const interfaceAliases = new Set([...inputItems, ...outputItems, ...middleItems].flatMap(variableAliasValues));
  const pythonParameterItems = pythonBindingParameterInputs(node)
    .filter((item) => !variableAliasValues(item).some((alias) => interfaceAliases.has(alias)));
  [
    ['parameter', arrayOrEmpty(props.parameters)],
    ['parameter', arrayOrEmpty(props.modelParameters)],
    ['parameter', arrayOrEmpty(props.physicalParameters)],
    ['parameter', arrayOrEmpty(node.parameters)],
    ['parameter', arrayOrEmpty(node.physicalParameters)],
    ['parameter', pythonParameterItems],
    ['input', inputItems.length ? inputItems : pythonBindingInterfaceItems(node, 'inputs')],
    ['output', outputItems.length ? outputItems : pythonBindingInterfaceItems(node, 'outputs')],
    ['middle', middleItems.length ? middleItems : pythonBindingInterfaceItems(node, 'middleVars')]
  ].forEach(([role, items]) => {
    items.forEach((item, index) => pushUniqueVariable(variables, seen, role, item, index));
  });
  return variables;
}

function getComponentFaultDeclaration(node = {}) {
  const props = isPlainObject(node.props) ? node.props : {};
  const declaration = props.faultInjection ?? node.faultInjection ?? props.injectableFaultVariables ?? node.injectableFaultVariables;
  return isPlainObject(declaration) ? declaration : null;
}

function hasComponentFaultDeclaration(node = {}) {
  const declaration = getComponentFaultDeclaration(node);
  return Boolean(declaration && FAULT_LAYERS.some((layer) => Object.prototype.hasOwnProperty.call(declaration, layer)));
}

function declarationVariableKey(item, index = 0) {
  if (isPlainObject(item)) {
    return normalizeVariableKey(item.variableKey ?? item.key ?? item.id ?? item.varName ?? item.name, `slot_${index + 1}`);
  }
  return normalizeVariableKey(item, `slot_${index + 1}`);
}

function declarationItemsForLayer(declaration = {}, layer = 'electrical') {
  const value = declaration[layer];
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  }
  return [];
}

function createDeclaredComponentSlot(layer, item, variable, index) {
  const extra = isPlainObject(item) ? clone(item) : {};
  const variableKey = variable?.key || declarationVariableKey(item, index);
  const variableRole = variable?.role || text(extra.variableRole ?? extra.role ?? extra.kind, '');
  const fallbackRole = variableRole || layer;
  const allowedModels = uniqueTextArray(extra.allowedModels).length
    ? uniqueTextArray(extra.allowedModels)
    : NODE_LAYER_MODELS[layer].slice();

  return {
    ...extra,
    slotId: text(extra.slotId ?? extra.id, `${layer}:${variableKey}`),
    slotName: text(extra.slotName ?? extra.displayName ?? extra.name ?? extra.label, variable?.name || variableKey),
    layer,
    targetField: text(extra.targetField, variable?.targetField || defaultVariableTargetField(fallbackRole, variableKey)),
    bindingObject: text(extra.bindingObject ?? extra.targetVariable, variable?.bindingObject || variableKey),
    targetVariable: text(extra.targetVariable, extra.bindingObject || variable?.targetVariable || variable?.bindingObject || variableKey),
    allowedModels,
    variableKey,
    variableRole,
    signalId: text(extra.signalId, variable?.signalId || ''),
    unit: text(extra.unit, variable?.unit || ''),
    parameterKey: text(extra.parameterKey, variable?.parameterKey || ''),
    ...vectorMetadataOf({ ...variable, ...extra })
  };
}

function findDeclaredVariable(variables = [], item, variableKey) {
  const role = isPlainObject(item) ? text(item.variableRole ?? item.role ?? item.kind, '') : '';
  if (role) {
    const roleMatch = variables.find((variable) => variable.key === variableKey && variable.role === role);
    if (roleMatch) {
      return roleMatch;
    }
  }
  const matches = variables.filter((variable) => variable.key === variableKey);
  return matches.length === 1 ? matches[0] : matches[0] || null;
}

export function buildComponentFaultSlotsFromDeclaration(node = {}) {
  const declaration = getComponentFaultDeclaration(node);
  if (!declaration) {
    return [];
  }
  const variables = getComponentFaultVariables(node);
  return FAULT_LAYERS.flatMap((layer) => (
    declarationItemsForLayer(declaration, layer)
      .map((item, index) => {
        const variableKey = declarationVariableKey(item, index);
        const variable = findDeclaredVariable(variables, item, variableKey);
        if (!variable && !isPlainObject(item)) {
          return null;
        }
        return createDeclaredComponentSlot(layer, item, variable, index);
      })
      .filter(Boolean)
  ));
}

function faultSlotIdentity(slot = {}) {
  return `${slot.layer || ''}:${slot.slotId || slot.id || ''}`;
}

function mergeDeclaredFaultSlotMetadata(slots = [], extraSlots = [], target = {}) {
  const extraByIdentity = new Map();
  extraSlots.forEach((slot, index) => {
    if (!isPlainObject(slot)) {
      return;
    }
    const normalized = normalizeFaultSlot(slot, target, { index });
    extraByIdentity.set(faultSlotIdentity(normalized), normalized);
  });

  return slots.map((slot, index) => {
    const normalized = normalizeFaultSlot(slot, target, { index });
    const extra = extraByIdentity.get(faultSlotIdentity(normalized));
    if (!extra) {
      return normalized;
    }
    return normalizeFaultSlot({
      ...extra,
      ...normalized,
      allowedFaultIds: uniqueTextArray(normalized.allowedFaultIds).length
        ? normalized.allowedFaultIds
        : extra.allowedFaultIds,
      allowedFaultTypeIds: uniqueTextArray(normalized.allowedFaultTypeIds).length
        ? normalized.allowedFaultTypeIds
        : extra.allowedFaultTypeIds
    }, target, { index });
  });
}

export function isProtocolEdge(edge = {}) {
  return Boolean(lowerText(edge.lineType ?? edge.type) === 'can'
    || lowerText(edge.bus) === 'can'
    || lowerText(edge.protocol) === 'can'
    || text(edge.channelId).toUpperCase().includes('CAN')
    || text(edge.messageId)
    || text(edge.canMessageId));
}

function createDefaultEdgeFaultSlots(edge = {}) {
  return [{
    slotId: 'protocol:message',
    slotName: text(edge.messageId ?? edge.canMessageId ?? edge.channelId ?? edge.label ?? edge.signalName ?? edge.signalId, '连线消息'),
    layer: 'protocol',
    targetField: 'protocol.payload',
    allowedModels: EDGE_PROTOCOL_MODELS.slice(),
    signalId: text(edge.signalId),
    channelId: text(edge.channelId),
    messageId: text(edge.messageId ?? edge.canMessageId)
  }];
}

function createDefaultNodeFaultSlots(node = {}, options = {}) {
  const props = isPlainObject(node.props) ? node.props : {};
  const physicalItems = options.skipPhysical
    ? []
    // Use the same parameter discovery path as the property panel.  Standard
    // Python simulation components keep their configurable parameters in
    // props.parameters, so looking only at modelParameters/physicalParameters
    // made them invisible to the physical-fault runtime.
    : getComponentFaultVariables(node).filter((variable) => variable.role === 'parameter');
  const electricalItems = [
    ...arrayOrEmpty(props.inputs).map((item, index) => ({ role: 'input', item, index })),
    ...arrayOrEmpty(props.outputs).map((item, index) => ({ role: 'output', item, index })),
    ...arrayOrEmpty(props.middleVars).map((item, index) => ({ role: 'middle', item, index }))
  ];

  return [
    ...physicalItems.map((item, index) => createPortSlot('physical', 'parameter', item, index)),
    ...electricalItems.map(({ role, item, index }) => createPortSlot('electrical', role, item, index))
  ];
}

function slotMergeKey(slot = {}) {
  return `${slot.layer || ''}:${slot.slotId || ''}:${slot.targetField || ''}`;
}

function mergeFaultSlots(target = {}, defaults = []) {
  const merged = [];
  const seen = new Set();

  [...arrayOrEmpty(target.faultSlots), ...defaults].forEach((slot, index) => {
    if (!isPlainObject(slot)) {
      return;
    }
    const normalized = normalizeFaultSlot(slot, target, { index });
    const key = slotMergeKey(normalized);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(normalized);
  });

  return merged;
}

function findComponentVariableForFaultSlot(variables = [], slot = {}) {
  const role = text(slot.variableRole);
  const keys = new Set([
    slot.variableKey,
    slot.parameterKey,
    slot.bindingObject,
    slot.targetVariable
  ].map((value) => text(value)).filter(Boolean));
  const targetField = text(slot.targetField);
  return variables.find((variable) => (
    (!role || variable.role === role)
    && (keys.has(variable.key) || (targetField && variable.targetField === targetField))
  )) ?? null;
}

function reconcileFaultSlotShapes(node = {}, slots = []) {
  const variables = getComponentFaultVariables(node);
  return slots.map((slot) => {
    const variable = findComponentVariableForFaultSlot(variables, slot);
    if (!variable) {
      return slot;
    }
    const normalized = { ...slot, dataType: variable.type };
    // A saved fault slot is derived metadata.  Do not allow an obsolete
    // vector declaration to make a scalar component ask for injection paths.
    delete normalized.vectorLength;
    delete normalized.length;
    delete normalized.shape;
    delete normalized.vectorElementNames;
    return isExplicitScalarType(variable.type)
      ? normalized
      : { ...normalized, ...vectorMetadataOf(variable) };
  });
}

function capabilitySlotsForTarget(target = {}, targetKind = 'node', capabilityMap = []) {
  const entry = arrayOrEmpty(capabilityMap).find((item) => (
    item?.targetId === target.id && (item.targetKind || targetKind) === targetKind
  ));
  return arrayOrEmpty(entry?.faultSlots);
}

export function normalizeModelNode(node = {}, { faultCapabilityMap = [] } = {}) {
  const safeNode = isPlainObject(node) ? clone(node) : {};
  if (safeNode.type === 'signal_source') {
    safeNode.props = normalizeSignalSourceProps(safeNode.props ?? {});
  }

  if (hasComponentFaultDeclaration(safeNode)) {
    const faultSlots = mergeDeclaredFaultSlotMetadata(
      buildComponentFaultSlotsFromDeclaration(safeNode),
      [
        ...arrayOrEmpty(safeNode.faultSlots),
        ...capabilitySlotsForTarget(safeNode, 'node', faultCapabilityMap)
      ],
      safeNode
    );
    return {
      ...safeNode,
      faultSlots: reconcileFaultSlotShapes(safeNode, faultSlots)
    };
  }

  const hasDeclaredPhysical = arrayOrEmpty(safeNode.faultSlots)
    .some((slot) => normalizeSlotLayer(slot) === 'physical');
  const defaults = [
    ...capabilitySlotsForTarget(safeNode, 'node', faultCapabilityMap),
    ...createDefaultNodeFaultSlots(safeNode, { skipPhysical: hasDeclaredPhysical })
  ];

  const faultSlots = mergeFaultSlots(safeNode, defaults);
  return {
    ...safeNode,
    faultSlots: reconcileFaultSlotShapes(safeNode, faultSlots)
  };
}

export function normalizeModelEdge(edge = {}, { faultCapabilityMap = [] } = {}) {
  const safeEdge = isPlainObject(edge) ? clone(edge) : {};
  const normalizedEdge = {
    ...safeEdge,
    // A connection represents a protocol transport boundary only.  Signal
    // faults belong on the connected component input or output instead.
    faultSlots: arrayOrEmpty(safeEdge.faultSlots).filter((slot) => normalizeSlotLayer(slot) === 'protocol')
  };
  const defaults = [
    ...capabilitySlotsForTarget(safeEdge, 'edge', faultCapabilityMap)
      .filter((slot) => normalizeSlotLayer(slot) === 'protocol'),
    ...createDefaultEdgeFaultSlots(safeEdge)
  ];

  return {
    ...normalizedEdge,
    lineType: text(safeEdge.lineType ?? safeEdge.type, 'normal'),
    faultSlots: mergeFaultSlots(normalizedEdge, defaults)
  };
}

export function normalizeModelStoreSnapshot(snapshot = {}, options = {}) {
  const safeSnapshot = isPlainObject(snapshot) ? clone(snapshot) : {};
  const faultCapabilityMap = arrayOrEmpty(options.faultCapabilityMap);
  const removedComponentTypes = new Set(['instrument_complex_envelope_spectrum']);
  const normalizeNodes = (nodes) => arrayOrEmpty(nodes)
    .map((node) => normalizeModelNode(node, { faultCapabilityMap }));
  const normalizeLayer = (nodes, edges) => {
    const allNodes = normalizeNodes(nodes);
    const removedNodeIds = new Set(allNodes
      .filter((node) => removedComponentTypes.has(node.type))
      .map((node) => node.id));
    const activeNodes = allNodes.filter((node) => !removedComponentTypes.has(node.type));
    return {
      nodes: activeNodes,
      edges: arrayOrEmpty(edges)
        .map((edge) => normalizeModelEdge(edge, { faultCapabilityMap }))
        .filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId))
    };
  };

  const rootLayer = normalizeLayer(safeSnapshot.modelNodes, safeSnapshot.modelEdges);
  safeSnapshot.modelNodes = rootLayer.nodes;
  safeSnapshot.modelEdges = rootLayer.edges;

  if (isPlainObject(safeSnapshot.canvases)) {
    Object.entries(safeSnapshot.canvases).forEach(([canvasId, canvas]) => {
      if (!isPlainObject(canvas)) {
        return;
      }
      const layer = normalizeLayer(canvas.nodes, canvas.edges);
      safeSnapshot.canvases[canvasId] = {
        ...canvas,
        ...layer
      };
    });
  }

  return safeSnapshot;
}
