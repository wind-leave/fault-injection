import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

function loadPublicPackage(fileName) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.resolve(testDir, '..', 'public', 'model-packages', fileName);
  return JSON.parse(readFileSync(targetPath, 'utf8'));
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

async function mountWorkbench() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  return wrapper;
}

function setFieldValue(selector, value, eventName = 'input') {
  const field = document.querySelector(selector);
  expect(field).not.toBeNull();
  field.value = value;
  field.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function setCheckboxValue(selector, checked) {
  const field = document.querySelector(selector);
  expect(field).not.toBeNull();
  field.checked = checked;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function visiblePropertyTabs() {
  return Array.from(document.querySelectorAll('[data-props-tab]'))
    .filter((button) => !button.hidden)
    .map((button) => button.dataset.propsTab);
}

function dispatchPointer(target, type, init = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0
  });
  Object.defineProperty(event, 'pointerId', {
    value: init.pointerId ?? 1
  });
  target.dispatchEvent(event);
}

describe('property panel interaction', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('switches node property tabs and shows module-specific parameter fields', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 220, 220);
    await flushRuntime();

    const source = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'signal_source');
    window.selectNode(source.id);
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="overview"]')?.classList.contains('is-active')).toBe(true);

    document.querySelector('[data-props-tab="parameters"]').click();
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="parameters"]')?.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('prop-waveType')).not.toBeNull();
    expect(document.getElementById('prop-amplitude')).not.toBeNull();

    document.querySelector('[data-props-tab="faults"]').click();
    await flushRuntime();

    expect(document.querySelector('.props-fault-panel')).not.toBeNull();
    expect(document.querySelector('.props-fault-section')).not.toBeNull();
    expect(document.querySelector('.props-section-head')).not.toBeNull();
    expect(document.querySelector('.props-fault-actions')).not.toBeNull();
    expect(document.getElementById('pd')?.textContent).toContain('No active faults');
    expect(document.querySelector('.props-fault-action')).not.toBeNull();

    wrapper.unmount();
  });

  it('creates domain-specific signal source templates through the legacy runtime', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source_digital', 180, 220);
    window.createNode('signal_source_command', 360, 220);
    window.createNode('signal_source_rf', 540, 220);
    await flushRuntime();

    const sources = window.__GZ_STATE__.modelNodes.filter((node) => node.type === 'signal_source');

    expect(sources.map((node) => node.props.signalDomain)).toEqual(['digital', 'command', 'rf']);
    expect(sources.map((node) => node.props.name)).toEqual([
      '数字信号源 1',
      '指令信号源 2',
      '射频信号源 3'
    ]);
    expect(Array.from(document.querySelectorAll('.blk.b-source .blk-kicker')).map((item) => item.textContent.trim()))
      .toEqual(['数字', '指令', '射频']);

    wrapper.unmount();
  });

  it('renders and saves RF signal source fields through the legacy property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.getElementById('prop-signalDomain')).toBeNull();
    expect(document.getElementById('prop-name')).toBeNull();
    expect(document.getElementById('prop-centerFrequency')).not.toBeNull();
    expect(document.getElementById('prop-waveType')).toBeNull();

    setFieldValue('#prop-modulation', 'digital', 'change');
    await flushRuntime();
    setFieldValue('#prop-centerFrequency', '5.8');
    setFieldValue('#prop-centerFrequencyUnit', 'GHz');
    setFieldValue('#prop-bandwidth', '40MHz');
    setFieldValue('#prop-power', '12');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({
      signalDomain: 'rf',
      centerFrequency: '5.8',
      centerFrequencyUnit: 'GHz',
      bandwidth: '40MHz',
      power: '12',
      powerUnit: 'dBm'
    });

    wrapper.unmount();
  });

  it('applies RF modulation parameters to the generated source output', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    const outputAt = (time) => window.resolveNodeOutput(source.id, 0, 'actual', time, 0.01, new Map(), new Set());
    source.props.power = '10';

    source.props.modulation = 'cw';
    source.props.centerFrequency = '1';
    source.props.centerFrequencyUnit = 'GHz';
    expect(outputAt(0)).toBeCloseTo(0, 10);
    expect(outputAt(0.25e-9)).toBeCloseTo(10, 6);
    expect(outputAt(0.5e-9)).toBeCloseTo(0, 6);
    expect(outputAt(0.75e-9)).toBeCloseTo(-10, 6);

    source.props.modulation = 'am';
    source.props.centerFrequency = '1';
    source.props.centerFrequencyUnit = 'Hz';
    source.props.modulationDepth = '50';
    source.props.modulationRate = '1Hz';
    expect(outputAt(0.25)).toBeCloseTo(15, 6);

    source.props.modulation = 'fm';
    source.props.frequencyDeviation = '1Hz';
    expect(outputAt(0.25)).toBeCloseTo(10 * Math.sin(Math.PI / 2 + 1), 6);

    source.props.modulation = 'pm';
    source.props.phaseDeviation = `${Math.PI / 2}`;
    expect(outputAt(0.25)).toBeCloseTo(0, 6);

    source.props.modulation = 'pulse';
    source.props.pulseWidth = '500ms';
    source.props.prf = '1Hz';
    expect(outputAt(0.25)).toBeCloseTo(10, 6);
    expect(outputAt(0.75)).toBe(0);

    source.props.modulation = 'digital';
    source.props.bandwidth = '20Hz';
    source.props.symbolRate = '10Hz';
    source.props.sampleRate = '20Hz';
    expect(Math.abs(outputAt(0.25))).toBeCloseTo(10, 6);

    source.props.modulation = 'noise';
    source.props.snr = '0';
    source.props.bandwidth = '1MHz';
    expect(outputAt(0.31)).not.toBe(10);

    source.props.signalDomain = 'analog';
    source.props.waveType = 'sine';
    source.props.amplitude = '2';
    source.props.frequency = '1';
    source.props.phase = `${Math.PI / 2}`;
    source.props.offset = '0';
    expect(outputAt(0)).toBeCloseTo(2, 6);

    source.props.waveType = 'ramp';
    source.props.initialValue = '2';
    source.props.slope = '3';
    source.props.startTime = '0.5';
    expect(outputAt(1)).toBeCloseTo(3.5, 6);

    wrapper.unmount();
  });

  it('shows signal source definition above module status and hides canvas position for signal sources', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="overview"]')?.classList.contains('is-active')).toBe(true);
    const overviewLabels = Array.from(document.querySelectorAll('#pd .pglbl'))
      .map((item) => item.textContent.trim());
    expect(overviewLabels).toContain('信号定义');
    expect(overviewLabels).toContain('模块状态');
    expect(overviewLabels.indexOf('信号定义')).toBeLessThan(overviewLabels.indexOf('模块状态'));
    expect(overviewLabels).not.toContain('画布位置');
    expect(document.getElementById('pd')?.textContent).toContain('信号名称');
    expect(document.getElementById('prop-name')).not.toBeNull();
    expect(document.getElementById('prop-signalName')).not.toBeNull();
    expect(document.getElementById('prop-signalId')).not.toBeNull();
    expect(document.getElementById('prop-unit')).not.toBeNull();
    expect(document.getElementById('prop-description')).not.toBeNull();
    expect(document.getElementById('prop-centerFrequency')).toBeNull();
    expect(document.getElementById('prop-signalDomain')).toBeNull();

    setFieldValue('#prop-name', 'RF Test Source');
    setFieldValue('#prop-signalName', '空速射频链路');
    setFieldValue('#prop-signalId', 'rf.airspeed.link');
    setFieldValue('#prop-unit', 'MHz');
    setFieldValue('#prop-description', '用于空速传感器链路仿真');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({
      name: 'RF Test Source',
      signalName: '空速射频链路',
      signalId: 'rf.airspeed.link',
      unit: 'MHz',
      description: '用于空速传感器链路仿真'
    });

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="parameters"]')?.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('prop-name')).toBeNull();
    expect(document.getElementById('prop-signalName')).toBeNull();
    expect(document.getElementById('prop-centerFrequency')).not.toBeNull();
    expect(document.getElementById('prop-signalDomain')).toBeNull();

    wrapper.unmount();
  });

  it('removes canvas position from every signal source overview', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const componentTypes = [
      'signal_source',
      'signal_source_digital',
      'signal_source_command',
      'signal_source_rf'
    ];

    for (const [index, componentType] of componentTypes.entries()) {
      const source = window.createNode(componentType, 160 + index * 120, 220);
      await flushRuntime();
      window.selectNode(source.id);
      await flushRuntime();

      const overviewLabels = Array.from(document.querySelectorAll('#pd .pglbl'))
        .map((item) => item.textContent.trim());
      expect(overviewLabels).toContain('信号定义');
      expect(overviewLabels).not.toContain('画布位置');
    }

    wrapper.unmount();
  });

  it('removes canvas position from the simulation block overview', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 220, 220);
    await flushRuntime();
    window.selectNode(block.id);
    await flushRuntime();

    const overviewLabels = Array.from(document.querySelectorAll('#pd .pglbl'))
      .map((item) => item.textContent.trim());
    expect(overviewLabels).not.toContain('画布位置');

    wrapper.unmount();
  });

  it('keeps digital signal current-value controls out of the parameter panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_digital', 220, 220);
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();

    expect(visiblePropertyTabs()).toEqual(['overview', 'parameters', 'faults']);
    expect(document.querySelector('[data-props-tab="runtimeInput"]')).toBeNull();
    expect(document.querySelector('[data-props-tab="outputs"]')?.hidden).toBe(true);

    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    const groupLabels = Array.from(document.querySelectorAll('#pd .pglbl')).map((item) => item.textContent.trim());
    expect(groupLabels).toContain('数字信号配置');
    expect(groupLabels).not.toContain('当前取值');
    expect(document.getElementById('prop-initialState')).toBeNull();
    expect(document.getElementById('prop-initialState-slider')).toBeNull();
    expect(document.querySelector('[data-digital-current-control]')).toBeNull();
    expect(document.querySelector('[data-digital-current-ticks]')).toBeNull();
    expect(document.getElementById('prop-digitalMode')).not.toBeNull();

    wrapper.unmount();
  });

  it('edits digital signal gear presets for enum mode while keeping two fixed level gears', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_digital', 220, 220);
    source.props.digitalMode = 'level';
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelectorAll('[data-digital-gear-row]')).toHaveLength(2);
    expect(document.querySelector('[data-digital-gear-add]')).toBeNull();
    expect(document.querySelector('[data-digital-gear-delete]')).toBeNull();
    expect(document.getElementById('prop-lowLevel')).not.toBeNull();
    expect(document.getElementById('prop-highLevel')).not.toBeNull();

    source.props.digitalMode = 'enum';
    source.props.enumValues = 'idle,armed';
    window.renderPropertyPanel(source);
    await flushRuntime();

    expect(document.querySelectorAll('[data-digital-gear-row]')).toHaveLength(2);
    expect(document.getElementById('prop-enumValues')?.value).toBe('idle,armed');
    document.querySelector('[data-digital-gear-add]').click();
    await flushRuntime();
    expect(document.querySelectorAll('[data-digital-gear-row]')).toHaveLength(3);
    const gearInputs = document.querySelectorAll('[data-digital-gear-value]');
    gearInputs[2].value = 'fault';
    gearInputs[2].dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('prop-enumValues')?.value).toBe('idle,armed,fault');
    document.querySelector('[data-digital-gear-delete]').click();
    await flushRuntime();
    expect(document.querySelectorAll('[data-digital-gear-row]')).toHaveLength(2);

    wrapper.unmount();
  });

  it('uses the selected added enum gear as the runtime digital output', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_digital', 220, 220);
    source.props.digitalMode = 'enum';
    source.props.enumValues = 'idle,armed';
    source.props.initialState = 'idle';
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    document.querySelector('[data-digital-gear-add]').click();
    await flushRuntime();
    const gearInputs = document.querySelectorAll('[data-digital-gear-value]');
    gearInputs[2].value = 'fault';
    gearInputs[2].dispatchEvent(new Event('input', { bubbles: true }));

    source.props.initialState = 'fault';
    window.syncRuntimeSignalSourceOutputFromProps(source);
    expect(source.props.initialState).toBe('fault');
    expect(window.resolveNodeOutput(source.id, 0, 'actual', 0, 0.1, new Map(), new Set())).toBe(2);

    wrapper.unmount();
  });

  it('keeps generic digital bounds in parameter configuration without a current-value slider', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_digital', 220, 220);
    source.props.digitalMode = 'generic';
    source.props.minValue = '0';
    source.props.maxValue = '100';
    source.props.initialState = '25';
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.getElementById('prop-minValue').value).toBe('0');
    expect(document.getElementById('prop-maxValue').value).toBe('100');
    expect(document.getElementById('prop-initialState')).toBeNull();
    expect(document.getElementById('prop-initialState-slider')).toBeNull();

    wrapper.unmount();
  });

  it('saves simple component parameters through the extracted property schema', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const gain = window.createNode('gain_block', 260, 220);
    await flushRuntime();

    window.selectNode(gain.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(window.__GZ_PROPERTY_PANEL_SCHEMA__).toBeTruthy();
    expect(document.getElementById('prop-gain')).not.toBeNull();

    setFieldValue('#prop-name', '增益 A');
    setFieldValue('#prop-gain', '3.5');
    setFieldValue('#prop-inputFormat', '向量', 'change');
    setFieldValue('#prop-outputFormat', '矩阵', 'change');
    document.querySelector('.props-save').click();
    await flushRuntime();

    expect(gain.props).toMatchObject({
      name: '增益 A',
      gain: '3.5',
      inputFormat: '向量',
      outputFormat: '矩阵'
    });

    wrapper.unmount();
  });

  it('exposes a fault UI refresh orchestration entry point', async () => {
    const wrapper = await mountWorkbench();

    expect(window.refreshFaultUiAfterChange).toEqual(expect.any(Function));

    wrapper.unmount();
  });

  it.skip('renders simulation block parameters through the extracted simulation schema', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 300, 220);
    await flushRuntime();

    window.selectNode(block.id);
    await flushRuntime();
    expect(document.querySelector('[data-props-tab="outputs"]')?.hidden).toBe(true);
    expect(document.querySelector('.rpanel')?.dataset.propsTabCount).toBe('3');
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__).toBeTruthy();
    expect(document.getElementById('prop-name')).not.toBeNull();
    expect(document.getElementById('prop-moduleType')).not.toBeNull();
    expect(document.getElementById('sim-input-count')).not.toBeNull();
    expect(document.getElementById('sim-output-count')).not.toBeNull();
    expect(document.getElementById('sim-middle-count')).not.toBeNull();
    expect(document.querySelector('.sim-intf-row[data-role="输入"]')).not.toBeNull();
    expect(document.querySelector('.sim-intf-row[data-role="输出"]')).not.toBeNull();
    expect(document.querySelector('.sim-intf-row[data-role="中间变量"]')).not.toBeNull();

    setFieldValue('#prop-name', '仿真 A');
    setFieldValue('#prop-moduleType', '积分', 'change');
    setFieldValue('.sim-intf-row[data-role="输入"] [data-sim-field="name"]', '误差输入');
    setFieldValue('.sim-intf-row[data-role="输出"] [data-sim-field="name"]', '控制输出');
    setFieldValue('.sim-intf-row[data-role="中间变量"] [data-sim-field="name"]', '积分状态');
    setFieldValue('#prop-ffunctionNote', '接口说明');
    document.querySelector('.props-save').click();
    await flushRuntime();

    expect(block.props.name).toBe('仿真 A');
    expect(block.props.moduleType).toBe('积分');
    expect(block.props.inputs[0].name).toBe('误差输入');
    expect(block.props.outputs[0].name).toBe('控制输出');
    expect(block.props.middleVars[0].name).toBe('积分状态');
    expect(block.props.ffunctionNote).toBe('接口说明');
    expect(window.getNodePorts(block).inputs[0].label).toContain('误差输入');
    expect(window.getNodePorts(block).outputs[0].label).toContain('控制输出');
    expect(window.getNodePorts(block).outputs[1].label).toContain('积分状态');

    wrapper.unmount();
  });

  it('saves editable signal-source labels and uses the standard canvas connection for a multimeter', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 220, 180);
    const multimeter = window.createNode('instrument_multimeter', 480, 180);
    const targetComponent = window.createNode('flow_block', 480, 300);
    const scope = window.createNode('instrument_scope', 700, 180);
    await flushRuntime();

    window.selectNode(source.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    setFieldValue('#prop-outputPortName', '姿态误差信号');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(source.props.outputPortName).toBe('姿态误差信号');
    expect(window.getNodePorts(source).outputs[0].label).toBe('姿态误差信号');

    window.selectNode(multimeter.id);
    window.setPropertyPanelTab('overview');
    await flushRuntime();
    expect(document.getElementById(`b-${multimeter.id}`)?.innerHTML).not.toContain('data-multimeter-canvas-lead');
    expect(window.getNodePorts(multimeter).inputs.map((port) => port.label)).toEqual(['正端（VΩ）', '负端（COM）']);
    expect(window.getNodePorts(multimeter).inputs.map((port) => port.side)).toEqual(['left', 'right']);
    window.handlePortClick({ stopPropagation() {} }, multimeter.id, 'input', 0);
    window.handlePortClick({ stopPropagation() {} }, source.id, 'output', 0);
    window.handlePortClick({ stopPropagation() {} }, multimeter.id, 'input', 1);
    window.handlePortClick({ stopPropagation() {} }, targetComponent.id, 'input', 0);
    await flushRuntime();
    expect(multimeter.props.positiveLead).toMatchObject({ nodeId: source.id, direction: 'output', portIndex: 0 });
    expect(multimeter.props.negativeLead).toMatchObject({ nodeId: targetComponent.id, direction: 'input', portIndex: 0 });
    expect(document.querySelectorAll(`[data-multimeter-lead^="${multimeter.id}:"]`)).toHaveLength(2);

    window.selectNode(scope.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    setFieldValue('#prop-inputPortNameCh1', '俯仰角');
    setFieldValue('#prop-inputPortNameCh2', '偏航角');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(window.getNodePorts(scope).inputs.map((port) => port.label)).toEqual(['俯仰角', '偏航角']);

    wrapper.unmount();
  });

  it.skip('saves editable display names for Python-bound simulation ports', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 320, 220);
    block.pythonBinding = {
      bound: true,
      fileName: 'controller.py',
      moduleName: 'controller',
      entryFunction: 'process',
      portMapping: {
        inputs: [{ varName: 'error', displayName: '误差', type: 'float', connected: false }],
        outputs: [{ varName: 'command', displayName: '控制指令', type: 'float' }],
        middleVars: [{ varName: 'integral', displayName: '积分量', type: 'float' }]
      }
    };
    await flushRuntime();

    window.selectNode(block.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    const inputPortCard = document.querySelector('[data-python-port-display-name][data-python-port-kind="inputs"]')?.closest('.props-port-card');
    expect(inputPortCard?.querySelector('.props-port-card__kind')?.textContent).toContain('输入端口 1');
    expect(inputPortCard?.querySelector('.props-port-card__name')).toBeNull();
    expect(inputPortCard?.querySelector('.props-port-card__var')).toBeNull();
    setFieldValue('[data-python-port-display-name][data-python-port-kind="inputs"]', '姿态误差');
    setFieldValue('[data-python-port-display-name][data-python-port-kind="outputs"]', '执行器指令');
    setFieldValue('[data-python-port-display-name][data-python-port-kind="middleVars"]', '积分状态');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(block.pythonBinding.portMapping.inputs[0].displayName).toBe('姿态误差');
    expect(block.pythonBinding.portMapping.outputs[0].displayName).toBe('执行器指令');
    expect(block.pythonBinding.portMapping.middleVars[0].displayName).toBe('积分状态');
    expect(window.getNodePorts(block).inputs[0].label).toBe('姿态误差');
    expect(window.getNodePorts(block).outputs.map((port) => port.label)).toEqual(['执行器指令', '积分状态']);

    wrapper.unmount();
  });

  it('can cancel injected faults and clears visual fault state from a component', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.type === 'simulation_block');
    block.injectedFault = {
      modelId: 'sensor_additive_bias',
      name: 'Sensor Additive Bias',
      layer: 'electrical',
      runtimeBehavior: 'additive_bias',
      parameters: { offset: 0.2 }
    };
    block.faultBindings = [
      {
        bindingId: 'binding-test',
        faultModelId: 'sensor_additive_bias',
        name: 'Sensor Additive Bias',
        layer: 'electrical',
        active: true,
        injectedFault: block.injectedFault
      }
    ];
    state.faultedBlks = [block.id];

    window.selectNode(block.id);
    await flushRuntime();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-fault-runtime-summary]')).toBeNull();
    expect(document.getElementById('pd')?.textContent).not.toContain('故障运行配置');
    expect(document.querySelector('[data-fault-binding-enabled]')).toBeNull();

    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.getElementById(`b-${block.id}`)?.classList.contains('faulted')).toBe(true);
    const faultInstance = document.querySelector('[data-fault-binding-id="binding-test"]');
    expect(faultInstance?.classList.contains('props-fault-card--name-only')).toBe(true);
    expect(faultInstance?.textContent.trim()).toBe('Sensor Additive Bias');
    expect(faultInstance?.querySelector('.props-fault-param-grid')).toBeNull();
    expect(faultInstance?.querySelector('.props-fault-remove')).toBeNull();

    window.removeFaultBinding('node', block.id, 'binding-test');
    await flushRuntime();

    expect(block.injectedFault).toBeUndefined();
    expect(block.faultBindings?.filter((binding) => binding.active !== false)).toHaveLength(0);
    expect(state.faultedBlks).not.toContain(block.id);
    expect(document.getElementById(`b-${block.id}`)?.classList.contains('faulted')).toBe(false);
    expect(document.getElementById('pd')?.textContent).toContain('No active faults');

    wrapper.unmount();
  });

  it('describes each layered fault injector target contract in its property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const cases = [
      ['physical_fault_injector', '物理层', '模块参数'],
      ['electrical_fault_injector', '电气层', '模块变量或信号连线'],
      ['protocol_fault_injector', '协议层', '连接线传递数据']
    ];

    for (const [type, layerLabel, objectLabel] of cases) {
      const node = window.createNode(type, 260, 220);
      await flushRuntime();

      window.selectNode(node.id);
      await flushRuntime();

      const textContent = document.getElementById('pd')?.textContent || '';
      expect(textContent).toContain('绑定状态');
      expect(textContent).toContain('故障层级');
      expect(textContent).toContain(layerLabel);
      expect(textContent).toContain('绑定对象');
      expect(textContent).toContain('故障对象');
      expect(textContent).toContain(objectLabel);
      expect(textContent).toContain('匹配规则');
    }

    wrapper.unmount();
  });

  it('retains the selected physical fault behavior in the executable fault instance', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sensor = window.createNode('barometer_sensor', 360, 220);
    const injector = window.createNode('physical_fault_injector', 160, 220);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: sensor.id,
      slotId: 'physical:barometer_bias',
      mathModel: 'step',
      parameters: { step: 0.5, start: 0, duration: '' }
    });

    expect(result.ok).toBe(true);
    expect(window.__GZ_STATE__.faultInstances).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: sensor.id,
        targetField: 'params.bias',
        runtimeBehavior: 'step'
      })
    ]));

    wrapper.unmount();
  });

  it('applies electrical bias to the bound edge signal', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    const gain = window.createNode('gain_block', 480, 220);
    const injector = window.createNode('electrical_fault_injector', 320, 420);
    const state = window.__GZ_STATE__;
    source.props.amplitude = '1';
    source.props.frequency = '1';
    gain.props.gain = '1';
    const edge = {
      id: 'edge-electrical-bias',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: gain.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    };
    state.modelEdges.push(edge);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge',
      targetId: edge.id,
      slotId: `electrical:${edge.id}:signal`,
      mathModel: 'bias',
      parameters: { bias: 0.5, start: 0, duration: '' }
    });

    expect(result.ok).toBe(true);
    expect(window.resolveNodeOutput(gain.id, 0, 'actual', 0.25, 0.1, new Map(), new Set())).toBeCloseTo(1.5);

    wrapper.unmount();
  });

  it('uses a bias default when electrical bias is bound to a component output', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    const sensor = window.createNode('barometer_sensor', 480, 220);
    const injector = window.createNode('electrical_fault_injector', 320, 420);
    const state = window.__GZ_STATE__;
    source.props.amplitude = '1';
    source.props.frequency = '1';
    state.modelEdges.push({
      id: 'edge-source-barometer',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: sensor.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    await flushRuntime();

    const outputSlot = window.getLayeredFaultSlotsForTarget(sensor)
      .find((slot) => slot.layer === 'electrical' && slot.variableRole === 'output');
    expect(outputSlot).toBeDefined();
    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: sensor.id,
      slotId: outputSlot.id,
      mathModel: 'bias'
    });

    expect(result.ok).toBe(true);
    const reference = window.resolveNodeOutput(sensor.id, 0, 'reference', 0.25, 0.1, new Map(), new Set());
    const actual = window.resolveNodeOutput(sensor.id, 0, 'actual', 0.25, 0.1, new Map(), new Set());
    expect(actual).toBeCloseTo(reference + 0.1);

    wrapper.unmount();
  });


  it('uses a dedicated export settings panel for oscilloscope output data', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const scope = window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    window.__GZ_SIM__.actual.scopeSamples[scope.id] = {
      ch1: [{ t: 1, v: 2.5 }],
      ch2: [{ t: 1, v: -1 }]
    };
    window.__GZ_SIM__.reference.scopeSamples[scope.id] = {
      ch1: [{ t: 1, v: 2 }],
      ch2: [{ t: 1, v: -1.2 }]
    };

    window.selectNode(scope.id);
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="faults"]')?.hidden).toBe(true);

    window.setPropertyPanelTab('outputs');
    await flushRuntime();

    expect(document.querySelector('[data-scope-export-settings]')).not.toBeNull();
    expect(document.getElementById('pd')?.textContent).toContain('CSV');

    setCheckboxValue('[data-scope-export-channel="ch2"]', false);
    setCheckboxValue('[data-scope-export-field="reference"]', false);
    setCheckboxValue('[data-scope-export-field="residual"]', false);
    document.querySelector('[data-scope-export-save]').click();
    await flushRuntime();

    expect(scope.props.scopeExport).toEqual({
      format: 'csv',
      channels: ['ch1'],
      fields: ['time', 'actual']
    });

    document.querySelector('[data-scope-export-csv]').click();
    await flushRuntime();

    expect(window.__GZ_LAST_SCOPE_EXPORT__?.filename).toContain('_scope.csv');
    expect(window.__GZ_LAST_SCOPE_EXPORT__?.csv).toBe('channel,time,actual\nch1,1.000000,2.500000');

    wrapper.unmount();
  });



  it('keeps declaration-only injectable variables visible in the fault settings tab', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.type === 'simulation_block');
    block.props.name = 'CAN adapter';
    block.props.inputs = [];
    block.props.outputs = [];
    block.props.middleVars = [];
    block.props.faultInjection = {
      physical: [],
      electrical: [],
      protocol: [
        {
          key: 'frame_counter',
          slotName: 'Frame counter',
          variableRole: 'protocol',
          targetField: 'protocol.frameCounter'
        }
      ]
    };
    block.faultSlots = [];

    window.selectNode(block.id);
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.querySelector('[data-fault-slot-variable="frame_counter"]')?.textContent).toContain('Frame counter');
    expect(document.querySelector('[data-fault-slot-layer="protocol"][data-fault-slot-var="frame_counter"]').checked).toBe(true);

    document.querySelector('[data-save-fault-slots]').click();
    await flushRuntime();

    expect(block.props.faultInjection.protocol).toEqual(['frame_counter']);
    expect(block.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'protocol:frame_counter',
        slotName: 'Frame counter',
        variableRole: 'protocol',
        targetField: 'protocol.frameCounter'
      })
    ]);

    wrapper.unmount();
  });



  it.skip('edits CAN edge signal metadata for multi-signal flow inspection', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 180, 220);
    window.createNode('simulation_block', 480, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const target = state.modelNodes.find((node) => node.type === 'simulation_block');
    state.modelEdges.push({
      id: 'edge-can-test',
      lineType: 'can',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    window.renderModelNodes();
    window.selectEdge('edge-can-test');
    await flushRuntime();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    document.getElementById('prop-edge-signal-id').value = 'imu.pitch_rate';
    document.getElementById('prop-edge-channel-id').value = 'CAN-FC-01';
    document.getElementById('prop-edge-message-id').value = '0x184';
    document.getElementById('prop-edge-signal-unit').value = 'rad/s';
    document.getElementById('prop-edge-payload-kind').value = 'float32';
    document.getElementById('prop-edge-fault-policy').value = 'propagates';
    window.saveSelectedEdgeMetadata();
    await flushRuntime();

    const edge = state.modelEdges.find((item) => item.id === 'edge-can-test');
    expect(edge).toMatchObject({
      signalId: 'imu.pitch_rate',
      channelId: 'CAN-FC-01',
      messageId: '0x184',
      signalUnit: 'rad/s',
      payloadKind: 'float32',
      faultPropagationPolicy: 'propagates'
    });
    expect(edge.signalChannels).toEqual([
      expect.objectContaining({
        signalId: 'imu.pitch_rate',
        channelId: 'CAN-FC-01',
        messageId: '0x184'
      })
    ]);

    const metrics = window.collectDataflowEdges().find((item) => item.edge.id === 'edge-can-test').metrics;
    expect(metrics.signalId).toBe('imu.pitch_rate');
    expect(metrics.channelId).toBe('CAN-FC-01');
    expect(metrics.messageId).toBe('0x184');

    window.setPropertyPanelTab('outputs');
    await flushRuntime();

    expect(document.getElementById('pd')?.textContent).toContain('imu.pitch_rate');
    expect(document.getElementById('pd')?.textContent).toContain('CAN-FC-01');
    expect(document.getElementById('pd')?.textContent).toContain('0x184');

    wrapper.unmount();
  });

  it.skip('preserves secondary CAN signal channels when saving primary edge metadata', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 180, 220);
    window.createNode('simulation_block', 480, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const target = state.modelNodes.find((node) => node.type === 'simulation_block');
    state.modelEdges.push({
      id: 'edge-can-multi-channel',
      lineType: 'can',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalChannels: [
        {
          signalId: 'imu.pitch_rate.old',
          channelId: 'CAN-FC-OLD',
          messageId: '0x180',
          payloadKind: 'float32'
        },
        {
          signalId: 'imu.temperature',
          channelId: 'CAN-FC-IMU',
          messageId: '0x185',
          payloadKind: 'uint16'
        }
      ]
    });
    window.renderModelNodes();
    window.selectEdge('edge-can-multi-channel');
    await flushRuntime();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    document.getElementById('prop-edge-signal-id').value = 'imu.pitch_rate';
    document.getElementById('prop-edge-channel-id').value = 'CAN-FC-01';
    document.getElementById('prop-edge-message-id').value = '0x184';
    document.getElementById('prop-edge-payload-kind').value = 'float32';
    window.saveSelectedEdgeMetadata();
    await flushRuntime();

    const edge = state.modelEdges.find((item) => item.id === 'edge-can-multi-channel');
    expect(edge.signalChannels).toHaveLength(2);
    expect(edge.signalChannels[0]).toMatchObject({
      signalId: 'imu.pitch_rate',
      channelId: 'CAN-FC-01',
      messageId: '0x184',
      payloadKind: 'float32'
    });
    expect(edge.signalChannels[1]).toMatchObject({
      signalId: 'imu.temperature',
      channelId: 'CAN-FC-IMU',
      messageId: '0x185',
      payloadKind: 'uint16'
    });

    wrapper.unmount();
  });

  it('adds and edits multiple edge diagnostic test points from the edge property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('simulation_block', 180, 220);
    const target = window.createNode('instrument_scope', 480, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    source.props.name = 'Source controller';
    target.props.name = 'Output scope';
    source.faultSlots = [
      {
        slotId: 'electrical:output:torque',
        slotName: 'Torque output',
        layer: 'electrical',
        allowedFaultTypeIds: ['source_bias', 'source_noise']
      }
    ];
    state.activeModelPackage = {
      modelId: 'testpoint-config-package',
      faultTypeCatalog: [
        { id: 'source_bias', name: 'Source bias', layer: 'electrical' },
        { id: 'source_noise', name: 'Source noise', layer: 'electrical' },
        { id: 'target_fault', name: 'Target fault', layer: 'electrical' }
      ],
      faultLibrary: [
        { id: 'source_bias', name: 'Source bias', layer: 'electrical' },
        { id: 'source_noise', name: 'Source noise', layer: 'electrical' },
        { id: 'target_fault', name: 'Target fault', layer: 'electrical' }
      ],
      faultCapabilityMap: [
        {
          targetKind: 'node',
          targetId: source.id,
          faultSlots: source.faultSlots
        }
      ]
    };
    state.modelEdges.push({
      id: 'edge-source-scope-testpoint',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalId: 'controller.output'
    });
    window.renderModelNodes();
    window.renderEdges();
    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();

    expect(visiblePropertyTabs()).toContain('testpoints');
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();

    expect(document.querySelector('[data-edge-testpoint-panel]')).not.toBeNull();
    expect(document.querySelector('[data-add-edge-testpoint]')).not.toBeNull();
    expect(document.querySelector('[data-edge-testpoint-fault="target_fault"]')).toBeNull();

    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();

    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();

    const cards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('[data-edge-testpoint-fault="source_bias"]')).toBeNull();
    expect(cards[0].querySelector('[data-edge-testpoint-fault="source_noise"]')).toBeNull();
    expect(cards[0].querySelector('[data-edge-testpoint-fault="target_fault"]')).toBeNull();
    expect(cards[0].querySelector('[data-edge-testpoint-fault-list]')).not.toBeNull();
    expect(cards[1].querySelector('[data-edge-testpoint-fault-list]')).not.toBeNull();
    expect(cards[0].querySelector('[data-delete-edge-testpoint]')).not.toBeNull();
    expect(cards[1].querySelector('[data-delete-edge-testpoint]')).not.toBeNull();

    expect(window.activateFaultForTarget(source, 'source_bias').ok).toBe(true);
    expect(window.activateFaultForTarget(source, 'source_noise').ok).toBe(true);
    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();

    const injectedCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    expect(injectedCards[0].querySelector('[data-edge-testpoint-component]')).not.toBeNull();
    expect(injectedCards[0].querySelector('[data-edge-testpoint-component]')?.textContent).toContain('Source controller');
    expect(injectedCards[0].querySelector('[data-edge-testpoint-component] [data-edge-testpoint-fault="source_bias"]')).not.toBeNull();
    expect(injectedCards[0].querySelector('[data-edge-testpoint-component] [data-edge-testpoint-fault="source_noise"]')).not.toBeNull();
    expect(injectedCards[0].querySelector('[data-edge-testpoint-fault="target_fault"]')).toBeNull();

    const unrelated = window.createNode('simulation_block', 700, 360);
    unrelated.props.name = 'Unrelated injected module';
    state.faultInstances.push({
      instanceId: 'target-fault-instance',
      faultTypeId: 'target_fault',
      targetKind: 'node',
      targetId: unrelated.id,
      displayName: 'Target fault',
      active: true
    });
    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();

    const globallyInjectedCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    const componentGroups = Array.from(globallyInjectedCards[0].querySelectorAll('[data-edge-testpoint-component]'));
    expect(componentGroups.map((group) => group.getAttribute('data-edge-testpoint-component'))).toEqual([
      source.id,
      unrelated.id
    ]);
    expect(componentGroups[0].querySelector('[data-edge-testpoint-fault="source_bias"]')).not.toBeNull();
    expect(componentGroups[0].querySelector('[data-edge-testpoint-fault="source_noise"]')).not.toBeNull();
    expect(componentGroups[1].querySelector('[data-edge-testpoint-fault="target_fault"]')).not.toBeNull();

    globallyInjectedCards[0].querySelector('[data-edge-testpoint-name]').value = 'Controller output monitor A';
    globallyInjectedCards[0].querySelector('[data-edge-testpoint-name]').dispatchEvent(new Event('input', { bubbles: true }));
    globallyInjectedCards[0].querySelector('[data-edge-testpoint-fault="source_bias"]').checked = true;
    globallyInjectedCards[0].querySelector('[data-edge-testpoint-fault="source_bias"]').dispatchEvent(new Event('change', { bubbles: true }));
    globallyInjectedCards[0].querySelector('[data-save-edge-testpoint]').click();
    await flushRuntime();

    expect(document.querySelector('.props-panel-shell--edge[data-props-panel-shell="true"]')).not.toBeNull();
    const afterFirstSaveCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    const afterFirstSaveSelections = Array.from(afterFirstSaveCards[0].querySelectorAll('[data-edge-testpoint-fault]'))
      .filter((input) => input.checked)
      .map((input) => input.getAttribute('data-edge-testpoint-fault'));
    expect(afterFirstSaveSelections).toEqual(['source_bias']);
    expect(afterFirstSaveCards[0].querySelector('[data-save-edge-testpoint]')?.closest('.props-panel-shell--edge')).not.toBeNull();

    const refreshedCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    refreshedCards[1].querySelector('[data-edge-testpoint-name]').value = 'Controller output monitor B';
    refreshedCards[1].querySelector('[data-edge-testpoint-name]').dispatchEvent(new Event('input', { bubbles: true }));
    refreshedCards[1].querySelector('[data-edge-testpoint-fault="source_noise"]').checked = true;
    refreshedCards[1].querySelector('[data-edge-testpoint-fault="source_noise"]').dispatchEvent(new Event('change', { bubbles: true }));
    refreshedCards[1].querySelector('[data-save-edge-testpoint]').click();
    await flushRuntime();

    const points = state.manualDiagnosticTestPoints.filter((item) => item.edgeId === 'edge-source-scope-testpoint');
    expect(points).toHaveLength(2);
    expect(points.map((point) => point.name)).toEqual([
      'Controller output monitor A',
      'Controller output monitor B'
    ]);
    expect(points.map((point) => point.detects)).toEqual([
      ['source_bias'],
      ['source_noise']
    ]);
    expect(new Set(points.map((point) => point.pointId)).size).toBe(2);

    const diagnosticPositions = window.buildDiagnosticTestPointModel().positions
      .filter((item) => item.edgeId === 'edge-source-scope-testpoint');
    expect(diagnosticPositions).toHaveLength(2);
    expect(diagnosticPositions.map((point) => point.name)).toEqual([
      'Controller output monitor A',
      'Controller output monitor B'
    ]);

    window.setCanvasView('components');
    await flushRuntime();
    expect(document.getElementById('simulation-panel')?.textContent).toContain('Controller output monitor A');
    expect(document.getElementById('simulation-panel')?.textContent).toContain('Controller output monitor B');

    window.setCanvasView('dataflow');
    await flushRuntime();
    expect(document.getElementById('dataflow-panel')?.textContent).toContain('Controller output monitor A');
    expect(document.getElementById('dataflow-panel')?.textContent).toContain('Controller output monitor B');

    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    document.querySelector('[data-edge-testpoint-card] [data-delete-edge-testpoint]').click();
    await flushRuntime();

    const remainingPoints = state.manualDiagnosticTestPoints.filter((item) => item.edgeId === 'edge-source-scope-testpoint');
    expect(remainingPoints).toHaveLength(1);
    expect(remainingPoints[0]).toMatchObject({
      name: 'Controller output monitor B',
      detects: ['source_noise']
    });

    const remainingCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    expect(remainingCards).toHaveLength(1);
    expect(remainingCards[0].querySelector('[data-edge-testpoint-name]').value).toBe('Controller output monitor B');
    expect(window.buildDiagnosticTestPointModel().positions
      .filter((item) => item.edgeId === 'edge-source-scope-testpoint')).toHaveLength(1);

    wrapper.unmount();
  });


  it('rejects component fault injection when the fault name already exists', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const first = window.createNode('simulation_block', 180, 220);
    const second = window.createNode('simulation_block', 480, 220);
    await flushRuntime();

    first.faultSlots = [
      { slotId: 'electrical:first', layer: 'electrical', allowedFaultTypeIds: ['first_fault'] }
    ];
    second.faultSlots = [
      { slotId: 'electrical:second', layer: 'electrical', allowedFaultTypeIds: ['second_fault'] }
    ];
    window.__GZ_STATE__.activeModelPackage = {
      modelId: 'duplicate-fault-name-package',
      faultTypeCatalog: [
        { id: 'first_fault', name: 'Repeated display fault', displayName: 'Repeated display fault', layer: 'electrical' },
        { id: 'second_fault', name: 'Repeated display fault', displayName: 'Repeated display fault', layer: 'electrical' }
      ],
      faultCapabilityMap: [
        { targetKind: 'node', targetId: first.id, faultSlots: first.faultSlots },
        { targetKind: 'node', targetId: second.id, faultSlots: second.faultSlots }
      ]
    };

    const firstResult = window.activateFaultForTarget(first, 'first_fault');
    const secondResult = window.activateFaultForTarget(second, 'second_fault');

    expect(firstResult).toMatchObject({ ok: true });
    expect(secondResult).toMatchObject({
      ok: false,
      error: 'duplicate-fault-name'
    });
    expect(window.__GZ_STATE__.faultInstances).toHaveLength(1);

    wrapper.unmount();
  });

  it('renders CAN edge inspector sections for route, channels, and faults', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 180, 220);
    window.createNode('simulation_block', 480, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const target = state.modelNodes.find((node) => node.type === 'simulation_block');
    state.modelEdges.push({
      id: 'edge-can-inspector',
      lineType: 'can',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      currentValue: 12.4,
      residualValue: 0.3,
      signalChannels: [
        {
          signalId: 'imu.pitch_rate',
          channelId: 'CAN-FC-01',
          messageId: '0x184',
          signalRole: 'primary',
          signalUnit: 'rad/s',
          payloadKind: 'float32',
          sampleRate: '100Hz',
          faultPropagationPolicy: 'propagates'
        },
        {
          signalId: 'imu.temperature',
          channelId: 'CAN-FC-IMU',
          messageId: '0x185',
          signalRole: 'secondary',
          signalUnit: 'degC',
          payloadKind: 'uint16',
          sampleRate: '10Hz',
          faultPropagationPolicy: 'localOnly'
        }
      ]
    });
    window.renderModelNodes();
    window.selectEdge('edge-can-inspector');
    await flushRuntime();

    const pd = () => document.getElementById('pd');

    expect(document.querySelector('[data-edge-overview]')).not.toBeNull();
    expect(document.querySelector('[data-edge-route]')).not.toBeNull();
    expect(document.querySelector('[data-edge-channel-count]')).not.toBeNull();
    expect(pd()?.textContent).toContain(source.id);
    expect(pd()?.textContent).toContain(target.id);
    expect(pd()?.textContent.toLowerCase()).toContain('can');
    expect(pd()?.textContent).toContain('imu.pitch_rate');
    expect(pd()?.textContent).toContain('imu.temperature');

    const edge = state.modelEdges.find((item) => item.id === 'edge-can-inspector');
    const parametersTab = document.querySelector('[data-props-tab="parameters"]');
    const outputsTab = document.querySelector('[data-props-tab="outputs"]');
    expect(parametersTab?.hidden).toBe(true);
    expect(outputsTab?.hidden).toBe(true);
    expect(document.querySelector('[data-edge-channel-list]')).toBeNull();
    expect(document.getElementById('prop-edge-signal-id')).toBeNull();

    edge.faultBindings = [
      {
        bindingId: 'edge-fault-can-delay',
        faultModelId: 'fm-can-delay',
        name: 'CAN delay',
        layer: 'protocol',
        propagationMode: 'protocolEdge',
        runtimeBehavior: 'delay',
        active: true,
        parameters: {
          latency: 0.025,
          dropRate: 0.12,
          burstLength: 4,
          affectedChannels: ['CAN-FC-02', 'CAN-FC-IMU']
        }
      }
    ];
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.querySelector('.props-protocol-action')).not.toBeNull();
    expect(document.querySelector('[data-fault-binding-id="edge-fault-can-delay"]')).not.toBeNull();
    expect(pd()?.textContent).toContain('delay');
    expect(pd()?.textContent).toContain('latency');
    expect(pd()?.textContent).toContain('dropRate');
    expect(pd()?.textContent).toContain('burstLength');

    wrapper.unmount();
  });


  it.skip('shows localized parameter empty states for single-channel edges', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 180, 220);
    window.createNode('simulation_block', 480, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const target = state.modelNodes.find((node) => node.type === 'simulation_block');
    state.modelEdges.push({
      id: 'edge-single-channel',
      lineType: 'can',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalId: 'imu.pitch_rate',
      channelId: 'CAN-FC-IMU',
      messageId: '0x184'
    });
    window.renderModelNodes();
    window.selectEdge('edge-single-channel');
    await flushRuntime();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    const panelText = document.getElementById('pd')?.textContent;
    expect(panelText).toContain('通道配置');
    expect(panelText).toContain('主通道');
    expect(panelText).toContain('可编辑');
    expect(panelText).toContain('暂无次级通道');
    expect(panelText).not.toContain('Channel configuration');
    expect(panelText).not.toContain('primary channel');
    expect(panelText).not.toContain('editable');
    expect(panelText).not.toContain('No secondary channels');
    ['涓', '鎸', '娴嬬', '浼犳', '鈫'].forEach((marker) => {
      expect(panelText).not.toContain(marker);
    });

    wrapper.unmount();
  });

  it('opens component authoring dialog from a custom event and displays parsed interfaces', async () => {
    const wrapper = await mountWorkbench();

    window.dispatchEvent(new CustomEvent('gz:open-component-authoring', {
      detail: {
        parsedInterface: {
          fileName: 'attitude_controller.py',
          moduleName: 'attitude_controller',
          description: '姿态控制器',
          entryFunction: 'process',
          inputs: [
            { name: 'attitude_error', displayName: '姿态误差', type: 'float' }
          ],
          outputs: [
            { name: 'output_0', displayName: '力矩指令', type: 'float' }
          ],
          middleVars: [],
          rawSource: 'def process(attitude_error): return attitude_error'
        }
      }
    }));
    await flushRuntime();

    const dialog = document.querySelector('[data-testid="component-authoring-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('姿态控制器');
    expect(dialog?.textContent).toContain('姿态误差');
    expect(dialog?.textContent).toContain('力矩指令');

    wrapper.unmount();
  });

  it('opens fault authoring dialog for a selected target slot', async () => {
    const wrapper = await mountWorkbench();

    window.dispatchEvent(new CustomEvent('gz:open-fault-authoring', {
      detail: {
        target: {
          targetKind: 'node',
          targetId: 'node-imu',
          targetName: 'IMU 陀螺仪反馈',
          slotId: 'gyro-feedback',
          slotName: '陀螺仪反馈信号'
        }
      }
    }));
    await flushRuntime();

    const dialog = document.querySelector('[data-testid="fault-authoring-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('IMU 陀螺仪反馈');
    expect(dialog?.textContent).toContain('陀螺仪反馈信号');
    expect(dialog?.textContent).toContain('故障名称');

    wrapper.unmount();
  });

  it('saves a newly authored component into the canvas and active model package', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    await flushRuntime();

    window.dispatchEvent(new CustomEvent('gz:open-component-authoring', {
      detail: {
        parsedInterface: {
          fileName: 'custom_attitude.py',
          moduleName: 'custom_attitude',
          description: '自定义姿态模块',
          entryFunction: 'process',
          inputs: [
            { name: 'pitch_error', displayName: '俯仰误差', type: 'float' }
          ],
          outputs: [
            { name: 'torque_cmd', displayName: '力矩指令', type: 'float' }
          ],
          middleVars: [
            { name: 'controller_state', displayName: '控制状态', type: 'float' }
          ],
          rawSource: 'def process(pitch_error): return pitch_error'
        }
      }
    }));
    await flushRuntime();

    setFieldValue('[data-authoring-component-name]', '自定义姿态控制器');
    setFieldValue('[data-authoring-slot-name]', '控制输出故障位');
    document.querySelector('[data-save-authored-component]').click();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const node = state.modelNodes.find((item) => item.props?.name === '自定义姿态控制器');

    expect(node).toMatchObject({
      type: 'simulation_block',
      props: expect.objectContaining({
        name: '自定义姿态控制器'
      })
    });
    expect(node.faultSlots).toEqual([
      expect.objectContaining({
        slotName: '控制输出故障位',
        signalId: 'custom_attitude.torque_cmd',
        allowedFaultTypeIds: []
      })
    ]);
    expect(state.activeModelPackage.systemModel.nodes.some((item) => item.id === node.id)).toBe(true);
    expect(state.activeModelPackage.componentTemplates.some((item) => item.templateId === node.templateId)).toBe(true);
    expect(state.activeModelPackage.faultCapabilityMap).toContainEqual(expect.objectContaining({
      targetKind: 'node',
      targetId: node.id,
      faultSlots: [
        expect.objectContaining({
          slotId: node.faultSlots[0].slotId,
          allowedFaultTypeIds: []
        })
      ]
    }));
    expect(document.querySelector('[data-testid="component-authoring-dialog"]')).toBeNull();

    wrapper.unmount();
  });

  it('saves a newly authored fault and exposes it as a compatible target fault', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    await flushRuntime();

    window.dispatchEvent(new CustomEvent('gz:open-component-authoring', {
      detail: {
        parsedInterface: {
          fileName: 'custom_imu.py',
          moduleName: 'custom_imu',
          description: '自定义 IMU 模块',
          entryFunction: 'process',
          inputs: [],
          outputs: [
            { name: 'pitch_rate', displayName: '俯仰角速度', type: 'float' }
          ],
          middleVars: [],
          rawSource: 'def process(): return 0'
        }
      }
    }));
    await flushRuntime();

    setFieldValue('[data-authoring-component-name]', '自定义 IMU');
    setFieldValue('[data-authoring-slot-name]', '陀螺仪反馈故障位');
    document.querySelector('[data-save-authored-component]').click();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const node = state.modelNodes.find((item) => item.props?.name === '自定义 IMU');
    const slot = node.faultSlots[0];

    window.dispatchEvent(new CustomEvent('gz:open-fault-authoring', {
      detail: {
        target: {
          targetKind: 'node',
          targetId: node.id,
          targetName: node.props.name,
          slotId: slot.slotId,
          slotName: slot.slotName
        }
      }
    }));
    await flushRuntime();

    setFieldValue('[data-authoring-fault-id]', 'custom_gyro_bias');
    setFieldValue('[data-authoring-fault-name]', '自定义陀螺仪偏置');
    setFieldValue('[data-authoring-fault-layer]', 'electrical', 'change');
    setFieldValue('[data-authoring-fault-behavior]', 'bias', 'change');
    setFieldValue('[data-authoring-param-name="bias"]', '0.18');
    document.querySelector('[data-save-authored-fault]').click();
    await flushRuntime();

    expect(state.activeModelPackage.faultTypeCatalog).toContainEqual(expect.objectContaining({
      id: 'custom_gyro_bias',
      displayName: '自定义陀螺仪偏置',
      runtimeBehavior: 'bias'
    }));
    expect(state.activeModelPackage.faultCapabilityMap.find((entry) => entry.targetId === node.id).faultSlots[0].allowedFaultTypeIds).toContain('custom_gyro_bias');

    const compatible = window.getCompatibleFaultModelsForTarget(node);
    expect(compatible.map((item) => item.id)).toContain('custom_gyro_bias');

    const dropResult = window.handleFaultComponentDrop({ target: node });
    await flushRuntime();

    expect(dropResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    expect(document.querySelector('[data-activate-compatible-fault="custom_gyro_bias"]')).toBeNull();
    expect(document.querySelector('[data-testid="fault-authoring-dialog"]')).toBeNull();

    wrapper.unmount();
  });

  it('shows target parameter display name for an injected fault tag instead of the internal variable key', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.type === 'simulation_block');
    block.props.name = '姿态控制器';
    block.props.modelParameters = [
      { key: 'controller_gain', name: '姿态控制增益', targetField: 'params.controller_gain' }
    ];
    block.faultSlots = [
      {
        slotId: 'physical:controller_gain',
        slotName: '姿态控制增益',
        layer: 'physical',
        variableKey: 'controller_gain',
        parameterKey: 'controller_gain',
        bindingObject: 'controller_gain',
        targetVariable: 'controller_gain',
        targetField: 'params.controller_gain'
      }
    ];
    state.faultTags = [
      {
        id: 'fault-tag-controller-gain',
        faultModelId: 'controller_gain_bias',
        name: '增益偏移故障',
        layer: 'physical',
        targetKind: 'node',
        targetId: block.id,
        targetName: block.props.name,
        slotId: 'physical:controller_gain',
        bindingObject: 'controller_gain',
        targetVariable: 'controller_gain',
        targetField: 'params.controller_gain',
        parameters: { bias: 0.1 }
      }
    ];
    block.injectedFault = {
      modelId: 'controller_gain_bias',
      name: '增益偏移故障',
      parameters: { bias: 0.1 }
    };
    block.faultBindings = [{
      bindingId: 'controller-gain-bias',
      faultModelId: 'controller_gain_bias',
      active: true,
      injectedFault: block.injectedFault
    }];
    state.selFaultTag = 'fault-tag-controller-gain';

    window.__GZ_RENDER_FAULT_TAG_PANEL__(state.faultTags[0]);
    await flushRuntime();

    expect(document.querySelector('.fault-tag-binding-card')?.textContent).toContain('姿态控制增益');
    expect(document.querySelector('.fault-tag-binding-card')?.textContent).not.toContain('controller_gain');
    expect(document.querySelector('.props-tab[data-props-tab="parameters"]')?.hidden).toBe(false);
    expect(document.getElementById('pd')?.textContent).not.toContain('故障参数');

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-fault-tag-enabled]')?.value).toBe('true');
    setFieldValue('[data-fault-tag-enabled]', 'false', 'change');
    await flushRuntime();

    expect(state.faultTags[0].runtimeEnabled).toBe(false);
    expect(block.faultBindings[0].active).toBe(false);
    expect(block.injectedFault.active).toBe(false);
    expect(state.faultTags).toHaveLength(1);

    wrapper.unmount();
  });

  it('opens and configures the digital multimeter from its property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const multimeter = window.createNode('instrument_multimeter', 420, 240);
    await flushRuntime();
    window.selectNode(multimeter.id);
    await flushRuntime();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    expect(document.getElementById('prop-name')).not.toBeNull();
    expect(document.getElementById('prop-measurementMode')).toBeNull();
    expect(document.getElementById('prop-range')).toBeNull();
    expect(document.getElementById('prop-refreshRate')).toBeNull();
    window.setPropertyPanelTab('overview');
    await flushRuntime();

    const openButton = document.querySelector('[data-multimeter-action="open"]');
    expect(openButton).not.toBeNull();
    expect(document.querySelector('[data-instrument-action="clear"]')).toBeNull();
    openButton.click();
    await flushRuntime();

    const meterWindow = document.querySelector('[data-multimeter-window]');
    expect(meterWindow).not.toBeNull();
    expect(meterWindow?.textContent).toContain('Digital Multimeter');
    expect(meterWindow?.parentElement?.id).toBe('multimeter-window-layer');
    expect(Number.parseFloat(meterWindow?.style.left || '0')).toBeGreaterThanOrEqual(multimeter.x);
    const initialLeft = meterWindow?.style.left;
    const initialTop = meterWindow?.style.top;
    dispatchPointer(meterWindow.querySelector('.multimeter-window__header'), 'pointerdown', { clientX: 20, clientY: 20 });
    dispatchPointer(document, 'pointermove', { clientX: 90, clientY: 70 });
    dispatchPointer(document, 'pointerup', { clientX: 90, clientY: 70 });
    expect(meterWindow?.style.left).not.toBe(initialLeft);

    const range = meterWindow?.querySelector('[data-multimeter-config="range"]');
    range.value = '20V';
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(multimeter.props.range).toBe('20V');
    expect(document.querySelector('[data-multimeter-window]')).not.toBeNull();

    document.querySelector('[data-multimeter-close]')?.click();
    await flushRuntime();
    expect(document.querySelector('[data-multimeter-window]')).toBeNull();

    window.openMultimeterInstrument(multimeter.id);
    await flushRuntime();
    expect(document.querySelector('[data-multimeter-window]')?.style.left).toBe(initialLeft);
    expect(document.querySelector('[data-multimeter-window]')?.style.top).toBe(initialTop);

    wrapper.unmount();
  });

  it('opens, moves, configures, and closes the spectrum analyzer window', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '64Hz';
    spectrum.props.fftSize = '64';
    spectrum.props.frequencyRange = '0-32Hz';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => ({
      t: index / 64,
      actual: Math.sin(2 * Math.PI * 4 * index / 64),
      reference: 0
    }));
    await flushRuntime();
    window.selectNode(spectrum.id);
    await flushRuntime();

    expect(document.getElementById('pd')?.textContent).not.toContain('频率范围');
    expect(document.getElementById('pd')?.textContent).not.toContain('FFT 点数');
    expect(document.getElementById('pd')?.textContent).not.toContain('窗函数');
    expect(document.querySelector('[data-instrument-action="clear"]')).toBeNull();
    expect(document.querySelector('[data-instrument-panel="spectrum"] .instrument-hero')).not.toBeNull();
    expect(document.querySelector('[data-instrument-panel="spectrum"] .instrument-spectrum-bars')).not.toBeNull();
    expect(document.querySelector('[data-instrument-panel="spectrum"] .instrument-metrics')).not.toBeNull();
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    ['sampleRate', 'frequencyRange', 'fftSize', 'windowFunction'].forEach((key) => {
      expect(document.getElementById(`prop-${key}`)).toBeNull();
    });
    window.setPropertyPanelTab('overview');
    await flushRuntime();

    const openButton = document.querySelector('[data-spectrum-action="open"]');
    expect(openButton).not.toBeNull();
    openButton.click();
    await flushRuntime();

    const spectrumWindow = document.querySelector('[data-spectrum-window]');
    expect(spectrumWindow).not.toBeNull();
    expect(spectrumWindow?.parentElement?.id).toBe('spectrum-window-layer');
    expect(spectrumWindow?.textContent).toContain('Spectrum Analyzer');
    expect(spectrumWindow?.dataset.spectrumFftSize).toBe('64');
    expect(spectrumWindow?.dataset.spectrumWindowFunction).toBe('rectangular');
    expect(spectrumWindow?.querySelector('[data-spectrum-peak-frequency]')?.textContent).toContain('4');
    expect(spectrumWindow?.querySelector('[data-spectrum-axis="x"]')?.textContent).toMatch(/32(?:\.0+)?Hz/);
    expect(spectrumWindow?.querySelector('[data-spectrum-axis="y"]')).not.toBeNull();
    expect(spectrumWindow?.textContent).toContain('频率（Hz）');
    expect(spectrumWindow?.textContent).toContain('电平（dB）');
    const initialLeft = spectrumWindow?.style.left;
    const initialTop = spectrumWindow?.style.top;
    dispatchPointer(spectrumWindow.querySelector('.spectrum-window__header'), 'pointerdown', { clientX: 20, clientY: 20 });
    dispatchPointer(document, 'pointermove', { clientX: 90, clientY: 70 });
    dispatchPointer(document, 'pointerup', { clientX: 90, clientY: 70 });
    expect(spectrumWindow?.style.left).not.toBe(initialLeft);

    const fftSize = spectrumWindow?.querySelector('[data-spectrum-config="fftSize"]');
    fftSize.value = '2048';
    fftSize.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.fftSize).toBe('2048');
    expect(document.querySelector('[data-spectrum-window]')?.dataset.spectrumFftSize).toBe('2048');

    const windowFunction = document.querySelector('[data-spectrum-config="windowFunction"]');
    windowFunction.value = 'Hamming';
    windowFunction.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')?.dataset.spectrumWindowFunction).toBe('hamming');

    const sampleRateValue = document.querySelector('[data-spectrum-config="sampleRateValue"]');
    const sampleRateUnit = document.querySelector('[data-spectrum-config="sampleRateUnit"]');
    expect(sampleRateValue?.value).toBe('64');
    expect(sampleRateUnit?.value).toBe('Hz');

    const frequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const frequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const frequencyRangeUnit = document.querySelector('[data-spectrum-config="frequencyRangeUnit"]');
    expect(frequencyRangeStart?.value).toBe('0');
    expect(frequencyRangeEnd?.value).toBe('32');
    frequencyRangeStart.value = '8';
    frequencyRangeEnd.value = '16';
    frequencyRangeUnit.value = 'Hz';
    frequencyRangeUnit.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('8-16Hz');
    const visibleFrequencies = Array.from(document.querySelectorAll('[data-spectrum-bin]'))
      .map((bin) => Number(bin.getAttribute('data-spectrum-frequency')));
    expect(visibleFrequencies.every((frequency) => frequency >= 8 && frequency <= 16)).toBe(true);

    const referenceLevel = document.querySelector('[data-spectrum-config="referenceLevel"]');
    referenceLevel.value = '20';
    referenceLevel.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.referenceLevel).toBe('20');
    expect(document.querySelector('[data-spectrum-axis="y"]')?.textContent).toContain('20');

    const traceMode = document.querySelector('[data-spectrum-config="traceMode"]');
    traceMode.value = 'Max Hold';
    traceMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.traceMode).toBe('Max Hold');

    document.querySelector('[data-spectrum-peak-search]')?.click();
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-marker]')?.textContent).not.toContain('--');

    document.querySelector('[data-spectrum-close]')?.click();
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')).toBeNull();

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')?.style.left).toBe(initialLeft);
    expect(document.querySelector('[data-spectrum-window]')?.style.top).toBe(initialTop);

    wrapper.unmount();
  });

  it('closes instrument floating windows when creating a blank workspace', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    window.selectNode(spectrum.id);
    await flushRuntime();
    document.querySelector('[data-spectrum-action="open"]')?.click();
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')).not.toBeNull();

    window.doCreateBlankWorkspace();
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')).toBeNull();
    expect(document.querySelector('[data-multimeter-window]')).toBeNull();

    wrapper.unmount();
  });

  it('records spectrum data when it is the only connected measurement instrument', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 260, 240);
    const spectrum = window.createNode('instrument_spectrum', 540, 240);
    source.props.waveType = '正弦';
    source.props.amplitude = '1';
    source.props.frequency = '1';
    spectrum.props.sampleRate = '10Hz';
    spectrum.props.frequencyRange = '0-5Hz';
    spectrum.props.fftSize = '64';
    const canvas = window.getActiveCanvasRecord();
    canvas.edges.push(window.makeTask5Edge(
      'normal',
      source.id,
      spectrum.id,
      0,
      0,
      window.getNodePorts(source).outputs[0],
      window.getNodePorts(spectrum).inputs[0],
      null
    ));
    window.renderEdges();
    await flushRuntime();

    window.simInit(true);
    for (let step = 0; step < 40; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const samples = window.__GZ_SIM__.actual.instrumentSamples[spectrum.id];
    expect(samples).toHaveLength(40);
    expect(samples.some((sample) => Math.abs(sample.actual) > 0.5)).toBe(true);
    expect(samples.every((sample) => !Object.hasOwn(sample, 'reference'))).toBe(true);
    expect(window.__GZ_SIM__.reference.instrumentSamples?.[spectrum.id]).toBeUndefined();
    window.selectNode(spectrum.id);
    await flushRuntime();
    expect(document.querySelector('[data-instrument-panel="spectrum"] [data-spectrum-empty]')).toBeNull();
    expect(document.querySelector('[data-instrument-panel="spectrum"] .instrument-count strong')?.textContent).toBe('40');
    const barHeights = Array.from(document.querySelectorAll('[data-instrument-panel="spectrum"] [data-spectrum-bin]'))
      .map((bar) => Number.parseInt(bar.style.height, 10));
    expect(Math.max(...barHeights)).toBeGreaterThan(Math.min(...barHeights));
    document.querySelector('[data-instrument-panel="spectrum"] [data-instrument-action="export"]')?.click();
    expect(window.__GZ_LAST_INSTRUMENT_EXPORT__.csv.split('\n')[0]).toBe('time,actual');

    wrapper.unmount();
  });

  it('keeps simulation component interfaces unchanged when saving the property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 300, 220);
    const original = JSON.parse(JSON.stringify({
      name: block.props.name,
      inputs: block.props.inputs,
      outputs: block.props.outputs,
      middleVars: block.props.middleVars
    }));
    await flushRuntime();

    window.selectNode(block.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.getElementById('prop-name')?.disabled).toBe(true);
    expect(document.getElementById('sim-input-count')?.disabled).toBe(true);
    expect(document.querySelector('[data-sim-field="name"]')?.disabled).toBe(true);
    expect(document.querySelector('[data-sim-field="type"]')?.disabled).toBe(true);

    setFieldValue('#prop-name', 'renamed');
    setFieldValue('[data-sim-field="name"]', 'changed-port');
    document.querySelector('.props-save').click();
    await flushRuntime();

    expect(block.props.name).toBe(original.name);
    expect(block.props.inputs).toEqual(original.inputs);
    expect(block.props.outputs).toEqual(original.outputs);
    expect(block.props.middleVars).toEqual(original.middleVars);

    wrapper.unmount();
  });
});
