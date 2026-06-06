import { createSimulationBlockPythonBinding } from '../composables/useWorkbenchState.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveModuleName(parsedInterface = {}) {
  return text(
    parsedInterface.moduleName,
    typeof parsedInterface.fileName === 'string'
      ? parsedInterface.fileName.replace(/\.py$/i, '')
      : 'python_module'
  );
}

function resolveSignalId(moduleName, item, index) {
  return text(item?.signalId, `${moduleName}.${text(item?.name, `signal_${index}`)}`);
}

function resolveDisplayName(item, fallbackName) {
  return text(item?.displayName, text(item?.comment, text(item?.name, fallbackName)));
}

function mapPortList(items, direction, moduleName) {
  return arrayOrEmpty(items).map((item, index) => {
    const signalId = resolveSignalId(moduleName, item, index);
    const name = resolveDisplayName(item, `${direction}_${index}`);
    const id = text(item.id ?? item.portId, `${direction}-${index}`);

    return {
      id,
      portId: id,
      signalId,
      varName: text(item.name, `signal_${index}`),
      name,
      displayName: name,
      type: text(item.type, 'any'),
      comment: text(item.comment),
      direction
    };
  });
}

function mapStateVariables(items, moduleName) {
  return arrayOrEmpty(items).map((item, index) => {
    const signalId = resolveSignalId(moduleName, item, index);
    const name = resolveDisplayName(item, `middle_${index}`);
    const id = text(item.id ?? item.stateId, text(item.name, `state_${index}`));

    return {
      id,
      stateId: signalId,
      signalId,
      varName: text(item.name, `signal_${index}`),
      name,
      displayName: name,
      type: text(item.type, 'any'),
      comment: text(item.comment)
    };
  });
}

function mapParameters(inputs, moduleName) {
  return arrayOrEmpty(inputs)
    .filter((item) => item.default !== null && item.default !== undefined)
    .map((item, index) => {
      const signalId = resolveSignalId(moduleName, item, index);
      const name = resolveDisplayName(item, `parameter_${index}`);
      const id = text(item.id ?? item.parameterId, text(item.name, `parameter_${index}`));

      return {
        id,
        parameterId: `${signalId}.default`,
        signalId,
        varName: text(item.name, `signal_${index}`),
        name,
        displayName: name,
        type: text(item.type, 'any'),
        default: clone(item.default),
        comment: text(item.comment)
      };
    });
}

function enrichBindingSignalIds(binding, ports, stateVariables) {
  const nextBinding = clone(binding);
  nextBinding.portMapping = {
    ...nextBinding.portMapping,
    inputs: arrayOrEmpty(nextBinding.portMapping?.inputs).map((item, index) => ({
      ...item,
      signalId: ports.inputs[index]?.signalId ?? item.signalId
    })),
    outputs: arrayOrEmpty(nextBinding.portMapping?.outputs).map((item, index) => ({
      ...item,
      signalId: ports.outputs[index]?.signalId ?? item.signalId
    })),
    middleVars: arrayOrEmpty(nextBinding.portMapping?.middleVars).map((item, index) => ({
      ...item,
      signalId: stateVariables[index]?.signalId ?? item.signalId
    }))
  };

  return nextBinding;
}

function mapPropsPorts(items) {
  return arrayOrEmpty(items).map((item) => ({
    signalId: item.signalId,
    varName: item.varName,
    name: item.displayName,
    displayName: item.displayName,
    type: item.type,
    comment: item.comment
  }));
}

export function createComponentTemplateFromPython({
  templateId,
  displayName,
  category = '仿真模块',
  geometry = 'rect',
  parsedInterface
} = {}) {
  if (!templateId) {
    throw new Error('Missing templateId');
  }
  if (!parsedInterface?.entryFunction) {
    throw new Error('Missing parsed Python entry function');
  }

  const safeParsedInterface = clone(parsedInterface);
  const moduleName = resolveModuleName(safeParsedInterface);
  const ports = {
    inputs: mapPortList(safeParsedInterface.inputs, 'input', moduleName),
    outputs: mapPortList(safeParsedInterface.outputs, 'output', moduleName)
  };
  const stateVariables = mapStateVariables(safeParsedInterface.middleVars, moduleName);
  const pythonBinding = enrichBindingSignalIds(
    createSimulationBlockPythonBinding(safeParsedInterface, { moduleCategory: category }),
    ports,
    stateVariables
  );

  return {
    templateId,
    type: 'simulation_block',
    displayName: text(displayName, safeParsedInterface.description ?? templateId),
    category,
    geometry,
    ports,
    parameters: mapParameters(safeParsedInterface.inputs, moduleName),
    stateVariables,
    pythonBinding,
    faultSlots: []
  };
}

export function addFaultSlotToComponentTemplate(template, slot) {
  const nextTemplate = clone(template);
  const nextSlot = clone(slot);
  const slotId = nextSlot?.slotId;

  if (!slotId) {
    throw new Error('Missing slotId');
  }

  nextSlot.displayName = text(nextSlot.displayName ?? nextSlot.slotName, slotId);
  nextSlot.slotName = text(nextSlot.slotName ?? nextSlot.displayName, slotId);
  nextSlot.kind = text(nextSlot.kind, 'output_signal');
  nextSlot.allowedFaultTypeIds = arrayOrEmpty(nextSlot.allowedFaultTypeIds ?? nextSlot.allowedFaultIds);
  delete nextSlot.allowedFaultIds;

  const existingSlots = arrayOrEmpty(nextTemplate.faultSlots);
  const index = existingSlots.findIndex((item) => item?.slotId === slotId);
  nextTemplate.faultSlots = index === -1
    ? [...existingSlots, nextSlot]
    : existingSlots.map((item, itemIndex) => (itemIndex === index ? nextSlot : item));

  return nextTemplate;
}

export function createNodeFromComponentTemplate(template, { id, x = 0, y = 0 } = {}) {
  const safeTemplate = clone(template);

  if (!id) {
    throw new Error('Missing id');
  }

  return {
    id,
    templateId: safeTemplate.templateId,
    type: 'simulation_block',
    x,
    y,
    w: 176,
    h: 96,
    geometry: safeTemplate.geometry ?? 'rect',
    props: {
      name: safeTemplate.displayName,
      moduleType: safeTemplate.category ?? '仿真模块',
      geometry: safeTemplate.geometry ?? 'rect',
      parameters: arrayOrEmpty(safeTemplate.parameters),
      inputs: mapPropsPorts(safeTemplate.ports?.inputs),
      outputs: mapPropsPorts(safeTemplate.ports?.outputs),
      middleVars: mapPropsPorts(safeTemplate.stateVariables)
    },
    ports: clone(safeTemplate.ports),
    parameters: arrayOrEmpty(safeTemplate.parameters),
    stateVariables: arrayOrEmpty(safeTemplate.stateVariables),
    faultSlots: arrayOrEmpty(safeTemplate.faultSlots),
    pythonBinding: {
      ...clone(safeTemplate.pythonBinding),
      bound: true
    }
  };
}
