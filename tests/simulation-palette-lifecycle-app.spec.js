import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function createDataTransfer() {
  const data = new Map();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      data.set(type, value);
    },
    getData(type) {
      return data.get(type) || '';
    }
  };
}

function dispatchDrag(target, type, dataTransfer, { clientX = 0, clientY = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY }
  });
  target.dispatchEvent(event);
}

describe('simulation palette lifecycle', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('hides a dropped electrical entry and restores it when its canvas instance is deleted', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();

    const paletteItem = document.querySelector('[data-component="electrical_dc_boost"]');
    const viewport = document.getElementById('canvas-viewport');
    const dataTransfer = createDataTransfer();
    expect(paletteItem).toBeTruthy();
    expect(viewport).toBeTruthy();

    dispatchDrag(paletteItem, 'dragstart', dataTransfer);
    dispatchDrag(viewport, 'drop', dataTransfer, { clientX: 420, clientY: 260 });
    await flushRuntime();

    expect(document.querySelector('[data-component="electrical_dc_boost"]')).toBeNull();
    const node = window.__GZ_STATE__.modelNodes.find((item) => item.templateId === 'electrical_dc_boost');
    expect(node).toBeTruthy();
    const nodeElement = document.getElementById(`b-${node.id}`);
    expect(nodeElement?.classList.contains('b-electrical')).toBe(true);
    expect(nodeElement?.dataset.visualKind).toBe('electrical');
    expect(nodeElement?.querySelector('.blk-kicker')?.textContent).toBe('电气');

    window.selectNode(node.id);
    window.deleteCurrentSelection();
    await flushRuntime();

    expect(document.querySelector('[data-component="electrical_dc_boost"]')).toBeTruthy();
    wrapper.unmount();
  });

  it('uses a normal line whenever an electrical component is connected to a simulation component', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const electrical = window.createNode('electrical_dc_boost', 280, 260);
    const simulation = window.createNode('rf_downconverter', 560, 260);
    const event = { stopPropagation() {} };

    window.handlePortClick(event, electrical.id, 'output', 0);
    window.handlePortClick(event, simulation.id, 'input', 0);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: electrical.id,
        targetNodeId: simulation.id,
        lineType: 'normal'
      })
    ]);

    wrapper.unmount();
  });

  it('connects an electrical output to a simulation component power input', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const electrical = window.createNode('electrical_ac_power_source', 280, 260);
    const simulation = window.createNode('rf_downconverter', 560, 260);
    const powerInputIndex = window.getNodePorts(simulation).inputs.findIndex((port) => port.kind === 'powerInput');
    const event = { stopPropagation() {} };

    expect(powerInputIndex).toBeGreaterThanOrEqual(0);
    window.handlePortClick(event, electrical.id, 'output', 0);
    window.handlePortClick(event, simulation.id, 'input', powerInputIndex);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelEdges).toEqual([
      expect.objectContaining({
        sourceNodeId: electrical.id,
        targetNodeId: simulation.id,
        sourcePortIndex: 0,
        targetPortIndex: powerInputIndex,
        lineType: 'normal'
      })
    ]);

    wrapper.unmount();
  });

  it('gates local simulation output by supply connection, type, and voltage', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();

    const electrical = window.createNode('electrical_ac_power_source', 280, 260);
    const simulation = window.createNode('simulation_block', 560, 260);
    const powerInputIndex = window.getNodePorts(simulation).inputs.findIndex((port) => port.kind === 'powerInput');

    expect(window.__GZ_IS_SIMULATION_COMPONENT_POWERED__(simulation)).toBe(false);
    expect(window.buildSimulationResult(simulation, {}, [5], 'actual', 0, 0.1).outputs).toEqual([0]);

    const vectorSimulation = window.createNode('scalar_to_vector4', 760, 420);
    expect(window.executeBoundFlowBlock(vectorSimulation, {}, [5], 'actual', 0, 0.1).outputs).toEqual([
      [0, 0, 0, 0]
    ]);

    window.__GZ_STATE__.modelEdges.push({
      id: 'wrong-power',
      lineType: 'normal',
      sourceNodeId: electrical.id,
      targetNodeId: simulation.id,
      sourcePortIndex: 0,
      targetPortIndex: powerInputIndex
    });

    expect(window.__GZ_IS_SIMULATION_COMPONENT_POWERED__(simulation)).toBe(false);
    expect(window.buildSimulationResult(simulation, {}, [5, 220], 'actual', 0, 0.1).outputs).toEqual([0]);

    simulation.props.powerInputs[0] = {
      ...simulation.props.powerInputs[0],
      voltage: '220V',
      supplyType: 'AC'
    };

    expect(window.__GZ_IS_SIMULATION_COMPONENT_POWERED__(simulation)).toBe(true);
    const powered = window.buildSimulationResult(simulation, {}, [5, 220], 'actual', 0, 0.1);
    expect(powered.outputs[0]).toBeGreaterThan(0);
    expect(powered.outputs[0]).toBeLessThan(1);

    wrapper.unmount();
  });

  it('cycles the canvas line view between all, signal, and electrical topology', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const electrical = window.createNode('electrical_ac_power_source', 180, 220);
    const simulationA = window.createNode('rf_downconverter', 500, 180);
    const simulationB = window.createNode('rf_downconverter', 820, 320);
    const powerInputIndex = window.getNodePorts(simulationA).inputs.findIndex((port) => port.kind === 'powerInput');
    const state = window.__GZ_STATE__;
    state.modelEdges.push(
      { id: 'edge-electrical-simulation', lineType: 'normal', sourceNodeId: electrical.id, targetNodeId: simulationA.id, sourcePortIndex: 0, targetPortIndex: powerInputIndex },
      { id: 'edge-simulation-simulation', lineType: 'normal', sourceNodeId: simulationA.id, targetNodeId: simulationB.id, sourcePortIndex: 0, targetPortIndex: 0 }
    );
    window.renderModelNodes();
    window.renderEdges();

    const edgeElements = (id) => Array.from(document.querySelectorAll(`[data-edge-id="${id}"]`));
    expect(document.getElementById('canvas-line-view-toggle')?.textContent).toBe('全部');
    expect(document.getElementById(`b-${electrical.id}`)?.style.display).toBe('');
    expect(edgeElements('edge-electrical-simulation').every((element) => element.style.display === '')).toBe(true);
    expect(edgeElements('edge-simulation-simulation').every((element) => element.style.display === '')).toBe(true);

    window.cycleCanvasLineView();
    expect(window.getCanvasLineView()).toBe('signal');
    expect(document.getElementById('canvas-line-view-toggle')?.textContent).toBe('信号');
    expect(document.getElementById(`b-${electrical.id}`)?.style.display).toBe('none');
    expect(edgeElements('edge-electrical-simulation').every((element) => element.style.display === 'none')).toBe(true);
    expect(edgeElements('edge-simulation-simulation').every((element) => element.style.display === '')).toBe(true);

    window.cycleCanvasLineView();
    expect(window.getCanvasLineView()).toBe('electrical');
    expect(document.getElementById('canvas-line-view-toggle')?.textContent).toBe('电气');
    expect(document.getElementById(`b-${electrical.id}`)?.style.display).toBe('');
    expect(edgeElements('edge-electrical-simulation').every((element) => element.style.display === '')).toBe(true);
    expect(edgeElements('edge-simulation-simulation').every((element) => element.style.display === 'none')).toBe(true);

    window.cycleCanvasLineView();
    expect(window.getCanvasLineView()).toBe('all');
    expect(document.getElementById('canvas-line-view-toggle')?.textContent).toBe('全部');
    expect(edgeElements('edge-simulation-simulation').every((element) => element.style.display === '')).toBe(true);

    wrapper.unmount();
  });
});
