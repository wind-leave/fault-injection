import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LeftPalette from '../src/components/layout/LeftPalette.vue';
import { COMPONENT_GROUPS, COMPONENT_REGISTRY } from '../src/services/componentRegistry.js';
import { registerAuthoredComponent, removeAuthoredComponent } from '../src/services/authoredComponentCatalogService.js';
import { applyFlightModelPackage, buildFlightModelPackage, validateFlightModelPackage } from '../src/services/flightModelPackageService.js';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';
import {
  loadDiscoveredComponents,
  syncDiscoveredComponents,
  useDiscoveredComponentCatalog
} from '../src/services/discoveredComponentCatalogService.js';

const component = {
  moduleId: 'test_auto_gain', name: '自动增益测试', category: '自动发现组件', icon: '算',
  fileName: 'test_auto_gain.py', entryFunction: 'process', requiresPower: false,
  inputs: [{ portId: 'input-0', varName: 'signal', name: '输入', type: 'float' }],
  outputs: [{ portId: 'output-0', varName: 'result', name: '输出', type: 'float' }],
  parameters: [{ key: 'gain', name: '增益', type: 'number', default: 2 }], faultSlots: []
};
const response = (components = [component], errors = []) => ({
  ok: true, json: async () => ({ status: 'success', components, errors })
});
const componentGroups = COMPONENT_GROUPS.filter((group) => ['electrical', 'simulation'].includes(group.id));
const originalVisibility = new Map(componentGroups.map((group) => [group.id, group.componentsVisible]));

beforeEach(() => {
  // Exercise catalog rendering with the groups explicitly enabled. The default
  // hidden configuration is verified separately, including asynchronous loads.
  componentGroups.forEach((group) => { group.componentsVisible = true; });
});

afterEach(() => {
  syncDiscoveredComponents([]);
  Object.assign(useDiscoveredComponentCatalog(), { error: '', errors: [] });
  delete window.__GZ_COMPONENT_LIBRARY__;
  vi.unstubAllGlobals();
  componentGroups.forEach((group) => { group.componentsVisible = originalVisibility.get(group.id); });
});

describe('discovered component catalog', () => {
  it('keeps both hidden groups empty after automatic and authored components are loaded', async () => {
    componentGroups.forEach((group) => { group.componentsVisible = false; });
    const wrapper = mount(LeftPalette);
    const authoredType = 'authored-hidden-group-check';
    try {
      expect(wrapper.findAll('#g-electrical [data-component], #g-simulation [data-component]')).toHaveLength(0);
      await loadDiscoveredComponents({ fetchImpl: async () => response([
        component,
        { ...component, moduleId: 'hidden_electrical', group: 'electrical', paletteMenu: 'power-source' }
      ]) });
      registerAuthoredComponent({
        type: authoredType, name: '隐藏的自定义组件', categoryLabel: '我的组件', icon: '仿',
        rawSource: 'def process(signal):\n    return {"result": signal}',
        inputs: [{ name: '输入', varName: 'signal', type: 'number' }],
        outputs: [{ name: '输出', varName: 'result', type: 'number' }], parameters: []
      });
      await flushPromises();
      expect(wrapper.findAll('#g-electrical [data-component], #g-simulation [data-component]')).toHaveLength(0);
      expect(wrapper.findAll('[data-electrical-menu-section], [data-simulation-menu-section]')).toHaveLength(0);
      expect(wrapper.find('[data-palette-group="electrical"]').exists()).toBe(true);
      expect(wrapper.find('[data-palette-group="simulation"]').exists()).toBe(true);
      expect(wrapper.find('[data-component="signal_source"]').exists()).toBe(true);
      expect(COMPONENT_REGISTRY.electrical_dc_power_source.pythonBinding.moduleId).toBe('electrical_dc_power_source');
      expect(COMPONENT_REGISTRY.test_auto_gain.pythonBinding.moduleId).toBe(component.moduleId);
      expect(COMPONENT_REGISTRY[authoredType].pythonBinding.rawSource).toContain('def process');
    } finally {
      removeAuthoredComponent(authoredType);
      wrapper.unmount();
    }
  });

  it.each([
    ['simulation', 'rf-signal', '射频信号模型'],
    ['simulation', 'signal-processing', '信号处理模型'],
    ['electrical', 'power-source', '电源模块'],
    ['electrical', 'power-conversion', '电能变换'],
    ['simulation', 'custom-simulation', '我的仿真菜单'],
    ['electrical', 'custom-electrical', '我的电气菜单']
  ])('places converted components in their original %s menu %s', async (group, paletteMenu, category) => {
    const wrapper = mount(LeftPalette);
    try {
      syncDiscoveredComponents([{ ...component, group, paletteMenu, category }]);
      await flushPromises();
      const section = wrapper.get(`[data-${group === 'simulation' ? 'simulation' : 'electrical'}-menu-section="${paletteMenu}"]`);
      expect(section.get('.simulation-menu-section__head').text()).toContain(category);
      expect(section.find('[data-component="test_auto_gain"]').exists()).toBe(true);
      expect(wrapper.find(`[data-${group === 'simulation' ? 'simulation' : 'electrical'}-menu-section="discovered-category-${category}"]`).exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('places external electrical components in electrical menus with electrical styling and backend bindings', async () => {
    const wrapper = mount(LeftPalette);
    try {
      await loadDiscoveredComponents({ fetchImpl: async () => response([
        { ...component, group: 'electrical', category: '电源变换', paletteMenu: 'power-conversion' },
        { ...component, moduleId: 'custom_electrical', group: 'electrical', category: '外部电气分类' }
      ]) });
      await flushPromises();
      const entry = COMPONENT_REGISTRY.test_auto_gain;
      expect(entry).toMatchObject({ group: 'electrical', badge: '电气', className: 'b-electrical', paletteMenu: 'power-conversion' });
      expect(entry.pythonBinding).toMatchObject({ moduleId: 'test_auto_gain', executionMode: 'backend', bound: true });
      expect(wrapper.get('#g-electrical [data-component="test_auto_gain"]').text()).toContain(component.name);
      expect(wrapper.get('#g-electrical').text()).toContain('外部电气分类');
      expect(wrapper.find('#g-simulation [data-component="test_auto_gain"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('replaces builtin electrical templates without duplicate items and restores defaults when removed', async () => {
    const type = 'electrical_dc_power_source';
    const original = COMPONENT_REGISTRY[type];
    const definition = {
      ...component, moduleId: type, group: 'electrical', replacesBuiltin: true,
      category: '电源模块', paletteMenu: 'power-source', name: '外部直流电源', inputs: [],
      outputs: [{ portId: 'output-0', varName: 'dc_output', name: '直流输出', type: 'float' }],
      parameters: [{ key: 'output_voltage', name: '输出电压', type: 'number', default: 36 }]
    };
    window.__GZ_COMPONENT_LIBRARY__ = {};
    const wrapper = mount(LeftPalette);
    try {
      syncDiscoveredComponents([definition]);
      await flushPromises();
      expect(COMPONENT_REGISTRY[type].defaults).toMatchObject({ parameterValues: { output_voltage: 36 }, powerInputs: [] });
      expect(COMPONENT_REGISTRY[type].pythonBinding.moduleId).toBe(type);
      expect(wrapper.findAll(`[data-component="${type}"]`)).toHaveLength(1);
      expect(COMPONENT_REGISTRY[`discovered_${type}`]).toBeUndefined();
      expect(window.__GZ_COMPONENT_LIBRARY__[type].label).toBe('外部直流电源');
      const entry = COMPONENT_REGISTRY[type];
      const pkg = buildFlightModelPackage({
        meta: { modelId: 'external-power', modelName: '外部电源模型' },
        snapshot: { modelNodes: [{
          id: 'external-supply', type: entry.nodeType, templateId: type,
          props: structuredClone(entry.defaults), ports: structuredClone(entry.ports),
          pythonBinding: structuredClone(entry.pythonBinding)
        }], modelEdges: [] }
      });
      // Failed fetches retain the last successful external template.
      expect(await loadDiscoveredComponents({ fetchImpl: async () => ({ ok: false, status: 503 }) })).toBe(false);
      expect(COMPONENT_REGISTRY[type].label).toBe('外部直流电源');
      syncDiscoveredComponents([{ ...definition, name: '再次修改' }]);
      expect(COMPONENT_REGISTRY[type].label).toBe('再次修改');
      syncDiscoveredComponents([]);
      await flushPromises();
      expect(COMPONENT_REGISTRY[type]).toBe(original);
      expect(window.__GZ_COMPONENT_LIBRARY__[type].label).toBe(original.label);
      expect(wrapper.findAll(`[data-component="${type}"]`)).toHaveLength(0);
      const restored = applyFlightModelPackage(JSON.parse(JSON.stringify(pkg)));
      expect(restored.ok).toBe(true);
      const executable = buildBackendExecutablePackage(restored.snapshot);
      expect(executable.nodes[0].pythonBinding.moduleId).toBe(type);
      expect(executable.nodes[0].parameters.output_voltage).toBe(36);
    } finally { wrapper.unmount(); }
  });

  it('rejects malformed groups and invalid replacements without partially modifying the registry', () => {
    syncDiscoveredComponents([component]);
    for (const invalid of [
      { ...component, group: 'unknown' },
      { ...component, moduleId: 'electrical_dc_power_source', group: 'electrical', replacesBuiltin: false },
      { ...component, moduleId: 'signal_source', group: 'electrical', replacesBuiltin: true }
    ]) {
      expect(() => syncDiscoveredComponents([{ ...component, moduleId: 'new_valid' }, invalid])).toThrow();
      expect(COMPONENT_REGISTRY.test_auto_gain).toBeDefined();
      expect(COMPONENT_REGISTRY.new_valid).toBeUndefined();
    }
  });

  it('shows only external components and preserves original simulation IDs through model export', async () => {
    const type = 'scalar_to_vector4';
    const original = COMPONENT_REGISTRY[type];
    const wrapper = mount(LeftPalette);
    try {
      expect(wrapper.findAll('#g-electrical [data-component], #g-simulation [data-component]')).toHaveLength(0);
      syncDiscoveredComponents([{
        ...component, moduleId: type, templateId: type, replacesBuiltin: true,
        name: '外部标量转向量', group: 'simulation', category: '信号处理模型', paletteMenu: 'signal-processing',
        inputs: structuredClone(original.ports.inputs), outputs: structuredClone(original.ports.outputs), parameters: []
      }]);
      await flushPromises();
      const entry = COMPONENT_REGISTRY[type];
      expect(entry.templateId).toBe(type);
      expect(entry.pythonBinding.moduleId).toBe(type);
      expect(wrapper.get('#g-simulation').findAll('[data-component]')).toHaveLength(1);
      expect(wrapper.get(`[data-component="${type}"]`).text()).toContain('外部标量转向量');
      expect(wrapper.find('[data-component="rf_band_pass_filter"]').exists()).toBe(false);
      expect(wrapper.find('[data-component="electrical_dc_power_source"]').exists()).toBe(false);
      const pkg = buildFlightModelPackage({
        meta: { modelId: 'unchanged-external-ids', modelName: '原 ID 外部组件' },
        snapshot: { modelNodes: [{
          id: 'external-sim', type: entry.nodeType, templateId: entry.templateId, paletteKey: type,
          props: structuredClone(entry.defaults), ports: structuredClone(entry.ports),
          pythonBinding: structuredClone(entry.pythonBinding)
        }], modelEdges: [] }
      });
      const restored = applyFlightModelPackage(JSON.parse(JSON.stringify(pkg)));
      expect(restored.ok).toBe(true);
      const node = restored.snapshot.modelNodes[0];
      // Display-console controls match paletteKey/templateId directly.
      expect(node.paletteKey || node.templateId || node.pythonBinding.moduleId).toBe(type);
      expect(buildBackendExecutablePackage(restored.snapshot).nodes[0].pythonBinding.moduleId).toBe(type);
      syncDiscoveredComponents([]);
      await flushPromises();
      expect(COMPONENT_REGISTRY[type]).toBe(original);
      expect(wrapper.find(`[data-component="${type}"]`).exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.each([
    { ...component },
    { ...component, group: 'electrical', category: '电源变换', paletteMenu: 'power-conversion' },
    { ...component,
      inputs: [{ ...component.inputs[0], type: 'vector', dataType: 'vector', vectorLength: 2 }],
      outputs: [{ ...component.outputs[0], type: 'vector', dataType: 'vector', vectorLength: 2 }]
    },
    { ...component,
      inputs: [{ ...component.inputs[0], type: 'vector', dataType: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 4 }],
      outputs: [{ ...component.outputs[0], type: 'vector', dataType: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 4 }]
    }
  ])('preserves module binding and parameters through model save/import and executable export (%#)', (definition) => {
    syncDiscoveredComponents([definition]);
    const entry = COMPONENT_REGISTRY.test_auto_gain;
    const node = {
      id: 'auto-gain-1', type: entry.nodeType, templateId: entry.templateId,
      props: structuredClone(entry.defaults), ports: structuredClone(entry.ports),
      pythonBinding: structuredClone(entry.pythonBinding)
    };
    const pkg = buildFlightModelPackage({
      meta: { modelId: 'auto-discovery-roundtrip', modelName: '自动发现模型' },
      snapshot: { modelNodes: [node], modelEdges: [] }
    });
    expect(validateFlightModelPackage(pkg)).toEqual({ ok: true, errors: [] });
    const restored = applyFlightModelPackage(JSON.parse(JSON.stringify(pkg)));
    expect(restored.ok).toBe(true);
    const executable = buildBackendExecutablePackage(restored.snapshot);
    const exported = executable.nodes.find((item) => item.id === 'auto-gain-1');
    expect(exported.pythonBinding).toMatchObject({ moduleId: 'test_auto_gain', entryFunction: 'process' });
    expect(exported.parameters).toMatchObject({ gain: definition.parameters[0].default });
    expect(exported.outputs).toHaveLength(1);
    if (definition.outputs[0].dataType === 'rf_complex_envelope') {
      expect(exported.outputs[0]).toMatchObject({ dataType: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 4 });
    }
  });
  it('updates the mounted palette and runtime library with executable backend bindings', async () => {
    const wrapper = mount(LeftPalette);
    window.__GZ_COMPONENT_LIBRARY__ = {};
    try {
      const fetchImpl = vi.fn().mockResolvedValue(response());
      expect(await loadDiscoveredComponents({ fetchImpl })).toBe(true);
      await flushPromises();
      const entry = COMPONENT_REGISTRY.test_auto_gain;
      expect(entry.pythonBinding).toMatchObject({ moduleId: 'test_auto_gain', executionMode: 'backend', bound: true });
      expect(entry.defaults.parameterValues).toEqual({ gain: 2 });
      expect(entry.faultSlots).toContainEqual(expect.objectContaining({ targetField: 'params.gain' }));
      expect(window.__GZ_COMPONENT_LIBRARY__.test_auto_gain.pythonBinding.moduleId).toBe('test_auto_gain');
      const item = wrapper.get('[data-component="test_auto_gain"]');
      expect(item.text()).toContain('自动增益测试');
      const setData = vi.fn();
      await item.trigger('dragstart', { dataTransfer: { setData } });
      expect(setData).toHaveBeenCalledWith('text/plain', 'test_auto_gain');
      // Successful refresh removes files that no longer exist on the backend.
      expect(await loadDiscoveredComponents({ fetchImpl: async () => response([]) })).toBe(true);
      await flushPromises();
      expect(wrapper.find('[data-component="test_auto_gain"]').exists()).toBe(false);
      expect(window.__GZ_COMPONENT_LIBRARY__.test_auto_gain).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it('preserves existing components and displays errors without a refresh button when the backend fails', async () => {
    syncDiscoveredComponents([component]);
    const wrapper = mount(LeftPalette);
    try {
      expect(await loadDiscoveredComponents({ fetchImpl: async () => ({ ok: false, status: 503 }) })).toBe(false);
      await flushPromises();
      expect(wrapper.text()).toContain('HTTP 503');
      expect(COMPONENT_REGISTRY.test_auto_gain).toBeDefined();
      expect(wrapper.get('[data-testid="discovered-component-status"]').find('button').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('shows per-file diagnostics while retaining valid components', async () => {
    const wrapper = mount(LeftPalette);
    try {
      await loadDiscoveredComponents({ fetchImpl: async () => response([component], [{ fileName: 'broken.py', message: 'duplicate moduleId' }]) });
      await flushPromises();
      expect(wrapper.text()).toContain('broken.py：duplicate moduleId');
      expect(wrapper.find('[data-component="test_auto_gain"]').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
