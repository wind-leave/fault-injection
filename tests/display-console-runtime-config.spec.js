import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RuntimeConfigNotice from '../src/components/RuntimeConfigNotice.vue';

const shipped = JSON.parse(readFileSync('public/config/display-console.json', 'utf8'));

function customGlobalConfiguration() {
  const configuration = structuredClone(shipped);
  configuration.DISPLAY_CONSOLE_VECTOR_PORT_ID = 'external-vector';
  configuration.DISPLAY_CONSOLE_INPUTS.push({ key: 'temperature', label: '温度', type: 'float', unit: '℃', displayScale: 0.1, generateMeasurementPoint: false });
  configuration.DISPLAY_CONSOLE_COLUMNS.push(
    { key: 'temperature', label: '温度（℃）', source: 'input', inputIndex: 7 },
    { key: 'extraState', label: '附加状态', value: '已配置' }
  );
  configuration.DISPLAY_CONSOLE_PRESETS = { display_console_9: { name: '外部全局配置台' } };
  return configuration;
}

describe('runtime display-console configuration', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.useRealTimers());

  it('loads the shipped JSON without changing existing console behavior', async () => {
    const constants = await import('../src/constants/displayConsoleConfig.js');
    const defaults = Object.fromEntries(Object.keys(shipped).map((key) => [key, structuredClone(constants[key])]));
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => shipped });
    expect(await loadDisplayConsoleRuntimeConfig({ fetchImpl })).toEqual({ source: 'external', error: '' });
    for (const key of Object.keys(shipped)) expect(constants[key]).toEqual(defaults[key]);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('config/display-console.json'), expect.objectContaining({ cache: 'no-store' }));
  });

  it('uses every exported data setting in helper functions, registry templates and backend model ports', async () => {
    const constants = await import('../src/constants/displayConsoleConfig.js');
    const originalInputs = constants.DISPLAY_CONSOLE_INPUTS;
    const originalColumns = constants.DISPLAY_CONSOLE_COLUMNS;
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const configuration = customGlobalConfiguration();
    expect(await loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => ({ ok: true, json: async () => configuration }) })).toEqual({ source: 'external', error: '' });
    expect(constants.DISPLAY_CONSOLE_INPUTS).toBe(originalInputs);
    expect(constants.DISPLAY_CONSOLE_COLUMNS).toBe(originalColumns);
    expect(constants.createDisplayConsoleVectorPort()).toMatchObject({ id: 'external-vector', vectorLength: 8, name: '8路参数输入' });
    const displayConfig = constants.createDisplayConsoleConfig();
    expect(displayConfig.columns).toHaveLength(18);
    expect(displayConfig.ports[0]).toMatchObject({ id: 'external-vector', name: '8路参数输入' });
    expect(displayConfig.inputs[7]).toMatchObject({ key: 'temperature', unit: '℃', displayScale: 0.1 });
    const { COMPONENT_REGISTRY } = await import('../src/services/componentRegistry.js');
    expect(COMPONENT_REGISTRY.display_console_9.defaults.displayConfig).toEqual(displayConfig);
    const { buildBackendExecutablePackage } = await import('../src/services/backendExecutablePackageService.js');
    const pkg = buildBackendExecutablePackage({ modelNodes: [
      { id: 'preset-console', type: 'display_console', templateId: 'display_console_9', props: {} },
      { id: 'legacy-console', type: 'display_console', props: {} }
    ], modelEdges: [] });
    for (const node of pkg.nodes) expect(node.inputs[0]).toMatchObject({ id: 'external-vector', vectorLength: 8, vectorElementNames: expect.arrayContaining(['温度']) });
  });

  it('restores all builtin data after a failed full-document edit and accepts the original preset-only format', async () => {
    const constants = await import('../src/constants/displayConsoleConfig.js');
    const defaults = Object.fromEntries(Object.keys(shipped).map((key) => [key, structuredClone(constants[key])]));
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const load = (document) => loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => ({ ok: true, json: async () => document }) });
    await load(customGlobalConfiguration());
    const invalid = customGlobalConfiguration();
    invalid.DISPLAY_CONSOLE_PRESETS.display_console_9.fields = { temperature: { inputIndex: 8 } };
    const result = await load(invalid);
    expect(result).toMatchObject({ source: 'builtin', error: expect.stringContaining('inputIndex') });
    for (const key of Object.keys(shipped)) expect(constants[key]).toEqual(defaults[key]);
    await load(customGlobalConfiguration());
    expect(await load({ display_console_8: { name: '旧格式控制台' } })).toMatchObject({ source: 'external' });
    expect(constants.DISPLAY_CONSOLE_VECTOR_PORT_ID).toBe(defaults.DISPLAY_CONSOLE_VECTOR_PORT_ID);
    expect(constants.DISPLAY_CONSOLE_INPUTS).toEqual(defaults.DISPLAY_CONSOLE_INPUTS);
    expect(constants.DISPLAY_CONSOLE_PRESETS).toEqual({ display_console_8: { name: '旧格式控制台' } });
  });

  it('validates global arrays and validates preset overrides against the proposed globals', async () => {
    const { validateDisplayConsoleRuntimeConfiguration } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const cases = [
      { DISPLAY_CONSOLE_INPUTS: [] },
      { DISPLAY_CONSOLE_INPUTS: [{ key: 'temperature', label: '温度' }, { key: 'temperature', label: '重复' }] },
      { DISPLAY_CONSOLE_VECTOR_PORT_ID: '' },
      { DISPLAY_CONSOLE_COLUMNS: [] },
      { DISPLAY_CONSOLE_COLUMNS: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] },
      { DISPLAY_CONSOLE_COLUMNS: [{ key: 'a', label: 'A', source: 'input', inputIndex: 8 }] },
      { DISPLAY_CONSOLE_COLUMNS: [{ key: 'a', label: 'A', value: Infinity }] },
      { DISPLAY_CONSOLE_PRESETS: { display_console_9: { fields: { missing: { label: '不存在' } } } } }
    ];
    for (const overrides of cases) expect(() => validateDisplayConsoleRuntimeConfiguration({ ...customGlobalConfiguration(), ...overrides })).toThrow();
    expect(() => validateDisplayConsoleRuntimeConfiguration({ DISPLAY_CONSOLE_UNKNOWN: [] })).toThrow('不支持');
    expect(validateDisplayConsoleRuntimeConfiguration(customGlobalConfiguration()).DISPLAY_CONSOLE_COLUMNS).toHaveLength(18);
  });

  it('installs ports, table fields, controls and shared bindings before building the registry', async () => {
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const presets = {
      display_console_9: {
        name: '外部配置控制台',
        inputs: { amplitude: { label: '通道幅度', displayScale: 10 } },
        ports: [
          { id: 'console-input', name: 'A' },
          { id: 'input-b', name: 'B' },
          { id: 'input-c', name: 'C', inputs: { amplitude: { generateMeasurementPoint: false } } }
        ],
        fields: { centerFrequency: { label: '载频' }, remark: { value: '现场配置' } },
        controls: [{ componentType: 'rf_downconverter', parameterKeys: ['lo_frequency_hz'] }],
        sharedParameters: [{ key: 'frequency', label: '本振', bindings: [{ componentType: 'rf_downconverter', parameterKey: 'lo_frequency_hz' }] }]
      }
    };
    await loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => ({ ok: true, json: async () => presets }) });
    const { COMPONENT_REGISTRY, getPaletteGroups } = await import('../src/services/componentRegistry.js');
    expect(COMPONENT_REGISTRY.display_console_1).toBeUndefined();
    expect(COMPONENT_REGISTRY.display_console_2).toBeUndefined();
    const entry = COMPONENT_REGISTRY.display_console_9;
    expect(entry.label).toBe('外部配置控制台');
    expect(entry.defaults.displayConfig.ports).toHaveLength(3);
    expect(entry.defaults.displayConfig.ports[2].inputs[3]).toMatchObject({ label: '通道幅度', displayScale: 10, generateMeasurementPoint: false });
    expect(entry.defaults.displayConfig.columns[1].label).toBe('载频');
    expect(entry.defaults.displayConfig.controls).toEqual(presets.display_console_9.controls);
    expect(entry.defaults.displayConfig.sharedParameters).toEqual(presets.display_console_9.sharedParameters);
    expect(getPaletteGroups().find((group) => group.id === 'display-control').components.map((item) => item.type)).toEqual(['display_console_9']);
  });

  it.each([
    ['找不到文件', () => ({ ok: false, status: 404 }), 'HTTP 404'],
    ['JSON 语法错误', () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } }), 'Unexpected token'],
    ['返回 HTML', () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }), 'Unexpected token <'],
    ['格式错误', () => ({ ok: true, json: async () => [] }), '必须是对象'],
    ['重复端口', () => ({ ok: true, json: async () => ({ display_console_1: { ports: [{ id: 'a' }, { id: 'a' }] } }) }), '重复标识'],
    ['参数键格式错误', () => ({ ok: true, json: async () => ({ display_console_1: { controls: [{ componentType: 'gain', parameterKeys: 'gain' }] } }) }), '必须是数组']
  ])('falls back atomically when %s', async (_, response, message) => {
    const { DISPLAY_CONSOLE_PRESETS } = await import('../src/constants/displayConsoleConfig.js');
    const defaults = structuredClone(DISPLAY_CONSOLE_PRESETS);
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const result = await loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => response() });
    expect(result).toMatchObject({ source: 'builtin', error: expect.stringContaining(message) });
    expect(DISPLAY_CONSOLE_PRESETS).toEqual(defaults);
  });

  it('falls back on network failure and times out even while reading the response body', async () => {
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const failure = await loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => { throw new Error('Network offline'); } });
    expect(failure.error).toContain('Network offline');
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const pending = loadDisplayConsoleRuntimeConfig({ fetchImpl, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ source: 'builtin', error: expect.stringContaining('超时') });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('rejects invalid input, field, control and shared-parameter contracts', async () => {
    const { validateDisplayConsolePresets } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const badPresets = [
      { ports: [] },
      { ports: [{ name: '缺少 ID' }] },
      { inputs: { unknown: '未知输入' } },
      { inputs: { amplitude: { generateMeasurementPoint: 'false' } } },
      { fields: { amplitude: { inputIndex: 7 } } },
      { fields: { remark: { source: 'input' } } },
      { controls: [{ componentType: 'gain', parameterKeys: ['gain', 'gain'] }] },
      { sharedParameters: [{ key: 'shared', bindings: [{ componentType: 'gain' }] }] }
    ];
    for (const preset of badPresets) expect(() => validateDisplayConsolePresets({ display_console_1: preset })).toThrow();
    expect(() => validateDisplayConsolePresets({ gain: {} })).toThrow('显控台标识');
    expect(() => validateDisplayConsolePresets(JSON.parse('{"__proto__":{}}'))).toThrow();
  });

  it('only imports the app and registry after the asynchronous config load completes', async () => {
    const { initializeWorkbench } = await import('../src/bootstrap.js');
    let resolveConfig;
    const pendingConfig = new Promise((resolve) => { resolveConfig = resolve; });
    const importApp = vi.fn(async () => ({ default: 'test-app' }));
    const mountApp = vi.fn();
    const pending = initializeWorkbench({ loadConfig: () => pendingConfig, importApp, mountApp });
    expect(importApp).not.toHaveBeenCalled();
    resolveConfig({ error: '配置提示' });
    await pending;
    expect(mountApp).toHaveBeenCalledWith('test-app', { runtimeConfigError: '配置提示' });
  });

  it('renders external ports and columns and controls external canvas components using their original IDs', async () => {
    const { loadDisplayConsoleRuntimeConfig } = await import('../src/services/displayConsoleRuntimeConfig.js');
    const { initializeWorkbench } = await import('../src/bootstrap.js');
    const presets = {
      display_console_9: {
        name: '现场控制台',
        fields: { centerFrequency: { label: '现场载频' } },
        ports: [
          { id: 'console-input', name: 'A' },
          { id: 'console-input-2', name: 'B' },
          { id: 'console-input-3', name: 'C' }
        ],
        controls: [
          { componentType: 'rf_four_output_source', parameterKeys: ['center_frequency_hz'] },
          { componentType: 'rf_downconverter', parameterKeys: ['lo_frequency_hz'] }
        ],
        sharedParameters: [{
          key: 'shared_frequency', label: '共享频率',
          bindings: [
            { componentType: 'rf_four_output_source', parameterKey: 'center_frequency_hz' },
            { componentType: 'rf_downconverter', parameterKey: 'lo_frequency_hz' }
          ]
        }]
      }
    };
    const configuration = customGlobalConfiguration();
    configuration.DISPLAY_CONSOLE_PRESETS = { ...presets, display_console_10: { name: '全局默认端口台' } };
    let wrapper;
    try {
      wrapper = await initializeWorkbench({
        loadConfig: () => loadDisplayConsoleRuntimeConfig({ fetchImpl: async () => ({ ok: true, json: async () => configuration }) }),
        mountApp: (App, props) => mount(App, { props, attachTo: document.body })
      });
      await nextTick();
      const { COMPONENT_REGISTRY } = await import('../src/services/componentRegistry.js');
      const { syncDiscoveredComponents } = await import('../src/services/discoveredComponentCatalogService.js');
      syncDiscoveredComponents(['rf_four_output_source', 'rf_downconverter'].map((type) => {
        const entry = COMPONENT_REGISTRY[type];
        return {
          moduleId: type, templateId: type, replacesBuiltin: true, group: 'simulation',
          name: entry.label, category: '射频信号模型', paletteMenu: entry.simulationMenu,
          fileName: entry.pythonBinding.fileName, entryFunction: entry.pythonBinding.entryFunction,
          inputs: structuredClone(entry.ports.inputs), outputs: structuredClone(entry.ports.outputs),
          parameters: structuredClone(entry.defaults.parameters), requiresPower: false, faultSlots: entry.faultSlots
        };
      }));
      window.doCreateBlankWorkspace();
      const source = window.createNode('rf_four_output_source', 100, 100);
      const converter = window.createNode('rf_downconverter', 400, 100);
      expect(source.templateId).toBe('rf_four_output_source');
      expect(converter.templateId).toBe('rf_downconverter');
      const consoleNode = window.createNode('display_console_9', 700, 100);
      const defaultConsole = window.createNode('display_console_10', 1000, 100);
      expect(window.getNodePorts(consoleNode).inputs.map((port) => port.portId)).toEqual(['console-input', 'console-input-2', 'console-input-3']);
      expect(window.getNodePorts(consoleNode).inputs.every((port) => port.vectorLength === 8)).toBe(true);
      expect(window.getNodePorts(defaultConsole).inputs[0]).toMatchObject({ portId: 'external-vector', vectorLength: 8 });
      window.openDisplayConsolePanel(consoleNode.id);
      await nextTick();
      const panel = document.querySelector('[data-display-console-panel]');
      expect(panel.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(panel.querySelector('thead').textContent).toContain('现场载频');
      expect(panel.querySelectorAll('thead th')).toHaveLength(18);
      expect(panel.querySelector('thead').textContent).toContain('温度（℃）');
      window.selectNode(defaultConsole.id);
      window.setPropertyPanelTab('parameters');
      await nextTick();
      expect(document.querySelector('[data-display-console-vector-map]').textContent).toContain('向量长度 8');
      expect(panel.querySelector('[data-display-console-parameter="conversion_gain"]')).toBeNull();
      const frequency = panel.querySelector('[data-display-console-shared-parameter="shared_frequency"]');
      expect(frequency).not.toBeNull();
      frequency.value = '915';
      panel.querySelector('[data-display-console-shared-parameter-unit="shared_frequency"]').value = 'MHz';
      panel.querySelector('[data-display-console-apply]').click();
      await nextTick();
      expect(source.props.parameterValues.center_frequency_hz).toBe(915000000);
      expect(converter.props.parameterValues.lo_frequency_hz).toBe(915000000);
      const { buildBackendExecutablePackage } = await import('../src/services/backendExecutablePackageService.js');
      const pkg = buildBackendExecutablePackage({ modelNodes: [defaultConsole], modelEdges: [] });
      expect(pkg.nodes[0].inputs[0]).toMatchObject({ id: 'external-vector', vectorLength: 8 });
    } finally {
      wrapper?.unmount();
      const { syncDiscoveredComponents } = await import('../src/services/discoveredComponentCatalogService.js');
      syncDiscoveredComponents([]);
      const { __resetLegacyRuntimeForTests } = await import('../src/services/legacyRuntimeBootstrap.js');
      __resetLegacyRuntimeForTests();
      window.localStorage.clear();
      document.body.innerHTML = '';
    }
  });

  it('shows a readable fallback warning which can be dismissed', async () => {
    const wrapper = mount(RuntimeConfigNotice, { props: { message: '配置无效，使用默认配置' } });
    expect(wrapper.get('[role="alert"]').text()).toContain('使用默认配置');
    await wrapper.get('button').trigger('click');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
