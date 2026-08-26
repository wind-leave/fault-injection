import { reactive } from 'vue';
import { COMPONENT_REGISTRY, createPythonSimulationComponent } from './componentRegistry.js';

const STORAGE_KEY = 'gz.authoredSimulationComponents.v1';

const catalogState = reactive({
  components: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slug(value, fallback = 'component') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return normalized || fallback;
}

function categoryIdFor(label) {
  const normalized = String(label ?? '').trim();
  if (!normalized) return 'authored-components';
  // Category labels are user-facing Chinese text in the common case.  Do not
  // collapse every non-ASCII label to the same fallback identifier.
  const encoded = Array.from(normalized)
    .map((character) => character.codePointAt(0).toString(36))
    .join('-');
  return `authored-category-${encoded}`;
}

function normalizeType(value) {
  return value === 'number[]' ? 'number[]' : 'number';
}

function normalizeArrayLength(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeValue(value, type) {
  if (type === 'number[]') {
    return Array.isArray(value)
      ? value.map((item) => Number(item)).filter(Number.isFinite)
      : [];
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeVectorElementNames(value, vectorLength) {
  if (!vectorLength || !Array.isArray(value)) return [];
  return value
    .slice(0, vectorLength)
    .map((item) => String(item ?? '').trim());
}

function toPort(item, direction, index) {
  const type = normalizeType(item?.type);
  const name = String(item?.name ?? '').trim() || `${direction} ${index + 1}`;
  const varName = slug(item?.varName || name, `${direction}_${index + 1}`).replace(/-/g, '_');
  const vectorLength = type === 'number[]'
    ? normalizeArrayLength(item?.vectorLength) || undefined
    : undefined;
  const vectorElementNames = normalizeVectorElementNames(item?.vectorElementNames, vectorLength);

  return {
    portId: `${direction}-${index}`,
    name,
    varName,
    type: type === 'number[]' ? 'vector' : 'float',
    ...(type === 'number[]' ? {
      dataType: 'vector',
      ...(vectorLength ? { vectorLength } : {}),
      ...(vectorElementNames.length ? { vectorElementNames } : {})
    } : {}),
    ...(item?.unit ? { unit: String(item.unit).trim() } : {})
  };
}

function toParameter(item, index) {
  const type = normalizeType(item?.type);
  const name = String(item?.name ?? '').trim() || `参数 ${index + 1}`;
  const key = slug(item?.key || name, `parameter_${index + 1}`).replace(/-/g, '_');
  const vectorLength = type === 'number[]'
    ? normalizeArrayLength(item?.vectorLength) || undefined
    : undefined;

  return {
    key,
    name,
    type: type === 'number[]' ? 'vector' : 'float',
    ...(type === 'number[]' ? { dataType: 'vector', ...(vectorLength ? { vectorLength } : {}) } : {}),
    default: normalizeValue(item?.defaultValue, type),
    ...(item?.unit ? { unit: String(item.unit).trim() } : {})
  };
}

export function createAuthoredComponentRegistryEntry(definition) {
  return createPythonSimulationComponent({
    type: definition.type,
    group: 'simulation',
    simulationMenu: definition.categoryId || 'authored-components',
    simulationMenuLabel: definition.categoryLabel || '我的组件',
    label: definition.name,
    moduleType: definition.categoryLabel || '我的组件',
    description: definition.description,
    inputs: definition.inputs.map((item, index) => toPort(item, 'input', index)),
    outputs: definition.outputs.map((item, index) => toPort(item, 'output', index)),
    parameters: definition.parameters.map((item, index) => toParameter(item, index)),
    rawSource: definition.rawSource,
    entryFunction: definition.entryFunction || 'process',
    executionMode: definition.executionMode || 'mock',
    sourceKind: 'custom',
    moduleId: definition.moduleId || definition.type,
    fileName: definition.fileName || `${definition.moduleId || definition.type}.py`,
    title: definition.description || `${definition.name} 仿真组件`,
    palette: {
      icon: definition.icon,
      ...(definition.iconImage ? { iconImage: definition.iconImage } : {}),
      ...(definition.iconColor ? { iconColor: definition.iconColor } : {}),
      iconClass: 'simulation',
      repeatable: true
    },
    powerInputs: [],
    powerOutputs: []
  });
}

function syncRuntimeLibrary(type, definition) {
  COMPONENT_REGISTRY[type] = definition;
  if (typeof window !== 'undefined' && window.__GZ_COMPONENT_LIBRARY__) {
    window.__GZ_COMPONENT_LIBRARY__[type] = clone({
      label: definition.label,
      badge: definition.badge,
      className: definition.className,
      nodeType: definition.nodeType,
      templateId: definition.templateId,
      width: definition.width,
      height: definition.height,
      defaults: definition.defaults,
      ports: definition.ports,
      pythonBinding: definition.pythonBinding,
      faultSlots: definition.faultSlots
    });
  }
}

function persist() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(catalogState.components));
  } catch {
    // The current demonstration can still use components for this session when
    // browser storage is unavailable or full.
  }
}

function normalizeDefinition(definition = {}) {
  const name = String(definition.name ?? '').trim();
  const type = String(definition.type ?? '').trim() || `authored-${slug(name)}-${Date.now()}`;
  const categoryLabel = String(definition.categoryLabel ?? '').trim();

  return {
    id: String(definition.id ?? type),
    type,
    name,
    categoryId: String(definition.categoryId ?? '').trim() || categoryIdFor(categoryLabel),
    categoryLabel: categoryLabel || '我的组件',
    description: String(definition.description ?? '').trim(),
    icon: String(definition.icon ?? '').trim(),
    iconImage: String(definition.iconImage ?? '').trim(),
    iconColor: String(definition.iconColor ?? '').trim(),
    rawSource: String(definition.rawSource ?? ''),
    fileName: String(definition.fileName ?? '').trim(),
    entryFunction: String(definition.entryFunction ?? 'process').trim() || 'process',
    moduleId: String(definition.moduleId ?? '').trim(),
    executionMode: definition.executionMode === 'backend' ? 'backend' : 'mock',
    inputs: Array.isArray(definition.inputs) ? clone(definition.inputs) : [],
    outputs: Array.isArray(definition.outputs) ? clone(definition.outputs) : [],
    parameters: Array.isArray(definition.parameters) ? clone(definition.parameters) : []
  };
}

function hydrate() {
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return;
    catalogState.components.splice(0, catalogState.components.length, ...stored.map(normalizeDefinition));
    catalogState.components.forEach((component) => {
      syncRuntimeLibrary(component.type, createAuthoredComponentRegistryEntry(component));
    });
  } catch {
    // Ignore malformed legacy local storage. New components remain available.
  }
}

export function useAuthoredComponentCatalog() {
  return catalogState;
}

export function registerAuthoredComponent(definition) {
  const normalized = normalizeDefinition(definition);
  const registryEntry = createAuthoredComponentRegistryEntry(normalized);
  const existingIndex = catalogState.components.findIndex((item) => item.id === normalized.id || item.type === normalized.type);

  if (existingIndex === -1) {
    catalogState.components.push(normalized);
  } else {
    catalogState.components.splice(existingIndex, 1, normalized);
  }
  syncRuntimeLibrary(normalized.type, registryEntry);
  persist();
  return { component: clone(normalized), registryEntry };
}

export function removeAuthoredComponent(type) {
  const index = catalogState.components.findIndex((component) => component.type === type);
  if (index === -1) return null;
  const [removed] = catalogState.components.splice(index, 1);
  delete COMPONENT_REGISTRY[type];
  if (typeof window !== 'undefined' && window.__GZ_COMPONENT_LIBRARY__) {
    delete window.__GZ_COMPONENT_LIBRARY__[type];
  }
  persist();
  return clone(removed);
}

hydrate();
