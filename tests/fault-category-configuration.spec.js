import { mount } from '@vue/test-utils';
import { afterEach, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';
import { applyScalarFault, applyComplexEnvelopeFault } from '../src/services/faultInjectionService.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  localStorage.clear();
  document.body.innerHTML = '';
  __resetLegacyRuntimeForTests();
});

async function openDialog(layer) {
  wrapper = mount(App, { attachTo: document.body });
  await nextTick();
  await Promise.resolve();
  window.doCreateBlankWorkspace();
  const source = window.createNode('simulation_block', 200, 200);
  source.props.modelParameters = [{key: 'gain', name: '增益'}];
  source.props.outputs = [{key: 'signal', name: '信号', type: '标量'}];
  source.props.faultInjection = {physical: ['gain'], electrical: ['signal'], protocol: []};
  const sink = window.createNode('simulation_block', 500, 200);
  const edge = {id: 'category-edge', sourceNodeId: source.id, targetNodeId: sink.id, sourcePortIndex: 0, targetPortIndex: 0};
  window.__GZ_STATE__.modelEdges.push(edge);
  window.renderModelNodes();
  if (layer === 'protocol') {
    window.selectEdge(edge.id);
    window.openProtocolFaultImport();
  } else {
    window.openComponentLayeredFaultDialog(source.id);
    document.querySelector(`[data-component-fault-layer="${layer}"]`).click();
  }
  return document.querySelector('[data-layered-fault-binding-dialog]');
}

function select(dialog, selector, value) {
  const input = dialog.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('change', {bubbles: true}));
}

const categories = [
  ['analog', ['偏差', '卡位', '渐变', '突变']],
  ['state', ['状态突变', '信号阻塞', '间歇故障']],
  ['communication', ['通信延迟', '随机丢包', '报文篡改', '通信中断']]
];

it.each(['physical', 'electrical', 'protocol'])('%s requires category selection and switches all three mode groups', async (layer) => {
  const dialog = await openDialog(layer);
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector('[data-layered-fault-category]').value).toBe('');
  expect(dialog.querySelector('[data-layered-fault-confirm]').disabled).toBe(true);
  expect(dialog.querySelector('[data-layered-fault-config]').hidden).toBe(true);
  for (const [category, labels] of categories) {
    select(dialog, '[data-layered-fault-category]', category);
    expect([...dialog.querySelectorAll('[data-layered-fault-option="model"]')].map(node => node.textContent)).toEqual(labels);
    expect(dialog.querySelector('[data-layered-noise-enabled]').checked).toBe(false);
    expect(dialog.querySelector('[data-layered-fault-confirm]').disabled).toBe(false);
  }
});

it.each(['physical', 'electrical', 'protocol'].flatMap(layer => ['gaussian_noise', 'uniform_white_noise', 'gaussian_colored_noise'].map(type => [layer, type])))('%s saves %s as an overlay on the selected fault', async (layer, type) => {
  const dialog = await openDialog(layer);
  select(dialog, '[data-layered-fault-category]', 'analog');
  dialog.querySelector('[data-layered-fault-param="bias"]').value = '2';
  const enabled = dialog.querySelector('[data-layered-noise-enabled]');
  enabled.checked = true;
  enabled.dispatchEvent(new Event('change', {bubbles: true}));
  select(dialog, '[data-layered-noise-type]', type);
  const noiseHost = dialog.querySelector('[data-layered-noise-params]');
  expect(!!noiseHost.querySelector('[data-layered-fault-param="alpha"]')).toBe(type === 'gaussian_colored_noise');
  noiseHost.querySelector('[data-layered-fault-param="mean"]').value = '0.5';
  dialog.querySelector('[data-layered-fault-confirm]').click();
  expect(document.querySelector('[data-layered-fault-binding-dialog]')).toBeNull();
  const state = window.__GZ_STATE__;
  expect(state.faultInstances[0]).toMatchObject({faultCategory: 'analog', runtimeBehavior: 'bias', parameters: {bias: 2, noiseType: type, noiseEnabled: 1, noiseMean: 0.5}});
  const executable = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
  expect(executable.faultInstances[0]).toMatchObject({faultCategory: 'analog', parameters: {bias: 2, noiseType: type, noiseEnabled: 1}});
});

it('blocks invalid noise parameters and omits noise when it is switched off', async () => {
  const dialog = await openDialog('electrical');
  select(dialog, '[data-layered-fault-category]', 'state');
  const enabled = dialog.querySelector('[data-layered-noise-enabled]');
  enabled.checked = true;
  enabled.dispatchEvent(new Event('change', {bubbles: true}));
  dialog.querySelector('[data-layered-noise-params] [data-layered-fault-param="std"]').value = '-1';
  dialog.querySelector('[data-layered-fault-confirm]').click();
  expect(window.__GZ_STATE__.faultInstances).toHaveLength(0);
  expect(dialog.querySelector('[data-layered-fault-error]').hidden).toBe(false);
  enabled.checked = false;
  enabled.dispatchEvent(new Event('change', {bubbles: true}));
  dialog.querySelector('[data-layered-fault-confirm]').click();
  expect(window.__GZ_STATE__.faultInstances[0].parameters).not.toHaveProperty('noiseEnabled');
});

it.each(['physical', 'electrical', 'protocol'].flatMap(layer => [
  ['delay', 'link_delay'], ['dropout', 'random_packet_loss'], ['tamper', 'data_tamper'], ['data_cutoff', 'signal_cutoff']
].map(([mode, backendType]) => [layer, mode, backendType])))('%s binds communication mode %s and exports an executable type', async (layer, mode, backendType) => {
  const dialog = await openDialog(layer);
  select(dialog, '[data-layered-fault-category]', 'communication');
  dialog.querySelector(`[data-layered-fault-option="model"][data-layered-fault-option-value="${mode}"]`).click();
  dialog.querySelector('[data-layered-fault-confirm]').click();
  expect(window.__GZ_STATE__.faultInstances[0]).toMatchObject({faultCategory: 'communication', runtimeBehavior: mode});
  const executable = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(window.__GZ_STATE__);
  expect(executable.faultInstances[0].faultType).toBe(backendType);
});

it.each(['gaussian_noise', 'uniform_white_noise', 'gaussian_colored_noise'])('%s adds noise after the fault exactly once and obeys its time window', (type) => {
  const params = {targetValue: 4, start: 1, duration: 2, noiseEnabled: 1, noiseType: type, noiseMean: 2, noiseStd: 0, noiseAmplitude: 0};
  expect(applyScalarFault(10, {behavior: 'step', params, time: 0})).toBe(10);
  expect(applyScalarFault(10, {behavior: 'step', params, time: 1})).toBe(6);
  expect(applyScalarFault(10, {behavior: 'step', params, time: 4})).toBe(10);
  const value = {i: 10, q: 20, referenceFrequencyHz: 2e9};
  expect(applyComplexEnvelopeFault(value, {behavior: 'step', params, time: 1})).toEqual({...value, i: 6, q: 6});
});
