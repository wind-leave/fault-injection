import { reactive } from 'vue';
import {
  COMPONENT_REGISTRY,
  buildComponentLibraryFromRegistry,
  createPythonSimulationComponent
} from './componentRegistry.js';

const catalog = reactive({ components: [], errors: [], loading: false, error: '' });
const registeredTypes = new Set();
const replacedTemplates = new Map();

export function useDiscoveredComponentCatalog() {
  return catalog;
}

export function syncDiscoveredComponents(components) {
  // Build everything first so a malformed response cannot partially replace the palette.
  const entries = {};
  const originals = new Map();
  for (const component of components) {
    const group = component.group ?? 'simulation';
    if (!['simulation', 'electrical'].includes(group)) {
      throw new Error(`不支持的组件分组：${group}`);
    }
    const replacing = component.replacesBuiltin === true;
    const type = replacing ? component.moduleId : `discovered_${component.moduleId}`;
    const original = replacing ? replacedTemplates.get(type) ?? COMPONENT_REGISTRY[type] : null;
    if (replacing && (group !== 'electrical' || original?.group !== 'electrical'
      || original?.pythonBinding?.moduleId !== component.moduleId)) {
      throw new Error(`无法替换内置电气组件：${component.moduleId}`);
    }
    if (entries[type] || (!replacing && COMPONENT_REGISTRY[type] && !registeredTypes.has(type))) {
      throw new Error(`组件标识重复：${component.moduleId}`);
    }
    if (replacing) originals.set(type, original);
    const electrical = group === 'electrical';
    entries[type] = createPythonSimulationComponent({
      type,
      group,
      moduleId: component.moduleId,
      fileName: component.fileName,
      entryFunction: component.entryFunction,
      label: component.name,
      description: component.description,
      moduleType: component.category,
      ...(electrical ? {
        paletteMenu: component.paletteMenu || `discovered-category-${component.category}`,
        paletteMenuLabel: component.category,
        badge: '电气',
        className: 'b-electrical'
      } : {
        simulationMenu: component.paletteMenu || `discovered-category-${component.category}`,
        simulationMenuLabel: component.category
      }),
      inputs: component.inputs,
      outputs: component.outputs,
      parameters: component.parameters,
      requiresPower: component.requiresPower,
      faultSlots: component.faultSlots,
      executionMode: 'backend',
      sourceKind: 'builtin',
      palette: {
        ...(original?.palette || { repeatable: true }),
        icon: component.icon || (electrical ? '电' : '仿'),
        iconClass: electrical ? 'electrical' : 'simulation'
      }
    });
  }
  for (const type of registeredTypes) {
    delete COMPONENT_REGISTRY[type];
    if (window.__GZ_COMPONENT_LIBRARY__) delete window.__GZ_COMPONENT_LIBRARY__[type];
  }
  registeredTypes.clear();
  Object.assign(COMPONENT_REGISTRY, Object.fromEntries(replacedTemplates));
  if (window.__GZ_COMPONENT_LIBRARY__) {
    Object.assign(window.__GZ_COMPONENT_LIBRARY__, buildComponentLibraryFromRegistry(Object.fromEntries(replacedTemplates)));
  }
  replacedTemplates.clear();
  originals.forEach((original, type) => replacedTemplates.set(type, original));
  Object.assign(COMPONENT_REGISTRY, entries);
  if (window.__GZ_COMPONENT_LIBRARY__) {
    Object.assign(window.__GZ_COMPONENT_LIBRARY__, buildComponentLibraryFromRegistry(entries));
  }
  Object.keys(entries).forEach((type) => registeredTypes.add(type));
  catalog.components = components;
}

export async function loadDiscoveredComponents({ fetchImpl = globalThis.fetch } = {}) {
  if (catalog.loading) return false;
  catalog.loading = true;
  catalog.error = '';
  try {
    const response = await fetchImpl('/api/components/discovered', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'success' || !Array.isArray(payload.components) || !Array.isArray(payload.errors)) {
      throw new Error('组件目录响应格式错误');
    }
    syncDiscoveredComponents(payload.components);
    catalog.errors = payload.errors;
    return true;
  } catch (error) {
    catalog.error = `自动组件加载失败：${error.message}。请确认后端已更新并启动，再重试。`;
    return false;
  } finally {
    catalog.loading = false;
  }
}
