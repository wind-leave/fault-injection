import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LeftPalette from '../src/components/layout/LeftPalette.vue';
import { COMPONENT_REGISTRY } from '../src/services/componentRegistry.js';
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

afterEach(() => {
  syncDiscoveredComponents([]);
  Object.assign(useDiscoveredComponentCatalog(), { error: '', errors: [] });
  delete window.__GZ_COMPONENT_LIBRARY__;
  vi.unstubAllGlobals();
});

describe('discovered component catalog', () => {
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
      expect(section.find('[data-component="discovered_test_auto_gain"]').exists()).toBe(true);
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
      const entry = COMPONENT_REGISTRY.discovered_test_auto_gain;
      expect(entry).toMatchObject({ group: 'electrical', badge: '电气', className: 'b-electrical', paletteMenu: 'power-conversion' });
      expect(entry.pythonBinding).toMatchObject({ moduleId: 'test_auto_gain', executionMode: 'backend', bound: true });
      expect(wrapper.get('#g-electrical [data-component="discovered_test_auto_gain"]').text()).toContain(component.name);
      expect(wrapper.get('#g-electrical').text()).toContain('外部电气分类');
      expect(wrapper.find('#g-simulation [data-component="discovered_test_auto_gain"]').exists()).toBe(false);
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
      expect(wrapper.findAll(`[data-component="${type}"]`)).toHaveLength(1);
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
      { ...component, group: 'electrical', replacesBuiltin: true },
      { ...component, moduleId: 'signal_source', group: 'electrical', replacesBuiltin: true }
    ]) {
      expect(() => syncDiscoveredComponents([{ ...component, moduleId: 'new_valid' }, invalid])).toThrow();
      expect(COMPONENT_REGISTRY.discovered_test_auto_gain).toBeDefined();
      expect(COMPONENT_REGISTRY.discovered_new_valid).toBeUndefined();
    }
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
    const entry = COMPONENT_REGISTRY.discovered_test_auto_gain;
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
      const entry = COMPONENT_REGISTRY.discovered_test_auto_gain;
      expect(entry.pythonBinding).toMatchObject({ moduleId: 'test_auto_gain', executionMode: 'backend', bound: true });
      expect(entry.defaults.parameterValues).toEqual({ gain: 2 });
      expect(entry.faultSlots).toContainEqual(expect.objectContaining({ targetField: 'params.gain' }));
      expect(window.__GZ_COMPONENT_LIBRARY__.discovered_test_auto_gain.pythonBinding.moduleId).toBe('test_auto_gain');
      const item = wrapper.get('[data-component="discovered_test_auto_gain"]');
      expect(item.text()).toContain('自动增益测试');
      const setData = vi.fn();
      await item.trigger('dragstart', { dataTransfer: { setData } });
      expect(setData).toHaveBeenCalledWith('text/plain', 'discovered_test_auto_gain');
      // Successful refresh removes files that no longer exist on the backend.
      expect(await loadDiscoveredComponents({ fetchImpl: async () => response([]) })).toBe(true);
      await flushPromises();
      expect(wrapper.find('[data-component="discovered_test_auto_gain"]').exists()).toBe(false);
      expect(window.__GZ_COMPONENT_LIBRARY__.discovered_test_auto_gain).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it('preserves existing components when the backend fails and shows an actionable retry', async () => {
    syncDiscoveredComponents([component]);
    const wrapper = mount(LeftPalette);
    try {
      expect(await loadDiscoveredComponents({ fetchImpl: async () => ({ ok: false, status: 503 }) })).toBe(false);
      await flushPromises();
      expect(wrapper.text()).toContain('HTTP 503');
      expect(COMPONENT_REGISTRY.discovered_test_auto_gain).toBeDefined();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
      await wrapper.get('[data-testid="discovered-component-status"] button').trigger('click');
      await flushPromises();
      expect(useDiscoveredComponentCatalog().error).toBe('');
    } finally { wrapper.unmount(); }
  });

  it('shows per-file diagnostics while retaining valid components', async () => {
    const wrapper = mount(LeftPalette);
    try {
      await loadDiscoveredComponents({ fetchImpl: async () => response([component], [{ fileName: 'broken.py', message: 'duplicate moduleId' }]) });
      await flushPromises();
      expect(wrapper.text()).toContain('broken.py：duplicate moduleId');
      expect(wrapper.find('[data-component="discovered_test_auto_gain"]').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
