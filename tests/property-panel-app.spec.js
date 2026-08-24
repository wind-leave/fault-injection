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

  it('shows module deletion only in the overview below execution mode and above model package status', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 220, 220);
    block.pythonBinding = {
      bound: true,
      fileName: 'controller.py',
      moduleName: 'controller',
      entryFunction: 'process',
      executionMode: 'mock',
      sourcePackageName: '测试模型包',
      portMapping: { inputs: [], outputs: [], middleVars: [] }
    };
    await flushRuntime();

    window.selectNode(block.id);
    await flushRuntime();

    const overviewDelete = document.querySelector('#pd .property-panel-overview-delete');
    const overviewContent = document.querySelector('#pd .props-panel-shell__content');
    const status = document.getElementById('model-package-status');
    const executionModeRow = Array.from(document.querySelectorAll('#pd .prow'))
      .find((row) => row.textContent.includes('执行模式'));

    expect(overviewDelete?.querySelector('.props-danger')?.textContent.trim()).toBe('删除模块');
    expect(overviewContent?.lastElementChild).toBe(overviewDelete);
    expect(executionModeRow?.compareDocumentPosition(overviewDelete) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('pd')?.nextElementSibling).toBe(status);

    for (const tab of ['parameters', 'faults']) {
      document.querySelector(`[data-props-tab="${tab}"]`).click();
      await flushRuntime();
      expect(document.querySelector('#pd .props-danger[onclick*="deleteSelectedNode"]')).toBeNull();
      expect(document.querySelector('#pd .property-panel-overview-delete')).toBeNull();
    }

    wrapper.unmount();
  });

  it('does not show a direct fault injection button for simulation or electrical components', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const simulation = window.createNode('rf_downconverter', 220, 220);
    const electrical = window.createNode('electrical_ac_power_source', 520, 220);
    await flushRuntime();

    for (const node of [simulation, electrical]) {
      window.selectNode(node.id);
      await flushRuntime();
      document.querySelector('[data-props-tab="faults"]').click();
      await flushRuntime();
      expect(document.querySelector('.props-fault-panel')).not.toBeNull();
      expect(document.querySelector('.props-fault-action')).toBeNull();
    }

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
    expect(outputAt(0.25e-9)).toBeCloseTo(1, 6);
    expect(outputAt(0.5e-9)).toBeCloseTo(0, 6);
    expect(outputAt(0.75e-9)).toBeCloseTo(-1, 6);

    source.props.modulation = 'am';
    source.props.centerFrequency = '1';
    source.props.centerFrequencyUnit = 'Hz';
    source.props.modulationDepth = '50';
    source.props.modulationRate = '1Hz';
    expect(outputAt(0.25)).toBeCloseTo(1.5, 6);

    source.props.modulation = 'fm';
    source.props.frequencyDeviation = '1Hz';
    expect(outputAt(0.25)).toBeCloseTo(Math.sin(Math.PI / 2 + 1), 6);

    source.props.modulation = 'pm';
    source.props.phaseDeviation = `${Math.PI / 2}`;
    expect(outputAt(0.25)).toBeCloseTo(0, 6);

    source.props.modulation = 'pulse';
    source.props.pulseWidth = '500';
    source.props.pulseWidthUnit = 'ms';
    source.props.pulsePeriod = '1';
    source.props.pulsePeriodUnit = 's';
    expect(outputAt(0.25)).toBeCloseTo(1, 6);
    expect(outputAt(0.75)).toBe(0);

    source.props.modulation = 'digital';
    source.props.bandwidth = '20Hz';
    source.props.symbolRate = '10Hz';
    source.props.sampleRate = '20Hz';
    expect(Math.abs(outputAt(0.25))).toBeCloseTo(1, 6);

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

    source.props.waveType = 'pulse';
    source.props.amplitude = '8';
    source.props.lowValue = '-1';
    source.props.frequency = '1';
    source.props.dutyCycle = '25';
    source.props.phase = '0';
    expect(outputAt(0.1)).toBe(8);
    expect(outputAt(0.5)).toBe(-1);

    wrapper.unmount();
  });

  it('outputs independently configurable RF vector values from the source runtime', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    source.props = {
      ...source.props,
      outputFormat: '向量',
      rfVectorLength: 3,
      rfVectorValues: '1, 0.5, -2',
      power: '10',
      centerFrequency: '1',
      centerFrequencyUnit: 'Hz'
    };

    const output = window.resolveNodeOutput(source.id, 0, 'actual', 0.25, 0.01, new Map(), new Set());
    expect(output).toEqual([1, 0.5, -2]);
    expect(window.getNodePorts(source).outputs[0]).toMatchObject({ dataType: 'vector', vectorLength: 3 });

    wrapper.unmount();
  });

  it('switches the RF property panel between batch and per-item vector configuration', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();
    window.selectNode(source.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    setFieldValue('#prop-outputFormat', '向量', 'change');
    await flushRuntime();
    expect(document.getElementById('prop-rfVectorLength')).not.toBeNull();
    expect(document.getElementById('prop-rfVectorValues')).not.toBeNull();

    setFieldValue('#prop-rfVectorLength', '3', 'change');
    await flushRuntime();
    setFieldValue('#prop-rfVectorConfigMode', 'item', 'change');
    await flushRuntime();
    const values = document.querySelectorAll('[data-rf-vector-value]');
    expect(values).toHaveLength(3);
    values[0].value = '1.2';
    values[1].value = '0.8';
    values[2].value = '0.4';
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({
      outputFormat: '向量',
      rfVectorLength: 3,
      rfVectorConfigMode: 'item',
      rfVectorValues: '1.2, 0.8, 0.4'
    });

    wrapper.unmount();
  });

  it('shows signal source definition and hides module status and canvas position for signal sources', async () => {
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
    expect(overviewLabels).not.toContain('模块状态');
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
    expect(document.querySelector(`#b-${source.id} .blk-lbl`)?.textContent.trim()).toBe('RF Test Source');

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

  it('only shows instrument vector-channel choices for connected vector ports', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('simulation_block', 180, 220);
    const scope = window.createNode('instrument_scope', 480, 180);
    const spectrum = window.createNode('instrument_spectrum', 480, 360);
    const state = window.__GZ_STATE__;
    source.props.outputs = [{ name: 'Control vector', type: '向量', vectorLength: 3 }];
    state.modelEdges.push({
      id: 'edge-vector-to-scope',
      sourceNodeId: source.id,
      targetNodeId: scope.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    state.modelEdges.push({
      id: 'edge-vector-to-spectrum',
      sourceNodeId: source.id,
      targetNodeId: spectrum.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    window.renderModelNodes();

    window.selectNode(scope.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    expect(document.querySelector('[data-instrument-vector-measurement]')).not.toBeNull();
    const scopeSelector = document.querySelector('[data-instrument-vector-channel="vectorChannelCh1"]');
    expect(scopeSelector).not.toBeNull();
    expect(Array.from(scopeSelector.options).map((option) => option.value)).toEqual(['1', '2', '3']);
    scopeSelector.value = '3';
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(scope.props.vectorChannelCh1).toBe(3);

    window.selectNode(spectrum.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    const spectrumSelector = document.querySelector('[data-instrument-vector-channel="vectorChannel"]');
    expect(spectrumSelector).not.toBeNull();
    spectrumSelector.value = '2';
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(spectrum.props.vectorChannel).toBe(2);

    source.props.outputs = [{ name: 'Scalar output', type: '标量' }];
    window.renderModelNodes();
    window.selectNode(scope.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    expect(document.querySelector('[data-instrument-vector-measurement]')).toBeNull();

    wrapper.unmount();
  });

  it('saves editable display names for Python-bound simulation ports', async () => {
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
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(block.pythonBinding.portMapping.inputs[0].displayName).toBe('姿态误差');
    expect(block.pythonBinding.portMapping.outputs[0].displayName).toBe('执行器指令');
    expect(block.pythonBinding.portMapping.middleVars[0].displayName).toBe('积分量');
    expect(window.getNodePorts(block).inputs[0].label).toBe('姿态误差');
    expect(window.getNodePorts(block).outputs.map((port) => port.label)).toEqual(['执行器指令']);

    wrapper.unmount();
  });

  it('saves editable electrical component and port names', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const block = window.createNode('electrical_dc_boost', 320, 220);
    await flushRuntime();

    window.selectNode(block.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    setFieldValue('#prop-name', '可调直流升压器');
    setFieldValue('[data-python-port-display-name][data-python-port-kind="inputs"]', '电池母线');
    setFieldValue('[data-python-port-display-name][data-python-port-kind="outputs"]', '升压母线');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(block.props.name).toBe('可调直流升压器');
    expect(window.getNodePorts(block).inputs[0].label).toBe('电池母线');
    expect(window.getNodePorts(block).outputs[0].label).toBe('升压母线');

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

  it('rejects electrical fault binding to a line', async () => {
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

    expect(result).toMatchObject({ ok: false, reason: 'incompatible-layer' });
    expect(window.canBindLayeredFaultInjectorToTarget(injector.id, edge)).toBe(false);
    expect(window.resolveNodeOutput(gain.id, 0, 'actual', 0.25, 0.1, new Map(), new Set())).toBeCloseTo(1);

    wrapper.unmount();
  });

  it('opens the protocol fault binding dialog when a normal line is selected', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    const gain = window.createNode('simulation_block', 480, 220);
    gain.props.inputs = [{ name: '合力', type: '标量' }];
    const injector = window.createNode('protocol_fault_injector', 320, 420);
    const edge = {
      id: 'edge-protocol-normal',
      lineType: 'normal',
      signalId: 'normal_link_variable',
      sourceNodeId: source.id,
      targetNodeId: gain.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    };
    window.__GZ_STATE__.modelEdges.push(edge);
    window.renderModelNodes();
    await flushRuntime();

    expect(window.getLayeredFaultSlotsForTarget(edge)).toEqual([
      expect.objectContaining({
        layer: 'protocol',
        bindingObject: 'normal_link_variable'
      })
    ]);
    expect(window.canBindLayeredFaultInjectorToTarget(injector.id, edge)).toBe(true);
    expect(window.beginLayeredFaultBinding(injector.id)).toBe(true);
    await flushRuntime();

    const edgePath = document.querySelector(`.edge-path[data-edge-id="${edge.id}"]`);
    expect(edgePath).not.toBeNull();
    edgePath.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    const slotOptions = dialog.querySelectorAll('[data-layered-fault-option="slot"]');
    expect(slotOptions).toHaveLength(1);
    expect(slotOptions[0].textContent).toBe('合力');
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => option.dataset.layeredFaultOptionValue))
      .toEqual(['attenuation', 'data_cutoff']);
    expect(dialog.querySelector('[data-layered-fault-param="scale"]')).not.toBeNull();
    expect(dialog.querySelector('[data-layered-fault-param="start"]')).not.toBeNull();
    expect(dialog.querySelector('[data-layered-fault-param="duration"]')).not.toBeNull();
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

  it('selects individual RF vector channels in the electrical fault binding dialog', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('rf_four_channel_source', 360, 220);
    const injector = window.createNode('electrical_fault_injector', 160, 220);
    await flushRuntime();

    const slot = window.getLayeredFaultSlotsForTarget(source)
      .find((item) => item.layer === 'electrical' && item.bindingObject === 'rf_samples');
    expect(slot).toMatchObject({
      targetField: 'outputs.rf_samples',
      vectorLength: 4
    });

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${source.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('信号衰减');
    expect(dialog.textContent).toContain('数据通断');
    expect(dialog.querySelector('[data-layered-fault-vector-scope]')).toBeNull();
    expect(dialog.querySelector('[data-layered-fault-vector-index]')).toBeNull();
    expect(dialog.querySelectorAll('[data-layered-fault-vector-item]')).toHaveLength(4);
    const items = dialog.querySelectorAll('[data-layered-fault-vector-item]');
    items[0].checked = true;
    items[1].checked = false;
    items[2].checked = true;
    items[3].checked = false;
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: source.id,
      targetField: 'outputs.rf_samples',
      vectorInjectionScope: 'items',
      vectorIndices: [0, 2]
    }));
    expect(document.getElementById('pd')?.textContent).toContain('注入路数');
    expect(document.getElementById('pd')?.textContent).toContain('第 1、3 路');
    wrapper.unmount();
  });

  it('only lists the ports that exist on one-sided components for fault injection', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const outputOnly = window.createNode('simulation_block', 360, 180);
    outputOnly.props = {
      name: 'Output-only component',
      outputs: [{ name: 'result', varName: 'result', type: '标量' }]
    };
    const inputOnly = window.createNode('simulation_block', 360, 360);
    inputOnly.props = {
      name: 'Input-only component',
      inputs: [{ name: 'command', varName: 'command', type: '标量' }]
    };
    const injector = window.createNode('electrical_fault_injector', 160, 180);
    await flushRuntime();

    expect(window.getNodePorts(outputOnly)).toMatchObject({
      inputs: [],
      outputs: [expect.objectContaining({ label: expect.stringContaining('result') })]
    });
    expect(window.getLayeredFaultSlotsForTarget(outputOnly)
      .filter((slot) => slot.layer === 'electrical')
      .map((slot) => slot.variableRole)).toEqual(['output']);

    expect(window.getNodePorts(inputOnly)).toMatchObject({
      inputs: [expect.objectContaining({ label: expect.stringContaining('command') })],
      outputs: []
    });
    expect(window.getLayeredFaultSlotsForTarget(inputOnly)
      .filter((slot) => slot.layer === 'electrical')
      .map((slot) => slot.variableRole)).toEqual(['input']);

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${outputOnly.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog?.textContent).toContain('result');
    expect(dialog?.textContent).not.toContain('输入 1');
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
    expect(document.querySelector('[data-fault-slot-count]')?.textContent).toBe('1 / 1');

    setCheckboxValue('[data-fault-slot-layer="protocol"][data-fault-slot-var="frame_counter"]', false);
    expect(document.querySelector('[data-fault-slot-count]')?.textContent).toBe('0 / 1');
    setCheckboxValue('[data-fault-slot-layer="protocol"][data-fault-slot-var="frame_counter"]', true);
    expect(document.querySelector('[data-fault-slot-count]')?.textContent).toBe('1 / 1');

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

  it('defaults parameters to physical faults and inputs and outputs to electrical faults before a declaration is saved', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const block = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'simulation_block');
    block.props.parameters = [{ key: 'controller_gain', name: 'Controller gain' }];
    block.props.inputs = [{ key: 'command', name: 'Command' }];
    block.props.outputs = [{ key: 'torque', name: 'Torque' }];
    block.props.middleVars = [];
    delete block.props.faultInjection;
    block.faultSlots = [];

    window.selectNode(block.id);
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.querySelector('[data-fault-slot-layer="physical"][data-fault-slot-var="controller_gain"]')?.checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="command"]')?.checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="torque"]')?.checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="protocol"][data-fault-slot-var="command"]')).toBeNull();
    expect(document.querySelector('[data-fault-slot-layer="protocol"][data-fault-slot-var="torque"]')).toBeNull();
    expect(document.querySelector('[data-fault-slot-count]')?.textContent).toBe('3 / 3');

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
    source.props.outputs = [{ name: 'Control vector', type: '向量', vectorLength: 3 }];
    target.props.name = 'Output scope';
    source.faultSlots = [
      {
        slotId: 'electrical:output:torque',
        slotName: 'Torque output',
        layer: 'electrical',
        dataType: 'vector',
        vectorLength: 3,
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
    window.selectNode(source.id);
    await flushRuntime();
    expect(window.openTargetFaultActivationDialog()).toBe(true);
    document.querySelector('[data-activate-compatible-fault="source_bias"]').click();
    await flushRuntime();
    expect(document.querySelector('[data-fault-vector-scope]')).toBeNull();
    expect(document.querySelector('[data-fault-vector-index]')).toBeNull();
    expect(document.querySelectorAll('[data-fault-vector-item]')).toHaveLength(3);
    document.querySelector('[data-cancel-target-fault]').click();
    document.querySelector('[data-close-target-fault-dialog]').click();
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
    expect(cards.every((card) => card.querySelector('[data-edge-testpoint-type]')?.value === 'virtual')).toBe(true);
    const vectorOptions = Array.from(cards[0].querySelectorAll('[data-edge-testpoint-vector-index] option'));
    expect(vectorOptions.map((option) => option.value)).toEqual(['0', '1', '2']);
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

    const monitoredEdge = state.modelEdges.find((item) => item.id === 'edge-source-scope-testpoint');
    monitoredEdge.injectedFault = {
      modelId: 'bound_edge_protocol_fault',
      name: 'Bound edge protocol fault',
      layer: 'protocol',
      active: true
    };
    monitoredEdge.faultBindings = [{
      faultModelId: 'bound_edge_protocol_fault',
      layer: 'protocol',
      active: true,
      injectedFault: monitoredEdge.injectedFault
    }];
    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    expect(document.querySelector('[data-edge-testpoint-fault="bound_edge_protocol_fault"]')).not.toBeNull();

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
    unrelated.injectedFault = {
      modelId: 'target_fault',
      name: 'Target fault',
      layer: 'electrical',
      active: true
    };
    unrelated.faultBindings = [{
      faultModelId: 'target_fault',
      layer: 'electrical',
      active: true,
      injectedFault: unrelated.injectedFault
    }];
    state.faultInstances.push({
      instanceId: 'orphan-edge-protocol-fault',
      faultTypeId: 'orphan_edge_protocol_fault',
      targetKind: 'edge',
      targetId: 'edge-source-scope-testpoint',
      displayName: 'Orphan edge protocol fault',
      layer: 'protocol',
      active: true
    });
    window.selectEdge('edge-source-scope-testpoint');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();

    const globallyInjectedCards = Array.from(document.querySelectorAll('[data-edge-testpoint-card]'));
    const componentGroups = Array.from(globallyInjectedCards[0].querySelectorAll('[data-edge-testpoint-component]'));
    expect(componentGroups.map((group) => group.getAttribute('data-edge-testpoint-component'))).toEqual(expect.arrayContaining([
      source.id,
      monitoredEdge.id,
      unrelated.id
    ]));
    expect(componentGroups[0].querySelector('[data-edge-testpoint-fault="source_bias"]')).not.toBeNull();
    expect(componentGroups[0].querySelector('[data-edge-testpoint-fault="source_noise"]')).not.toBeNull();
    expect(globallyInjectedCards[0].querySelector('[data-edge-testpoint-fault="bound_edge_protocol_fault"]')).not.toBeNull();
    expect(globallyInjectedCards[0].querySelector('[data-edge-testpoint-fault="target_fault"]')).not.toBeNull();
    expect(globallyInjectedCards[0].querySelector('[data-edge-testpoint-fault="orphan_edge_protocol_fault"]')).toBeNull();

    globallyInjectedCards[0].querySelector('[data-edge-testpoint-name]').value = 'Controller output monitor A';
    globallyInjectedCards[0].querySelector('[data-edge-testpoint-name]').dispatchEvent(new Event('input', { bubbles: true }));
    globallyInjectedCards[0].querySelector('[data-edge-testpoint-vector-index]').value = '2';
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
    expect(points.map((point) => point.vectorIndex)).toEqual([2, 0]);
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

    window.setCanvasView('dmatrix');
    await flushRuntime();
    const matrixEnabled = document.querySelector('[data-d-matrix-fault-enabled="controller_gain_bias"]');
    expect(matrixEnabled?.type).toBe('checkbox');
    expect(matrixEnabled?.checked).toBe(false);
    matrixEnabled.checked = true;
    matrixEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(state.faultTags[0].runtimeEnabled).toBe(true);
    expect(block.faultBindings[0].active).toBe(true);
    expect(block.injectedFault.active).toBe(true);
    expect(document.querySelector('[data-fault-tag-enabled]')?.value).toBe('true');

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

  it('opens independently configured sixteen-column display consoles from the property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 240);
    const displayConsole = window.createNode('display_console_1', 420, 240);
    const secondDisplayConsole = window.createNode('display_console_2', 720, 240);
    await flushRuntime();
    expect(displayConsole).toMatchObject({ type: 'display_console', templateId: 'display_console_1' });
    expect(secondDisplayConsole).toMatchObject({ type: 'display_console', templateId: 'display_console_2' });
    displayConsole.props.displayConfig.columns[0].label = '台 1 序号';
    expect(secondDisplayConsole.props.displayConfig.columns[0].label).toBe('序号');
    window.selectNode(displayConsole.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="faults"]')?.hidden).toBe(true);
    expect(document.querySelector('[data-props-tab="outputs"]')?.hidden).toBe(true);
    expect(window.getNodePorts(displayConsole).inputs).toEqual([
      expect.objectContaining({ label: '中心频率（MHz） / float', meta: expect.objectContaining({ type: 'float' }) }),
      expect.objectContaining({ label: '重复周期（μs） / float', meta: expect.objectContaining({ type: 'float' }) }),
      expect.objectContaining({ label: '脉宽（μs） / float', meta: expect.objectContaining({ type: 'float' }) }),
      expect.objectContaining({ label: '幅度 / float', meta: expect.objectContaining({ type: 'float' }) })
    ]);
    expect(document.querySelector('[data-display-console-configuration]')).not.toBeNull();
    document.querySelector(`[data-open-display-console="${displayConsole.id}"]`)?.click();
    await flushRuntime();

    const panel = document.querySelector(`[data-display-console-panel="${displayConsole.id}"]`);
    expect(panel).not.toBeNull();
    expect(panel?.parentElement?.id).toBe('display-console-window-layer');
    expect(panel?.style.left).toBe(`${displayConsole.x + displayConsole.w + 16}px`);
    expect(panel?.style.top).toBe(`${displayConsole.y}px`);
    expect(panel?.querySelectorAll('th')).toHaveLength(16);
    expect(panel?.querySelectorAll('tbody td')).toHaveLength(16);
    expect(panel?.textContent).toContain('中心频率（MHz）');
    expect(panel?.textContent).toContain('重复周期（μs）');
    expect(panel?.textContent).toContain('脉宽（μs）');
    expect(panel?.textContent).toContain('幅度');

    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-source-console',
      sourceNodeId: source.id,
      sourcePortIndex: 0,
      targetNodeId: displayConsole.id,
      targetPortIndex: 0
    });
    window.__GZ_STATE__.modelEdges.push(
      {
        id: 'edge-period-console',
        sourceNodeId: source.id,
        sourcePortIndex: 0,
        targetNodeId: displayConsole.id,
        targetPortIndex: 1
      },
      {
        id: 'edge-width-console',
        sourceNodeId: source.id,
        sourcePortIndex: 0,
        targetNodeId: displayConsole.id,
        targetPortIndex: 2
      }
    );
    window.__GZ_SIM__.actual.edgeStates = {
      'edge-source-console': { lastOutput: 12.5e6 },
      'edge-period-console': { lastOutput: 2e-6 },
      'edge-width-console': { lastOutput: 0.5e-6 }
    };
    window.refreshDisplayConsolePanel();
    const initialCells = panel?.querySelectorAll('[data-display-console-table] tbody td');
    expect(initialCells?.[1]?.textContent).toBe('12.5');
    expect(initialCells?.[2]?.textContent).toBe('2');
    expect(initialCells?.[3]?.textContent).toBe('0.5');
    window.__GZ_SIM__.actual.edgeStates['edge-source-console'].lastOutput = 25e6;
    window.refreshDisplayConsolePanel();
    expect(panel?.querySelector('[data-display-console-table] tbody')?.textContent).toContain('25');

    const dragHeader = panel?.querySelector('.display-console-window__header');
    dragHeader?.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 640,
      clientY: 260,
      button: 0
    }));
    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 700,
      clientY: 300
    }));
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(panel?.style.left).toBe(`${displayConsole.x + displayConsole.w + 76}px`);
    expect(panel?.style.top).toBe(`${displayConsole.y + 40}px`);

    panel?.querySelector('.display-console-window__close')?.click();
    await flushRuntime();
    expect(document.querySelector('[data-display-console-panel]')).toBeNull();

    const downconverter = window.createNode('rf_downconverter', 980, 420);
    window.openDisplayConsolePanel(secondDisplayConsole.id);
    await flushRuntime();
    const controlPanel = document.querySelector(`[data-display-console-panel="${secondDisplayConsole.id}"]`);
    expect(controlPanel?.querySelector('[data-display-console-controls]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-control-target]')?.value).toBe(downconverter.id);
    expect(controlPanel?.querySelector('[data-display-console-mode-switch="input_mode"]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-parameter="input_mode"]')?.getAttribute('type')).toBe('hidden');
    expect(controlPanel?.querySelector('[data-display-console-parameter="lo_frequency_hz"]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-parameter="sample_1"]')).toBeNull();
    controlPanel.querySelector('[data-display-console-mode-select="2"]')?.click();
    expect(controlPanel.querySelector('[data-display-console-parameter="input_mode"]')?.value).toBe('2');
    expect(controlPanel.querySelector('[data-display-console-mode-select="2"]')?.classList.contains('is-active')).toBe(true);
    controlPanel.querySelector('[data-display-console-parameter="lo_frequency_hz"]').value = '980';
    controlPanel.querySelector('[data-display-console-parameter-unit="lo_frequency_hz"]').value = 'MHz';
    controlPanel.querySelector('[data-display-console-apply]')?.click();
    await flushRuntime();
    expect(downconverter.props.parameterValues.lo_frequency_hz).toBe(980000000);
    expect(downconverter.props.parameterValues.input_mode).toBe(2);
    expect(downconverter.props.parameterUnits.lo_frequency_hz).toBe('MHz');
    expect(window.__GZ_SIM__.inited).toBe(false);

    window.closeDisplayConsolePanel();
    window.selectNode(downconverter.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    const modeOne = document.querySelector('[data-simulation-parameter-mode-select="1"]');
    const modeTwo = document.querySelector('[data-simulation-parameter-mode-select="2"]');
    expect(modeOne).not.toBeNull();
    expect(modeTwo?.classList.contains('is-active')).toBe(true);
    modeOne?.click();
    expect(modeOne?.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('[data-simulation-parameter="input_mode"]')?.value).toBe('1');
    document.querySelector('[data-property-save-node]')?.click();
    await flushRuntime();
    expect(downconverter.props.parameterValues.input_mode).toBe(1);

    wrapper.unmount();
  });

  it('saves the complete four-input display-console time series', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sources = Array.from({ length: 4 }, (_, index) => window.createNode('signal_source', 180, 160 + index * 90));
    const displayConsole = window.createNode('display_console_1', 520, 260);
    window.__GZ_STATE__.modelEdges.push(...sources.map((source, index) => ({
      id: `edge-console-${index + 1}`,
      sourceNodeId: source.id,
      sourcePortIndex: 0,
      targetNodeId: displayConsole.id,
      targetPortIndex: index
    })));
    window.__GZ_SIM__.componentOutputs = {
      time: [0, 0.1, 0.2],
      steps: [0, 0.1, 0.2].map((time, stepIndex) => ({
        time,
        actual: Object.fromEntries(sources.map((source, inputIndex) => [
          source.id,
          { output: (inputIndex + 1) * 100 + stepIndex }
        ])),
        reference: {}
      }))
    };

    const result = await window.buildSimulationResultSnapshot();
    const savedConsole = result.publicData.renderData.devices.find((device) => device.id === displayConsole.id);

    expect(savedConsole).toMatchObject({
      type: 'display_console',
      channels: {
        centerFrequency: { inputIndex: 0, connected: true, displayScale: 1e-6 },
        repetitionPeriod: { inputIndex: 1, connected: true, displayScale: 1e6 },
        pulseWidth: { inputIndex: 2, connected: true, displayScale: 1e6 },
        amplitude: { inputIndex: 3, connected: true, displayScale: 1 }
      }
    });
    expect(savedConsole.channels.centerFrequency.series).toEqual([
      { t: 0, value: 100 },
      { t: 0.1, value: 101 },
      { t: 0.2, value: 102 }
    ]);
    expect(savedConsole.channels.amplitude.series).toEqual([
      { t: 0, value: 400 },
      { t: 0.1, value: 401 },
      { t: 0.2, value: 402 }
    ]);

    wrapper.unmount();
  });

  it('saves display-console applied parameters with backend and display units', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const displayConsole = window.createNode('display_console_1', 520, 260);
    const controlled = window.createNode('rf_four_output_source', 220, 260);
    controlled.props.parameterValues = {
      ...controlled.props.parameterValues,
      center_frequency_hz: 250000000,
      pulse_width_seconds: 0.000002,
      pulse_period_seconds: 0.00001
    };
    controlled.props.parameterUnits = {
      center_frequency_hz: 'MHz'
    };
    displayConsole.props.controlTargetId = controlled.id;

    const result = await window.buildSimulationResultSnapshot();
    const savedConsole = result.publicData.renderData.devices.find((device) => device.id === displayConsole.id);

    expect(savedConsole.controlState).toEqual({
      targetComponentId: controlled.id,
      targetComponentName: controlled.props.name,
      componentType: 'rf_four_output_source',
      parameters: [
        {
          key: 'center_frequency_hz',
          name: expect.any(String),
          value: 250000000,
          unit: 'Hz',
          displayValue: 250,
          displayUnit: 'MHz'
        },
        {
          key: 'pulse_width_seconds',
          name: expect.any(String),
          value: 0.000002,
          unit: 's',
          displayValue: 0.000002,
          displayUnit: 's'
        },
        {
          key: 'pulse_period_seconds',
          name: expect.any(String),
          value: 0.00001,
          unit: 's',
          displayValue: 0.00001,
          displayUnit: 's'
        }
      ]
    });

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
    spectrum.props.markerFrequency = '4';
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
    expect(spectrumWindow?.querySelector('.spectrum-window__trace')).not.toBeNull();
    expect(spectrumWindow?.querySelector('.spectrum-window__bar')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-peak-frequency]')?.textContent).toBe('4.0000Hz');
    expect(spectrumWindow?.querySelector('[data-spectrum-marker]')?.textContent).toMatch(/^4\.0000Hz\s*\//);
    expect(spectrumWindow?.querySelector('[data-spectrum-axis="x"]')?.textContent).toMatch(/32(?:\.0+)?Hz/);
    expect(Array.from(spectrumWindow?.querySelectorAll('[data-spectrum-bin]') ?? [])
      .some((bin) => Number(bin.getAttribute('data-spectrum-frequency')) === 0)).toBe(true);
    expect(spectrumWindow?.querySelector('[data-spectrum-axis="y"]')).not.toBeNull();
    expect(spectrumWindow?.textContent).toContain('频率（Hz）');
    expect(spectrumWindow?.textContent).toContain('功率（dBm）');
    const initialLeft = spectrumWindow?.style.left;
    const initialTop = spectrumWindow?.style.top;
    dispatchPointer(spectrumWindow.querySelector('.spectrum-window__header'), 'pointerdown', { clientX: 20, clientY: 20 });
    dispatchPointer(document, 'pointermove', { clientX: 90, clientY: 70 });
    dispatchPointer(document, 'pointerup', { clientX: 90, clientY: 70 });
    expect(spectrumWindow?.style.left).not.toBe(initialLeft);

    expect(spectrumWindow?.querySelector('[data-spectrum-config="fftSize"]')).toBeNull();
    expect(spectrumWindow?.textContent).toContain('显示与量程');
    expect(spectrumWindow?.querySelector('[data-spectrum-config="attenuation"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-config="preamp"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-config="markerFrequency"]')).toBeNull();

    const editableSampleRate = spectrumWindow?.querySelector('[data-spectrum-config="sampleRateValue"]');
    window.__GZ_SIM__.running = true;
    editableSampleRate?.focus();
    editableSampleRate.value = '63';
    window.renderSpectrumInstrument();
    expect(document.activeElement).toBe(editableSampleRate);
    expect(document.querySelector('[data-spectrum-config="sampleRateValue"]')?.value).toBe('63');
    window.__GZ_SIM__.running = false;

    const windowFunction = document.querySelector('[data-spectrum-config="windowFunction"]');
    expect(windowFunction?.tagName).toBe('SELECT');
    expect(Array.from(windowFunction?.options||[]).map((option) => option.value)).toEqual(['Hann', 'Hamming', 'Blackman', 'Rectangular']);
    windowFunction.value = 'Hamming';
    windowFunction.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')?.dataset.spectrumWindowFunction).toBe('hamming');

    const sampleRateValue = document.querySelector('[data-spectrum-config="sampleRateValue"]');
    const sampleRateUnit = document.querySelector('[data-spectrum-config="sampleRateUnit"]');
    expect(sampleRateValue?.value).toBe('64');
    expect(sampleRateUnit?.value).toBe('Hz');
    expect(Array.from(sampleRateUnit?.options ?? []).map((option) => option.value)).toContain('GHz');
    expect(spectrumWindow?.textContent).toContain('RBW (MHz)');
    expect(spectrumWindow?.textContent).toContain('VBW (MHz)');

    const frequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const frequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const frequencyRangeUnit = document.querySelector('[data-spectrum-config="frequencyRangeUnit"]');
    const autoFrequencyRange = document.querySelector('[data-spectrum-config="autoFrequencyRange"]');
    expect(autoFrequencyRange?.value).toBe('on');
    expect(frequencyRangeStart?.disabled).toBe(true);
    expect(Array.from(frequencyRangeUnit?.options ?? []).map((option) => option.value)).toContain('GHz');
    autoFrequencyRange.value = 'off';
    autoFrequencyRange.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const editableFrequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const editableFrequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const editableFrequencyRangeUnit = document.querySelector('[data-spectrum-config="frequencyRangeUnit"]');
    expect(editableFrequencyRangeStart?.disabled).toBe(false);
    expect(editableFrequencyRangeStart?.value).toBe('0');
    expect(editableFrequencyRangeEnd?.value).toBe('32');
    const tuningMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    tuningMode.value = 'centerSpan';
    tuningMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-config="frequencyRangeStart"]')).toBeNull();
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('16');
    expect(document.querySelector('[data-spectrum-config="frequencySpan"]')?.value).toBe('32');
    const centerFrequency = document.querySelector('[data-spectrum-config="centerFrequency"]');
    const frequencySpan = document.querySelector('[data-spectrum-config="frequencySpan"]');
    const centerSpanUnit = document.querySelector('[data-spectrum-config="centerSpanUnit"]');
    centerFrequency.value = '12';
    frequencySpan.value = '8';
    centerSpanUnit.value = 'Hz';
    centerSpanUnit.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('8-16Hz');
    expect(document.querySelector('[data-spectrum-axis="x"]')?.textContent).toMatch(/8(?:\.0+)?Hz/);
    const startStopMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    startStopMode.value = 'startStop';
    startStopMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const restoredFrequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const restoredFrequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const restoredFrequencyRangeUnit = document.querySelector('[data-spectrum-config="frequencyRangeUnit"]');
    restoredFrequencyRangeStart.value = '8';
    restoredFrequencyRangeEnd.value = '16';
    restoredFrequencyRangeUnit.value = 'Hz';
    restoredFrequencyRangeUnit.dispatchEvent(new Event('change', { bubbles: true }));
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

    const dynamicRange = document.querySelector('[data-spectrum-config="dynamicRange"]');
    dynamicRange.value = '60';
    dynamicRange.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.dynamicRange).toBe('60');

    const autoRange = document.querySelector('[data-spectrum-config="autoRange"]');
    autoRange.value = 'on';
    autoRange.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.autoRange).toBe('on');

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

  it('keeps a narrowband peak visible when a manual spectrum range is wide', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '1kHz';
    spectrum.props.fftSize = '1024';
    spectrum.props.frequencyRange = '0-500Hz';
    spectrum.props.autoFrequencyRange = 'off';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 1024 }, (_, index) => ({
      t: index / 1000,
      actual: Math.sin(2 * Math.PI * 10 * index / 1000)
    }));

    window.selectNode(spectrum.id);
    await flushRuntime();
    document.querySelector('[data-spectrum-action="open"]')?.click();
    await flushRuntime();

    const spectrumWindow = document.querySelector('[data-spectrum-window]');
    expect(spectrumWindow?.querySelector('[data-spectrum-peak-frequency]')?.textContent).toContain('9.77');
    const visibleFrequencies = Array.from(spectrumWindow?.querySelectorAll('[data-spectrum-bin]') ?? [])
      .map((bin) => Number(bin.getAttribute('data-spectrum-frequency')));
    expect(visibleFrequencies).toHaveLength(128);
    expect(visibleFrequencies.some((frequency) => Math.abs(frequency - 9.765625) < 1e-6)).toBe(true);
    wrapper.unmount();
  });

  it('formats spectrum peak and marker frequency in the selected range unit', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '64GHz';
    spectrum.props.fftSize = '64';
    spectrum.props.frequencyRange = '0-32GHz';
    spectrum.props.autoFrequencyRange = 'off';
    spectrum.props.windowFunction = 'Rectangular';
    spectrum.props.markerFrequency = String(4e9);
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => ({
      t: index / 64000000000,
      actual: Math.sin(2 * Math.PI * 4 * index / 64)
    }));

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    expect(document.querySelector('[data-spectrum-peak-frequency]')?.textContent).toBe('4.0000GHz');
    expect(document.querySelector('[data-spectrum-marker]')?.textContent).toMatch(/^4\.0000GHz\s*\//);
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

  it('saves editable simulation component and port names from the property panel', async () => {
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

    expect(document.getElementById('prop-name')?.disabled).toBe(false);
    expect(document.getElementById('sim-input-count')?.disabled).toBe(false);
    expect(document.querySelector('[data-sim-field="name"]')?.disabled).toBe(false);
    expect(document.querySelector('[data-sim-field="type"]')?.disabled).toBe(false);

    setFieldValue('#prop-name', 'renamed');
    setFieldValue('[data-sim-field="name"]', 'changed-port');
    document.querySelector('.props-save').click();
    await flushRuntime();

    expect(block.props.name).toBe('renamed');
    expect(block.props.inputs[0].name).toBe('changed-port');
    expect(block.props.outputs).toEqual(original.outputs);
    expect(block.props.middleVars).toEqual(original.middleVars);

    wrapper.unmount();
  });
});
