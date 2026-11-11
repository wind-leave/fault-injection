import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { COMPONENT_GROUPS } from '../src/services/componentRegistry.js';
import { syncDiscoveredComponents } from '../src/services/discoveredComponentCatalogService.js';
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

function externalComponent(moduleId, group) {
  return {
    moduleId, group, name: moduleId, category: '测试', fileName: `${moduleId}.py`,
    entryFunction: 'process', requiresPower: false, inputs: [], parameters: [],
    outputs: [{ portId: 'out', varName: 'value', name: '输出' }],
  };
}

describe('simulation palette lifecycle', () => {
  afterEach(() => {
    syncDiscoveredComponents([]);
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it.each([
    ['builtin', 'electrical', 'electrical_dc_boost'],
    ['builtin', 'simulation', 'scalar_to_vector4'],
    ['external', 'electrical', 'external_electrical'],
    ['external', 'simulation', 'external_simulation'],
  ])('hides a dropped %s %s entry and restores it after deletion', async (source, group, moduleId) => {
    const groupConfig = COMPONENT_GROUPS.find((item) => item.id === group);
    const externalOnly = groupConfig.externalOnly;
    if (source === 'builtin') groupConfig.externalOnly = false;
    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();
      window.doCreateBlankWorkspace();
      if (source === 'external') {
        syncDiscoveredComponents([externalComponent(moduleId, group)]);
        await flushRuntime();
      }

      const selector = `[data-component="${moduleId}"]`;
      const paletteItem = document.querySelector(selector);
      const viewport = document.getElementById('canvas-viewport');
      const dataTransfer = createDataTransfer();
      expect(paletteItem).toBeTruthy();
      expect(viewport).toBeTruthy();

      dispatchDrag(paletteItem, 'dragstart', dataTransfer);
      dispatchDrag(viewport, 'drop', dataTransfer, { clientX: 420, clientY: 260 });
      await flushRuntime();

      expect(document.querySelector(selector)).toBeNull();
      const node = window.__GZ_STATE__.modelNodes.find((item) => item.templateId === moduleId);
      expect(node).toBeTruthy();
      if (group === 'electrical') {
        const nodeElement = document.getElementById(`b-${node.id}`);
        expect(nodeElement?.classList.contains('b-electrical')).toBe(true);
        if (source === 'builtin') {
          expect(nodeElement?.dataset.visualKind).toBe('electrical');
          expect(nodeElement?.querySelector('.blk-kicker')?.textContent).toBe('电气');
        }
      }

      window.selectNode(node.id);
      window.deleteCurrentSelection();
      await flushRuntime();

      expect(document.querySelector(selector)).toBeTruthy();
    } finally {
      groupConfig.externalOnly = externalOnly;
      wrapper.unmount();
    }
  });

  it('keeps an imported external template occupied until the last instance is deleted', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();
      const moduleId = 'external_existing_simulation';
      const definition = externalComponent(moduleId, 'simulation');
      const selector = `[data-component="${moduleId}"]`;
      window.doCreateBlankWorkspace();
      syncDiscoveredComponents([definition]);
      window.createNode(moduleId, 320, 220);
      window.createNode(moduleId, 620, 220);
      const exported = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();

      window.doCreateBlankWorkspace();
      syncDiscoveredComponents([]);
      expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(exported)).toMatchObject({ ok: true });
      syncDiscoveredComponents([definition]);
      await flushRuntime();
      expect(document.querySelector(selector)).toBeNull();

      for (const node of [...window.__GZ_STATE__.modelNodes]) {
        window.selectNode(node.id);
        window.deleteCurrentSelection();
        await flushRuntime();
        expect(Boolean(document.querySelector(selector))).toBe(window.__GZ_STATE__.modelNodes.length === 0);
      }

      expect(window.undoCanvasCommand()).toMatchObject({ ok: true });
      await flushRuntime();
      expect(document.querySelector(selector)).toBeNull();
      expect(window.redoCanvasCommand()).toMatchObject({ ok: true });
      await flushRuntime();
      expect(document.querySelector(selector)).toBeTruthy();
    } finally {
      wrapper.unmount();
    }
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
