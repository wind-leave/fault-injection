import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests, restoreStoredWorkbench } from '../src/services/legacyRuntimeBootstrap.js';

const noiseOptions = [['gaussian_noise', '独立高斯噪声'], ['uniform_white_noise', '均匀分布白噪声'], ['gaussian_colored_noise', '高斯有色噪声']];
const noiseTypes = noiseOptions.map(([id]) => id);

function chooseFaultCategory(dialog, category = dialog?.textContent.includes('物理层注入') ? 'state' : 'analog') {
  if (!dialog) return;
  const select = dialog.querySelector('[data-layered-fault-category]');
  select.value = category;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

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

  it('shows a fault injection button for simulation and electrical components', async () => {
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
      expect(document.querySelector('.props-fault-action')?.textContent).toBe('注入故障');
    }

    wrapper.unmount();
  });

  it.each([
    ['electrical', '电气层', 'bias', 'bias', 'outputs.torque'],
    ['physical', '物理层', 'step', 'targetValue', 'params.gain']
  ])('selects the %s fault page from the component inspector and confirms its binding', async (layer, label, model, parameter, targetField) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 320, 240);
    block.props.name = '姿态控制组件';
    block.props.modelParameters = [{ key: 'gain', name: '控制增益', targetField: 'params.gain' }];
    block.props.outputs = [{ key: 'torque', name: '力矩指令', type: '标量' }];
    block.props.faultInjection = { physical: ['gain'], electrical: ['torque'], protocol: [] };
    window.selectNode(block.id);
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const nodesBefore = [...state.modelNodes];
    document.querySelector('[data-open-property-fault-dialog]').click();
    await flushRuntime();

    let chooser = document.querySelector('[data-component-fault-layer-dialog]');
    expect(chooser).not.toBeNull();
    expect(chooser.textContent).toContain('姿态控制组件');
    expect([...chooser.querySelectorAll('[data-component-fault-layer]')]
      .map((button) => [button.textContent.trim().split('\n')[0], button.disabled]))
      .toEqual([['电气层故障', false], ['物理层故障', false]]);
    expect(state.faultInstances || []).toHaveLength(0);
    chooser.querySelector('[data-component-fault-layer-close]').click();
    expect(document.querySelector('[data-component-fault-layer-dialog]')).toBeNull();
    expect(state.modelNodes).toEqual(nodesBefore);

    document.querySelector('[data-open-property-fault-dialog]').click();
    chooser = document.querySelector('[data-component-fault-layer-dialog]');
    chooser.querySelector(`[data-component-fault-layer="${layer}"]`).click();
    await flushRuntime();

    expect(document.querySelector('[data-component-fault-layer-dialog]')).toBeNull();
    let dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog.textContent).toContain(`${label}注入`);
    expect(dialog.textContent).toContain('姿态控制组件');
    expect(dialog.querySelector('[data-layered-fault-model]').value).toBe(model);
    expect(state.modelNodes).toEqual(nodesBefore);
    expect(state.faultInstances || []).toHaveLength(0);
    dialog.querySelector('[data-layered-fault-cancel]').click();
    expect(document.querySelector('[data-layered-fault-binding-dialog]')).toBeNull();
    expect(state.faultInstances || []).toHaveLength(0);
    expect(state.modelNodes).toEqual(nodesBefore);

    document.querySelector('[data-open-property-fault-dialog]').click();
    document.querySelector(`[data-component-fault-layer="${layer}"]`).click();
    dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    dialog.querySelector(`[data-layered-fault-param="${parameter}"]`).value = '0.5';
    dialog.querySelector('[data-layered-fault-param="start"]').value = '1';
    dialog.querySelector('[data-layered-fault-param="duration"]').value = '2';
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(document.querySelector('[data-layered-fault-binding-dialog]')).toBeNull();
    expect(state.modelNodes).toEqual(nodesBefore);
    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetKind: 'node', targetId: block.id, layer, runtimeBehavior: model, targetField,
      parameters: expect.objectContaining({ [parameter]: 0.5, start: 1, duration: 2 })
    }));
    expect(block.faultBindings).toHaveLength(1);
    expect(state.faultTags).toContainEqual(expect.objectContaining({ targetId: block.id, layer }));
    wrapper.unmount();
  });

  it('disables undeclared component fault layers and enables them after slots are saved', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const block = window.createNode('simulation_block', 320, 240);
    block.props.modelParameters = [{ key: 'gain', name: '控制增益' }];
    block.props.outputs = [{ key: 'torque', name: '力矩指令', type: '标量' }];
    block.props.faultInjection = { physical: [], electrical: ['torque'], protocol: [] };
    window.selectNode(block.id);
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    document.querySelector('[data-open-property-fault-dialog]').click();
    expect(document.querySelector('[data-component-fault-layer="physical"]').disabled).toBe(true);
    expect(document.querySelector('[data-component-fault-layer="electrical"]').disabled).toBe(false);
    expect(document.querySelector('[data-component-fault-layer="physical"]').textContent).toContain('请先配置并保存故障槽位');
    document.querySelector('[data-component-fault-layer-close]').click();
    setCheckboxValue('[data-fault-slot-layer="physical"][data-fault-slot-var="gain"]', true);
    document.querySelector('[data-save-fault-slots]').click();
    await flushRuntime();

    document.querySelector('[data-open-property-fault-dialog]').click();
    expect(document.querySelector('[data-component-fault-layer="physical"]').disabled).toBe(false);
    document.querySelector('[data-component-fault-layer="physical"]').click();
    expect(document.querySelector('[data-layered-fault-physical-slot]')?.value).toBe('physical:gain');
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
    expect(document.getElementById('prop-power')).toMatchObject({ type: 'number', min: '', step: 'any' });

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

  it('keeps the testpoint editor rendered when an enum diagnostic condition exists on the canvas', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('rf_downconverter', 180, 220);
    const target = window.createNode('instrument_scope', 520, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const edge = {
      id: 'edge-enum-condition-testpoint',
      lineType: 'normal',
      sourceNodeId: source.id,
      sourcePortIndex: 0,
      targetNodeId: target.id,
      targetPortIndex: 0
    };
    state.modelEdges.push(edge);
    state.diagnosticTestPoints = [{
      id: 'tp-enum-condition',
      pointId: 'tp-enum-condition',
      edgeId: edge.id,
      name: '变频输出测点',
      pointType: 'physical'
    }];
    window.renderModelNodes();
    window.renderEdges();
    window.selectEdge(edge.id);
    await flushRuntime();

    window.setPropertyPanelTab('testpoints');
    await flushRuntime();

    expect(document.querySelector('[data-edge-testpoint-panel]')).not.toBeNull();
    expect(document.querySelector('[data-edge-testpoint-card]')).not.toBeNull();
    expect(document.querySelector('[data-edge-testpoint-condition]')).not.toBeNull();
    expect(document.getElementById('pd')?.textContent).toContain('影响检测能力的参数');
    expect(document.getElementById('pd')?.textContent).not.toContain('当前连线可注入协议层故障。');

    wrapper.unmount();
  });

  it('exports unique simulation module IDs as device and connection IDs', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const filter = window.createNode('DZDK_A', 180, 220);
    const limiter = window.createNode('DZDK_B', 480, 220);
    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-filter-limiter',
      lineType: 'normal',
      sourceNodeId: filter.id,
      sourcePortIndex: 0,
      targetNodeId: limiter.id,
      targetPortIndex: 0
    });
    await flushRuntime();

    const result = await window.buildSimulationResultSnapshot();
    const devices = result.publicData.renderData.devices;

    expect(devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'DZDK_A' }),
      expect.objectContaining({ id: 'DZDK_B' })
    ]));
    expect(result.publicData.renderData.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'edge-filter-limiter',
        sourceDeviceId: 'DZDK_A',
        targetDeviceId: 'DZDK_B'
      })
    ]));

    wrapper.unmount();
  });

  it('enables and saves RF pulse width and repetition period after pulse modulation is selected', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();
    window.selectNode(source.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.getElementById('prop-pulseWidth')).toBeNull();
    setFieldValue('#prop-modulation', 'pulse', 'change');
    await flushRuntime();

    expect(document.getElementById('prop-pulseWidth')).not.toBeNull();
    expect(document.getElementById('prop-pulsePeriod')).not.toBeNull();
    setFieldValue('#prop-pulseWidth', '250');
    setFieldValue('#prop-pulseWidthUnit', 'μs', 'change');
    setFieldValue('#prop-pulsePeriod', '1');
    setFieldValue('#prop-pulsePeriodUnit', 'ms', 'change');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({
      modulation: 'pulse',
      pulseWidth: '250',
      pulseWidthUnit: 'μs',
      pulsePeriod: '1',
      pulsePeriodUnit: 'ms'
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

    source.props.modulation = '脉冲调制';
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

  it('configures a complex-envelope vector with one shared RF configuration', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();
    window.selectNode(source.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    setFieldValue('#prop-outputFormat', '复数包络', 'change');
    await flushRuntime();
    expect(document.getElementById('prop-rfComplexEnvelopeMode')?.value).toBe('scalar');
    expect(document.getElementById('prop-rfVectorLength')).toBeNull();
    setFieldValue('#prop-rfComplexEnvelopeMode', 'vector', 'change');
    await flushRuntime();
    expect(document.getElementById('prop-rfVectorLength')).not.toBeNull();
    expect(document.getElementById('prop-rfVectorConfigMode')).toBeNull();
    expect(document.getElementById('prop-rfVectorValues')).toBeNull();
    expect(document.querySelectorAll('[data-rf-vector-value]')).toHaveLength(0);

    setFieldValue('#prop-rfVectorLength', '32', 'change');
    await flushRuntime();
    setFieldValue('#prop-centerFrequency', '20');
    setFieldValue('#prop-pulseWidth', '1');
    setFieldValue('#prop-pulsePeriod', '10');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({
      outputFormat: '复数包络', rfComplexEnvelopeMode: 'vector', rfVectorLength: 32,
      centerFrequency: '20', pulseWidth: '1', pulsePeriod: '10'
    });
    expect(window.getNodePorts(source).outputs[0]).toMatchObject({
      dataType: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 32
    });
    const output = window.resolveNodeOutput(source.id, 0, 'actual', 0, 0.01, new Map(), new Set());
    expect(output).toHaveLength(32);
    expect(output[0]).toMatchObject({ i: expect.any(Number), q: expect.any(Number), referenceFrequencyHz: 20e9 });
    expect(output[1]).toEqual(output[0]);
    expect(output[1]).not.toBe(output[0]);
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

  it('edits RF component and output port IDs without breaking a connection', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    const target = window.createNode('flow_block', 500, 220);
    await flushRuntime();
    window.handlePortClick({ stopPropagation() {} }, source.id, 'output', 0);
    window.handlePortClick({ stopPropagation() {} }, target.id, 'input', 0);
    await flushRuntime();
    const edge = window.__GZ_STATE__.modelEdges[0];
    expect(edge?.sourceNodeId).toBe(source.id);

    window.selectNode(source.id);
    await flushRuntime();
    expect(document.getElementById('prop-componentId')?.value).toBe(source.id);
    setFieldValue('#prop-componentId', 'rf-source-32');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(source.id).toBe('rf-source-32');
    expect(window.__GZ_STATE__.selBlk).toBe('rf-source-32');
    expect(edge.sourceNodeId).toBe('rf-source-32');
    expect(document.getElementById('b-rf-source-32')).not.toBeNull();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    expect(document.getElementById('prop-outputPortId')?.value).toBe('signal');
    setFieldValue('#prop-outputPortId', 'rf.out');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(source.props.outputPortId).toBe('rf.out');
    expect(window.getNodePorts(source).outputs[0].portId).toBe('rf.out');
    expect(edge.sourcePortMeta.portId).toBe('rf.out');
    expect(edge.sourcePort.portId).toBe('rf.out');
    expect(edge.sourceNodeId).toBe(source.id);
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
    source.props.outputs = [{
      name: 'Control vector', type: '向量', vectorLength: 3,
      vectorElementNames: ['横滚指令', '俯仰指令', '偏航指令']
    }];
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
    expect(Array.from(scopeSelector.options).map((option) => option.textContent)).toEqual(['横滚指令', '俯仰指令', '偏航指令']);
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
        inputs: [{
          varName: 'error', displayName: '误差', type: 'vector', vectorLength: 3,
          vectorElementNames: ['横滚误差', '俯仰误差', '偏航误差'], connected: false
        }, {
          varName: 'mode', displayName: '模式输入', type: 'float', elementNames: ['输入模式'], connected: false
        }],
        outputs: [{
          varName: 'command', displayName: '控制指令', type: 'vector', vectorLength: 4,
          vectorElementNames: ['副翼', '升降舵', '方向舵', '油门']
        }, {
          varName: 'status', displayName: '状态输出', type: 'float', elementNames: ['输出状态']
        }],
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
    expect(Array.from(inputPortCard?.querySelectorAll('[data-python-port-vector-element-name]') || []).map((element) => element.value)).toEqual(['横滚误差', '俯仰误差', '偏航误差']);
    setFieldValue('[data-python-port-display-name][data-python-port-kind="inputs"]', '姿态误差');
    setFieldValue('[data-python-port-display-name][data-python-port-kind="outputs"]', '执行器指令');
    setFieldValue('[data-python-port-vector-element-name][data-python-port-kind="inputs"][data-python-port-vector-element-index="1"]', '俯仰角误差');
    setFieldValue('[data-python-port-vector-element-name][data-python-port-kind="outputs"][data-python-port-vector-element-index="3"]', '发动机推力');
    setFieldValue('[data-python-port-scalar-element-name][data-python-port-kind="inputs"][data-python-port-index="1"]', '工作模式');
    setFieldValue('[data-python-port-scalar-element-name][data-python-port-kind="outputs"][data-python-port-index="1"]', '运行状态');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(block.pythonBinding.portMapping.inputs[0].displayName).toBe('姿态误差');
    expect(block.pythonBinding.portMapping.outputs[0].displayName).toBe('执行器指令');
    expect(block.pythonBinding.portMapping.inputs[0].vectorElementNames).toEqual(['横滚误差', '俯仰角误差', '偏航误差']);
    expect(block.pythonBinding.portMapping.outputs[0].vectorElementNames).toEqual(['副翼', '升降舵', '方向舵', '发动机推力']);
    expect(block.pythonBinding.portMapping.inputs[1].elementNames).toEqual(['工作模式']);
    expect(block.pythonBinding.portMapping.outputs[1].elementNames).toEqual(['运行状态']);
    expect(block.pythonBinding.portMapping.middleVars[0].displayName).toBe('积分量');
    expect(window.getNodePorts(block).inputs[0].label).toBe('姿态误差');
    expect(window.getNodePorts(block).outputs.map((port) => port.label)).toEqual(['执行器指令', '状态输出']);
    expect(window.getNodePorts(block).outputs[0].meta.vectorElementNames).toEqual(['副翼', '升降舵', '方向舵', '发动机推力']);
    expect(window.getNodePorts(block).outputs[1].meta.elementNames).toEqual(['运行状态']);

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
    const sensor = window.createNode('simulation_block', 360, 220);
    sensor.props.modelParameters = [
      { key: 'bias', name: 'Bias', targetField: 'params.bias' },
      { key: 'scale', name: 'Scale', targetField: 'params.scale' }
    ];
    const injector = window.createNode('physical_fault_injector', 160, 220);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: sensor.id,
      slotId: 'physical:parameter:bias',
      mathModel: 'step',
      parameters: { targetValue: 0.5, start: 0, duration: '' }
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

  it.each([
    ['step', '状态突变', ['targetValue', 'start', 'duration'], 'parameter_step'],
    ['freeze', '信号阻塞', ['start', 'duration'], 'parameter_freeze'],
    ['intermittent', '间歇故障', ['value', 'period', 'duty', 'start', 'duration'], 'intermittent']
  ])('offers the three state fault modes on the physical page and binds %s with its own parameters', async (model, label, fields, executableType) => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sensor = window.createNode('simulation_block', 360, 220);
    sensor.props.modelParameters = [{ key: 'scale', name: 'Scale', targetField: 'params.scale' }];
    const injector = window.createNode('physical_fault_injector', 160, 220);
    await flushRuntime();

    expect(window.beginLayeredFaultBinding(injector.id)).toBe(true);
    document.querySelector(`#b-${sensor.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog).not.toBeNull();
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => [option.dataset.layeredFaultOptionValue, option.textContent]))
      .toEqual([['step', '状态突变'], ['freeze', '信号阻塞'], ['intermittent', '间歇故障']]);
    expect(dialog.textContent).toContain('故障类型');
    expect(dialog.querySelector('[data-layered-fault-model]')?.value).toBe('step');
    dialog.querySelector(`[data-layered-fault-option="model"][data-layered-fault-option-value="${model}"]`).click();
    expect(dialog.querySelector('[data-layered-fault-dropdown-label="model"]').textContent).toBe(label);
    expect([...dialog.querySelectorAll('[data-layered-fault-param]')].map((input) => input.dataset.layeredFaultParam)).toEqual(fields);
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: sensor.id, layer: 'physical', runtimeBehavior: model, targetField: 'params.scale'
    }));
    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(window.__GZ_STATE__);
    expect(pkg.faultInstances).toContainEqual(expect.objectContaining({ faultType: executableType, targetId: sensor.id }));
    wrapper.unmount();
  });

  it('selects an I/Q envelope route from the spectrum analyzer property panel', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('simulation_block', 180, 220);
    const spectrum = window.createNode('instrument_spectrum', 480, 220);
    const state = window.__GZ_STATE__;
    source.props.outputs = [{
      name: 'I/Q 向量', type: '复数包络', dataType: 'rf_complex_envelope',
      vectorLength: 3, vectorElementNames: ['目标 1', '目标 2', '目标 3']
    }];
    state.modelEdges.push({
      id: 'edge-complex-vector-to-spectrum',
      sourceNodeId: source.id,
      targetNodeId: spectrum.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    window.renderModelNodes();

    window.selectNode(spectrum.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(window.getInstrumentVectorMeasurements(spectrum)).toHaveLength(1);
    const selector = document.querySelector('[data-instrument-vector-channel="vectorChannel"]');
    expect(selector).not.toBeNull();
    expect(Array.from(selector.options).map((option) => option.value)).toEqual(['1', '2', '3']);
    selector.value = '2';
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();
    expect(spectrum.props.vectorChannel).toBe(2);

    wrapper.unmount();
  });

  it('binds one physical fault instance to multiple component parameters', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sensor = window.createNode('simulation_block', 360, 220);
    sensor.props.modelParameters = [
      { key: 'bias', name: 'Bias', targetField: 'params.bias' },
      { key: 'scale', name: 'Scale', targetField: 'params.scale' }
    ];
    const injector = window.createNode('physical_fault_injector', 160, 220);
    await flushRuntime();

    const slots = window.getLayeredFaultSlotsForTarget(sensor)
      .filter((slot) => slot.layer === 'physical')
      .slice(0, 2);
    expect(slots).toHaveLength(2);

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: sensor.id,
      slotId: slots[0].id,
      slotIds: slots.map((slot) => slot.id),
      mathModel: 'step',
      parameters: { targetValue: 0.5, start: 0, duration: '' }
    });

    expect(result.ok).toBe(true);
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: sensor.id,
      slotId: slots[0].id,
      slotIds: slots.map((slot) => slot.id),
      targetFields: slots.map((slot) => slot.targetField),
      parameterKeys: slots.map((slot) => slot.parameterKey),
      parameters: expect.objectContaining({ targetValue: 0.5 })
    }));

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

  it('accepts negative dBm values for an RF signal source', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    window.selectNode(source.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    setFieldValue('#prop-power', '-30');
    document.querySelector('[data-property-save-node]').click();
    await flushRuntime();

    expect(source.props).toMatchObject({ power: '-30', powerUnit: 'dBm' });
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
    chooseFaultCategory(dialog);
    expect(dialog).not.toBeNull();
    const slotOptions = dialog.querySelectorAll('[data-layered-fault-option="slot"]');
    expect(slotOptions).toHaveLength(1);
    expect(slotOptions[0].textContent).toBe('合力');
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => option.dataset.layeredFaultOptionValue))
      .toEqual(['bias', 'freeze', 'drift', 'step']);
    expect(dialog.querySelector('[data-layered-fault-param="bias"]')).not.toBeNull();
    expect(dialog.querySelector('[data-layered-fault-param="start"]')).not.toBeNull();
    expect(dialog.querySelector('[data-layered-fault-param="duration"]')).not.toBeNull();
    wrapper.unmount();
  });

  it.each([
    ['normal', 'bias', 'bias'],
    ['can', 'freeze', null],
    ['normal', 'drift', 'rate'],
    ['can', 'step', 'targetValue']
  ])('opens the shared protocol binding page from the %s edge inspector and binds %s', async (lineType, mathModel, parameter) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    const sink = window.createNode('simulation_block', 480, 220);
    sink.props.inputs = [{ name: '控制指令', type: '标量' }];
    const state = window.__GZ_STATE__;
    const edge = {
      id: `edge-inspector-${lineType}`,
      label: '控制指令链路',
      lineType,
      signalId: 'control.command',
      sourceNodeId: source.id,
      targetNodeId: sink.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    };
    state.modelEdges.push(edge);
    window.renderModelNodes();
    window.selectEdge(edge.id);
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    const nodesBefore = [...state.modelNodes];
    expect(document.querySelector('.props-protocol-action').getAttribute('onclick')).toBe('window.openProtocolFaultImport()');
    window.openProtocolFaultImport();
    await flushRuntime();

    let dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('协议层注入');
    expect(dialog.textContent).toContain('控制指令链路');
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => option.dataset.layeredFaultOptionValue)).toEqual(['bias', 'freeze', 'drift', 'step']);
    expect(dialog.textContent).toContain('故障类型');
    expect(dialog.textContent).not.toContain('衰减模型');
    expect(dialog.textContent).not.toContain('通断模型');
    expect(document.getElementById('ov-proto').classList.contains('open')).toBe(false);
    expect(state.modelNodes).toEqual(nodesBefore);
    expect(edge.faultBindings || []).toHaveLength(0);

    dialog.querySelector('[data-layered-fault-cancel]').click();
    await flushRuntime();
    expect(document.querySelector('[data-layered-fault-binding-dialog]')).toBeNull();
    expect(state.modelNodes).toEqual(nodesBefore);
    expect(edge.faultBindings || []).toHaveLength(0);
    expect(state.faultInstances || []).toHaveLength(0);
    expect(state.selEdge).toBe(edge.id);

    window.openProtocolFaultImport();
    await flushRuntime();
    dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    dialog.querySelector(`[data-layered-fault-option="model"][data-layered-fault-option-value="${mathModel}"]`).click();
    dialog.querySelector('[data-layered-fault-param="start"]').value = '1';
    dialog.querySelector('[data-layered-fault-param="duration"]').value = '2';
    if (parameter) dialog.querySelector(`[data-layered-fault-param="${parameter}"]`).value = '0.25';
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(document.querySelector('[data-layered-fault-binding-dialog]')).toBeNull();
    expect(state.modelNodes).toEqual(nodesBefore);
    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetKind: 'edge',
      targetId: edge.id,
      layer: 'protocol',
      runtimeBehavior: mathModel,
      parameters: expect.objectContaining({ start: 1, duration: 2, ...(parameter ? { [parameter]: 0.25 } : {}) })
    }));
    expect(edge.faultBindings).toHaveLength(1);
    expect(state.faultTags).toContainEqual(expect.objectContaining({ targetId: edge.id, layer: 'protocol' }));
    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(pkg.faultInstances).toContainEqual(expect.objectContaining({ targetId: edge.id,
      faultType: { bias: 'sensor_bias', freeze: 'signal_stuck', drift: 'parameter_drift', step: 'parameter_step' }[mathModel] }));
    wrapper.unmount();
  });

  it('applies a protocol-edge fault to a complete vector payload', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('rf_four_channel_source', 180, 220);
    const sink = window.createNode('simulation_block', 520, 220);
    sink.props.inputs = [{ name: '四路指令', type: '向量', dataType: 'vector', vectorLength: 4 }];
    const injector = window.createNode('protocol_fault_injector', 320, 420);
    const edge = {
      id: 'edge-protocol-vector',
      lineType: 'normal',
      signalId: 'rf.command',
      sourceNodeId: source.id,
      targetNodeId: sink.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    };
    window.__GZ_STATE__.modelEdges.push(edge);
    window.renderModelNodes();
    await flushRuntime();

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`.edge-path[data-edge-id="${edge.id}"]`)
      .dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog.querySelectorAll('[data-layered-fault-vector-item]')).toHaveLength(0);
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetKind: 'edge',
      targetId: edge.id
    }));
    expect(window.__GZ_STATE__.faultInstances.find((item) => item.targetId === edge.id))
      .not.toHaveProperty('vectorInjectionScope');
    wrapper.unmount();
  });

  it.each([
    ['bias', '偏差', ['bias', 'start', 'duration'], 'sensor_bias'],
    ['freeze', '卡位', ['start', 'duration'], 'signal_stuck'],
    ['drift', '渐变', ['rate', 'start', 'duration'], 'parameter_drift'],
    ['step', '突变', ['targetValue', 'start', 'duration'], 'parameter_step']
  ])('retains the electrical fault types and exports %s with its own parameters', async (model, label, fields, executableType) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const sensor = window.createNode('simulation_block', 360, 220);
    sensor.props.outputs = [{ key: 'torque', name: '力矩指令', type: '标量' }];
    sensor.props.faultInjection = { physical: [], electrical: ['torque'], protocol: [] };
    const injector = window.createNode('electrical_fault_injector', 160, 220);
    await flushRuntime();
    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${sensor.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => [option.dataset.layeredFaultOptionValue, option.textContent]))
      .toEqual([['bias', '偏差'], ['freeze', '卡位'], ['drift', '渐变'], ['step', '突变']]);
    expect(dialog.textContent).toContain('故障类型');
    expect(dialog.querySelector('[data-layered-fault-model]').value).toBe('bias');
    dialog.querySelector(`[data-layered-fault-option="model"][data-layered-fault-option-value="${model}"]`).click();
    expect(dialog.querySelector('[data-layered-fault-dropdown-label="model"]').textContent).toBe(label);
    expect([...dialog.querySelectorAll('[data-layered-fault-param]')].map((input) => input.dataset.layeredFaultParam)).toEqual(fields);
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: sensor.id, targetField: 'outputs.torque', layer: 'electrical', runtimeBehavior: model
    }));
    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(window.__GZ_STATE__);
    expect(pkg.faultInstances).toContainEqual(expect.objectContaining({
      targetId: sensor.id, targetField: 'outputs.torque', faultType: executableType
    }));
    wrapper.unmount();
  });

  it.each(['electrical', 'protocol'].flatMap((layer) => noiseOptions.map(([type, label]) => [layer, type, label])))
  ('configures additive %s %s on an existing target and exports the exact noise type', async (layer, type, label) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('simulation_block', 180, 220);
    source.props.outputs = [{ key: 'torque', name: '力矩指令', type: '标量' }];
    source.props.faultInjection = { physical: [], electrical: [{ key: 'torque', allowedModels: ['bias', 'freeze', 'drift', 'step'] }], protocol: [] };
    const sink = window.createNode('simulation_block', 480, 220);
    const edge = { id: 'existing-noise-edge', sourceNodeId: source.id, targetNodeId: sink.id, sourcePortIndex: 0, targetPortIndex: 0, lineType: 'normal',
      faultSlots: [{ layer: 'protocol', allowedModels: ['attenuation', 'data_cutoff'] }] };
    const state = window.__GZ_STATE__;
    state.modelEdges.push(edge);
    window.renderModelNodes();
    if (layer === 'electrical') {
      window.selectNode(source.id);
      window.setPropertyPanelTab('faults');
      document.querySelector('[data-open-property-fault-dialog]').click();
      document.querySelector('[data-component-fault-layer="electrical"]').click();
    } else {
      window.selectEdge(edge.id);
      window.openProtocolFaultImport();
    }
    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog.querySelectorAll('[data-layered-fault-option="model"]')).toHaveLength(4);
    setCheckboxValue('[data-layered-noise-enabled]', true);
    setFieldValue('[data-layered-noise-type]', type, 'change');
    expect(dialog.querySelector('[data-noise-additive-help]').textContent).toContain('在故障结果上叠加噪声');
    const noiseHost = dialog.querySelector('[data-layered-noise-params]');
    expect(noiseHost.querySelector('[data-layered-fault-param="seed"]')).not.toBeNull();
    expect(noiseHost.querySelector('[data-layered-fault-param="alpha"]') !== null).toBe(type === 'gaussian_colored_noise');
    noiseHost.querySelector('[data-layered-fault-param="mean"]').value = '0.2';
    noiseHost.querySelector('[data-layered-fault-param="seed"]').value = '17';
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();
    const target = layer === 'electrical' ? source : edge;
    expect(state.faultInstances).toContainEqual(expect.objectContaining({ targetId: target.id, layer, runtimeBehavior: 'bias',
      parameters: expect.objectContaining({ bias: 0.1, noiseEnabled: 1, noiseType: type, noiseMean: 0.2, noiseSeed: 17 }) }));
    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(pkg.faultInstances).toContainEqual(expect.objectContaining({ targetId: target.id, faultType: 'sensor_bias',
      parameters: expect.objectContaining({ bias: 0.1, noiseEnabled: 1, noiseType: type, noiseMean: 0.2, noiseSeed: 17 }) }));
    wrapper.unmount();
  });

  it.each([
    ['electrical', ['attenuation', 'data_cutoff'], ['bias', 'freeze', 'drift', 'step']],
    ['electrical', ['bias'], ['bias', 'freeze', 'drift', 'step']],
    ['protocol', ['delay', 'dropout'], ['bias', 'freeze', 'drift', 'step']],
    ['protocol', ['attenuation', 'data_cutoff'], ['bias', 'freeze', 'drift', 'step']],
    ['protocol', ['bias'], ['bias', 'freeze', 'drift', 'step']]
  ])('offers category modes on %s despite legacy slot models %j', async (layer, savedModels, originalModels) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('simulation_block', 180, 220);
    source.props.outputs = [{ key: 'torque', name: '力矩指令', type: '标量' }];
    source.props.faultInjection = { physical: [], electrical: [{ key: 'torque', allowedModels: savedModels }], protocol: [] };
    const sink = window.createNode('simulation_block', 480, 220);
    const edge = { id: 'legacy-filter-edge', sourceNodeId: source.id, targetNodeId: sink.id, sourcePortIndex: 0, targetPortIndex: 0,
      faultSlots: [{ layer: 'protocol', allowedModels: savedModels }] };
    window.__GZ_STATE__.modelEdges.push(edge);
    window.renderModelNodes();
    if (layer === 'electrical') {
      window.selectNode(source.id);
      window.setPropertyPanelTab('faults');
      document.querySelector('[data-open-property-fault-dialog]').click();
      document.querySelector('[data-component-fault-layer="electrical"]').click();
    } else {
      window.selectEdge(edge.id);
      window.openProtocolFaultImport();
    }
    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')].map((option) => option.dataset.layeredFaultOptionValue))
      .toEqual(originalModels);
    expect(dialog.querySelector('[data-layered-fault-model]').value).toBe(originalModels[0]);
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: layer === 'electrical' ? source.id : edge.id, layer, runtimeBehavior: originalModels[0]
    }));
    wrapper.unmount();
  });

  it.each(noiseTypes)('adds %s once to an electrical signal source output', async (type) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 300, 220);
    source.props.amplitude = '1';
    source.props.frequency = '1';
    const injector = window.createNode('electrical_fault_injector', 100, 220);
    const slot = window.getLayeredFaultSlotsForTarget(source).find((item) => item.layer === 'electrical' && item.variableRole === 'output');
    expect(window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node', targetId: source.id, slotId: slot.id, mathModel: type,
      parameters: { mean: 0.25, std: 0, amplitude: 0, start: 0, duration: 1 }
    }).ok).toBe(true);
    const reference = window.resolveNodeOutput(source.id, 0, 'reference', 0.25, 0.1, new Map(), new Set());
    const actual = window.resolveNodeOutput(source.id, 0, 'actual', 0.25, 0.1, new Map(), new Set());
    expect(actual).toBeCloseTo(reference + 0.25);
    wrapper.unmount();
  });

  it.each(noiseTypes)('adds %s once on a protocol connection', async (type) => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    source.props.amplitude = '1';
    source.props.frequency = '1';
    const gain = window.createNode('gain_block', 480, 220);
    gain.props.gain = '1';
    const injector = window.createNode('protocol_fault_injector', 300, 420);
    const edge = { id: 'noise-protocol-runtime', lineType: 'normal', sourceNodeId: source.id, targetNodeId: gain.id, sourcePortIndex: 0, targetPortIndex: 0 };
    window.__GZ_STATE__.modelEdges.push(edge);
    const slot = window.getLayeredFaultSlotsForTarget(edge)[0];
    expect(window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge', targetId: edge.id, slotId: slot.id, mathModel: type,
      parameters: { mean: 0.25, std: 0, amplitude: 0, start: 0, duration: 1 }
    }).ok).toBe(true);
    const reference = window.resolveNodeOutput(gain.id, 0, 'reference', 0.25, 0.1, new Map(), new Set());
    const actual = window.resolveNodeOutput(gain.id, 0, 'actual', 0.25, 0.1, new Map(), new Set());
    expect(actual).toBeCloseTo(reference + 0.25);
    wrapper.unmount();
  });

  it('retains legacy attenuation preset support on a signal source output', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sensor = window.createNode('signal_source', 480, 220);
    const injector = window.createNode('electrical_fault_injector', 320, 420);
    sensor.props.amplitude = '1';
    sensor.props.frequency = '1';
    await flushRuntime();

    const outputSlot = window.getLayeredFaultSlotsForTarget(sensor)
      .find((slot) => slot.layer === 'electrical' && slot.variableRole === 'output');
    expect(outputSlot).toBeDefined();
    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: sensor.id,
      slotId: outputSlot.id,
      mathModel: 'attenuation'
    });

    expect(result.ok).toBe(true);
    const reference = window.resolveNodeOutput(sensor.id, 0, 'reference', 0.25, 0.1, new Map(), new Set());
    const actual = window.resolveNodeOutput(sensor.id, 0, 'actual', 0.25, 0.1, new Map(), new Set());
    expect(actual).toBeCloseTo(reference * Math.pow(10, -6 / 20));

    wrapper.unmount();
  });

  it('selects named RF vector channels in the electrical fault binding dialog', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('rf_four_port_up_down_converter', 360, 220);
    const injector = window.createNode('electrical_fault_injector', 160, 220);
    await flushRuntime();

    const slot = window.getLayeredFaultSlotsForTarget(source)
      .find((item) => item.layer === 'electrical' && item.bindingObject === 'downconverted_baseband_outputs');
    expect(slot).toMatchObject({
      targetField: 'outputs.downconverted_baseband_outputs',
      vectorLength: 2
    });

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${source.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('偏差');
    expect(dialog.textContent).toContain('卡位');
    expect(dialog.textContent).toContain('渐变');
    expect(dialog.textContent).toContain('突变');
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')]
      .map((option) => option.dataset.layeredFaultOptionValue)).toEqual(['bias', 'freeze', 'drift', 'step']);
    expect(dialog.querySelector('[data-layered-fault-vector-scope]')).toBeNull();
    expect(dialog.querySelector('[data-layered-fault-vector-index]')).toBeNull();
    dialog.querySelector(`[data-layered-fault-option="slot"][data-layered-fault-option-value="${slot.id}"]`).click();
    await flushRuntime();
    expect(dialog.querySelectorAll('[data-layered-fault-vector-item]')).toHaveLength(2);
    const items = dialog.querySelectorAll('[data-layered-fault-vector-item]');
    expect(Array.from(items).map((item) => item.parentElement?.textContent.trim()))
      .toEqual(['下变频基带输出 1（I）', '下变频基带输出 2（I）']);
    items[0].checked = true;
    items[1].checked = false;
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: source.id,
      targetField: 'outputs.downconverted_baseband_outputs',
      vectorInjectionScope: 'items',
      vectorIndices: [0]
    }));
    expect(document.getElementById('pd')?.textContent).toContain('注入路数');
    expect(document.getElementById('pd')?.textContent).toContain('下变频基带输出 1（I）');
    wrapper.unmount();
  });

  it('selects named complex-envelope vector routes in the electrical fault binding dialog', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('rf_complex_envelope_to_vector4', 360, 220);
    const injector = window.createNode('electrical_fault_injector', 160, 220);
    const routeNames = ['天线阵元 1', '天线阵元 2', '天线阵元 3', '天线阵元 4'];
    // Port element names are edited in the Python binding. The immutable
    // component declaration remains unnamed, matching a user-edited block.
    source.pythonBinding.portMapping.outputs[0].vectorElementNames = [...routeNames];
    await flushRuntime();

    const slot = window.getLayeredFaultSlotsForTarget(source)
      .find((item) => item.layer === 'electrical' && item.bindingObject === 'envelope_vector');
    expect(slot).toMatchObject({
      targetField: 'outputs.envelope_vector',
      dataType: 'rf_complex_envelope',
      vectorLength: 4
    });

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${source.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    const items = dialog.querySelectorAll('[data-layered-fault-vector-item]');
    expect(items).toHaveLength(4);
    expect(Array.from(items).map((item) => item.parentElement?.textContent.trim())).toEqual(routeNames);
    items[0].checked = false;
    items[1].checked = true;
    items[2].checked = false;
    items[3].checked = true;
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: source.id,
      targetField: 'outputs.envelope_vector',
      vectorInjectionScope: 'items',
      vectorIndices: [1, 3]
    }));
    wrapper.unmount();
  });

  it('does not request injection channels for a scalar electrical slot with stale vector metadata', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const target = window.createNode('simulation_block', 360, 220);
    target.props = {
      name: 'Scalar target',
      inputs: [{ name: '标量输入', varName: 'scalar_input', dataType: 'scalar', vectorLength: 4 }],
      outputs: []
    };
    target.faultSlots = [{
      slotId: 'electrical:input:scalar_input',
      layer: 'electrical',
      targetField: 'inputs.scalar_input',
      bindingObject: 'scalar_input',
      dataType: 'vector',
      vectorLength: 4
    }];
    const injector = window.createNode('electrical_fault_injector', 160, 220);
    window.renderModelNodes();
    await flushRuntime();

    window.beginLayeredFaultBinding(injector.id);
    document.querySelector(`#b-${target.id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    chooseFaultCategory(dialog);
    expect(dialog).not.toBeNull();
    expect(dialog.querySelectorAll('[data-layered-fault-vector-item]')).toHaveLength(0);
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
    chooseFaultCategory(dialog);
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
    source.props.outputs = [{
      name: 'Control vector',
      type: '向量',
      vectorLength: 3,
      vectorElementNames: ['横滚指令', '俯仰指令', '偏航指令']
    }];
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
    document.querySelector('[data-props-tab="testpoints"]')?.click();
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
    expect(vectorOptions.map((option) => option.textContent)).toEqual(['横滚指令', '俯仰指令', '偏航指令']);
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
    const monitoredEdgeFaultGroup = document.querySelector(`[data-edge-testpoint-component="${monitoredEdge.id}"]`);
    expect(monitoredEdgeFaultGroup?.querySelector('summary')?.textContent).toContain('Source controller -> Output scope');
    expect(monitoredEdgeFaultGroup?.querySelector('summary')?.textContent).not.toContain(monitoredEdge.id);

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
    globallyInjectedCards[0].querySelectorAll('[data-edge-testpoint-fault]').forEach((input) => {
      input.checked = input.dataset.edgeTestpointFault === 'source_bias';
    });
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
    refreshedCards[1].querySelectorAll('[data-edge-testpoint-fault]').forEach((input) => {
      input.checked = input.dataset.edgeTestpointFault === 'source_noise';
    });
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
    expect(points.every((point) => !Object.hasOwn(point, 'vectorElementName'))).toBe(true);
    expect(points.map((point) => point.sourceVectorElementName)).toEqual(['偏航指令', '横滚指令']);
    expect(points.map((point) => point.targetVectorElementName)).toEqual(['偏航指令', '横滚指令']);
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
    expect(document.getElementById('prop-edge-label')).not.toBeNull();
    expect(document.querySelector('[data-edge-channel-list]')).toBeNull();
    expect(document.getElementById('prop-edge-signal-id')).toBeNull();
    const channelsBeforeRename = structuredClone(edge.signalChannels);
    document.getElementById('prop-edge-label').value = '姿态速率 CAN 链路';
    window.savePropertyPanelTarget();
    expect(edge).toMatchObject({
      label: '姿态速率 CAN 链路',
      labelCustomized: true
    });
    expect(edge.signalChannels).toEqual(channelsBeforeRename);

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
    const source = window.createNode('signal_source_rf', 180, 240);
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
      expect.objectContaining({
        label: '七路参数输入 / 向量 7',
        dataType: 'vector',
        vectorLength: 7,
        vectorElementNames: [
          '中心频率（MHz）', '重复周期（μs）', '脉宽（μs）', '幅度',
          '频段编码', '波形编码', '调制方式编码'
        ]
      })
    ]);
    expect(document.querySelector('[data-display-console-configuration]')).not.toBeNull();
    expect(Array.from(document.querySelectorAll('[data-display-console-vector-map] [data-vector-parameter-name]'),
      (element) => element.textContent)).toEqual([
      '中心频率（MHz）', '重复周期（μs）', '脉宽（μs）', '幅度',
      '频段编码', '波形编码', '调制方式编码'
    ]);
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

    const liveSource = window.__GZ_STATE__.modelNodes.find((node) => node.id === source.id);
    liveSource.props.outputFormat = '向量';
    liveSource.props.rfVectorLength = 4;
    expect(window.getNodePorts(liveSource).outputs[0].vectorLength).toBe(4);
    expect(window.getNodePorts(displayConsole).inputs[0].vectorLength).toBe(7);
    window.handlePortClick({ stopPropagation() {} }, source.id, 'output', 0);
    window.handlePortClick({ stopPropagation() {} }, displayConsole.id, 'input', 0);
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(0);
    liveSource.props.rfVectorLength = 7;
    window.handlePortClick({ stopPropagation() {} }, source.id, 'output', 0);
    window.handlePortClick({ stopPropagation() {} }, displayConsole.id, 'input', 0);
    const consoleEdge = window.__GZ_STATE__.modelEdges.find((edge) => edge.targetNodeId === displayConsole.id);
    expect(consoleEdge).toMatchObject({ sourceNodeId: source.id, targetPortIndex: 0 });
    window.__GZ_SIM__.actual.edgeStates = {
      [consoleEdge.id]: { lastOutput: [12.5e6, 2e-6, 0.5e-6, 4, 5, 6, 7] }
    };
    window.refreshDisplayConsolePanel();
    const initialCells = panel?.querySelectorAll('[data-display-console-table] tbody td');
    expect(initialCells?.[1]?.textContent).toBe('12.5');
    expect(initialCells?.[2]?.textContent).toBe('2');
    expect(initialCells?.[3]?.textContent).toBe('0.5');
    window.__GZ_SIM__.actual.edgeStates[consoleEdge.id].lastOutput[0] = 25e6;
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

    const vectorSource = window.createNode('rf_four_channel_source', 920, 240);
    const outputSource = window.createNode('rf_four_output_source', 1120, 240);
    const limitAmplifier = window.createNode('rf_limit_amplify_downconvert_split8', 1320, 240);
    window.openDisplayConsolePanel(displayConsole.id);
    await flushRuntime();
    const sharedControlPanel = document.querySelector(`[data-display-console-panel="${displayConsole.id}"]`);
    const sharedCenterFrequency = sharedControlPanel?.querySelector('[data-display-console-shared-parameter="rf_center_frequency"]');
    expect(sharedControlPanel?.querySelector('[data-display-console-shared-controls]')).not.toBeNull();
    expect(sharedCenterFrequency).not.toBeNull();
    const sharedTargetSummary = sharedControlPanel?.querySelector('[data-display-console-shared-targets="rf_center_frequency"]');
    expect(sharedTargetSummary?.textContent).toContain(vectorSource.props.name);
    expect(sharedTargetSummary?.textContent).toContain(outputSource.props.name);
    expect(sharedTargetSummary?.textContent).toContain(limitAmplifier.props.name);
    expect(sharedControlPanel?.querySelector(`[data-display-console-control-component="${vectorSource.id}"] [data-display-console-parameter="center_frequency_hz"]`)).toBeNull();
    expect(sharedControlPanel?.querySelector(`[data-display-console-control-component="${outputSource.id}"] [data-display-console-parameter="center_frequency_hz"]`)).toBeNull();
    sharedCenterFrequency.value = '915';
    const sharedCenterFrequencyUnit = sharedControlPanel?.querySelector('[data-display-console-shared-parameter-unit="rf_center_frequency"]');
    expect(sharedCenterFrequencyUnit).not.toBeNull();
    sharedCenterFrequencyUnit.value = 'MHz';
    sharedControlPanel?.querySelector('[data-display-console-apply]')?.click();
    await flushRuntime();
    expect(vectorSource.props.parameterValues.center_frequency_hz).toBe(915000000);
    expect(outputSource.props.parameterValues.center_frequency_hz).toBe(915000000);
    expect(limitAmplifier.props.parameterValues.lo_frequency_hz).toBe(915000000);
    expect(displayConsole.props.sharedParameterValues.rf_center_frequency).toBe(915000000);
    expect(displayConsole.props.sharedParameterUnits.rf_center_frequency).toBe('MHz');
    window.closeDisplayConsolePanel();

    const downconverter = window.createNode('rf_downconverter', 980, 420);
    const secondDownconverter = window.createNode('rf_downconverter', 1180, 420);
    window.openDisplayConsolePanel(secondDisplayConsole.id);
    await flushRuntime();
    const controlPanel = document.querySelector(`[data-display-console-panel="${secondDisplayConsole.id}"]`);
    expect(controlPanel?.querySelector('[data-display-console-controls]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-control-target]')).toBeNull();
    expect(controlPanel?.querySelectorAll('[data-display-console-control-component]')).toHaveLength(2);
    const downconverterControls = controlPanel?.querySelector(`[data-display-console-control-component="${downconverter.id}"]`);
    const secondDownconverterControls = controlPanel?.querySelector(`[data-display-console-control-component="${secondDownconverter.id}"]`);
    expect(controlPanel?.querySelector('[data-display-console-shared-mode-switch="rf_downconverter_input_mode"]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-shared-parameter="rf_downconverter_input_mode"]')?.getAttribute('type')).toBe('hidden');
    expect(downconverterControls?.querySelector('[data-display-console-parameter="input_mode"]')).toBeNull();
    expect(secondDownconverterControls?.querySelector('[data-display-console-parameter="input_mode"]')).toBeNull();
    expect(downconverterControls?.querySelector('[data-display-console-parameter="lo_frequency_hz"]')).not.toBeNull();
    expect(controlPanel?.querySelector('[data-display-console-parameter="sample_1"]')).toBeNull();
    controlPanel?.querySelector('[data-display-console-shared-mode-select="2"]')?.click();
    expect(controlPanel?.querySelector('[data-display-console-shared-parameter="rf_downconverter_input_mode"]')?.value).toBe('2');
    expect(controlPanel?.querySelector('[data-display-console-shared-mode-select="2"]')?.classList.contains('is-active')).toBe(true);
    downconverterControls.querySelector('[data-display-console-parameter="lo_frequency_hz"]').value = '980';
    downconverterControls.querySelector('[data-display-console-parameter-unit="lo_frequency_hz"]').value = 'MHz';
    secondDownconverterControls.querySelector('[data-display-console-parameter="lo_frequency_hz"]').value = '1.2';
    secondDownconverterControls.querySelector('[data-display-console-parameter-unit="lo_frequency_hz"]').value = 'GHz';
    controlPanel.querySelector('[data-display-console-apply]')?.click();
    await flushRuntime();
    expect(downconverter.props.parameterValues.lo_frequency_hz).toBe(980000000);
    expect(downconverter.props.parameterValues.input_mode).toBe(2);
    expect(secondDownconverter.props.parameterValues.input_mode).toBe(2);
    expect(downconverter.props.parameterUnits.lo_frequency_hz).toBe('MHz');
    expect(secondDownconverter.props.parameterValues.lo_frequency_hz).toBe(1200000000);
    expect(secondDownconverter.props.parameterUnits.lo_frequency_hz).toBe('GHz');
    expect(window.__GZ_SIM__.inited).toBe(false);
    expect(secondDisplayConsole.props.sharedParameterValues.rf_downconverter_input_mode).toBe(2);

    // A physical parameter fault changes the runtime value, not the display
    // console's operator setpoint. Simulate that override here and confirm
    // the console keeps showing the last setting made by its operator.
    downconverter.props.parameterValues.input_mode = 1;
    window.renderDisplayConsolePanel();
    await flushRuntime();
    expect(document.querySelector('[data-display-console-shared-parameter="rf_downconverter_input_mode"]')?.value).toBe('2');
    expect(document.querySelector('[data-display-console-shared-mode-select="2"]')?.classList.contains('is-active')).toBe(true);
    downconverter.props.parameterValues.input_mode = 2;

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

  it('shows each display console preset’s vector element names in parameter configuration', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const displayConsole = window.createNode('display_console_3', 420, 240);
    window.selectNode(displayConsole.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    const rows = Array.from(document.querySelectorAll('[data-display-console-vector-map] [data-vector-element-index]'));
    expect(rows.map((row) => [row.querySelector('.pk')?.textContent, row.querySelector('[data-vector-parameter-name]')?.textContent])).toEqual([
      ['元素 1', '下变频输出 1（I）'],
      ['元素 2', '下变频输出 2（I）'],
      ['元素 3', '上变频射频输出 1'],
      ['元素 4', '上变频射频输出 2'],
      ['元素 5', '频段编码'],
      ['元素 6', '波形编码'],
      ['元素 7', '调制方式编码']
    ]);

    wrapper.unmount();
  });

  it('maps display console 2’s two vector ports to separate rows and measurement points', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const sourceA = window.createNode('signal_source_rf', 140, 220);
    const sourceB = window.createNode('signal_source_rf', 140, 420);
    const displayConsole = window.createNode('display_console_2', 520, 280);
    for (const source of [sourceA, sourceB]) {
      source.props.outputFormat = '向量';
      source.props.rfVectorLength = 7;
    }
    window.__GZ_STATE__.modelEdges.push(
      { id: 'edge-console-a', sourceNodeId: sourceA.id, sourcePortIndex: 0, targetNodeId: displayConsole.id, targetPortIndex: 0 },
      { id: 'edge-console-b', sourceNodeId: sourceB.id, sourcePortIndex: 0, targetNodeId: displayConsole.id, targetPortIndex: 1 }
    );
    window.__GZ_SIM__.actual.edgeStates = {
      'edge-console-a': { lastOutput: [12e6, 2, 3, 4, 5, 6, 7] },
      'edge-console-b': { lastOutput: [25e6, 12, 13, 14, 15, 16, 17] }
    };

    expect(window.getNodePorts(displayConsole).inputs).toEqual([
      expect.objectContaining({ portId: 'console-input', dataType: 'vector', vectorLength: 7 }),
      expect.objectContaining({ portId: 'console-input-2', dataType: 'vector', vectorLength: 7 })
    ]);
    window.renderModelNodes();
    expect(document.querySelectorAll(`#b-${displayConsole.id} .node-port--input`)).toHaveLength(2);
    window.selectNode(displayConsole.id);
    window.setPropertyPanelTab('parameters');
    await flushRuntime();
    expect(Array.from(document.querySelectorAll('[data-display-console-vector-map]'),
      (map) => map.querySelector('.display-console-vector-map__title')?.textContent)).toEqual([
      '通道 A（向量长度 7）· 元素与参数对应关系',
      '通道 B（向量长度 7）· 元素与参数对应关系'
    ]);
    window.openDisplayConsolePanel(displayConsole.id);
    await flushRuntime();
    const rows = Array.from(document.querySelectorAll('[data-display-console-table] tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.querySelector('.display-console-table__column--center-frequency')?.textContent)).toEqual(['12', '25']);
    expect(rows.map((row) => row.querySelector('.display-console-table__column--serial-number')?.textContent)).toEqual(['1', '2']);

    const points = window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).positions
      .filter((point) => point.displayConsoleInput && point.nodeId === displayConsole.id);
    expect(points.filter((point) => point.targetPortIndex === 0).map((point) => point.vectorIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(points.filter((point) => point.targetPortIndex === 1).map((point) => point.vectorIndex)).toEqual([0, 1, 2, 4, 5, 6]);

    window.__GZ_SIM__.componentOutputs = {
      time: [0],
      steps: [{ time: 0, actual: {
        [sourceA.id]: { output: [12e6, 2, 3, 4, 5, 6, 7] },
        [sourceB.id]: { output: [25e6, 12, 13, 14, 15, 16, 17] }
      }, reference: {} }]
    };
    const result = await window.buildSimulationResultSnapshot();
    const savedConsole = result.publicData.renderData.devices.find((device) => device.id === displayConsole.id);
    expect(savedConsole.measurementPorts.inputs.map((port) => port.portId)).toEqual(['console-input', 'console-input-2']);
    expect(savedConsole.channels['console-input.centerFrequency'].series[0].value).toBe(12e6);
    expect(savedConsole.channels['console-input-2.centerFrequency'].series[0].value).toBe(25e6);

    wrapper.unmount();
  });

  it('renders a shared parameter without a duplicate controls entry', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const displayConsole = window.createNode('display_console', 520, 260);
    displayConsole.props.displayConfig = {
      controls: [],
      sharedParameters: [{
        key: 'limit_lo_frequency',
        label: '本振频率',
        bindings: [{
          componentType: 'rf_limit_amplify_downconvert_split8',
          parameterKey: 'lo_frequency_hz'
        }]
      }]
    };
    const limitAmplifier = window.createNode('rf_limit_amplify_downconvert_split8', 260, 260);
    window.openDisplayConsolePanel(displayConsole.id);
    await flushRuntime();

    expect(document.querySelector('[data-display-console-shared-parameter="limit_lo_frequency"]')).not.toBeNull();
    expect(document.querySelector('[data-display-console-shared-targets="limit_lo_frequency"]')?.textContent)
      .toContain(limitAmplifier.props.name);

    wrapper.unmount();
  });

  it('shows controls for a component inside a subsystem canvas', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const displayConsole = window.createNode('display_console_2', 520, 260);
    const subsystem = window.createNode('subsystem_block', 280, 260);
    window.openSubsystemCanvas(subsystem.id);
    const nestedDownconverter = window.createNode('rf_downconverter', 320, 260);
    await flushRuntime();

    window.navigateToCanvas('canvas-root');
    window.openDisplayConsolePanel(displayConsole.id);
    await flushRuntime();

    expect(document.querySelector(
      `[data-display-console-control-component="${nestedDownconverter.id}"]`
    )).not.toBeNull();
    expect(document.querySelector(
      '[data-display-console-shared-targets="rf_downconverter_input_mode"]'
    )?.textContent).toContain(nestedDownconverter.props.name);

    wrapper.unmount();
  });

  it('saves the complete seven-input display-console time series', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 180, 260);
    source.props.outputFormat = '向量';
    source.props.rfVectorLength = 7;
    const displayConsole = window.createNode('display_console_1', 520, 260);
    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-console-vector',
      sourceNodeId: source.id,
      sourcePortIndex: 0,
      targetNodeId: displayConsole.id,
      targetPortIndex: 0
    });
    window.__GZ_SIM__.componentOutputs = {
      time: [0, 0.1, 0.2],
      steps: [0, 0.1, 0.2].map((time, stepIndex) => ({
        time,
        actual: { [source.id]: { output: Array.from({ length: 7 }, (_, inputIndex) =>
          (inputIndex + 1) * 100 + stepIndex) } },
        reference: {}
      }))
    };

    const consolePoints = window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).positions
      .filter((point) => point.displayConsoleInput && point.nodeId === displayConsole.id);
    expect(consolePoints.map((point) => point.vectorIndex)).toEqual([1, 2, 3, 4, 5, 6]);

    const result = await window.buildSimulationResultSnapshot();
    const savedConsole = result.publicData.renderData.devices.find((device) => device.id === displayConsole.id);

    expect(savedConsole).toMatchObject({
      type: 'display_console',
      measurementPorts: {
        inputs: [expect.objectContaining({ portId: 'console-input' })]
      },
      channels: {
        centerFrequency: { inputIndex: 0, connected: true, displayScale: 1e-6 },
        repetitionPeriod: { inputIndex: 1, connected: true, displayScale: 1e6 },
        pulseWidth: { inputIndex: 2, connected: true, displayScale: 1e6 },
        amplitude: { inputIndex: 3, connected: true, displayScale: 1 },
        band: { inputIndex: 4, connected: true, displayScale: 1 },
        waveform: { inputIndex: 5, connected: true, displayScale: 1 },
        modulation: { inputIndex: 6, connected: true, displayScale: 1 }
      }
    });
    expect(result.publicData.renderData.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edge-console-vector', targetPort: 'console-input' })
    ]));
    expect(savedConsole.channels.centerFrequency.series.map(({ t, value }) => ({ t, value }))).toEqual([
      { t: 0, value: 100 },
      { t: 0.1, value: 101 },
      { t: 0.2, value: 102 }
    ]);
    expect(savedConsole.channels.amplitude.series.map(({ t, value }) => ({ t, value }))).toEqual([
      { t: 0, value: 400 },
      { t: 0.1, value: 401 },
      { t: 0.2, value: 402 }
    ]);
    expect(savedConsole.channels.modulation.series.map(({ t, value }) => ({ t, value }))).toEqual([
      { t: 0, value: 700 },
      { t: 0.1, value: 701 },
      { t: 0.2, value: 702 }
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

    const dragHandle = spectrumWindow?.querySelector('[data-spectrum-drag-handle]');
    expect(dragHandle).not.toBeNull();
    const leftAfterHeaderDrag = spectrumWindow?.style.left;
    dispatchPointer(dragHandle, 'pointerdown', { clientX: 90, clientY: 70 });
    dispatchPointer(document, 'pointermove', { clientX: 150, clientY: 110 });
    dispatchPointer(document, 'pointerup', { clientX: 150, clientY: 110 });
    expect(spectrumWindow?.style.left).not.toBe(leftAfterHeaderDrag);

    expect(spectrumWindow?.querySelector('[data-spectrum-config="fftSize"]')).not.toBeNull();
    expect(spectrumWindow?.textContent).toContain('显示与量程');
    expect(spectrumWindow?.querySelector('[data-spectrum-config="attenuation"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-config="preamp"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-config="markerFrequency"]')).toBeNull();

    expect(spectrumWindow?.querySelector('[data-spectrum-config="sampleRateValue"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-config="sampleRateUnit"]')).toBeNull();
    expect(spectrumWindow?.querySelector('[data-spectrum-auto-sample-rate]')?.textContent).toMatch(/^64(?:\.0+)?Hz$/);

    const windowFunction = document.querySelector('[data-spectrum-config="windowFunction"]');
    expect(windowFunction?.tagName).toBe('SELECT');
    expect(Array.from(windowFunction?.options||[]).map((option) => option.value)).toEqual(['Hann', 'Hamming', 'Blackman', 'Rectangular']);
    windowFunction.value = 'Hamming';
    windowFunction.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-window]')?.dataset.spectrumWindowFunction).toBe('hamming');

    expect(document.querySelector('[data-spectrum-auto-sample-rate]')?.textContent).toMatch(/^64(?:\.0+)?Hz$/);

    const frequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const frequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const frequencyRangeStartUnit = document.querySelector('[data-spectrum-config="frequencyRangeStartUnit"]');
    const frequencyRangeEndUnit = document.querySelector('[data-spectrum-config="frequencyRangeEndUnit"]');
    const autoFrequencyRange = document.querySelector('[data-spectrum-config="autoFrequencyRange"]');
    expect(autoFrequencyRange?.value).toBe('off');
    expect(frequencyRangeStart?.disabled).toBe(false);
    expect(Array.from(frequencyRangeStartUnit?.options ?? []).map((option) => option.value)).toContain('GHz');
    expect(Array.from(frequencyRangeEndUnit?.options ?? []).map((option) => option.value)).toContain('GHz');
    autoFrequencyRange.value = 'off';
    autoFrequencyRange.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const editableFrequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const editableFrequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const editableFrequencyRangeStartUnit = document.querySelector('[data-spectrum-config="frequencyRangeStartUnit"]');
    const editableFrequencyRangeEndUnit = document.querySelector('[data-spectrum-config="frequencyRangeEndUnit"]');
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
    const centerFrequencyUnit = document.querySelector('[data-spectrum-config="centerFrequencyUnit"]');
    const frequencySpanUnit = document.querySelector('[data-spectrum-config="frequencySpanUnit"]');
    centerFrequency.value = '12';
    frequencySpan.value = '0.008';
    centerFrequencyUnit.value = 'Hz';
    frequencySpanUnit.value = 'kHz';
    frequencySpanUnit.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('8Hz-16Hz');
    expect(document.querySelector('[data-spectrum-axis="x"]')?.textContent).toMatch(/8(?:\.0+)?Hz/);
    const startStopMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    startStopMode.value = 'startStop';
    startStopMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const restoredFrequencyRangeStart = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const restoredFrequencyRangeEnd = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const restoredFrequencyRangeStartUnit = document.querySelector('[data-spectrum-config="frequencyRangeStartUnit"]');
    const restoredFrequencyRangeEndUnit = document.querySelector('[data-spectrum-config="frequencyRangeEndUnit"]');
    restoredFrequencyRangeStart.value = '8';
    restoredFrequencyRangeEnd.value = '16';
    restoredFrequencyRangeStartUnit.value = 'Hz';
    restoredFrequencyRangeEndUnit.value = 'Hz';
    restoredFrequencyRangeEndUnit.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('8Hz-16Hz');
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
    expect(spectrumWindow?.querySelector('[data-spectrum-peak-frequency]')?.textContent).toContain('9.7656');
    const visibleFrequencies = Array.from(spectrumWindow?.querySelectorAll('[data-spectrum-bin]') ?? [])
      .map((bin) => Number(bin.getAttribute('data-spectrum-frequency')));
    expect(visibleFrequencies).toHaveLength(513);
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

  it('formats spectrum peak and marker frequency in GHz for center/span tuning', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '64GHz';
    spectrum.props.fftSize = '64';
    spectrum.props.frequencyRange = '0Hz-32000000000Hz';
    spectrum.props.tuningMode = 'centerSpan';
    spectrum.props.centerFrequencyUnit = 'GHz';
    spectrum.props.frequencySpanUnit = 'GHz';
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

  it('lets the ordinary spectrum analyzer analyze the full I/Q envelope spectrum around its RF reference frequency', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '64MHz';
    spectrum.props.fftSize = '64';
    spectrum.props.autoFrequencyRange = 'on';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => {
      const phase = 2 * Math.PI * 4 * index / 64;
      return {
        t: index / 64000000,
        actual: {
          i: Math.cos(phase),
          q: Math.sin(phase),
          referenceFrequencyHz: 20e9,
          impedanceOhm: 50,
          unit: 'V'
        }
      };
    });

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    expect(document.querySelector('[data-spectrum-window]')).not.toBeNull();
    expect(document.querySelector('[data-spectrum-config="vectorChannel"]')).toBeNull();
    expect(document.querySelector('[data-spectrum-peak-frequency]')?.textContent).toBe('20.0040GHz');
    const frequencies = Array.from(document.querySelectorAll('[data-spectrum-bin]'))
      .map((bin) => Number(bin.getAttribute('data-spectrum-frequency')));
    expect(frequencies).toContain(20.004e9);
    wrapper.unmount();
  });

  it('draws up to 1024 complex-envelope FFT bins per trace', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    // A persisted manual rate must not decimate complex-envelope I/Q data.
    spectrum.props.sampleRate = '1Hz';
    spectrum.props.fftSize = '1024';
    spectrum.props.autoFrequencyRange = 'on';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 1024 }, (_, index) => ({
      t: index / 1e6,
      actual: { i: 1, q: 0, referenceFrequencyHz: 20e9, impedanceOhm: 50, unit: 'V' }
    }));

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const points = document.querySelector('.spectrum-window__trace-line')?.getAttribute('points')?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(1024);
    wrapper.unmount();
  });

  it('caps a complex-envelope spectrum trace at 1024 plotted points', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '1MHz';
    spectrum.props.fftSize = '2048';
    spectrum.props.autoFrequencyRange = 'on';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 2048 }, (_, index) => ({
      t: index / 1e6,
      actual: { i: 1, q: 0, referenceFrequencyHz: 20e9, impedanceOhm: 50, unit: 'V' }
    }));

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const points = document.querySelector('.spectrum-window__trace-line')?.getAttribute('points')?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(1024);
    wrapper.unmount();
  });

  it('allows an absolute RF start/stop range to be edited for a complex-envelope spectrum analyzer', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '64MHz';
    spectrum.props.fftSize = '64';
    spectrum.props.autoFrequencyRange = 'on';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => ({
      t: index / 64000000,
      actual: { i: 1, q: 0, referenceFrequencyHz: 20e9, impedanceOhm: 50, unit: 'V' }
    }));
    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const automatic = document.querySelector('[data-spectrum-config="autoFrequencyRange"]');
    automatic.value = 'off';
    automatic.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const start = document.querySelector('[data-spectrum-config="frequencyRangeStart"]');
    const end = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    const startUnit = document.querySelector('[data-spectrum-config="frequencyRangeStartUnit"]');
    const endUnit = document.querySelector('[data-spectrum-config="frequencyRangeEndUnit"]');
    expect(start?.disabled).toBe(false);
    start.value = '19';
    end.value = '21';
    startUnit.value = 'GHz';
    endUnit.value = 'GHz';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(spectrum.props.frequencyRange).toBe('19GHz-21GHz');
    expect(document.querySelector('[data-spectrum-config="frequencyRangeStart"]')?.value).toBe('19');
    expect(document.querySelector('[data-spectrum-config="frequencyRangeEnd"]')?.value).toBe('21');
    wrapper.unmount();
  });

  it('draws -150 dBm outside the complex-envelope acquisition range', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    Object.assign(spectrum.props, {
      sampleRate: '64MHz',
      fftSize: '64',
      frequencyRange: '19GHz-21GHz',
      autoFrequencyRange: 'off',
      windowFunction: 'Rectangular'
    });
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => {
      const phase = 2 * Math.PI * 4 * index / 64;
      return {
        t: index / 64000000,
        actual: { i: Math.cos(phase), q: Math.sin(phase), referenceFrequencyHz: 20e9 }
      };
    });

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const bins = Array.from(document.querySelectorAll('[data-spectrum-bin]'));
    [19e9, 21e9].forEach((frequency) => {
      const bin = bins.find((item) => Number(item.getAttribute('data-spectrum-frequency')) === frequency);
      expect(bin?.getAttribute('title')).toMatch(/-150(?:\.0+)?dBm/);
    });

    wrapper.unmount();
  });

  it('keeps the selected spectrum frequency field active when a drag ends outside it', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.frequencyRange = '0Hz-32Hz';
    spectrum.props.autoFrequencyRange = 'off';
    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const assertRangeSelectionStays = (key, otherKey) => {
      const input = document.querySelector(`[data-spectrum-config="${key}"]`);
      const other = document.querySelector(`[data-spectrum-config="${otherKey}"]`);
      const group = input.closest('.spectrum-window__config-range');
      expect(group.tagName).toBe('DIV');
      expect(input.closest('label')).toBeNull();
      let capturedPointerId = null;
      input.setPointerCapture = pointerId => { capturedPointerId = pointerId; };
      dispatchPointer(input, 'pointerdown', { pointerId: 47 });
      expect(capturedPointerId).toBe(47);
      input.focus();
      input.select();
      group.click();
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      expect(document.activeElement).not.toBe(other);
    };

    assertRangeSelectionStays('frequencyRangeEnd', 'frequencyRangeStart');
    const tuningMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    tuningMode.value = 'centerSpan';
    tuningMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    assertRangeSelectionStays('frequencySpan', 'centerFrequency');

    wrapper.unmount();
  });

  it('keeps a manually entered center/span range for a complex-envelope spectrum analyzer', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    Object.assign(spectrum.props, {
      sampleRate: '10MHz',
      fftSize: '64',
      autoFrequencyRange: 'on',
      tuningMode: 'startStop',
      centerFrequencyUnit: 'GHz',
      frequencySpanUnit: 'GHz',
      windowFunction: 'Rectangular'
    });
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => ({
      t: index / 10000000,
      actual: { i: 1, q: 0, referenceFrequencyHz: 20e9, impedanceOhm: 50, unit: 'V' }
    }));
    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const tuningMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    tuningMode.value = 'centerSpan';
    tuningMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(spectrum.props.autoFrequencyRange).toBe('off');
    const center = document.querySelector('[data-spectrum-config="centerFrequency"]');
    const span = document.querySelector('[data-spectrum-config="frequencySpan"]');
    const centerUnit = document.querySelector('[data-spectrum-config="centerFrequencyUnit"]');
    const spanUnit = document.querySelector('[data-spectrum-config="frequencySpanUnit"]');
    expect(center?.disabled).toBe(false);
    expect(center?.value).toBe('20');
    center.value = '20';
    span.value = '0.00002';
    centerUnit.value = 'GHz';
    spanUnit.value = 'GHz';
    span.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(spectrum.props.frequencyRange).toBe('19999990000Hz-20000010000Hz');
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('20');
    expect(document.querySelector('[data-spectrum-config="frequencySpan"]')?.value).toBe('0.00002');
    wrapper.unmount();
  });

  it('keeps a manually tuned RF center before spectrum samples arrive', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.tuningMode = 'centerSpan';
    spectrum.props.centerFrequencyUnit = 'GHz';
    spectrum.props.frequencySpanUnit = 'MHz';
    spectrum.props.frequencyRange = '0Hz-32Hz';
    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const center = document.querySelector('[data-spectrum-config="centerFrequency"]');
    const span = document.querySelector('[data-spectrum-config="frequencySpan"]');
    center.value = '20';
    span.value = '10';
    center.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(spectrum.props.frequencyRange).toBe('19995000000Hz-20005000000Hz');
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('20');
    expect(document.querySelector('[data-spectrum-config="frequencySpan"]')?.value).toBe('10');
    expect(document.querySelector('[data-spectrum-axis="x"]')?.textContent).toContain('20.005');
    wrapper.unmount();
  });

  it('keeps an e-9 center frequency after a connected analyzer redraws', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 260, 240);
    const spectrum = window.createNode('instrument_spectrum', 540, 240);
    const canvas = window.getActiveCanvasRecord();
    canvas.edges.push(window.makeTask5Edge(
      'normal', source.id, spectrum.id, 0, 0,
      window.getNodePorts(source).outputs[0],
      window.getNodePorts(spectrum).inputs[0], null
    ));
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 64 }, (_, index) => ({
      t: index / 64,
      actual: { i: 1, q: 0, referenceFrequencyHz: 1e-9 }
    }));
    Object.assign(spectrum.props, {
      tuningMode: 'centerSpan',
      autoFrequencyRange: 'off',
      centerFrequencyUnit: 'Hz',
      frequencySpanUnit: 'Hz',
      frequencyRange: '0Hz-32Hz'
    });
    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    const center = document.querySelector('[data-spectrum-config="centerFrequency"]');
    const span = document.querySelector('[data-spectrum-config="frequencySpan"]');
    center.value = '1e-9';
    span.value = '1e-9';
    center.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(spectrum.props.frequencyRange).toBe('5e-10Hz-1.5e-9Hz');
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('1e-9');
    expect(document.querySelector('[data-spectrum-config="frequencySpan"]')?.value).toBe('1e-9');
    expect(document.querySelector('[data-spectrum-window]')?.dataset.spectrumRange).toBe('5e-10-1.5e-9');
    window.renderSpectrumInstrument({ rebuild: true });
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('1e-9');
    const nextCenter = document.querySelector('[data-spectrum-config="centerFrequency"]');
    nextCenter.value = '2e-9';
    nextCenter.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('1.5e-9Hz-2.5e-9Hz');
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('2e-9');
    const restoredCenter = document.querySelector('[data-spectrum-config="centerFrequency"]');
    restoredCenter.value = '1e-9';
    restoredCenter.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const tuningMode = document.querySelector('[data-spectrum-config="tuningMode"]');
    tuningMode.value = 'startStop';
    tuningMode.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-spectrum-config="frequencyRangeStart"]')?.value).toBe('5e-10');
    expect(document.querySelector('[data-spectrum-config="frequencyRangeEnd"]')?.value).toBe('1.5e-9');
    const end = document.querySelector('[data-spectrum-config="frequencyRangeEnd"]');
    end.value = '2e-9';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(spectrum.props.frequencyRange).toBe('5e-10Hz-2e-9Hz');
    wrapper.unmount();
  });

  it('restores the spectrum center after the page closes and reopens', async () => {
    let wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    Object.assign(spectrum.props, {
      tuningMode: 'centerSpan',
      autoFrequencyRange: 'off',
      centerFrequencyUnit: 'Hz',
      frequencySpanUnit: 'Hz',
      frequencyRange: '0Hz-32Hz'
    });
    window.openSpectrumInstrument(spectrum.id);
    const center = document.querySelector('[data-spectrum-config="centerFrequency"]');
    const span = document.querySelector('[data-spectrum-config="frequencySpan"]');
    center.value = '1e-9';
    span.value = '1e-9';
    center.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('1e-9');

    window.dispatchEvent(new Event('pagehide'));
    expect(window.localStorage.getItem('gz-workbench-system-model')).toContain('5e-10Hz-1.5e-9Hz');
    wrapper.unmount();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();

    wrapper = await mountWorkbench();
    expect(restoreStoredWorkbench()).toBe(true);
    const restored = window.__GZ_STATE__.modelNodes.find((node) => node.id === spectrum.id);
    expect(restored?.props).toMatchObject({
      tuningMode: 'centerSpan',
      autoFrequencyRange: 'off',
      centerFrequencyUnit: 'Hz',
      frequencySpanUnit: 'Hz',
      frequencyRange: '5e-10Hz-1.5e-9Hz'
    });
    window.openSpectrumInstrument(restored.id);
    expect(document.querySelector('[data-spectrum-config="centerFrequency"]')?.value).toBe('1e-9');
    expect(document.querySelector('[data-spectrum-config="frequencySpan"]')?.value).toBe('1e-9');
    wrapper.unmount();
  });

  it('lets the ordinary spectrum analyzer use automatic I/Q sampling in the local fallback runtime', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 260, 240);
    const spectrum = window.createNode('instrument_spectrum', 540, 240);
    Object.assign(source.props, {
      signalDomain: 'rf',
      outputFormat: '复数包络',
      centerFrequency: '20',
      centerFrequencyUnit: 'GHz',
      power: '0',
      powerUnit: 'dBm',
      pulseWidth: '1',
      pulseWidthUnit: 'ms',
      pulsePeriod: '10',
      pulsePeriodUnit: 'ms'
    });
    spectrum.props.sampleRate = '1MHz';
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

    document.getElementById('sim-dur').value = '10';
    document.getElementById('sim-dur-unit').value = 'us';
    document.getElementById('sim-step').value = '1';
    document.getElementById('sim-step-unit').value = 'us';
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    await flushRuntime();

    const samples = window.__GZ_SIM__.actual.instrumentSamples[spectrum.id];
    expect(samples).toHaveLength(4);
    expect(samples[0]?.actual).toMatchObject({
      i: expect.any(Number),
      q: expect.any(Number),
      referenceFrequencyHz: 20e9
    });
    window.openSpectrumInstrument(spectrum.id);
    expect(document.querySelector('[data-spectrum-config="sampleRateValue"]')).toBeNull();
    expect(document.querySelector('[data-spectrum-auto-sample-rate]')?.textContent).toMatch(/^1(?:\.0+)?MHz$/);
    wrapper.unmount();
  });

  it('adds configured broadband noise to local complex-envelope I/Q samples', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const clean = window.createNode('signal_source', 260, 240);
    const noisy = window.createNode('signal_source', 260, 340);
    const base = {
      signalDomain: 'rf',
      outputFormat: '复数包络',
      centerFrequency: '20',
      centerFrequencyUnit: 'GHz',
      power: '0',
      powerUnit: 'dBm',
      pulseWidth: '1',
      pulseWidthUnit: 'ms',
      pulsePeriod: '10',
      pulsePeriodUnit: 'ms'
    };
    Object.assign(clean.props, base);
    Object.assign(noisy.props, {
      ...base,
      noiseEnabled: 'on',
      noiseSnr: '0',
      noiseBandwidth: '1',
      noiseBandwidthUnit: 'MHz'
    });

    const cleanOffPulse = window.resolveNodeOutput(clean.id, 0, 'actual', 5e-3, 0.1e-6, new Map(), new Set());
    const noisyOffPulse = window.resolveNodeOutput(noisy.id, 0, 'actual', 5e-3, 0.1e-6, new Map(), new Set());

    expect(cleanOffPulse).toMatchObject({ i: 0, q: 0, referenceFrequencyHz: 20e9 });
    expect(noisyOffPulse).toMatchObject({ referenceFrequencyHz: 20e9 });
    expect(Math.abs(noisyOffPulse.i) + Math.abs(noisyOffPulse.q)).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('shows the correct power for a low-rate sine spectrum without bandwidth smoothing', async () => {
    const wrapper = await mountWorkbench();
    window.doCreateBlankWorkspace();
    const spectrum = window.createNode('instrument_spectrum', 420, 240);
    spectrum.props.sampleRate = '32Hz';
    spectrum.props.fftSize = '32';
    spectrum.props.frequencyRange = '0-5Hz';
    spectrum.props.windowFunction = 'Rectangular';
    window.__GZ_SIM__.actual.instrumentSamples[spectrum.id] = Array.from({ length: 32 }, (_, index) => ({
      t: index / 32,
      actual: Math.sin(2 * Math.PI * index / 32)
    }));

    window.openSpectrumInstrument(spectrum.id);
    await flushRuntime();

    expect(document.querySelector('[data-spectrum-peak-frequency]')?.textContent).toBe('1.0000Hz');
    expect(document.querySelector('[data-spectrum-peak-amplitude]')?.textContent).toBe('10.00 dBm');
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
