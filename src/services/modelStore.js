export const FAULT_MATH_MODEL_DEFINITIONS = Object.freeze({
  physical: [
    {
      id: 'bias',
      name: '偏置模型',
      formula: 'p_fault = p + bias',
      defaultParameters: { bias: 0.1, start: 0, duration: '' }
    },
    {
      id: 'drift',
      name: '漂移模型',
      formula: 'p_fault = p + rate * max(t - start, 0)',
      defaultParameters: { rate: 0.006, start: 0, duration: '' }
    },
    {
      id: 'step',
      name: '突变模型',
      formula: 'p_fault = p + step',
      defaultParameters: { step: 0.1, start: 0, duration: '' }
    },
    {
      id: 'degradation',
      name: '衰减模型',
      formula: 'p_fault = p * scale(t)',
      defaultParameters: { scale: 0.85, start: 0, duration: '' }
    },
    {
      id: 'freeze',
      name: '卡死模型',
      formula: 'p_fault = hold(p, start)',
      defaultParameters: { start: 0, duration: '' }
    },
    {
      id: 'random',
      name: '随机模型',
      formula: 'p_fault = p + noise(seed, std)',
      defaultParameters: { seed: 1, std: 0.08, start: 0, duration: '' }
    }
  ],
  electrical: [
    {
      id: 'bias',
      name: '信号偏置',
      formula: 'y_fault = y + bias',
      defaultParameters: { bias: 0.1, start: 0, duration: '' }
    },
    {
      id: 'noise',
      name: '随机噪声',
      formula: 'y_fault = y + noise(seed, std)',
      defaultParameters: { seed: 1, std: 0.08, start: 0, duration: '' }
    },
    {
      id: 'freeze',
      name: '信号卡死',
      formula: 'y_fault = hold(y, start)',
      defaultParameters: { start: 0, duration: '' }
    },
    {
      id: 'intermittent',
      name: '间歇异常',
      formula: 'y_fault = f(y) when gate(t) else y',
      defaultParameters: { period: 4, duty: 0.25, start: 0, duration: '' }
    }
  ],
  protocol: [
    {
      id: 'delay',
      name: '报文延迟',
      formula: 'payload_fault[k] = payload[k - d]',
      defaultParameters: { delay_steps: 3, start: 0, duration: '' }
    },
    {
      id: 'dropout',
      name: '报文丢失',
      formula: 'payload_fault = previous(payload) when drop(seed, rate)',
      defaultParameters: { drop_rate: 0.08, seed: 1, start: 0, duration: '' }
    },
    {
      id: 'tamper',
      name: '报文篡改',
      formula: 'payload_fault = tamper(payload)',
      defaultParameters: { bias: 0.1, scale: 1, start: 0, duration: '' }
    },
    {
      id: 'stale',
      name: '陈旧报文',
      formula: 'payload_fault = hold(payload, start)',
      defaultParameters: { start: 0, duration: '' }
    }
  ]
});

const EDGE_ELECTRICAL_MODELS = Object.freeze(['bias', 'noise', 'freeze', 'intermittent']);
const EDGE_PROTOCOL_MODELS = Object.freeze(['delay', 'dropout', 'tamper', 'stale']);
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

function createPortSlot(layer, role, item = {}, index = 0) {
  const key = text(item.key ?? item.id ?? item.name ?? item.varName, `${role}_${index + 1}`)
    .replace(/\s+/g, '_');

  return {
    slotId: `${layer}:${role}:${key}`,
    slotName: text(item.name ?? item.label ?? item.varName, `${role} ${index + 1}`),
    layer,
    targetField: `${role}.${key}`,
    allowedModels: layer === 'physical'
      ? FAULT_MATH_MODEL_DEFINITIONS.physical.map((model) => model.id)
      : EDGE_ELECTRICAL_MODELS.slice(),
    parameterKey: text(item.key ?? item.id ?? item.name ?? item.varName),
    unit: text(item.unit)
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
    type: text(source.type ?? source.format),
    parameterKey: role === 'parameter' ? key : ''
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

function pythonBindingInterfaceItems(node = {}, group = 'inputs') {
  const binding = isPlainObject(node.pythonBinding) ? node.pythonBinding : {};
  const parsedItems = arrayOrEmpty(binding.parsedInterface?.[group]);
  return parsedItems.length ? parsedItems : arrayOrEmpty(binding.portMapping?.[group]);
}

export function getComponentFaultVariables(node = {}) {
  const props = isPlainObject(node.props) ? node.props : {};
  const variables = [];
  const seen = new Set();
  [
    ['parameter', arrayOrEmpty(props.parameters)],
    ['parameter', arrayOrEmpty(props.modelParameters)],
    ['parameter', arrayOrEmpty(props.physicalParameters)],
    ['parameter', arrayOrEmpty(node.parameters)],
    ['parameter', arrayOrEmpty(node.physicalParameters)],
    ['parameter', pythonBindingParameterInputs(node)],
    ['input', arrayOrEmpty(props.inputs)],
    ['input', pythonBindingInterfaceItems(node, 'inputs')],
    ['output', arrayOrEmpty(props.outputs)],
    ['output', pythonBindingInterfaceItems(node, 'outputs')],
    ['middle', arrayOrEmpty(props.middleVars)],
    ['middle', pythonBindingInterfaceItems(node, 'middleVars')]
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
    parameterKey: text(extra.parameterKey, variable?.parameterKey || '')
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
  const slots = [
    {
      slotId: 'electrical:signal_value',
      slotName: text(edge.label ?? edge.signalName ?? edge.signalId, '信号值'),
      layer: 'electrical',
      targetField: 'signal.value',
      allowedModels: EDGE_ELECTRICAL_MODELS.slice(),
      signalId: text(edge.signalId),
      lineType: text(edge.lineType ?? edge.type, 'normal')
    }
  ];

  if (isProtocolEdge(edge)) {
    slots.push({
      slotId: 'protocol:can_message',
      slotName: text(edge.messageId ?? edge.canMessageId ?? edge.channelId, 'CAN 报文'),
      layer: 'protocol',
      targetField: 'can.payload',
      allowedModels: EDGE_PROTOCOL_MODELS.slice(),
      signalId: text(edge.signalId),
      channelId: text(edge.channelId),
      messageId: text(edge.messageId ?? edge.canMessageId)
    });
  }

  return slots;
}

function createDefaultNodeFaultSlots(node = {}, options = {}) {
  const props = isPlainObject(node.props) ? node.props : {};
  const physicalItems = options.skipPhysical
    ? []
    : [
      ...arrayOrEmpty(props.modelParameters),
      ...arrayOrEmpty(props.physicalParameters),
      ...arrayOrEmpty(node.physicalParameters)
    ];
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

function capabilitySlotsForTarget(target = {}, targetKind = 'node', capabilityMap = []) {
  const entry = arrayOrEmpty(capabilityMap).find((item) => (
    item?.targetId === target.id && (item.targetKind || targetKind) === targetKind
  ));
  return arrayOrEmpty(entry?.faultSlots);
}

export function normalizeModelNode(node = {}, { faultCapabilityMap = [] } = {}) {
  const safeNode = isPlainObject(node) ? clone(node) : {};
  if (hasComponentFaultDeclaration(safeNode)) {
    return {
      ...safeNode,
      faultSlots: mergeDeclaredFaultSlotMetadata(
        buildComponentFaultSlotsFromDeclaration(safeNode),
        [
          ...arrayOrEmpty(safeNode.faultSlots),
          ...capabilitySlotsForTarget(safeNode, 'node', faultCapabilityMap)
        ],
        safeNode
      )
    };
  }

  const hasDeclaredPhysical = arrayOrEmpty(safeNode.faultSlots)
    .some((slot) => normalizeSlotLayer(slot) === 'physical');
  const defaults = [
    ...capabilitySlotsForTarget(safeNode, 'node', faultCapabilityMap),
    ...createDefaultNodeFaultSlots(safeNode, { skipPhysical: hasDeclaredPhysical })
  ];

  return {
    ...safeNode,
    faultSlots: mergeFaultSlots(safeNode, defaults)
  };
}

export function normalizeModelEdge(edge = {}, { faultCapabilityMap = [] } = {}) {
  const safeEdge = isPlainObject(edge) ? clone(edge) : {};
  const defaults = [
    ...capabilitySlotsForTarget(safeEdge, 'edge', faultCapabilityMap),
    ...createDefaultEdgeFaultSlots(safeEdge)
  ];

  return {
    ...safeEdge,
    lineType: text(safeEdge.lineType ?? safeEdge.type, 'normal'),
    faultSlots: mergeFaultSlots(safeEdge, defaults)
  };
}

export function normalizeModelStoreSnapshot(snapshot = {}, options = {}) {
  const safeSnapshot = isPlainObject(snapshot) ? clone(snapshot) : {};
  const faultCapabilityMap = arrayOrEmpty(options.faultCapabilityMap);
  const normalizeNodes = (nodes) => arrayOrEmpty(nodes)
    .map((node) => normalizeModelNode(node, { faultCapabilityMap }));
  const normalizeEdges = (edges) => arrayOrEmpty(edges)
    .map((edge) => normalizeModelEdge(edge, { faultCapabilityMap }));

  safeSnapshot.modelNodes = normalizeNodes(safeSnapshot.modelNodes);
  safeSnapshot.modelEdges = normalizeEdges(safeSnapshot.modelEdges);

  if (isPlainObject(safeSnapshot.canvases)) {
    Object.entries(safeSnapshot.canvases).forEach(([canvasId, canvas]) => {
      if (!isPlainObject(canvas)) {
        return;
      }
      safeSnapshot.canvases[canvasId] = {
        ...canvas,
        nodes: normalizeNodes(canvas.nodes),
        edges: normalizeEdges(canvas.edges)
      };
    });
  }

  return safeSnapshot;
}
