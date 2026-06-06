import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function dispatchDoubleClick(target) {
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

function dispatchClick(target, options = {}) {
  target.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...options
  }));
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

function connectCanvasNodes(canvas, edgeId, sourceNodeId, targetNodeId, sourcePortIndex = 0, targetPortIndex = 0) {
  canvas.edges.push({
    id: edgeId,
    lineType: 'normal',
    sourceNodeId,
    targetNodeId,
    sourcePortIndex,
    targetPortIndex
  });
}

describe('subsystem hierarchy app integration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('shows subsystem_block in the palette and creates an empty child canvas for it', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('[data-component="subsystem_block"]')).not.toBeNull();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    expect(subsystemNode.type).toBe('subsystem_block');
    expect(subsystemNode.targetCanvasId).toBeTruthy();
    expect(state.canvases[subsystemNode.targetCanvasId]).toMatchObject({
      id: subsystemNode.targetCanvasId,
      parentSubsystemNodeId: subsystemNode.id,
      nodes: [],
      edges: []
    });
  });

  it('enters a subsystem canvas on double click and returns to root through breadcrumbs', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const subsystemNode = document.querySelector('.blk.b-subsystem');
    expect(subsystemNode).not.toBeNull();

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 220,
      clientY: 180,
      button: 0
    });
    Object.defineProperty(pointerDown, 'pointerId', { value: 11 });
    expect(subsystemNode.dispatchEvent(pointerDown)).toBe(true);
    expect(pointerDown.defaultPrevented).toBe(false);

    dispatchClick(subsystemNode);
    dispatchClick(subsystemNode);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const childCanvasId = state.canvases['canvas-root'].nodes[0].targetCanvasId;
    expect(state.activeCanvasId).toBe(childCanvasId);
    expect(state.canvasTrail).toEqual(['canvas-root', childCanvasId]);
    expect(document.querySelector('[data-testid="canvas-breadcrumbs"]')).not.toBeNull();

    window.createNode('signal_source', 300, 260);
    await flushRuntime();

    expect(state.canvases[childCanvasId].nodes).toHaveLength(1);
    expect(state.canvases['canvas-root'].nodes).toHaveLength(1);

    document.querySelector('[data-breadcrumb-root]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flushRuntime();

    expect(state.activeCanvasId).toBe('canvas-root');
    expect(document.querySelectorAll('.blk').length).toBe(1);
  });

  it('truncates the breadcrumb trail when navigating back to an ancestor canvas', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const rootSubsystemId = window.__GZ_STATE__.canvases['canvas-root'].nodes[0].id;
    window.openSubsystemCanvas(rootSubsystemId);
    await flushRuntime();

    window.createNode('subsystem_block', 520, 320);
    await flushRuntime();

    const levelOneCanvasId = window.__GZ_STATE__.activeCanvasId;
    const nestedSubsystemId = window.__GZ_STATE__.canvases[levelOneCanvasId].nodes[0].id;
    window.openSubsystemCanvas(nestedSubsystemId);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    expect(state.canvasTrail).toHaveLength(3);

    window.navigateToCanvas(levelOneCanvasId);
    await flushRuntime();

    expect(state.activeCanvasId).toBe(levelOneCanvasId);
    expect(state.canvasTrail).toEqual(['canvas-root', levelOneCanvasId]);
  });

  it('edits subsystem nodes through a dedicated node form instead of link fields', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    const nameInput = document.getElementById('prop-name');
    expect(nameInput).not.toBeNull();
    expect(document.getElementById('prop-linkType')).toBeNull();
    expect(document.getElementById('prop-sourcePort')).toBeNull();
    expect(document.getElementById('prop-targetPort')).toBeNull();

    nameInput.value = '飞控主控';
    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.props.name).toBe('飞控主控');
    expect(subsystemNode.targetCanvasId).toBeTruthy();
    expect(subsystemNode.props.linkType).toBeUndefined();
    expect(subsystemNode.props.sourcePort).toBeUndefined();
    expect(subsystemNode.props.targetPort).toBeUndefined();
  });

  it('exports and re-imports hierarchy snapshots into a fresh runtime without flattening child canvases', async () => {
    const firstWrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const rootSubsystemId = window.__GZ_STATE__.canvases['canvas-root'].nodes[0].id;
    window.openSubsystemCanvas(rootSubsystemId);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const childCanvasId = state.activeCanvasId;
    state.canvasScale = 1.75;
    state.canvasOffsetX = 86;
    state.canvasOffsetY = 52;

    window.createNode('signal_source', 320, 240);
    await flushRuntime();

    const exported = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(exported.workbenchSnapshot.rootCanvasId).toBe('canvas-root');
    expect(exported.workbenchSnapshot.activeCanvasId).toBe(childCanvasId);
    expect(exported.workbenchSnapshot.canvasTrail).toEqual(['canvas-root', childCanvasId]);
    expect(exported.workbenchSnapshot.canvases['canvas-root'].nodes).toHaveLength(1);
    expect(exported.workbenchSnapshot.canvases[childCanvasId].nodes).toHaveLength(1);

    firstWrapper.unmount();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();

    const secondWrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(exported);
    await flushRuntime();

    const importedState = window.__GZ_STATE__;
    expect(importResult).toMatchObject({ ok: true });
    expect(importedState.rootCanvasId).toBe('canvas-root');
    expect(importedState.activeCanvasId).toBe(childCanvasId);
    expect(importedState.canvasTrail).toEqual(['canvas-root', childCanvasId]);
    expect(importedState.canvases['canvas-root'].nodes).toHaveLength(1);
    expect(importedState.canvases[childCanvasId].nodes).toHaveLength(1);
    expect(importedState.canvasScale).toBe(1.75);
    expect(importedState.canvasOffsetX).toBe(86);
    expect(importedState.canvasOffsetY).toBe(52);

    secondWrapper.unmount();
  });

  it('keeps independent viewport scale and offsets for each canvas when navigating hierarchies', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootSubsystemId = state.canvases['canvas-root'].nodes[0].id;
    state.canvasScale = 1.25;
    state.canvasOffsetX = 40;
    state.canvasOffsetY = 24;

    window.openSubsystemCanvas(rootSubsystemId);
    await flushRuntime();

    const childCanvasId = state.activeCanvasId;
    state.canvasScale = 1.6;
    state.canvasOffsetX = 60;
    state.canvasOffsetY = 48;

    window.goToRootCanvas();
    await flushRuntime();

    expect(state.activeCanvasId).toBe('canvas-root');
    expect(state.canvasScale).toBe(1.25);
    expect(state.canvasOffsetX).toBe(40);
    expect(state.canvasOffsetY).toBe(24);
    expect(state.canvases['canvas-root'].viewport).toMatchObject({
      scale: 1.25,
      offsetX: 40,
      offsetY: 24
    });
    expect(state.canvases[childCanvasId].viewport).toMatchObject({
      scale: 1.6,
      offsetX: 60,
      offsetY: 48
    });
  });

  it('requires a movement threshold before blank-canvas panning changes the viewport', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const viewport = document.getElementById('canvas-viewport');
    const startX = state.canvasOffsetX;
    const startY = state.canvasOffsetY;

    dispatchPointer(viewport, 'pointerdown', { pointerId: 21, clientX: 120, clientY: 120 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 21, clientX: 123, clientY: 124 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 21, clientX: 123, clientY: 124 });
    await flushRuntime();

    expect(state.canvasOffsetX).toBe(startX);
    expect(state.canvasOffsetY).toBe(startY);

    dispatchPointer(viewport, 'pointerdown', { pointerId: 22, clientX: 120, clientY: 120 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 22, clientX: 154, clientY: 156 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 22, clientX: 154, clientY: 156 });
    await flushRuntime();

    expect(state.canvasOffsetX).not.toBe(startX);
    expect(state.canvasOffsetY).not.toBe(startY);
  });

  it('requires a movement threshold before node dragging repositions a node', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 320, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const node = state.canvases['canvas-root'].nodes[0];
    const nodeEl = document.getElementById(`b-${node.id}`);
    const startX = node.x;
    const startY = node.y;

    dispatchPointer(nodeEl, 'pointerdown', { pointerId: 31, clientX: 200, clientY: 180 });
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointermove', { pointerId: 31, clientX: 203, clientY: 183 });
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointerup', { pointerId: 31, clientX: 203, clientY: 183 });
    await flushRuntime();

    expect(node.x).toBe(startX);
    expect(node.y).toBe(startY);

    dispatchPointer(nodeEl, 'pointerdown', { pointerId: 32, clientX: 200, clientY: 180 });
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointermove', { pointerId: 32, clientX: 232, clientY: 214 });
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointerup', { pointerId: 32, clientX: 232, clientY: 214 });
    await flushRuntime();

    expect(node.x).not.toBe(startX);
    expect(node.y).not.toBe(startY);
  });

  it('syncs subsystem interfaces into stable parent ports and child boundary nodes', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    const inputCount = document.getElementById('subsystem-input-count');
    const outputCount = document.getElementById('subsystem-output-count');
    expect(inputCount).not.toBeNull();
    expect(outputCount).not.toBeNull();

    inputCount.value = '2';
    outputCount.value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();

    const inputRows = [...document.querySelectorAll('.subsystem-intf-row[data-subsystem-role="input"]')];
    const outputRows = [...document.querySelectorAll('.subsystem-intf-row[data-subsystem-role="output"]')];
    expect(inputRows).toHaveLength(2);
    expect(outputRows).toHaveLength(1);

    inputRows[0].querySelector('[data-subsystem-field="name"]').value = '姿态误差';
    inputRows[1].querySelector('[data-subsystem-field="name"]').value = '高度误差';
    outputRows[0].querySelector('[data-subsystem-field="name"]').value = '控制输出';

    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.props.interface.inputs).toHaveLength(2);
    expect(subsystemNode.props.interface.outputs).toHaveLength(1);
    expect(subsystemNode.props.interface.inputs.map((item) => item.name)).toEqual(['姿态误差', '高度误差']);
    expect(subsystemNode.props.interface.outputs[0].name).toBe('控制输出');

    const subsystemShell = document.getElementById(`b-${subsystemNode.id}`);
    expect(subsystemShell?.querySelectorAll('.node-port--input')).toHaveLength(2);
    expect(subsystemShell?.querySelectorAll('.node-port--output')).toHaveLength(1);

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port')).toHaveLength(2);
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port').map((node) => node.props.name)).toEqual(['姿态误差', '高度误差']);
    expect(childCanvas.nodes.find((node) => node.type === 'subsystem_out_port')?.props.name).toBe('控制输出');

    window.openSubsystemCanvas(subsystemNode.id);
    await flushRuntime();

    expect(document.querySelectorAll('.blk.b-subsystem-port-in')).toHaveLength(2);
    expect(document.querySelectorAll('.blk.b-subsystem-port-out')).toHaveLength(1);
  });

  it('prunes stale parent edges when a subsystem interface shrinks', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 180, 220);
    window.createNode('signal_source', 180, 320);
    window.createNode('subsystem_block', 440, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const sourceNodes = rootCanvas.nodes.filter((node) => node.type === 'signal_source');
    const subsystemNode = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    document.getElementById('subsystem-input-count').value = '2';
    document.getElementById('subsystem-output-count').value = '0';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    rootCanvas.edges.push(
      {
        id: 'edge-subsystem-prune-0',
        lineType: 'normal',
        sourceNodeId: sourceNodes[0].id,
        targetNodeId: subsystemNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-subsystem-prune-1',
        lineType: 'normal',
        sourceNodeId: sourceNodes[1].id,
        targetNodeId: subsystemNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 1
      }
    );

    document.getElementById('subsystem-input-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    expect(rootCanvas.edges).toHaveLength(1);
    expect(rootCanvas.edges[0].targetPortIndex).toBe(0);
  });

  it('removes a child canvas when its subsystem shell is deleted', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    const childCanvasId = subsystemNode.targetCanvasId;

    window.selectNode(subsystemNode.id);
    await flushRuntime();
    window.deleteSelectedNode();
    await flushRuntime();

    expect(state.canvases[childCanvasId]).toBeUndefined();
    expect(state.canvases['canvas-root'].nodes).toHaveLength(0);
  });

  it('does not leak parent input through a subsystem when the child output is disconnected', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('signal_source', 180, 220);
    window.createNode('subsystem_block', 440, 240);
    window.createNode('instrument_scope', 760, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const sourceNode = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const subsystemNode = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const scopeNode = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');

    sourceNode.props.amplitude = '2';
    sourceNode.props.frequency = '1';

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    document.getElementById('subsystem-input-count').value = '1';
    document.getElementById('subsystem-output-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    rootCanvas.edges.push(
      {
        id: 'edge-root-source-subsystem-disconnected',
        lineType: 'normal',
        sourceNodeId: sourceNode.id,
        targetNodeId: subsystemNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-root-subsystem-scope-disconnected',
        lineType: 'normal',
        sourceNodeId: subsystemNode.id,
        targetNodeId: scopeNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      }
    );

    window.simInit(true);
    for (let step = 0; step < 4; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const samples = window.__GZ_SIM__?.actual?.scopeSamples?.[scopeNode.id]?.ch1 ?? [];
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((sample) => Math.abs(sample.actual) < 1e-6)).toBe(true);
  });

  it('propagates signals through a subsystem boundary during simulation', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('signal_source', 180, 220);
    window.createNode('subsystem_block', 440, 240);
    window.createNode('instrument_scope', 760, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const sourceNode = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const subsystemNode = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const scopeNode = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');

    sourceNode.props.amplitude = '2';
    sourceNode.props.frequency = '1';

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    document.getElementById('subsystem-input-count').value = '1';
    document.getElementById('subsystem-output-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();

    document.querySelector('.subsystem-intf-row[data-subsystem-role="input"] [data-subsystem-field="name"]').value = '输入信号';
    document.querySelector('.subsystem-intf-row[data-subsystem-role="output"] [data-subsystem-field="name"]').value = '输出信号';
    window.saveSelectedNode();
    await flushRuntime();

    rootCanvas.edges.push(
      {
        id: 'edge-root-source-subsystem',
        lineType: 'normal',
        sourceNodeId: sourceNode.id,
        targetNodeId: subsystemNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      },
      {
        id: 'edge-root-subsystem-scope',
        lineType: 'normal',
        sourceNodeId: subsystemNode.id,
        targetNodeId: scopeNode.id,
        sourcePortIndex: 0,
        targetPortIndex: 0
      }
    );

    window.openSubsystemCanvas(subsystemNode.id);
    await flushRuntime();

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    const childInput = childCanvas.nodes.find((node) => node.type === 'subsystem_in_port');
    const childOutput = childCanvas.nodes.find((node) => node.type === 'subsystem_out_port');

    childCanvas.edges.push({
      id: 'edge-child-pass-through',
      lineType: 'normal',
      sourceNodeId: childInput.id,
      targetNodeId: childOutput.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });

    window.goToRootCanvas();
    await flushRuntime();

    window.simInit(true);
    for (let step = 0; step < 4; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const samples = window.__GZ_SIM__?.actual?.scopeSamples?.[scopeNode.id]?.ch1 ?? [];
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((sample) => Math.abs(sample.actual) > 0.01)).toBe(true);
  });

  it('propagates a signal through the second subsystem input boundary back to the parent scope', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('signal_source', 180, 220);
    window.createNode('subsystem_block', 440, 240);
    window.createNode('instrument_scope', 760, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const sourceNode = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const subsystemNode = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const scopeNode = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');

    sourceNode.props.amplitude = '2';
    sourceNode.props.frequency = '1';

    window.selectNode(subsystemNode.id);
    await flushRuntime();

    document.getElementById('subsystem-input-count').value = '2';
    document.getElementById('subsystem-output-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    const childInput = childCanvas.nodes
      .filter((node) => node.type === 'subsystem_in_port')
      .find((node) => node.props.order === 1);
    const childOutput = childCanvas.nodes.find((node) => node.type === 'subsystem_out_port');

    expect(childInput).toBeTruthy();
    expect(childOutput).toBeTruthy();

    connectCanvasNodes(rootCanvas, 'edge-root-source-subsystem-second-input', sourceNode.id, subsystemNode.id, 0, 1);
    connectCanvasNodes(rootCanvas, 'edge-root-subsystem-scope-second-input', subsystemNode.id, scopeNode.id, 0, 0);

    connectCanvasNodes(childCanvas, 'edge-child-second-input-pass-through', childInput.id, childOutput.id, 0, 0);

    window.simInit(true);
    for (let step = 0; step < 4; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const samples = window.__GZ_SIM__?.actual?.scopeSamples?.[scopeNode.id]?.ch1 ?? [];
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((sample) => Math.abs(sample.actual) > 0.01)).toBe(true);
  });

  it('wraps a ctrl-click multi-selection into a subsystem and reconnects parent and child canvases', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 160, 220);
    window.createNode('flow_block', 360, 220);
    window.createNode('simulation_block', 600, 220);
    window.createNode('instrument_scope', 860, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const sourceNode = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const flowNode = rootCanvas.nodes.find((node) => node.type === 'flow_block');
    const simulationNode = rootCanvas.nodes.find((node) => node.type === 'simulation_block');
    const scopeNode = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');

    connectCanvasNodes(rootCanvas, 'edge-wrap-source-flow', sourceNode.id, flowNode.id, 0, 0);
    connectCanvasNodes(rootCanvas, 'edge-wrap-flow-sim', flowNode.id, simulationNode.id, 0, 0);
    connectCanvasNodes(rootCanvas, 'edge-wrap-sim-scope', simulationNode.id, scopeNode.id, 0, 0);

    window.renderModelNodes();
    await flushRuntime();

    dispatchClick(document.getElementById(`b-${flowNode.id}`));
    dispatchClick(document.getElementById(`b-${simulationNode.id}`), { ctrlKey: true });
    await flushRuntime();

    expect(typeof window.wrapSelectionIntoSubsystem).toBe('function');

    window.wrapSelectionIntoSubsystem();
    await flushRuntime();

    const wrappedRootCanvas = state.canvases['canvas-root'];
    const subsystemNode = wrappedRootCanvas.nodes.find((node) => node.type === 'subsystem_block');

    expect(subsystemNode).toBeTruthy();
    expect(wrappedRootCanvas.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['signal_source', 'instrument_scope', 'subsystem_block'])
    );
    expect(wrappedRootCanvas.nodes).toHaveLength(3);
    expect(wrappedRootCanvas.edges).toHaveLength(2);
    expect(wrappedRootCanvas.edges.some((edge) => edge.sourceNodeId === sourceNode.id && edge.targetNodeId === subsystemNode.id)).toBe(true);
    expect(wrappedRootCanvas.edges.some((edge) => edge.sourceNodeId === subsystemNode.id && edge.targetNodeId === scopeNode.id)).toBe(true);

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    expect(childCanvas).toBeTruthy();
    expect(childCanvas.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['flow_block', 'simulation_block', 'subsystem_in_port', 'subsystem_out_port'])
    );
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port')).toHaveLength(1);
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === flowNode.id && edge.targetNodeId === simulationNode.id)).toBe(true);

    const childInput = childCanvas.nodes.find((node) => node.type === 'subsystem_in_port');
    const childOutput = childCanvas.nodes.find((node) => node.type === 'subsystem_out_port');
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === childInput.id && edge.targetNodeId === flowNode.id)).toBe(true);
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === simulationNode.id && edge.targetNodeId === childOutput.id)).toBe(true);
  });
});
