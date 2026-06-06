import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function dispatchClick(target) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function mountWorkbench() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  return wrapper;
}

describe('signal routing integration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('allows one output port to branch into multiple downstream inputs', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 220, 220);
    window.createNode('simulation_block', 520, 220);
    window.createNode('instrument_scope', 820, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const sim = state.modelNodes.find((node) => node.type === 'simulation_block');
    const scope = state.modelNodes.find((node) => node.type === 'instrument_scope');

    const sourcePort = document.querySelector('.blk.b-source .node-port--output');
    const simInput = document.querySelector('.blk.b-sim .node-port--input');
    const scopeInput = document.querySelector('.blk.b-inst .node-port--input');

    dispatchClick(sourcePort);
    dispatchClick(simInput);
    await flushRuntime();

    dispatchClick(sourcePort);
    dispatchClick(scopeInput);
    await flushRuntime();

    const branchedEdges = state.modelEdges.filter(
      (edge) => edge.sourceNodeId === source.id && (edge.sourcePortIndex || 0) === 0
    );
    expect(branchedEdges).toHaveLength(2);
    expect(branchedEdges.map((edge) => edge.targetNodeId)).toEqual(expect.arrayContaining([sim.id, scope.id]));
    expect(new Set(branchedEdges.map((edge) => `${edge.targetNodeId}:${edge.targetPortIndex || 0}`)).size).toBe(2);

    wrapper.unmount();
  });

  it('still rejects a duplicate edge between the same source and target ports', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 220, 220);
    window.createNode('simulation_block', 520, 220);
    await flushRuntime();

    const sourcePort = document.querySelector('.blk.b-source .node-port--output');
    const simInput = document.querySelector('.blk.b-sim .node-port--input');

    dispatchClick(sourcePort);
    dispatchClick(simInput);
    await flushRuntime();

    dispatchClick(sourcePort);
    dispatchClick(simInput);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);

    wrapper.unmount();
  });

  it('still rejects a second upstream connection into the same input port', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 220, 220);
    window.createNode('signal_source', 220, 360);
    window.createNode('simulation_block', 520, 280);
    await flushRuntime();

    const sourcePorts = document.querySelectorAll('.blk.b-source .node-port--output');
    const simInput = document.querySelector('.blk.b-sim .node-port--input');

    dispatchClick(sourcePorts[0]);
    dispatchClick(simInput);
    await flushRuntime();

    dispatchClick(sourcePorts[1]);
    dispatchClick(simInput);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);

    wrapper.unmount();
  });

  it('presents flow_block as a signal adapter block in the palette and node card', async () => {
    const wrapper = await mountWorkbench();

    const paletteItem = document.querySelector('[data-component="flow_block"]');
    expect(paletteItem?.textContent).toContain('适配');

    window.createNode('flow_block', 360, 220);
    await flushRuntime();

    const nodeCard = document.querySelector('.blk.b-flow');
    expect(nodeCard?.textContent).toContain('适配');

    const state = window.__GZ_STATE__;
    const flow = state.modelNodes.find((node) => node.type === 'flow_block');
    window.selectNode(flow.id);
    await flushRuntime();

    const inspector = document.getElementById('pd');
    expect(inspector?.textContent).toContain('信号适配配置');
    expect(inspector?.textContent).not.toContain('绑定 Python');
    expect(inspector?.textContent).not.toContain('解除 Python');

    wrapper.unmount();
  });

  it('shows gain, sum, and mux blocks in the palette and creates nodes with visible ports', async () => {
    const wrapper = await mountWorkbench();

    expect(document.querySelector('[data-component="gain_block"]')).not.toBeNull();
    expect(document.querySelector('[data-component="sum_block"]')).not.toBeNull();
    expect(document.querySelector('[data-component="mux_block"]')).not.toBeNull();

    window.createNode('gain_block', 220, 180);
    window.createNode('sum_block', 460, 180);
    window.createNode('mux_block', 700, 180);
    await flushRuntime();

    const gain = document.querySelector('.blk.b-gain');
    const sum = document.querySelector('.blk.b-sum');
    const mux = document.querySelector('.blk.b-mux');

    expect(gain).not.toBeNull();
    expect(sum).not.toBeNull();
    expect(mux).not.toBeNull();
    expect(gain?.querySelectorAll('.node-port--input')).toHaveLength(1);
    expect(gain?.querySelectorAll('.node-port--output')).toHaveLength(1);
    expect(sum?.querySelectorAll('.node-port--input')).toHaveLength(2);
    expect(sum?.querySelectorAll('.node-port--output')).toHaveLength(1);
    expect(mux?.querySelectorAll('.node-port--input')).toHaveLength(2);
    expect(mux?.querySelectorAll('.node-port--output')).toHaveLength(1);

    wrapper.unmount();
  });

  it('evaluates gain_block as scalar multiplication', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 180, 180);
    window.createNode('gain_block', 420, 180);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const gain = state.modelNodes.find((node) => node.type === 'gain_block');

    source.props.waveType = '常值';
    source.props.amplitude = '2';
    source.props.frequency = '0';
    source.props.outputFormat = '标量';
    gain.props.gain = '0.5';
    gain.props.inputFormat = '标量';
    gain.props.outputFormat = '标量';
    state.modelEdges.push({
      id: 'edge-source-gain',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: gain.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });

    const value = window.resolveNodeOutput(gain.id, 0, 'actual', 0, 0.1, new Map(), new Set());
    expect(value).toBe(1);

    wrapper.unmount();
  });

  it('evaluates sum_block and mux_block with explicit multi-input semantics', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 180, 180);
    window.createNode('signal_source', 180, 320);
    window.createNode('sum_block', 460, 180);
    window.createNode('mux_block', 720, 180);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const [sourceA, sourceB] = state.modelNodes.filter((node) => node.type === 'signal_source');
    const sum = state.modelNodes.find((node) => node.type === 'sum_block');
    const mux = state.modelNodes.find((node) => node.type === 'mux_block');

    sourceA.props.waveType = '常值';
    sourceA.props.amplitude = '2';
    sourceA.props.frequency = '0';
    sourceB.props.waveType = '常值';
    sourceB.props.amplitude = '3';
    sourceB.props.frequency = '0';
    sum.props.inputCount = 2;
    sum.props.signs = ['+', '+'];
    mux.props.inputCount = 2;

    state.modelEdges.push(
      {
        id: 'edge-a-sum',
        lineType: 'normal',
        sourceNodeId: sourceA.id,
        targetNodeId: sum.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-b-sum',
        lineType: 'normal',
        sourceNodeId: sourceB.id,
        targetNodeId: sum.id,
        sourcePortIndex: 0,
        targetPortIndex: 1
      },
      {
        id: 'edge-a-mux',
        lineType: 'normal',
        sourceNodeId: sourceA.id,
        targetNodeId: mux.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-b-mux',
        lineType: 'normal',
        sourceNodeId: sourceB.id,
        targetNodeId: mux.id,
        sourcePortIndex: 0,
        targetPortIndex: 1
      }
    );

    const sumValue = window.resolveNodeOutput(sum.id, 0, 'actual', 0, 0.1, new Map(), new Set());
    const muxValue = window.resolveNodeOutput(mux.id, 0, 'actual', 0, 0.1, new Map(), new Set());

    expect(sumValue).toBe(5);
    expect(muxValue).toEqual([2, 3]);

    wrapper.unmount();
  });

  it('preserves mux vectors when routing through downstream blocks', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('signal_source', 180, 180);
    window.createNode('signal_source', 180, 320);
    window.createNode('mux_block', 460, 220);
    window.createNode('flow_block', 760, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const [sourceA, sourceB] = state.modelNodes.filter((node) => node.type === 'signal_source');
    const mux = state.modelNodes.find((node) => node.type === 'mux_block');
    const adapter = state.modelNodes.find((node) => node.type === 'flow_block');

    sourceA.props.waveType = '常值';
    sourceA.props.amplitude = '2';
    sourceA.props.frequency = '0';
    sourceB.props.waveType = '常值';
    sourceB.props.amplitude = '3';
    sourceB.props.frequency = '0';
    mux.props.inputCount = 2;
    adapter.props.inputFormat = '向量';
    adapter.props.outputFormat = '向量';

    state.modelEdges.push(
      {
        id: 'edge-a-mux-route',
        lineType: 'normal',
        sourceNodeId: sourceA.id,
        targetNodeId: mux.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-b-mux-route',
        lineType: 'normal',
        sourceNodeId: sourceB.id,
        targetNodeId: mux.id,
        sourcePortIndex: 0,
        targetPortIndex: 1
      },
      {
        id: 'edge-mux-adapter-route',
        lineType: 'normal',
        sourceNodeId: mux.id,
        targetNodeId: adapter.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      }
    );

    const adapterValue = window.resolveNodeOutput(adapter.id, 0, 'actual', 0, 0.1, new Map(), new Set());
    expect(adapterValue).toEqual([2, 3]);

    wrapper.unmount();
  });
});
