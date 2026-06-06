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
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.getElementById(`b-${block.id}`)?.classList.contains('faulted')).toBe(true);
    expect(document.querySelector('[data-fault-binding-id="binding-test"]')).not.toBeNull();
    expect(document.querySelector('.props-fault-param-grid')).not.toBeNull();
    expect(document.querySelector('.props-fault-param')?.textContent).toContain('offset');

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

  it('describes protocol edge faults as faults on transmitted connection data', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const edge = state.modelEdges.find((item) => item.id === 'edge-motor-motor1');
    const injector = window.createNode('protocol_fault_injector', 420, 260);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge',
      targetId: edge.id,
      mathModel: 'tamper',
      parameters: { value: 1, start: 0, duration: '', mode: 'overwrite' }
    });
    await flushRuntime();

    expect(result).toMatchObject({
      ok: true,
      targetKind: 'edge',
      injectionForm: 'protocol-bus',
      bindingObject: 'motor.command.m1'
    });

    window.selectEdge(edge.id);
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    const panelText = document.getElementById('pd')?.textContent || '';
    expect(document.querySelector('[data-fault-binding-target]')).not.toBeNull();
    expect(panelText).toContain('故障对象');
    expect(panelText).toContain('连接线传递数据');
    expect(panelText).toContain('绑定信号');
    expect(panelText).toContain('motor.command.m1');
    expect(panelText).toContain('通道ID');
    expect(panelText).toContain('CAN-FC-M1');
    expect(panelText).toContain('CAN报文');
    expect(panelText).toContain('0x211');
    expect(panelText).toContain('协议层故障作用于当前连接线传递的数据');

    wrapper.unmount();
  });

  it('renders stable property panel tabs for every non-fault component type', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const componentTypes = [
      'signal_source',
      'flow_block',
      'gain_block',
      'sum_block',
      'mux_block',
      'simulation_block',
      'subsystem_block',
      'instrument_scope',
      'instrument_spectrum',
      'instrument_logger'
    ];

    for (const [index, type] of componentTypes.entries()) {
      const node = window.createNode(type, 180 + index * 24, 180 + index * 18);
      await flushRuntime();

      window.selectNode(node.id);
      await flushRuntime();

      window.setPropertyPanelTab('overview');
      await flushRuntime();
      if (type === 'instrument_scope') {
        expect(document.querySelector('[data-scope-overview-panel]')).not.toBeNull();
        expect(document.querySelector('.props-target-card')).toBeNull();
      } else {
        expect(document.querySelector('.props-target-card')).not.toBeNull();
      }
      expect(document.getElementById('pd')?.textContent).toContain(node.props.name);

      window.setPropertyPanelTab('parameters');
      await flushRuntime();
      expect(document.querySelector('.props-form')).not.toBeNull();
      expect(document.querySelector('.props-save')).not.toBeNull();
      if (type === 'instrument_scope') {
        window.setPropertyPanelTab('faults');
        await flushRuntime();
        expect(document.querySelector('[data-props-tab="faults"]')?.hidden).toBe(true);
        expect(document.querySelector('.props-fault-panel')).toBeNull();
        expect(document.querySelector('[data-scope-overview-panel]')).not.toBeNull();

        window.setPropertyPanelTab('outputs');
        await flushRuntime();
        expect(document.querySelector('[data-props-tab="outputs"]')?.textContent?.trim()).toBe('导出设置');
        expect(document.querySelector('[data-scope-export-settings]')).not.toBeNull();
        expect(document.querySelector('.props-target-card')).toBeNull();
        continue;
      }
      expect(document.getElementById('pd')?.textContent).toContain('保存设置');

      window.setPropertyPanelTab('faults');
      await flushRuntime();
      expect(document.querySelector('.props-fault-panel')).not.toBeNull();
      expect(document.querySelector('.props-fault-section')).not.toBeNull();
      expect(document.getElementById('pd')?.textContent).toContain('故障实例');

      window.setPropertyPanelTab('outputs');
      await flushRuntime();
      expect(document.querySelector('.props-target-card')).not.toBeNull();
      expect(document.getElementById('pd')?.textContent).toContain('端口与变量');
    }

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

  it('renders distinct property panel shells for component, scope, edge, and fault injector targets', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    expect(importResult).toMatchObject({ ok: true });

    const scope = window.createNode('instrument_scope', 520, 240);
    const injector = window.createNode('protocol_fault_injector', 360, 360);
    await flushRuntime();

    const component = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'simulation_block');
    const edge = window.__GZ_STATE__.modelEdges.find((item) => item.id === 'edge-motor-motor1');

    window.selectNode(component.id);
    await flushRuntime();
    expect(document.querySelector('[data-props-panel-kind="component"]')).not.toBeNull();

    window.selectNode(scope.id);
    await flushRuntime();
    expect(document.querySelector('[data-props-panel-kind="scope"]')).not.toBeNull();

    window.selectEdge(edge.id);
    await flushRuntime();
    expect(document.querySelector('[data-props-panel-kind="edge"]')).not.toBeNull();

    window.selectNode(injector.id);
    await flushRuntime();
    expect(document.querySelector('[data-props-panel-kind="fault-injector"]')).not.toBeNull();

    wrapper.unmount();
  });

  it('keeps a fault tag inside its dedicated property panel when switching tabs', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const edge = window.__GZ_STATE__.modelEdges.find((item) => item.id === 'edge-motor-motor1');
    const injector = window.createNode('protocol_fault_injector', 420, 260);
    await flushRuntime();

    const bindResult = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge',
      targetId: edge.id,
      mathModel: 'tamper',
      parameters: { value: 1, start: 0, duration: '', mode: 'overwrite' }
    });
    await flushRuntime();

    expect(bindResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.faultTags).toHaveLength(1);

    const tag = window.__GZ_STATE__.faultTags[0];
    window.selectFaultTag(tag.id);
    await flushRuntime();

    expect(document.querySelector('[data-props-panel-kind="fault-tag"]')).not.toBeNull();
    expect(document.querySelector(`[data-fault-tag-inspector="${tag.id}"]`)).not.toBeNull();
    expect(document.querySelector('.fault-tag-overview-panel')).not.toBeNull();
    const overviewText = document.querySelector('.fault-tag-overview-panel')?.textContent || '';
    expect(overviewText).toContain('\u7ed1\u5b9a\u6982\u89c8');
    expect(overviewText).toContain('\u76ee\u6807\u5bf9\u8c61');
    expect(overviewText).toContain('\u76ee\u6807\u7c7b\u578b');
    expect(overviewText).toContain('\u8fd0\u884c\u884c\u4e3a');
    expect(overviewText).toContain('\u6545\u969c\u53c2\u6570');
    expect(overviewText).toContain('\u8fde\u63a5\u7ebf');
    expect(overviewText).toContain('\u534f\u8bae\u5c42');
    expect(overviewText).toContain('\u5df2\u6ce8\u5165');
    expect(overviewText).toContain('\u6545\u969c\u503c');
    expect(overviewText).toContain('\u5f00\u59cb\u65f6\u95f4');
    expect(overviewText).toContain('\u6301\u7eed\u65f6\u95f4');
    expect(overviewText).toContain('\u5199\u5165\u65b9\u5f0f');
    expect(overviewText).not.toContain('\ufffd');
    expect(document.querySelector('[data-props-tab="faults"]')?.hidden).toBe(true);
    expect(document.querySelector('[data-props-tab="outputs"]')?.hidden).toBe(true);
    expect(document.querySelectorAll('.props-target-card')).toHaveLength(0);

    expect(document.querySelector('[data-fault-tag-edit-params]')).not.toBeNull();
    document.querySelector('[data-fault-tag-edit-params]').click();
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="parameters"]')?.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('[data-props-panel-kind="fault-tag"]')).not.toBeNull();
    expect(document.querySelector(`[data-fault-tag-param-panel="${tag.id}"]`)).not.toBeNull();
    const parameterText = document.querySelector(`[data-fault-tag-param-panel="${tag.id}"]`)?.textContent || '';
    expect(parameterText).toContain('\u6545\u969c\u53c2\u6570');
    expect(parameterText).toContain('\u6545\u969c\u503c');
    expect(parameterText).toContain('\u5f00\u59cb\u65f6\u95f4');
    expect(parameterText).toContain('\u6301\u7eed\u65f6\u95f4');
    expect(parameterText).toContain('\u5199\u5165\u65b9\u5f0f');
    expect(parameterText).not.toContain('\ufffd');

    setFieldValue('[data-fault-tag-param="value"]', '9');
    expect(document.querySelector('[data-fault-tag-apply]')?.disabled).toBe(false);
    document.querySelector('[data-fault-tag-apply]').click();
    await flushRuntime();

    const updatedTag = window.__GZ_STATE__.faultTags.find((item) => item.id === tag.id);
    const updatedEdge = window.__GZ_STATE__.modelEdges.find((item) => item.id === edge.id);
    expect(updatedTag.parameters.value).toBe('9');
    expect(updatedTag.injectedFault.parameters.value).toBe('9');
    expect(updatedEdge.injectedFault.parameters.value).toBe('9');

    window.setPropertyPanelTab('overview');
    await flushRuntime();
    const updatedOverviewText = document.querySelector('.fault-tag-overview-panel')?.textContent || '';
    expect(updatedOverviewText).toContain('\u6545\u969c\u503c');
    expect(updatedOverviewText).toContain('9');
    wrapper.unmount();
  });

  it('deletes the selected fault tag and runtime binding with the Delete key', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const target = state.modelNodes.find((node) => node.id === 'node-imu');
    const injector = window.createNode('electrical_fault_injector', 420, 260);
    await flushRuntime();

    const bindResult = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'node',
      targetId: target.id,
      slotId: 'electrical:测量角速度',
      mathModel: 'bias',
      parameters: { bias: 5, start: 1, duration: 2 }
    });
    await flushRuntime();

    expect(bindResult).toMatchObject({ ok: true });
    expect(target.faultBindings?.some((binding) => binding.active !== false)).toBe(true);
    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetId: target.id,
      slotId: 'electrical:测量角速度'
    }));

    const tag = state.faultTags.find((item) => item.targetId === target.id);
    expect(tag).toBeTruthy();
    tag.expanded = true;
    tag.collapsed = false;
    window.renderModelNodes();
    window.renderEdges();
    await flushRuntime();

    const tagEl = document.querySelector(`[data-fault-tag-id="${tag.id}"]`);
    expect(tagEl).not.toBeNull();
    tagEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushRuntime();

    expect(state.selFaultTag).toBe(tag.id);
    expect(document.querySelector(`[data-fault-tag-id="${tag.id}"]`)?.classList.contains('is-selected')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(state.selFaultTag).toBeNull();
    expect(state.faultTags.some((item) => item.id === tag.id)).toBe(false);
    expect(state.faultInstances.some((instance) => (
      instance.targetId === target.id
      && instance.slotId === 'electrical:测量角速度'
      && instance.active !== false
    ))).toBe(false);
    expect(target.faultBindings?.some((binding) => binding.active !== false)).toBe(false);
    expect(target.injectedFault).toBeUndefined();
    expect(document.querySelector(`[data-fault-tag-id="${tag.id}"]`)).toBeNull();

    wrapper.unmount();
  });

  it('edits component-owned injectable variables from the fault settings tab', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.type === 'simulation_block');
    block.props.name = 'Attitude controller';
    block.props.modelParameters = [
      { key: 'A', name: 'Gain A', targetField: 'params.A' },
      { key: 'D', name: 'Limit D', targetField: 'params.D' }
    ];
    block.props.inputs = [
      { varName: 'B', name: 'Pitch error', signalId: 'attitude.pitch_error' }
    ];
    block.props.outputs = [
      { varName: 'E', name: 'Torque demand', signalId: 'attitude.torque_demand' }
    ];
    block.props.middleVars = [
      { varName: 'C', name: 'Integrator state', targetField: 'state.integrator' }
    ];
    block.props.faultInjection = {
      physical: ['A'],
      electrical: [],
      protocol: []
    };
    block.faultSlots = [];
    state.activeModelPackage = {
      modelId: 'test-package',
      modelName: 'Test package',
      systemModel: { nodes: [block], edges: [] },
      workbenchSnapshot: { modelNodes: [block], modelEdges: [] },
      faultCapabilityMap: []
    };

    window.selectNode(block.id);
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    expect(document.querySelector('[data-fault-slot-editor]')).not.toBeNull();
    expect(document.querySelector('.props-fault-slot-table')).not.toBeNull();
    expect(document.querySelector('.props-fault-slot-head')).not.toBeNull();
    expect(document.querySelectorAll('.props-layer-toggle')).toHaveLength(15);
    expect(document.querySelector('.props-fault-actions .props-save')).not.toBeNull();
    expect(document.querySelector('[data-fault-slot-variable="A"]')?.textContent).toContain('Gain A');
    expect(document.querySelector('[data-fault-slot-variable="D"]')?.textContent).toContain('Limit D');
    expect(document.querySelector('[data-fault-slot-variable="B"]')?.textContent).toContain('Pitch error');
    expect(document.querySelector('[data-fault-slot-variable="E"]')?.textContent).toContain('Torque demand');
    expect(document.querySelector('[data-fault-slot-variable="C"]')?.textContent).toContain('Integrator state');
    expect(document.querySelector('[data-fault-slot-layer="physical"][data-fault-slot-var="A"]').checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="D"]').checked).toBe(false);

    setCheckboxValue('[data-fault-slot-layer="physical"][data-fault-slot-var="D"]', true);
    setCheckboxValue('[data-fault-slot-layer="electrical"][data-fault-slot-var="D"]', true);
    setCheckboxValue('[data-fault-slot-layer="electrical"][data-fault-slot-var="B"]', true);
    setCheckboxValue('[data-fault-slot-layer="electrical"][data-fault-slot-var="E"]', true);
    setCheckboxValue('[data-fault-slot-layer="electrical"][data-fault-slot-var="C"]', true);
    setCheckboxValue('[data-fault-slot-layer="protocol"][data-fault-slot-var="D"]', true);
    document.querySelector('[data-save-fault-slots]').click();
    await flushRuntime();

    expect(block.props.faultInjection).toEqual({
      physical: ['A', 'D'],
      electrical: ['D', 'B', 'E', 'C'],
      protocol: ['D']
    });
    expect(block.faultSlots.map((slot) => slot.slotId)).toEqual([
      'physical:A',
      'physical:D',
      'electrical:D',
      'electrical:B',
      'electrical:E',
      'electrical:C',
      'protocol:D'
    ]);
    expect(block.faultSlots.find((slot) => slot.slotId === 'physical:A')).toMatchObject({
      slotName: 'Gain A',
      targetField: 'params.A'
    });
    expect(block.faultSlots.find((slot) => slot.slotId === 'electrical:D')).toMatchObject({
      slotName: 'Limit D',
      targetField: 'params.D',
      bindingObject: 'D',
      targetVariable: 'D'
    });
    expect(block.faultSlots.find((slot) => slot.slotId === 'electrical:B')).toMatchObject({
      slotName: 'Pitch error',
      variableRole: 'input',
      targetField: 'inputs.B',
      bindingObject: 'B',
      targetVariable: 'B'
    });
    expect(block.faultSlots.find((slot) => slot.slotId === 'electrical:E')).toMatchObject({
      slotName: 'Torque demand',
      variableRole: 'output',
      targetField: 'outputs.E',
      bindingObject: 'E',
      targetVariable: 'E'
    });
    expect(block.faultSlots.find((slot) => slot.slotId === 'electrical:C')).toMatchObject({
      slotName: 'Integrator state',
      variableRole: 'middle',
      targetField: 'state.integrator',
      bindingObject: 'C',
      targetVariable: 'C'
    });
    expect(state.activeModelPackage.faultCapabilityMap.find((entry) => entry.targetId === block.id)).toMatchObject({
      targetKind: 'node',
      targetId: block.id,
      faultSlots: expect.arrayContaining([
        expect.objectContaining({ slotId: 'protocol:D', slotName: 'Limit D' })
      ])
    });

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

  it('shows module-owned interface variables in the fault settings variable list', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.selectNode('node-controller');
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    const variables = Array.from(document.querySelectorAll('[data-fault-slot-variable]'))
      .map((row) => row.getAttribute('data-fault-slot-variable'));

    expect(variables).toEqual([
      'controller_gain',
      'controller_integrator_limit',
      '姿态误差',
      '力矩需求',
      '积分状态'
    ]);
    expect(document.querySelectorAll('.props-layer-toggle')).toHaveLength(15);
    expect(document.querySelector('[data-fault-slot-variable="姿态误差"]')?.textContent).toContain('姿态误差');
    expect(document.querySelector('[data-fault-slot-variable="力矩需求"]')?.textContent).toContain('力矩需求');
    expect(document.querySelector('[data-fault-slot-variable="积分状态"]')?.textContent).toContain('积分状态');
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="姿态误差"]').checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="力矩需求"]').checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-layer="electrical"][data-fault-slot-var="积分状态"]').checked).toBe(true);
    expect(document.querySelector('[data-fault-slot-variable="motor_command_payload"]')).toBeNull();

    wrapper.unmount();
  });

  it('opens slot-aware fault injection from the fault settings action', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.id === 'node-controller');
    block.props.name = 'Attitude controller';
    block.props.inputs = [
      { varName: 'attitude_error', name: 'Attitude error' }
    ];
    block.props.outputs = [
      { varName: 'torque_request', name: 'Torque request' }
    ];
    block.props.faultInjection = {
      physical: [],
      electrical: ['attitude_error', 'torque_request'],
      protocol: []
    };
    block.faultSlots = [
      {
        slotId: 'electrical:attitude_error',
        slotName: 'Attitude error',
        layer: 'electrical',
        variableKey: 'attitude_error',
        variableRole: 'input',
        bindingObject: 'attitude_error',
        targetVariable: 'attitude_error',
        targetField: 'inputs.attitude_error',
        allowedFaultTypeIds: ['sensor_additive_bias']
      },
      {
        slotId: 'electrical:torque_request',
        slotName: 'Torque request',
        layer: 'electrical',
        variableKey: 'torque_request',
        variableRole: 'output',
        bindingObject: 'torque_request',
        targetVariable: 'torque_request',
        targetField: 'outputs.torque_request',
        allowedFaultTypeIds: ['sensor_additive_bias']
      }
    ];
    state.activeModelPackage = {
      modelId: 'slot-aware-test',
      modelName: 'Slot aware test',
      systemModel: { nodes: [block], edges: [] },
      workbenchSnapshot: { modelNodes: [block], modelEdges: [] },
      faultTypeCatalog: [
        {
          id: 'sensor_additive_bias',
          displayName: 'Sensor additive bias',
          name: 'Sensor additive bias',
          layer: 'electrical',
          runtimeBehavior: 'additive_bias',
          defaultParameters: { offset: 0.1, start: 0 }
        }
      ],
      faultCapabilityMap: [
        {
          targetKind: 'node',
          targetId: block.id,
          targetName: block.props.name,
          faultSlots: block.faultSlots
        }
      ]
    };

    window.selectNode(block.id);
    await flushRuntime();
    window.setPropertyPanelTab('faults');
    await flushRuntime();

    document.querySelector('.props-fault-action').click();
    await flushRuntime();

    const dialog = document.querySelector('[data-target-fault-dialog]');
    expect(dialog).not.toBeNull();
    const choices = Array.from(document.querySelectorAll('[data-activate-compatible-fault="sensor_additive_bias"]'));
    expect(choices).toHaveLength(2);

    const torqueChoice = document.querySelector('[data-activate-compatible-fault="sensor_additive_bias"][data-activate-fault-slot="electrical:torque_request"]');
    expect(torqueChoice).not.toBeNull();
    expect(torqueChoice.textContent).toContain('torque_request');
    torqueChoice.click();
    await flushRuntime();

    const panel = document.querySelector('[data-target-fault-parameters]');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('torque_request');
    panel.querySelector('[data-confirm-target-fault]').click();
    await flushRuntime();

    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      faultTypeId: 'sensor_additive_bias',
      targetKind: 'node',
      targetId: block.id,
      slotId: 'electrical:torque_request',
      bindingObject: 'torque_request',
      targetVariable: 'torque_request',
      targetField: 'outputs.torque_request'
    }));
    expect(block.injectedFault).toMatchObject({
      modelId: 'sensor_additive_bias',
      slotId: 'electrical:torque_request',
      bindingObject: 'torque_request',
      targetVariable: 'torque_request',
      targetField: 'outputs.torque_request'
    });
    expect(state.faultTags).toContainEqual(expect.objectContaining({
      faultModelId: 'sensor_additive_bias',
      targetId: block.id,
      slotId: 'electrical:torque_request',
      bindingObject: 'torque_request'
    }));

    window.setPropertyPanelTab('faults');
    await flushRuntime();

    const clearButton = document.querySelector('.props-fault-clear');
    expect(clearButton).not.toBeNull();
    expect(window.clearFaultBindings('node', block.id)).toBe(true);
    await flushRuntime();

    expect(block.injectedFault).toBeUndefined();
    expect(block.faultBindings?.filter((binding) => binding.active !== false)).toHaveLength(0);
    expect(state.faultInstances?.some((instance) => (
      instance.active !== false
      && instance.faultTypeId === 'sensor_additive_bias'
      && instance.targetId === block.id
      && instance.slotId === 'electrical:torque_request'
    ))).toBe(false);
    expect(state.faultTags?.some((tag) => (
      tag.faultModelId === 'sensor_additive_bias'
      && tag.targetId === block.id
      && tag.slotId === 'electrical:torque_request'
    ))).toBe(false);
    expect(state.faultInjectionLinks?.some((link) => (
      link.faultModelId === 'sensor_additive_bias'
      && (link.targetNodeId === block.id || link.targetId === block.id)
    ))).toBe(false);
    expect(document.getElementById('pd')?.textContent).toContain('No active faults');

    wrapper.unmount();
  });

  it('edits CAN edge signal metadata for multi-signal flow inspection', async () => {
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

  it('preserves secondary CAN signal channels when saving primary edge metadata', async () => {
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

  it('renders CAN edge inspector sections for route, channels, faults, and diagnostics', async () => {
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

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-edge-channel-list]')).not.toBeNull();
    expect(document.querySelector('[data-edge-channel-card="primary"]')).not.toBeNull();
    expect(document.querySelector('[data-edge-channel-card="secondary"]')).not.toBeNull();
    expect(document.getElementById('prop-edge-signal-id')).not.toBeNull();
    expect(document.getElementById('prop-edge-channel-id')).not.toBeNull();
    expect(document.getElementById('prop-edge-message-id')).not.toBeNull();
    expect(pd()?.textContent).toContain('通道配置');
    expect(pd()?.textContent).toContain('连接类型');
    expect(pd()?.textContent).toContain('主通道');
    expect(pd()?.textContent).toContain('可编辑');
    expect(pd()?.textContent).toContain('信号ID');
    expect(pd()?.textContent).toContain('通道ID');
    expect(pd()?.textContent).toContain('CAN报文ID');
    expect(pd()?.textContent).toContain('信号角色');
    expect(pd()?.textContent).toContain('单位');
    expect(pd()?.textContent).toContain('载荷类型');
    expect(pd()?.textContent).toContain('采样率');
    expect(pd()?.textContent).toContain('故障传播策略');
    expect(pd()?.textContent).not.toContain('Channel configuration');
    expect(pd()?.textContent).not.toContain('primary channel');
    expect(pd()?.textContent).not.toContain('editable');
    expect(pd()?.textContent).not.toContain('No secondary channels');

    document.getElementById('prop-edge-signal-id').value = 'imu.pitch_rate.filtered';
    document.getElementById('prop-edge-channel-id').value = 'CAN-FC-02';
    document.getElementById('prop-edge-message-id').value = '0x186';
    window.saveSelectedEdgeMetadata();
    await flushRuntime();

    const edge = state.modelEdges.find((item) => item.id === 'edge-can-inspector');
    expect(edge.signalChannels).toHaveLength(2);
    expect(edge.signalChannels[0]).toMatchObject({
      signalId: 'imu.pitch_rate.filtered',
      channelId: 'CAN-FC-02',
      messageId: '0x186'
    });
    expect(edge.signalChannels[1]).toMatchObject({
      signalId: 'imu.temperature',
      channelId: 'CAN-FC-IMU',
      messageId: '0x185'
    });

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

    window.setPropertyPanelTab('outputs');
    await flushRuntime();

    expect(document.querySelector('[data-edge-diagnostics]')).not.toBeNull();
    ['currentValue', 'residual', 'latency', 'dropRate', 'burstLength', 'status'].forEach((label) => {
      expect(pd()?.textContent).toContain(label);
    });
    expect(pd()?.textContent).toContain('CAN-FC-02');
    expect(pd()?.textContent).toContain('CAN-FC-IMU');
    expect(pd()?.textContent).toContain('delay');

    wrapper.unmount();
  });

  it('shows a Chinese edge summary before internal variable mapping', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.selectEdge('edge-imu-error');
    await flushRuntime();

    const summary = document.querySelector('[data-edge-chinese-summary]');
    const internalMapping = document.querySelector('[data-edge-internal-mapping]');
    const pd = () => document.getElementById('pd');

    expect(document.querySelector('[data-edge-overview]')).not.toBeNull();
    expect(document.querySelector('[data-edge-route]')).not.toBeNull();
    expect(document.querySelector('[data-edge-channel-count]')).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(internalMapping).not.toBeNull();
    expect(summary.compareDocumentPosition(internalMapping) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(pd()?.textContent).toContain('链路概览');
    expect(pd()?.textContent).toContain('连接关系');
    expect(pd()?.textContent).toContain('源模块');
    expect(pd()?.textContent).toContain('目标模块');
    expect(pd()?.textContent).toContain('连线类型');
    expect(pd()?.textContent).toContain('总线类型');
    expect(pd()?.textContent).toContain('通道数量');
    expect(pd()?.textContent).toContain('故障来源');
    expect(pd()?.textContent).toContain('主信号：imu.pitch_rate');
    expect(pd()?.textContent).not.toContain('Route identity');
    expect(pd()?.textContent).not.toContain('中文链路摘要');

    expect(summary.textContent).toContain('链路摘要');
    expect(summary.textContent).toContain('IMU');
    expect(summary.textContent).toContain('测量反馈');
    expect(summary.textContent).toContain('测点');
    expect(summary.textContent).toContain('传播');

    expect(internalMapping.textContent).toContain('边ID');
    expect(internalMapping.textContent).toContain('源节点ID');
    expect(internalMapping.textContent).toContain('目标节点ID');
    expect(internalMapping.textContent).toContain('信号ID');
    expect(internalMapping.textContent).toContain('通道ID');
    expect(internalMapping.textContent).toContain('CAN报文');
    expect(internalMapping.textContent).toContain('Python变量');
    expect(internalMapping.textContent).toContain('edge-imu-error');
    expect(internalMapping.textContent).toContain('imu.pitch_rate');
    expect(internalMapping.textContent).toContain('CAN-FC-IMU');
    expect(internalMapping.textContent).toContain('0x184');

    ['涓', '鎸', '娴嬬', '浼犳', '鈫'].forEach((marker) => {
      expect(pd()?.textContent).not.toContain(marker);
    });

    wrapper.unmount();
  });

  it('shows localized parameter empty states for single-channel edges', async () => {
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

  it('opens authoring dialogs from visible palette actions', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    await flushRuntime();

    document.querySelector('[data-open-component-authoring]').click();
    await flushRuntime();

    expect(document.querySelector('[data-testid="component-authoring-dialog"]')).not.toBeNull();

    setFieldValue('[data-authoring-component-name]', '入口测试模块');
    setFieldValue('[data-authoring-slot-name]', '入口测试故障位');
    document.querySelector('[data-save-authored-component]').click();
    await flushRuntime();

    const node = window.__GZ_STATE__.modelNodes.find((item) => item.props?.name === '入口测试模块');
    window.selectNode(node.id);
    await flushRuntime();

    expect(document.querySelector('[data-open-fault-authoring-for-selected]')).toBeNull();
    expect(document.querySelector('[data-testid="fault-authoring-dialog"]')).toBeNull();

    wrapper.unmount();
  });
});
