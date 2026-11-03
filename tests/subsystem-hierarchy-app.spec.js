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

  it('offers four blank subsystem entries and creates an independent child canvas for each', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const entries = [...document.querySelectorAll('[data-palette-body="subsystem"] .citem-draggable')];
    expect(entries.map((entry) => entry.querySelector('.citem-label')?.textContent.trim())).toEqual([
      '子系统块', '子系统块 2', '子系统块 3', '子系统块 4'
    ]);
    expect(entries.every((entry) => entry.draggable)).toBe(true);
    expect(new Set(entries.map((entry) => entry.dataset.paletteKey)).size).toBe(4);
    expect(entries.map((entry) => entry.dataset.component)).toEqual([
      'subsystem_block', 'subsystem_block_2', 'subsystem_block_3', 'subsystem_block_4'
    ]);

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
    const card = document.getElementById(`b-${subsystemNode.id}`);
    expect(card?.classList.contains('subsystem-card')).toBe(true);
    expect(card?.querySelector('.blk-sub')?.textContent).toBe('双击进入子画布');
    expect(card?.querySelector('.subsystem-card__summary')).toBeNull();
    expect(card?.querySelector('.subsystem-card__open')).toBeNull();

    entries.slice(1).forEach((entry, index) => {
      window.createNode(entry.dataset.component, 420 + index * 210, 320);
    });
    const subsystemNodes = state.canvases['canvas-root'].nodes;
    expect(subsystemNodes).toHaveLength(4);
    expect(subsystemNodes.map((node) => node.props.name)).toEqual([
      '子系统块', '子系统块 2', '子系统块 3', '子系统块 4'
    ]);
    expect(subsystemNodes.map((node) => node.props.subsystemId)).toEqual([
      'subsystem-block-1', 'subsystem-block-2', 'subsystem-block-3', 'subsystem-block-4'
    ]);
    expect(new Set(subsystemNodes.map((node) => node.targetCanvasId)).size).toBe(4);
    subsystemNodes.forEach((node) => {
      expect(state.canvases[node.targetCanvasId]).toMatchObject({
        parentSubsystemNodeId: node.id,
        nodes: [],
        edges: []
      });
    });

    window.createNode('subsystem_block_2', 1040, 320);
    expect(state.canvases['canvas-root'].nodes.at(-1).props.subsystemId).toBe('subsystem-block-2-2');
    const saved = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(saved.workbenchSnapshot.canvases['canvas-root'].nodes.slice(0, 4).map((node) => [
      node.templateId || node.type, node.props.name, node.props.subsystemId
    ])).toEqual([
      ['subsystem_block', '子系统块', 'subsystem-block-1'],
      ['subsystem_block_2', '子系统块 2', 'subsystem-block-2'],
      ['subsystem_block_3', '子系统块 3', 'subsystem-block-3'],
      ['subsystem_block_4', '子系统块 4', 'subsystem-block-4']
    ]);
  });

  it('keeps test points from the top level and a subsystem in global diagnostic views', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.canvases['canvas-root'].nodes = [
      { id: 'root-source', type: 'signal_source', props: { name: '顶层信号' } },
      { id: 'subsystem-1', type: 'subsystem_block', targetCanvasId: 'canvas-child', props: { name: '子系统', interface: { inputs: [], outputs: [] } } }
    ];
    state.canvases['canvas-root'].edges = [
      { id: 'edge-root', sourceNodeId: 'root-source', targetNodeId: 'subsystem-1', sourcePortIndex: 0, targetPortIndex: 0 }
    ];
    state.canvases['canvas-child'] = {
      id: 'canvas-child',
      name: '子系统',
      parentSubsystemNodeId: 'subsystem-1',
      nodes: [
        { id: 'child-source', type: 'signal_source', props: { name: '子系统信号' } },
        { id: 'child-target', type: 'simulation_block', props: { name: '子系统处理' } }
      ],
      edges: [
        { id: 'edge-child', sourceNodeId: 'child-source', targetNodeId: 'child-target', sourcePortIndex: 0, targetPortIndex: 0 }
      ],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.diagnosticTestPoints = [
      { pointId: 'M-root', edgeId: 'edge-root', pointType: 'virtual', detects: [] },
      { pointId: 'M-child', edgeId: 'edge-child', pointType: 'virtual', detects: [] }
    ];
    state.installedDiagnosticTestPointIds = ['M-root', 'M-child'];

    const assertGlobalViews = () => {
      expect(window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).positions.map((point) => point.pointId))
        .toEqual(expect.arrayContaining(['M-root', 'M-child']));
      expect(window.buildDetectionMatrixModel().points.map((point) => point.pointId))
        .toEqual(expect.arrayContaining(['M-root', 'M-child']));
      expect(window.collectDataflowEdges().map((item) => item.edge.id))
        .toEqual(expect.arrayContaining(['edge-root', 'edge-child']));
    };

    assertGlobalViews();
    state.installedDiagnosticTestPointIds = [];
    expect(window.addDiagnosticTestPoint('M-child')).toBe(true);
    expect(state.installedDiagnosticTestPointIds).toContain('M-child');
    window.openSubsystemCanvas('subsystem-1');
    expect(window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).positions.map((point) => point.pointId))
      .toEqual(expect.arrayContaining(['M-root', 'M-child']));
    expect(window.buildDetectionMatrixModel().points.map((point) => point.pointId)).toContain('M-child');
  });

  it('connects a scalar subsystem interface to a float simulation input', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 260, 240);
    const state = window.__GZ_STATE__;
    const subsystem = state.canvases['canvas-root'].nodes[0];
    subsystem.props.interface.outputs = [{
      id: 'subsystem-scalar-output',
      name: '四接口射频信号输出 · 标量输出',
      type: '标量',
      componentNodeId: 'internal-rf-four-output',
      componentPortIndex: 0,
      componentName: '四接口射频信号输出',
      componentPortName: '标量输出',
      order: 0
    }];
    window.renderModelNodes();

    window.createNode('scalar_to_vector4', 560, 240);
    const simulation = state.canvases['canvas-root'].nodes.find((node) => node.type === 'simulation_block');
    expect(window.getNodePorts(simulation).inputs[0].meta.type).toBe('float');

    const event = { stopPropagation() {} };
    window.handlePortClick(event, subsystem.id, 'output', 0);
    window.handlePortClick(event, simulation.id, 'input', 0);

    expect(state.canvases['canvas-root'].edges).toContainEqual(expect.objectContaining({
      sourceNodeId: subsystem.id,
      targetNodeId: simulation.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    }));

    const edge = state.canvases['canvas-root'].edges.find((item) => item.sourceNodeId === subsystem.id);
    window.selectEdge(edge.id);
    expect(document.querySelector('#pd').textContent).toContain('子系统块 → 标量转四维向量');
    expect(document.querySelector('#pd').textContent).not.toContain('四接口射频信号输出 → 标量转四维向量');
    state.canvases[subsystem.targetCanvasId].nodes.push({
      id: 'internal-rf-four-output',
      type: 'simulation_block',
      props: { name: '四接口射频信号输出' }
    });
    window.__GZ_SIM__.actual.nodeStates['internal-rf-four-output'] = { lastOutputs: [42] };
    expect(window.getDataflowEdgeMetrics(edge).currentValue).toBe(42);
    expect(window.collectMeasurementPoints().find((point) => point.edgeId === edge.id)).toMatchObject({
      sourceNodeId: 'internal-rf-four-output',
      sourcePortIndex: 0,
      currentValue: 42
    });
  });

  it('renders a subsystem boundary segment for an external wire and selects its top-level edge properties', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 160, 240);
    const subsystem = window.createNode('subsystem_block', 420, 240);
    source.props.name = '外部信号源';
    subsystem.props.name = '控制子系统';
    window.openSubsystemCanvas(subsystem.id);
    const internal = window.createNode('flow_block', 420, 240);
    internal.props.name = '内部控制组件';
    await flushRuntime();

    window.goToRootCanvas();
    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const externalEdge = {
      id: 'edge-external-to-subsystem',
      lineType: 'normal',
      sourceNodeId: source.id,
      sourcePortIndex: 0,
      targetNodeId: subsystem.id,
      targetPortIndex: 0
    };
    rootCanvas.edges.push(externalEdge);
    window.renderModelNodes();
    await flushRuntime();

    window.openSubsystemCanvas(subsystem.id);
    await flushRuntime();
    const childCanvas = state.canvases[subsystem.targetCanvasId];
    const boundarySegment = childCanvas.edges.find((edge) => edge.subsystemBoundaryMapping);
    expect(boundarySegment).toMatchObject({ linkedExternalEdgeId: externalEdge.id });

    const internalPath = document.querySelector(`.edge-path[data-edge-id="${boundarySegment.id}"]`);
    expect(internalPath).not.toBeNull();
    expect(internalPath?.getAttribute('d')).toMatch(/^M\s+[-\d.]+\s+[-\d.]+\s+L\s+[-\d.]+\s+[-\d.]+$/);
    dispatchClick(internalPath);
    await flushRuntime();

    expect(state.selEdge).toBe(externalEdge.id);
    expect(document.querySelector('#pd')?.textContent).toContain('外部信号源');
    expect(document.querySelector('#pd')?.textContent).toContain('控制子系统');
    expect(document.querySelector('#pd')?.textContent).toContain('输入信号');
    expect(document.querySelector('#pd')?.textContent).not.toContain('内部控制组件');
  });

  it('binds a protocol fault from an output boundary segment to its external wire', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const subsystem = window.createNode('subsystem_block', 420, 240);
    const scope = window.createNode('instrument_scope', 760, 240);
    window.openSubsystemCanvas(subsystem.id);
    const internalSource = window.createNode('signal_source', 320, 240);
    internalSource.props.amplitude = '2';
    internalSource.props.frequency = '1';
    window.goToRootCanvas();
    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const externalEdge = {
      id: 'subsystem-output-to-scope', lineType: 'normal',
      sourceNodeId: subsystem.id, sourcePortIndex: 0,
      targetNodeId: scope.id, targetPortIndex: 0
    };
    rootCanvas.edges.push(externalEdge);
    window.renderModelNodes();
    window.openSubsystemCanvas(subsystem.id);
    await flushRuntime();
    const childCanvas = state.canvases[subsystem.targetCanvasId];
    const segment = childCanvas.edges.find((edge) => edge.subsystemBoundaryMapping && edge.linkedExternalEdgeId === externalEdge.id);
    expect(segment).toBeTruthy();
    const injector = window.createNode('protocol_fault_injector', 560, 440);
    expect(window.beginLayeredFaultBinding(injector.id)).toBe(true);
    const segmentPath = document.querySelector(`.edge-path[data-edge-id="${segment.id}"]`);
    expect(segmentPath).not.toBeNull();
    dispatchPointer(segmentPath, 'pointerup');
    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    dialog.querySelector('[data-layered-fault-option="model"][data-layered-fault-option-value="data_cutoff"]').click();
    dialog.querySelector('[data-layered-fault-confirm]').click();
    await flushRuntime();

    expect(rootCanvas.edges.find((edge) => edge.id === externalEdge.id)?.injectedFault)
      .toMatchObject({ runtimeBehavior: 'data_cutoff' });
    expect(state.faultInstances).toContainEqual(expect.objectContaining({ targetId: externalEdge.id }));
    expect(childCanvas.edges.find((edge) => edge.id === segment.id)?.injectedFault).toBeUndefined();

    const refreshedSegment = document.querySelector(`.edge-path[data-edge-id="${segment.id}"]`);
    dispatchClick(refreshedSegment);
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();
    const externalPoint = state.manualDiagnosticTestPoints.find((point) => point.edgeId === externalEdge.id);
    expect(externalPoint).toBeDefined();
    expect(externalPoint.detects).toContain(state.faultInstances.find((item) => item.targetId === externalEdge.id).faultTypeId);

    window.goToRootCanvas();
    const executable = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(executable.faultInstances).toContainEqual(expect.objectContaining({
      targetId: executable.edges.find((edge) => edge.targetNodeId === scope.id)?.id,
      faultType: 'signal_cutoff'
    }));
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    const actual = window.__GZ_SIM__.actual.scopeSamples[scope.id]?.ch1 ?? [];
    expect(actual).toHaveLength(4);
    expect(actual.every((sample) => Math.abs(sample.actual) < 1e-6)).toBe(true);
  });

  it.each([
    ['physical', 'physical_fault_injector', 'degradation', { scale: 0.5, start: 0, duration: '' }, 'parameter_degradation'],
    ['electrical', 'electrical_fault_injector', 'attenuation', { attenuation_db: 6, start: 0, duration: '' }, 'signal_attenuation'],
    ['protocol', 'protocol_fault_injector', 'data_cutoff', { start: 0, duration: '' }, 'signal_cutoff']
  ])('applies a %s fault to a component or wire inside a subsystem', async (
    layer, injectorType, mathModel, parameters, executableType
  ) => {
    mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 180, 220);
    const subsystem = window.createNode('subsystem_block', 440, 220);
    const scope = window.createNode('instrument_scope', 760, 220);
    source.props.amplitude = '0.2';
    source.props.frequency = '1';
    const state = window.__GZ_STATE__;
    state.sysLoaded = true;
    const root = state.canvases['canvas-root'];
    window.openSubsystemCanvas(subsystem.id);
    const child = state.canvases[subsystem.targetCanvasId];
    const block = window.createNode('simulation_block', 430, 220);
    block.props.moduleType = 'control';
    block.props.requiresPower = false;
    block.props.modelParameters = [{ key: 'controller_gain', name: '控制增益', targetField: 'params.controller_gain' }];
    if (layer === 'protocol') {
      const downstream = window.createNode('gain_block', 650, 220);
      connectCanvasNodes(child, 'internal-block-to-gain', block.id, downstream.id);
      window.renderModelNodes();
    }
    window.goToRootCanvas();
    connectCanvasNodes(root, 'source-to-subsystem', source.id, subsystem.id);
    connectCanvasNodes(root, 'subsystem-to-scope', subsystem.id, scope.id);
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    const baseline = window.__GZ_SIM__.actual.scopeSamples[scope.id].ch1;
    expect(baseline.some((sample) => Math.abs(sample.actual) > 0.001)).toBe(true);

    window.openSubsystemCanvas(subsystem.id);
    const injector = window.createNode(injectorType, 650, 420);
    const target = layer === 'protocol'
      ? child.edges.find((edge) => edge.id === 'internal-block-to-gain')
      : block;
    const slot = layer === 'physical'
      ? window.getLayeredFaultSlotsForTarget(block).find((item) => item.layer === layer && item.parameterKey === 'controller_gain')
      : layer === 'electrical'
        ? window.getLayeredFaultSlotsForTarget(block).find((item) => item.layer === layer && item.variableRole === 'output')
        : window.getLayeredFaultSlotsForTarget(target).find((item) => item.layer === layer);
    expect(slot).toBeDefined();
    const bound = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: layer === 'protocol' ? 'edge' : 'node',
      targetId: target.id,
      slotId: slot.id,
      mathModel,
      parameters
    });
    expect(bound).toMatchObject({ ok: true, targetId: target.id });
    expect(state.faultInstances).toContainEqual(expect.objectContaining({ targetId: target.id, layer }));

    window.goToRootCanvas();
    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    const executableFault = pkg.faultInstances.find((fault) => fault.faultType === executableType);
    expect(executableFault).toBeDefined();
    expect(layer === 'protocol'
      ? pkg.edges.some((edge) => edge.id === executableFault.targetId && edge.sourceNodeId === block.id)
      : executableFault.targetId === block.id).toBe(true);
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    const actual = window.__GZ_SIM__.actual.scopeSamples[scope.id].ch1;
    const largestBaseline = Math.max(...baseline.map((sample) => Math.abs(sample.actual)));
    const largestActual = Math.max(...actual.map((sample) => Math.abs(sample.actual)));
    expect(largestActual).toBeLessThan(layer === 'protocol' ? 1e-6 : largestBaseline * 0.8);
  });

  it('shows an internal subsystem output on a connected display console', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 260, 240);
    window.createNode('display_console', 560, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const subsystem = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const displayConsole = rootCanvas.nodes.find((node) => node.type === 'display_console');
    subsystem.props.interface.outputs = [{
      id: 'subsystem-console-output',
      name: '内部仿真输出',
      type: '向量',
      vectorLength: 7,
      componentNodeId: 'internal-console-source',
      componentPortIndex: 0,
      componentName: '内部仿真组件',
      componentPortName: '输出',
      order: 0
    }];
    displayConsole.props.displayConfig = {
      inputs: [{ key: 'internalValue', label: '内部输出', type: 'float', displayScale: 1 }],
      columns: [{ key: 'internalValue', label: '内部输出', source: 'input', inputIndex: 0 }]
    };
    state.canvases[subsystem.targetCanvasId].nodes.push({
      id: 'internal-console-source',
      type: 'simulation_block',
      props: { name: '内部仿真组件' }
    });
    connectCanvasNodes(rootCanvas, 'edge-subsystem-display-console', subsystem.id, displayConsole.id, 0, 0);
    window.__GZ_SIM__.actual.nodeStates['internal-console-source'] = { lastOutputs: [[42, 2, 3, 4, 5, 6, 7]] };
    window.__GZ_SIM__.componentOutputs = {
      time: [0],
      steps: [{ time: 0, actual: { 'internal-console-source': { output: [42, 2, 3, 4, 5, 6, 7] } } }]
    };

    window.openDisplayConsolePanel(displayConsole.id);

    expect(document.querySelector('[data-display-console-table] tbody td')?.textContent).toBe('42');
    const savedResult = await window.buildSimulationResultSnapshot();
    expect(savedResult.publicData.renderData.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDeviceId: subsystem.props.subsystemId,
        targetDeviceId: displayConsole.id
      })
    ]));
    const savedConsole = savedResult.publicData.renderData.devices.find((device) => device.id === displayConsole.id);
    expect(savedConsole.channels.internalValue).toMatchObject({
      connected: true,
      sourceDeviceId: 'internal-console-source',
      series: [{ t: 0, value: 42 }]
    });
    expect(savedResult.privateData.dMatrix.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayConsoleInput: true, sourceName: '内部仿真组件' })
    ]));
    expect(savedResult.publicData.initialSimulationResult.physicalMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDeviceId: subsystem.props.subsystemId,
        samples: [{ time: 0, actual: 42 }]
      })
    ]));
  });

  it('reads a subsystem input-boundary test point from its external source output', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.canvases['canvas-root'].nodes = [
      { id: 'outside-source', type: 'signal_source', props: { name: '外部信号源' } },
      {
        id: 'subsystem-under-test',
        type: 'subsystem_block',
        targetCanvasId: 'canvas-under-test',
        props: {
          name: '子系统',
          interface: {
            inputs: [{ id: 'subsystem-input', componentNodeId: 'inside-target', componentPortIndex: 0, name: '子系统输入' }],
            outputs: []
          }
        }
      }
    ];
    state.canvases['canvas-root'].edges = [{
      id: 'edge-outside-to-subsystem',
      sourceNodeId: 'outside-source',
      sourcePortIndex: 0,
      targetNodeId: 'subsystem-under-test',
      targetPortIndex: 0
    }];
    state.canvases['canvas-under-test'] = {
      id: 'canvas-under-test',
      parentSubsystemNodeId: 'subsystem-under-test',
      nodes: [
        { id: 'inside-input-boundary', type: 'subsystem_in_port', props: { interfacePortId: 'subsystem-input', order: 0 } },
        { id: 'inside-target', type: 'simulation_block', props: { name: '内部组件' } }
      ],
      edges: [{
        id: 'edge-inside-boundary-to-component',
        sourceNodeId: 'inside-input-boundary',
        sourcePortIndex: 0,
        targetNodeId: 'inside-target',
        targetPortIndex: 0,
        subsystemBoundaryMapping: true,
        interfacePortId: 'subsystem-input'
      }],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.diagnosticTestPoints = [{
      pointId: 'M-subsystem-input-boundary',
      shortName: 'M1',
      name: '子系统内部输入测点',
      edgeId: 'edge-inside-boundary-to-component',
      // A saved legacy point may retain the boundary id. Runtime sampling must
      // still resolve it to the real external signal source.
      measurementSourceNodeId: 'inside-input-boundary',
      measurementSourcePortIndex: 0,
      pointType: 'physical'
    }];
    state.simulationTestPointIds = ['M-subsystem-input-boundary'];
    window.__GZ_SIM__.componentOutputs = {
      time: [0],
      steps: [{
        time: 0,
        actual: { 'outside-source': { output: 37 } },
        reference: { 'outside-source': { output: 37 } }
      }]
    };

    window.setCanvasView('components');
    await flushRuntime();

    const card = document.querySelector('[data-simulation-testpoint="M-subsystem-input-boundary"]');
    expect(card?.textContent).toContain('37');

    // This point is intentionally not installed in the diagnostic matrix.
    // Result export must still retain the external-to-internal boundary wire
    // and sample the resolved external source.
    const savedResult = await window.buildSimulationResultSnapshot();
    expect(savedResult.publicData.initialSimulationResult.physicalMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pointId: 'M-subsystem-input-boundary',
        sourceDeviceId: 'outside-source',
        samples: [{ time: 0, actual: 37 }]
      })
    ]));
  });

  it('uses the mapped internal component element names for a test point on a subsystem input edge', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.canvases['canvas-root'].nodes = [
      {
        id: 'outside-vector-source',
        type: 'simulation_block',
        props: {
          name: '外部向量源',
          outputs: [{
            name: '外部输出',
            type: '向量',
            vectorLength: 4,
            vectorElementNames: ['元素 1', '元素 2', '元素 3', '元素 4']
          }]
        }
      },
      {
        id: 'vector-subsystem',
        type: 'subsystem_block',
        targetCanvasId: 'canvas-vector-subsystem',
        props: {
          name: '向量子系统',
          subsystemId: 'vector-subsystem-public',
          interface: {
            inputs: [{
              id: 'vector-input',
              portId: 'vector-input',
              vectorLength: 4,
              vectorElementNames: ['A', 'B', 'C', 'D'],
              componentNodeId: 'inside-vector-target',
              componentPortIndex: 0,
              componentName: '内部选择器',
              componentPortName: '四路输入',
              name: '内部选择器 · 四路输入'
            }],
            outputs: []
          }
        }
      }
    ];
    state.canvases['canvas-root'].edges = [{
      id: 'edge-vector-source-to-subsystem',
      lineType: 'normal',
      sourceNodeId: 'outside-vector-source',
      sourcePortIndex: 0,
      targetNodeId: 'vector-subsystem',
      targetPortIndex: 0
    }];
    state.canvases['canvas-vector-subsystem'] = {
      id: 'canvas-vector-subsystem',
      parentSubsystemNodeId: 'vector-subsystem',
      nodes: [{
        id: 'inside-vector-target',
        type: 'simulation_block',
        props: {
          name: '内部选择器',
          inputs: [{
            id: 'vector-input',
            name: '四路输入',
            type: '向量',
            vectorLength: 4,
            vectorElementNames: ['A', 'B', 'C', 'D']
          }]
        }
      }],
      edges: [],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.modelNodes = state.canvases['canvas-root'].nodes;
    state.modelEdges = state.canvases['canvas-root'].edges;

    window.renderModelNodes();
    window.renderEdges();
    window.selectEdge('edge-vector-source-to-subsystem');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();

    const options = Array.from(document.querySelectorAll('[data-edge-testpoint-vector-index] option'));
    expect(options.map((option) => option.textContent)).toEqual(['A', 'B', 'C', 'D']);

    window.setCanvasView('dmatrix');
    await flushRuntime();
    expect(document.querySelector('#d-matrix-panel .is-error')).toBeNull();
    expect(document.querySelector('#d-matrix-panel [data-d-matrix-view]')).not.toBeNull();
    window.setCanvasView('canvas');
    window.selectEdge('edge-vector-source-to-subsystem');

    const savedResult = await window.buildSimulationResultSnapshot();
    expect(savedResult.publicData.renderData.connections).toEqual([
      expect.objectContaining({
        id: 'edge-vector-source-to-subsystem',
        sourceDeviceId: 'outside-vector-source',
        targetDeviceId: 'vector-subsystem-public',
        targetPort: 'vector-input',
        label: '外部向量源·外部输出→向量子系统·四路输入'
      })
    ]);
    expect(savedResult.publicData.initialSimulationResult.virtualMeasurements).toContainEqual(expect.objectContaining({
      targetDeviceId: 'vector-subsystem-public',
      targetPort: 'vector-input',
      targetVectorElementName: 'A'
    }));
    expect(savedResult.publicData.renderData.devices.find((device) => device.id === 'vector-subsystem-public')?.measurementPorts)
      .toMatchObject({ inputs: [{ portId: 'vector-input', elementNames: ['A'] }] });
    expect(savedResult.publicData.renderData.connections).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetDeviceId: 'inside-vector-target' })
    ]));
    expect(savedResult.privateData.executableModel.edges).toContainEqual(expect.objectContaining({
      id: 'edge-vector-source-to-subsystem',
      sourceNodeId: 'outside-vector-source',
      targetNodeId: 'inside-vector-target'
    }));

    window.setPropertyPanelTab('overview');
    await flushRuntime();
    const lineNameInput = document.querySelector('#prop-edge-label');
    lineNameInput.value = '外部向量输入 → 向量子系统';
    window.savePropertyPanelTarget();
    const renamedResult = await window.buildSimulationResultSnapshot();
    expect(renamedResult.publicData.renderData.connections).toContainEqual(expect.objectContaining({
      id: 'edge-vector-source-to-subsystem',
      label: '外部向量输入 → 向量子系统'
    }));
  });

  it('keeps measured elements under their corresponding automatic subsystem ports', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const root = state.canvases['canvas-root'];
    root.nodes = [
      { id: 'source-a', type: 'signal_source', props: { name: '信号源 A', outputName: '外部元素 A' } },
      { id: 'source-b', type: 'signal_source', props: { name: '信号源 B', outputName: '外部元素 B' } },
      {
        id: 'two-port-subsystem', type: 'subsystem_block', targetCanvasId: 'canvas-two-port',
        props: {
          name: '双输入子系统', subsystemId: 'two-port-public', interfaceMode: 'auto',
          interface: {
            inputs: [
              { id: 'auto-input-inside-a-input', portId: 'auto-input-inside-a-input', name: '端口 A', componentNodeId: 'inside-a', componentPortIndex: 0, elementNames: ['元素 A'] },
              { id: 'auto-input-inside-b-input', portId: 'auto-input-inside-b-input', name: '端口 B', componentNodeId: 'inside-b', componentPortIndex: 0, elementNames: ['元素 B'] }
            ],
            outputs: []
          }
        }
      }
    ];
    root.edges = [
      { id: 'edge-port-a', sourceNodeId: 'source-a', sourcePortIndex: 0, targetNodeId: 'two-port-subsystem', targetPortIndex: 0 },
      { id: 'edge-port-b', sourceNodeId: 'source-b', sourcePortIndex: 0, targetNodeId: 'two-port-subsystem', targetPortIndex: 1 }
    ];
    state.canvases['canvas-two-port'] = {
      id: 'canvas-two-port', parentSubsystemNodeId: 'two-port-subsystem',
      nodes: [
        { id: 'inside-a', type: 'flow_block', x: 100, y: 100, props: { name: '内部 A', inputName: '元素 A', outputName: '输出 A' } },
        { id: 'inside-b', type: 'flow_block', x: 100, y: 220, props: { name: '内部 B', inputName: '元素 B', outputName: '输出 B' } }
      ],
      edges: [], viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.modelNodes = root.nodes;
    state.modelEdges = root.edges;
    expect(root.nodes[2].props.interface.inputs.map((port) => port.id)).toEqual([
      'auto-input-inside-a-input', 'auto-input-inside-b-input'
    ]);

    state.manualDiagnosticTestPoints = [
      { pointId: 'M-port-a', pointType: 'physical', edgeId: 'edge-port-a' },
      { pointId: 'M-port-b', pointType: 'physical', edgeId: 'edge-port-b' }
    ];
    const result = await window.buildSimulationResultSnapshot();
    const connections = result.publicData.renderData.connections;
    expect(connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edge-port-a', targetDeviceId: 'two-port-public', targetPort: 'auto-input-inside-a-input' }),
      expect.objectContaining({ id: 'edge-port-b', targetDeviceId: 'two-port-public', targetPort: 'auto-input-inside-b-input' })
    ]));
    expect(result.publicData.renderData.devices.find((device) => device.id === 'two-port-public')?.measurementPorts?.inputs)
      .toEqual([
        { portId: 'auto-input-inside-a-input', elementNames: ['元素 A'] },
        { portId: 'auto-input-inside-b-input', elementNames: ['元素 B'] }
      ]);
    expect(result.publicData.initialSimulationResult.physicalMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointId: 'M-port-a', targetDeviceId: 'two-port-public', targetPort: 'auto-input-inside-a-input', targetElementName: '元素 A' }),
      expect.objectContaining({ pointId: 'M-port-b', targetDeviceId: 'two-port-public', targetPort: 'auto-input-inside-b-input', targetElementName: '元素 B' })
    ]));
    root.nodes[2].props.interface.inputs[1].id = 'auto-input-inside-a-input';
    root.nodes[2].props.interface.inputs[1].portId = 'auto-input-inside-a-input';
    const merged = await window.buildSimulationResultSnapshot();
    expect(merged.publicData.renderData.devices.find((device) => device.id === 'two-port-public')?.measurementPorts?.inputs)
      .toEqual([{ portId: 'auto-input-inside-a-input', elementNames: ['元素 A', '元素 B'] }]);
    expect(merged.publicData.initialSimulationResult.physicalMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointId: 'M-port-a', targetPort: 'auto-input-inside-a-input', targetElementName: '元素 A' }),
      expect.objectContaining({ pointId: 'M-port-b', targetPort: 'auto-input-inside-a-input', targetElementName: '元素 B' })
    ]));
  });

  it('uses the connected output index when duplicate port ids have different element names', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const firstNames = ['A', 'B', 'C', 'D'];
    const secondNames = ['E', 'F', 'G', 'H'];
    state.canvases['canvas-root'].nodes = [
      {
        id: 'dual-envelope-receiver',
        type: 'simulation_block',
        props: {
          name: '四路复数包络双输出接收器',
          inputs: [],
          outputs: [
            { portId: 'MM', name: '输出 1', type: '向量', vectorLength: 4, vectorElementNames: firstNames },
            { portId: 'MM', name: '输出 2', type: '向量', vectorLength: 4, vectorElementNames: secondNames }
          ]
        }
      },
      {
        id: 'duplicate-port-subsystem',
        type: 'subsystem_block',
        targetCanvasId: 'canvas-duplicate-port-subsystem',
        props: {
          name: '子系统',
          interface: {
            inputs: [
              { id: 'MM', componentNodeId: 'inside-duplicate-target', componentPortIndex: 0, name: '输入 1' },
              { id: 'MM', componentNodeId: 'inside-duplicate-target', componentPortIndex: 1, name: '输入 2' }
            ],
            outputs: []
          }
        }
      }
    ];
    state.canvases['canvas-root'].edges = [{
      id: 'edge-duplicate-port-output-2',
      sourceNodeId: 'dual-envelope-receiver',
      sourcePortIndex: 1,
      targetNodeId: 'duplicate-port-subsystem',
      targetPortIndex: 1,
      // Reproduces metadata resolved from the first duplicate port ID.
      sourcePortMeta: { portId: 'MM', vectorLength: 4, vectorElementNames: firstNames }
    }];
    state.canvases['canvas-duplicate-port-subsystem'] = {
      id: 'canvas-duplicate-port-subsystem',
      parentSubsystemNodeId: 'duplicate-port-subsystem',
      nodes: [{
        id: 'inside-duplicate-target',
        type: 'simulation_block',
        props: {
          name: '内部接收器',
          inputs: [
            { portId: 'MM', name: '输入 1', type: '向量', vectorLength: 4, vectorElementNames: firstNames },
            { portId: 'MM', name: '输入 2', type: '向量', vectorLength: 4, vectorElementNames: firstNames }
          ],
          outputs: []
        }
      }],
      edges: [],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.modelNodes = state.canvases['canvas-root'].nodes;
    state.modelEdges = state.canvases['canvas-root'].edges;

    window.renderModelNodes();
    window.renderEdges();
    window.selectEdge('edge-duplicate-port-output-2');
    await flushRuntime();
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();

    const options = Array.from(document.querySelectorAll('[data-edge-testpoint-vector-index] option'));
    expect(options.map((option) => option.textContent)).toEqual(secondNames);
  });

  it('uses the subsystem name with the mapped internal port and saves an editable connection name', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const root = state.canvases['canvas-root'];
    const receiver = {
      id: 'receiver-for-edge-name',
      type: 'simulation_block',
      props: {
        name: '四路复数包络双输出接收器',
        inputs: [],
        outputs: [{ portId: 'MM', name: '输出端口2', type: '向量', vectorLength: 4 }]
      },
      pythonBinding: {
        moduleId: 'rf_complex_envelope_vector4_dual_output_receiver',
        entryFunction: 'process',
        portMapping: { inputs: [], outputs: [{ portId: 'MM', name: '输出端口2', vectorLength: 4 }], middleVars: [] }
      }
    };
    const subsystem = {
      id: 'subsystem-for-edge-name',
      type: 'subsystem_block',
      targetCanvasId: 'canvas-edge-name-subsystem',
      props: {
        name: '子系统1',
        subsystemId: 'subsystem-for-edge-name',
        interface: {
          inputs: [{
            id: 'MM',
            order: 0,
            name: '内部选择输入',
            componentNodeId: 'internal-selector-for-edge-name',
            componentName: '复数包络选择器',
            componentPortIndex: 0,
            componentPortName: '内部输入端口1'
          }],
          outputs: []
        }
      }
    };
    const edge = {
      id: 'edge-public-subsystem-name',
      lineType: 'normal',
      sourceNodeId: receiver.id,
      sourcePortIndex: 0,
      sourcePort: { displayName: '输出端口2' },
      targetNodeId: subsystem.id,
      targetPortIndex: 0
    };
    root.nodes = [receiver, subsystem];
    root.edges = [edge];
    state.canvases['canvas-edge-name-subsystem'] = {
      id: 'canvas-edge-name-subsystem',
      parentSubsystemNodeId: subsystem.id,
      nodes: [{
        id: 'internal-selector-for-edge-name',
        type: 'simulation_block',
        props: {
          name: '复数包络选择器',
          inputs: [{ portId: 'MM', name: '内部输入端口1', type: '向量', vectorLength: 4 }],
          outputs: []
        },
        pythonBinding: {
          moduleId: 'rf_complex_envelope_selector',
          entryFunction: 'process',
          portMapping: { inputs: [{ portId: 'MM', name: '内部输入端口1', vectorLength: 4 }], outputs: [], middleVars: [] }
        }
      }],
      edges: [],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.activeCanvasId = 'canvas-root';
    state.modelNodes = root.nodes;
    state.nodes = root.nodes;
    state.modelEdges = root.edges;
    state.edges = root.edges;

    window.renderModelNodes();
    window.renderEdges();
    window.selectEdge(edge.id);
    window.setPropertyPanelTab('overview');
    await flushRuntime();

    const expectedAutomaticName = '四路复数包络双输出接收器·输出端口2 → 子系统1·内部输入端口1';
    expect(document.querySelector('#prop-edge-label')?.value).toBe(expectedAutomaticName);
    expect(document.querySelector(`.edge-label[data-edge-id="${edge.id}"]`)?.textContent).toBe(expectedAutomaticName);

    const input = document.querySelector('#prop-edge-label');
    input.value = '接收机第二路 → 子系统选择输入';
    window.savePropertyPanelTarget();
    await flushRuntime();

    expect(edge).toMatchObject({
      label: '接收机第二路 → 子系统选择输入',
      labelCustomized: true
    });
    expect(document.querySelector(`.edge-label[data-edge-id="${edge.id}"]`)?.textContent)
      .toBe('接收机第二路 → 子系统选择输入');

  });

  it('shows faults injected into subsystem components as detectable options for child test points', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.canvases['canvas-root'].nodes = [{
      id: 'subsystem-fault-options',
      type: 'subsystem_block',
      targetCanvasId: 'canvas-fault-options',
      props: { name: '故障子系统', interface: { inputs: [], outputs: [] } }
    }];
    state.canvases['canvas-root'].edges = [];
    const internalFault = {
      modelId: 'child-sensor-bias',
      name: '内部传感器偏置',
      layer: 'physical',
      active: true
    };
    state.canvases['canvas-fault-options'] = {
      id: 'canvas-fault-options',
      name: '故障子系统',
      parentSubsystemNodeId: 'subsystem-fault-options',
      nodes: [
        {
          id: 'child-fault-source',
          type: 'simulation_block',
          props: { name: '内部传感器' },
          injectedFault: internalFault,
          faultBindings: [{ faultModelId: 'child-sensor-bias', active: true, injectedFault: internalFault }]
        },
        { id: 'child-fault-target', type: 'simulation_block', props: { name: '内部处理器' } }
      ],
      edges: [{
        id: 'edge-child-fault-options',
        sourceNodeId: 'child-fault-source',
        targetNodeId: 'child-fault-target',
        sourcePortIndex: 0,
        targetPortIndex: 0
      }],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };

    expect(window.openSubsystemCanvas('subsystem-fault-options')).toBe(true);
    // The legacy property panel reads the active-canvas aliases.  Mirror the
    // child canvas as the real canvas switcher does during user interaction.
    state.modelNodes = state.canvases['canvas-fault-options'].nodes;
    state.modelEdges = state.canvases['canvas-fault-options'].edges;
    state.nodes = state.modelNodes;
    state.edges = state.modelEdges;
    window.selectEdge('edge-child-fault-options');
    window.setPropertyPanelTab('testpoints');
    await flushRuntime();
    document.querySelector('[data-add-edge-testpoint]').click();
    await flushRuntime();

    const faultOption = document.querySelector('[data-edge-testpoint-fault="child-sensor-bias"]');
    expect(faultOption).not.toBeNull();
    expect(faultOption?.closest('[data-edge-testpoint-component]')?.textContent).toContain('内部传感器');
  });

  it('automatically associates faults with internal and external subsystem test points', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const state = window.__GZ_STATE__;
    const internalFault = { modelId: 'internal-physical-fault', layer: 'physical', active: true };
    const externalFault = { modelId: 'external-protocol-fault', layer: 'protocol', active: true };
    const root = state.canvases['canvas-root'];
    root.nodes = [
      { id: 'source', type: 'signal_source', props: { name: '外部源' } },
      { id: 'subsystem', type: 'subsystem_block', targetCanvasId: 'child', props: {
        name: '子系统', interface: {
          inputs: [{ id: 'input', order: 0, componentNodeId: 'internal-a', componentPortIndex: 0 }],
          outputs: [{ id: 'output', order: 0, componentNodeId: 'internal-b', componentPortIndex: 0 }]
        }
      } },
      { id: 'scope', type: 'instrument_scope', props: { name: '外部接收器' } }
    ];
    root.edges = [
      { id: 'outside-input', sourceNodeId: 'source', targetNodeId: 'subsystem', targetPortIndex: 0, injectedFault: externalFault },
      { id: 'outside-output', sourceNodeId: 'subsystem', targetNodeId: 'scope', sourcePortIndex: 0 }
    ];
    state.canvases.child = {
      id: 'child', parentSubsystemNodeId: 'subsystem', viewport: { scale: 1, offsetX: 0, offsetY: 0 },
      nodes: [
        { id: 'boundary-in', type: 'subsystem_in_port', props: { interfacePortId: 'input', order: 0 } },
        { id: 'internal-a', type: 'simulation_block', props: { name: '内部组件 A' }, injectedFault: internalFault,
          faultBindings: [{ faultModelId: 'internal-physical-fault', layer: 'physical', propagationMode: 'localParameter', canPropagate: false, active: true, injectedFault: internalFault }] },
        { id: 'internal-b', type: 'simulation_block', props: { name: '内部组件 B' } },
        { id: 'boundary-out', type: 'subsystem_out_port', props: { interfacePortId: 'output', order: 0 } }
      ],
      edges: [
        { id: 'inside-input', sourceNodeId: 'boundary-in', targetNodeId: 'internal-a', subsystemBoundaryMapping: true, subsystemBoundaryRole: 'input', linkedExternalEdgeId: 'outside-input' },
        { id: 'inside-wire', sourceNodeId: 'internal-a', targetNodeId: 'internal-b' },
        { id: 'inside-output', sourceNodeId: 'internal-b', targetNodeId: 'boundary-out', subsystemBoundaryMapping: true, subsystemBoundaryRole: 'output', linkedExternalEdgeId: 'outside-output' }
      ]
    };
    state.modelNodes = root.nodes;
    state.modelEdges = root.edges;
    state.nodes = root.nodes;
    state.edges = root.edges;

    const internalPoint = window.addDiagnosticTestPointFromEdge('inside-wire').point;
    const externalPoint = window.addDiagnosticTestPointFromEdge('outside-output').point;
    expect(window.addDiagnosticTestPointFromEdge('inside-output')).toMatchObject({
      ok: true, existed: true, point: expect.objectContaining({ pointId: externalPoint.pointId, edgeId: 'outside-output' })
    });
    expect(internalPoint.detects).toEqual(expect.arrayContaining(['external-protocol-fault', 'internal-physical-fault']));
    expect(externalPoint.detects).toEqual(expect.arrayContaining(['external-protocol-fault', 'internal-physical-fault']));
    expect(window.addDiagnosticTestPoint(internalPoint.pointId)).toBe(true);
    expect(window.addDiagnosticTestPoint(externalPoint.pointId)).toBe(true);
    const globalPoints = window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).installed;
    expect(globalPoints.find((point) => point.pointId === internalPoint.pointId)?.detects)
      .toContain('external-protocol-fault');
    expect(globalPoints.find((point) => point.pointId === externalPoint.pointId)?.detects)
      .toContain('internal-physical-fault');
    const laterFault = { modelId: 'later-electrical-fault', layer: 'electrical', active: true };
    const internalB = state.canvases.child.nodes.find((node) => node.id === 'internal-b');
    internalB.injectedFault = laterFault;
    internalB.faultBindings = [{ faultModelId: laterFault.modelId, layer: 'electrical', active: true, injectedFault: laterFault }];
    const refreshedPoints = window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).installed;
    expect(refreshedPoints.find((point) => point.pointId === externalPoint.pointId)?.detects)
      .toContain('later-electrical-fault');
    expect(refreshedPoints.find((point) => point.pointId === internalPoint.pointId)?.detects)
      .not.toContain('later-electrical-fault');
    const executable = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(executable.reportedNodeIds).toEqual(expect.arrayContaining(['internal-a', 'internal-b']));
  });

  it('keeps subsystem fault target component and wire names in the top-level knowledge graph', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.canvases['canvas-root'].nodes = [{
      id: 'subsystem-knowledge-names',
      type: 'subsystem_block',
      targetCanvasId: 'canvas-knowledge-names',
      props: { name: '飞控子系统', interface: { inputs: [], outputs: [] } }
    }];
    state.canvases['canvas-root'].edges = [];
    state.canvases['canvas-knowledge-names'] = {
      id: 'canvas-knowledge-names',
      name: '飞控子系统',
      parentSubsystemNodeId: 'subsystem-knowledge-names',
      nodes: [
        { id: 'internal-sensor', type: 'flow_block', props: { name: '内部传感器' } },
        { id: 'internal-controller', type: 'flow_block', props: { name: '内部控制器' } }
      ],
      edges: [{
        id: 'edge-internal-sensor-controller',
        sourceNodeId: 'internal-sensor',
        targetNodeId: 'internal-controller',
        sourcePortIndex: 0,
        targetPortIndex: 0
      }],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.faultInstances = [
      {
        instanceId: 'fault-internal-sensor',
        faultTypeId: 'fault-internal-sensor',
        name: '内部传感器偏置',
        targetKind: 'node',
        targetId: 'internal-sensor',
        active: true
      },
      {
        instanceId: 'fault-internal-wire',
        faultTypeId: 'fault-internal-wire',
        name: '内部连线断路',
        targetKind: 'edge',
        targetId: 'edge-internal-sensor-controller',
        active: true
      }
    ];

    const graph = window.getDiagnosticKnowledgeGraph();
    expect(graph.nodes.find((node) => node.kind === 'component' && node.id === 'internal-sensor')?.label)
      .toBe('内部传感器');
    expect(graph.nodes.find((node) => node.kind === 'signalEdge' && node.id === 'edge-internal-sensor-controller')?.label)
      .toContain('内部传感器');
    expect(graph.nodes.find((node) => node.kind === 'signalEdge' && node.id === 'edge-internal-sensor-controller')?.label)
      .toContain('内部控制器');
    expect(graph.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'OCCURS_ON',
        source: { kind: 'fault', id: 'fault-internal-sensor' },
        target: { kind: 'component', id: 'internal-sensor' }
      }),
      expect.objectContaining({
        type: 'OCCURS_ON',
        source: { kind: 'fault', id: 'fault-internal-wire' },
        target: { kind: 'signalEdge', id: 'edge-internal-sensor-controller' }
      })
    ]));
  });

  it('clears faults from wires rebuilt while wrapping and unwrapping a subsystem', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 160, 240);
    window.createNode('flow_block', 420, 240);
    window.createNode('instrument_scope', 700, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const source = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const flow = rootCanvas.nodes.find((node) => node.type === 'flow_block');
    const scope = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');
    connectCanvasNodes(rootCanvas, 'edge-fault-wrap-input', source.id, flow.id);
    connectCanvasNodes(rootCanvas, 'edge-fault-wrap-output', flow.id, scope.id);
    const inputEdge = rootCanvas.edges.find((edge) => edge.id === 'edge-fault-wrap-input');
    inputEdge.injectedFault = { modelId: 'fault-before-wrap', name: '封装前连线故障', active: true };
    inputEdge.faultBindings = [{
      bindingId: 'binding-before-wrap',
      faultModelId: 'fault-before-wrap',
      active: true,
      injectedFault: inputEdge.injectedFault
    }];
    state.faultInstances = [{
      instanceId: 'instance-before-wrap',
      faultTypeId: 'fault-before-wrap',
      targetKind: 'edge',
      targetId: inputEdge.id,
      active: true,
      enabled: true
    }];

    window.selectNode(flow.id);
    const subsystem = window.wrapSelectionIntoSubsystem();
    expect(subsystem).not.toBeNull();
    const rebuiltInput = rootCanvas.edges.find((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === subsystem.id);
    expect(rebuiltInput).not.toHaveProperty('injectedFault');
    expect(rebuiltInput?.faultBindings).toBeUndefined();
    expect(state.faultInstances.find((item) => item.instanceId === 'instance-before-wrap')).toMatchObject({
      active: false,
      enabled: false,
      disabledReason: 'edge-rebuilt-by-subsystem-topology-change'
    });

    rebuiltInput.injectedFault = { modelId: 'fault-before-unwrap', name: '解除前连线故障', active: true };
    rebuiltInput.faultBindings = [{
      bindingId: 'binding-before-unwrap',
      faultModelId: 'fault-before-unwrap',
      active: true,
      injectedFault: rebuiltInput.injectedFault
    }];
    state.faultInstances.push({
      instanceId: 'instance-before-unwrap',
      faultTypeId: 'fault-before-unwrap',
      targetKind: 'edge',
      targetId: rebuiltInput.id,
      active: true,
      enabled: true
    });

    const unwrapped = window.unwrapSelectedSubsystem(subsystem.id);
    expect(unwrapped).not.toBeNull();
    const restoredInput = rootCanvas.edges.find((edge) => edge.sourceNodeId === source.id && edge.targetNodeId === flow.id);
    expect(restoredInput).toBeTruthy();
    expect(restoredInput).not.toHaveProperty('injectedFault');
    expect(restoredInput?.faultBindings).toBeUndefined();
    expect(state.faultInstances.find((item) => item.instanceId === 'instance-before-unwrap')).toMatchObject({
      active: false,
      enabled: false,
      disabledReason: 'edge-rebuilt-by-subsystem-topology-change'
    });
  });

  it('preserves an external branch from an output also connected inside the wrapped subsystem', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const source = window.createNode('signal_source', 140, 220);
    const first = window.createNode('flow_block', 380, 220);
    const second = window.createNode('flow_block', 620, 220);
    const firstScope = window.createNode('instrument_scope', 850, 180);
    const secondScope = window.createNode('instrument_scope', 850, 360);
    const state = window.__GZ_STATE__;
    const root = state.canvases['canvas-root'];
    connectCanvasNodes(root, 'edge-source-first', source.id, first.id);
    connectCanvasNodes(root, 'edge-first-second', first.id, second.id);
    connectCanvasNodes(root, 'edge-first-scope', first.id, firstScope.id);
    connectCanvasNodes(root, 'edge-second-scope', second.id, secondScope.id);
    window.renderModelNodes();
    await flushRuntime();

    dispatchClick(document.getElementById(`b-${first.id}`));
    dispatchClick(document.getElementById(`b-${second.id}`), { ctrlKey: true });
    const subsystem = window.wrapSelectionIntoSubsystem();
    await flushRuntime();

    const child = state.canvases[subsystem.targetCanvasId];
    const outputIndexFor = (nodeId) => subsystem.props.interface.outputs.findIndex((item) => item.componentNodeId === nodeId);
    const firstOutputIndex = outputIndexFor(first.id);
    const secondOutputIndex = outputIndexFor(second.id);
    expect(firstOutputIndex).toBeGreaterThanOrEqual(0);
    expect(secondOutputIndex).toBeGreaterThanOrEqual(0);
    expect(firstOutputIndex).not.toBe(secondOutputIndex);
    expect(root.edges.find((edge) => edge.targetNodeId === firstScope.id)).toMatchObject({
      sourceNodeId: subsystem.id, sourcePortIndex: firstOutputIndex
    });
    expect(root.edges.find((edge) => edge.targetNodeId === secondScope.id)).toMatchObject({
      sourceNodeId: subsystem.id, sourcePortIndex: secondOutputIndex
    });
    const firstBoundary = child.nodes.find((node) => node.type === 'subsystem_out_port' && node.props.order === firstOutputIndex);
    const secondBoundary = child.nodes.find((node) => node.type === 'subsystem_out_port' && node.props.order === secondOutputIndex);
    expect(child.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: second.id }),
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: firstBoundary.id }),
      expect.objectContaining({ sourceNodeId: second.id, targetNodeId: secondBoundary.id })
    ]));

    window.unwrapSelectedSubsystem(subsystem.id);
    expect(root.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: second.id }),
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: firstScope.id }),
      expect.objectContaining({ sourceNodeId: second.id, targetNodeId: secondScope.id })
    ]));
  });

  it('keeps external wires on their original internal components when port ids are shared', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const firstSource = window.createNode('signal_source', 100, 400);
    const secondSource = window.createNode('signal_source', 100, 180);
    const first = window.createNode('subsystem_block', 320, 400);
    const second = window.createNode('subsystem_block', 320, 180);
    const firstScope = window.createNode('instrument_scope', 680, 400);
    const secondScope = window.createNode('instrument_scope', 680, 180);
    first.props.interface.inputs = [{ id: 'shared-input', name: '输入 A', type: '标量' }];
    second.props.interface.inputs = [{ id: 'shared-input', name: '输入 B', type: '标量' }];
    first.props.interface.outputs = [{ id: 'shared-output', name: '输出 A', type: '标量' }];
    second.props.interface.outputs = [{ id: 'shared-output', name: '输出 B', type: '标量' }];
    const state = window.__GZ_STATE__;
    const root = state.canvases['canvas-root'];
    connectCanvasNodes(root, 'edge-first-shared-input', firstSource.id, first.id);
    connectCanvasNodes(root, 'edge-second-shared-input', secondSource.id, second.id);
    connectCanvasNodes(root, 'edge-first-shared-port', first.id, firstScope.id);
    connectCanvasNodes(root, 'edge-second-shared-port', second.id, secondScope.id);
    window.renderModelNodes();
    await flushRuntime();

    dispatchClick(document.getElementById(`b-${first.id}`));
    dispatchClick(document.getElementById(`b-${second.id}`), { ctrlKey: true });
    const wrapped = window.wrapSelectionIntoSubsystem();
    await flushRuntime();

    const inputs = wrapped.props.interface.inputs;
    const outputs = wrapped.props.interface.outputs;
    expect(inputs).toHaveLength(2);
    expect(inputs.map((item) => item.id)).toEqual(['shared-input', 'shared-input']);
    expect(outputs).toHaveLength(2);
    expect(outputs.map((item) => item.id)).toEqual(['shared-output', 'shared-output']);
    const firstInputIndex = inputs.findIndex((item) => item.componentNodeId === first.id);
    const secondInputIndex = inputs.findIndex((item) => item.componentNodeId === second.id);
    const firstIndex = outputs.findIndex((item) => item.componentNodeId === first.id);
    const secondIndex = outputs.findIndex((item) => item.componentNodeId === second.id);
    expect(firstInputIndex).toBeGreaterThanOrEqual(0);
    expect(secondInputIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect([firstInputIndex, secondInputIndex]).toEqual([1, 0]);
    expect([firstIndex, secondIndex]).toEqual([1, 0]);
    expect(root.edges.find((edge) => edge.sourceNodeId === firstSource.id)?.targetPortIndex).toBe(firstInputIndex);
    expect(root.edges.find((edge) => edge.sourceNodeId === secondSource.id)?.targetPortIndex).toBe(secondInputIndex);
    expect(root.edges.find((edge) => edge.targetNodeId === firstScope.id)?.sourcePortIndex).toBe(firstIndex);
    expect(root.edges.find((edge) => edge.targetNodeId === secondScope.id)?.sourcePortIndex).toBe(secondIndex);

    const child = state.canvases[wrapped.targetCanvasId];
    const boundaries = child.nodes.filter((node) => node.type === 'subsystem_out_port');
    const inputBoundaries = child.nodes.filter((node) => node.type === 'subsystem_in_port');
    expect(new Set(boundaries.map((node) => node.id)).size).toBe(2);
    expect(new Set(inputBoundaries.map((node) => node.id)).size).toBe(2);
    expect(child.edges.filter((edge) => edge.subsystemBoundaryMapping)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: inputBoundaries.find((node) => node.props.order === firstInputIndex).id, targetNodeId: first.id }),
      expect.objectContaining({ sourceNodeId: inputBoundaries.find((node) => node.props.order === secondInputIndex).id, targetNodeId: second.id })
    ]));
    expect(child.edges.filter((edge) => edge.subsystemBoundaryMapping)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: boundaries.find((node) => node.props.order === firstIndex).id }),
      expect.objectContaining({ sourceNodeId: second.id, targetNodeId: boundaries.find((node) => node.props.order === secondIndex).id })
    ]));

    state.sysLoaded = true;
    await window.doSaveSys();
    const saved = JSON.parse(window.localStorage.getItem('gz-workbench-system-model'));
    expect(saved.canvases[wrapped.targetCanvasId].nodes.filter((node) => node.type === 'subsystem_in_port')).toHaveLength(2);
    window.restoreSystemModelSnapshot(saved);
    window.renderModelNodes();
    const restoredRoot = state.canvases['canvas-root'];
    const restoredChild = state.canvases[wrapped.targetCanvasId];
    const restoredWrapped = restoredRoot.nodes.find((node) => node.id === wrapped.id);
    expect(restoredWrapped.props.interface.inputs.map((item) => item.componentNodeId)).toEqual([second.id, first.id]);
    expect(restoredWrapped.props.interface.outputs.map((item) => item.componentNodeId)).toEqual([second.id, first.id]);
    expect(restoredRoot.edges.find((edge) => edge.sourceNodeId === firstSource.id)?.targetPortIndex).toBe(firstInputIndex);
    expect(restoredRoot.edges.find((edge) => edge.sourceNodeId === secondSource.id)?.targetPortIndex).toBe(secondInputIndex);
    expect(restoredRoot.edges.find((edge) => edge.targetNodeId === firstScope.id)?.sourcePortIndex).toBe(firstIndex);
    expect(restoredRoot.edges.find((edge) => edge.targetNodeId === secondScope.id)?.sourcePortIndex).toBe(secondIndex);
    expect(restoredChild.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: boundaries.find((node) => node.props.order === firstIndex).id }),
      expect.objectContaining({ sourceNodeId: second.id, targetNodeId: boundaries.find((node) => node.props.order === secondIndex).id })
    ]));

    const exported = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(exported.workbenchSnapshot.canvases[wrapped.targetCanvasId].nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(2);
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(exported)).toMatchObject({ ok: true });
    window.renderModelNodes();
    const importedRoot = state.canvases['canvas-root'];
    const importedWrapped = importedRoot.nodes.find((node) => node.id === wrapped.id);
    expect(importedWrapped.props.interface.inputs.map((item) => item.componentNodeId)).toEqual([second.id, first.id]);
    expect(importedWrapped.props.interface.outputs.map((item) => item.componentNodeId)).toEqual([second.id, first.id]);
    expect(importedRoot.edges.find((edge) => edge.sourceNodeId === firstSource.id)?.targetPortIndex).toBe(firstInputIndex);
    expect(importedRoot.edges.find((edge) => edge.sourceNodeId === secondSource.id)?.targetPortIndex).toBe(secondInputIndex);
    expect(importedRoot.edges.find((edge) => edge.targetNodeId === firstScope.id)?.sourcePortIndex).toBe(firstIndex);
    expect(importedRoot.edges.find((edge) => edge.targetNodeId === secondScope.id)?.sourcePortIndex).toBe(secondIndex);

    window.unwrapSelectedSubsystem(wrapped.id);
    expect(importedRoot.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: firstSource.id, targetNodeId: first.id }),
      expect.objectContaining({ sourceNodeId: secondSource.id, targetNodeId: second.id }),
      expect.objectContaining({ sourceNodeId: first.id, targetNodeId: firstScope.id }),
      expect.objectContaining({ sourceNodeId: second.id, targetNodeId: secondScope.id })
    ]));
  });

  it('records nonzero child-component test-point outputs without requiring a scope instrument', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.sysLoaded = true;
    state.canvases['canvas-root'].nodes = [
      { id: 'constant-source', type: 'signal_source', props: { name: '常值信号', waveType: '常值', amplitude: '19', frequency: '1' } },
      {
        id: 'subsystem-recording-test',
        type: 'subsystem_block',
        targetCanvasId: 'canvas-recording-test',
        props: {
          name: '子系统',
          interface: {
            inputs: [{ id: 'recording-input', componentNodeId: 'child-flow', componentPortIndex: 0, name: '输入' }],
            outputs: []
          }
        }
      }
    ];
    state.canvases['canvas-root'].edges = [{
      id: 'edge-source-to-recording-subsystem',
      sourceNodeId: 'constant-source',
      sourcePortIndex: 0,
      targetNodeId: 'subsystem-recording-test',
      targetPortIndex: 0
    }];
    state.canvases['canvas-recording-test'] = {
      id: 'canvas-recording-test',
      parentSubsystemNodeId: 'subsystem-recording-test',
      nodes: [
        { id: 'recording-input-boundary', type: 'subsystem_in_port', props: { interfacePortId: 'recording-input', order: 0 } },
        { id: 'child-flow', type: 'flow_block', props: { name: '子系统内部处理' } }
      ],
      edges: [{
        id: 'edge-child-flow-test-point',
        sourceNodeId: 'recording-input-boundary',
        sourcePortIndex: 0,
        targetNodeId: 'child-flow',
        targetPortIndex: 0,
        subsystemBoundaryMapping: true,
        interfacePortId: 'recording-input'
      }],
      viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
    state.diagnosticTestPoints = [{
      pointId: 'M-child-flow-output',
      shortName: 'M1',
      name: '子系统内部输出测点',
      edgeId: 'edge-child-flow-test-point',
      pointType: 'virtual'
    }];
    state.simulationTestPointIds = ['M-child-flow-output'];
    state.installedDiagnosticTestPointIds = ['M-child-flow-output'];

    window.simInit(true);
    await window.simStep();
    window.setCanvasView('components');
    await flushRuntime();

    expect(window.__GZ_SIM__.componentOutputs.steps.at(-1)?.actual['constant-source']).toMatchObject({ output: 19 });
    expect(window.__GZ_SIM__.componentOutputs.steps.at(-1)?.actual['child-flow']).toMatchObject({ output: 19 });
    const card = document.querySelector('[data-simulation-testpoint="M-child-flow-output"]');
    expect(card?.textContent).toContain('19');
    const savedResult = await window.buildSimulationResultSnapshot();
    expect(savedResult.publicData.initialSimulationResult.virtualMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pointId: 'M-child-flow-output',
        samples: [{ time: 0, actual: 19 }]
      })
    ]));
  });

  it('enters a subsystem canvas on double click and returns to root through breadcrumbs', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const subsystemNode = document.querySelector('.blk.b-subsystem');
    expect(subsystemNode).not.toBeNull();

    dispatchPointer(subsystemNode, 'pointerdown', { pointerId: 11, clientX: 220, clientY: 180 });
    expect(document.querySelector('.blk.b-subsystem')).toBe(subsystemNode);
    dispatchPointer(subsystemNode, 'pointerup', { pointerId: 11, clientX: 220, clientY: 180 });
    dispatchClick(subsystemNode);
    await flushRuntime();
    const refreshedSubsystemNode = document.querySelector('.blk.b-subsystem');
    expect(refreshedSubsystemNode).not.toBeNull();
    dispatchPointer(refreshedSubsystemNode, 'pointerdown', { pointerId: 12, clientX: 220, clientY: 180 });
    expect(document.querySelector('.blk.b-subsystem')).toBe(refreshedSubsystemNode);
    dispatchPointer(refreshedSubsystemNode, 'pointerup', { pointerId: 12, clientX: 220, clientY: 180 });
    dispatchClick(refreshedSubsystemNode);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const childCanvasId = state.canvases['canvas-root'].nodes[0].targetCanvasId;
    expect(state.activeCanvasId).toBe(childCanvasId);
    expect(state.canvasTrail).toEqual(['canvas-root', childCanvasId]);
    expect(document.querySelector('[data-testid="canvas-breadcrumbs"]')).not.toBeNull();

    window.createNode('signal_source', 300, 260);
    await flushRuntime();

    expect(state.canvases[childCanvasId].nodes.filter((node) => node.type === 'signal_source')).toHaveLength(1);
    expect(state.canvases[childCanvasId].nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);
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
    const subsystemIdInput = document.getElementById('prop-subsystem-id');
    expect(window.__GZ_SUBSYSTEM_PROPERTY_PANEL_SCHEMA__).toBeTruthy();
    expect(nameInput).not.toBeNull();
    expect(subsystemIdInput).not.toBeNull();
    expect(document.getElementById('prop-linkType')).toBeNull();
    expect(document.getElementById('prop-sourcePort')).toBeNull();
    expect(document.getElementById('prop-targetPort')).toBeNull();

    nameInput.value = '飞控主控';
    subsystemIdInput.value = 'flight-control-01';
    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.props.name).toBe('飞控主控');
    expect(subsystemNode.props.subsystemId).toBe('flight-control-01');
    expect(subsystemNode.targetCanvasId).toBeTruthy();
    expect(subsystemNode.props.linkType).toBeUndefined();
    expect(subsystemNode.props.sourcePort).toBeUndefined();
    expect(subsystemNode.props.targetPort).toBeUndefined();
  });

  it('keeps a subsystem property panel focused on its overview and hides unrelated sections', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const labels = Array.from(document.querySelectorAll('.props-tab:not([hidden])'))
      .map((item) => item.textContent.trim());
    expect(labels).toEqual(['属性']);
    expect(document.querySelector('.rpanel')?.dataset.propsTabCount).toBe('1');
    expect(document.getElementById('pd')?.textContent).not.toContain('画布位置');
  });

  it('rejects fault binding on a subsystem shell and requires binding inside its canvas', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes.find((node) => node.type === 'subsystem_block');
    subsystemNode.faultSlots = [{
      slotId: 'physical:subsystem',
      layer: 'physical',
      allowedFaultTypeIds: ['subsystem_fault_forbidden']
    }];
    state.activeModelPackage = {
      faultTypeCatalog: [{
        id: 'subsystem_fault_forbidden',
        name: '子系统故障',
        layer: 'physical',
        defaultParameters: { bias: 1 }
      }],
      faultCapabilityMap: [{
        targetKind: 'node',
        targetId: subsystemNode.id,
        faultSlots: subsystemNode.faultSlots
      }]
    };

    expect(window.getFaultCapabilityForTarget(subsystemNode)).toBeNull();
    expect(window.getCompatibleFaultModelsForTarget(subsystemNode)).toEqual([]);
    expect(window.activateFaultForTarget(subsystemNode, 'subsystem_fault_forbidden')).toMatchObject({
      ok: false,
      reason: 'subsystem-target'
    });
    expect(window.canBindLayeredFaultInjectorToTarget('physical_fault_injector', subsystemNode)).toBe(false);
    expect(state.faultInstances ?? []).toHaveLength(0);
    expect(state.faultTags ?? []).toHaveLength(0);

    window.selectNode(subsystemNode.id);
    await flushRuntime();
    expect(window.openTargetFaultActivationDialog()).toBe(false);
    expect(document.querySelector('[data-target-fault-dialog]')).toBeNull();

    window.openSubsystemCanvas(subsystemNode.id);
    window.createNode('signal_source', 320, 240);
    await flushRuntime();

    const internalNode = state.modelNodes.find((node) => node.type === 'signal_source');
    internalNode.faultSlots = [{
      slotId: 'physical:internal-source',
      layer: 'physical',
      allowedFaultTypeIds: ['internal_source_fault']
    }];
    state.activeModelPackage = {
      faultTypeCatalog: [{
        id: 'internal_source_fault',
        name: '内部信号源故障',
        layer: 'physical',
        defaultParameters: { bias: 0.1 }
      }],
      faultCapabilityMap: [{
        targetKind: 'node',
        targetId: internalNode.id,
        faultSlots: internalNode.faultSlots
      }]
    };

    expect(window.getCompatibleFaultModelsForTarget(internalNode).map((model) => model.id)).toContain('internal_source_fault');
    expect(window.activateFaultForTarget(internalNode, 'internal_source_fault')).toMatchObject({ ok: true });
    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetId: internalNode.id,
      faultTypeId: 'internal_source_fault'
    }));
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
    state.canvases['canvas-root'].nodes[0].props.subsystemId = 'saved-subsystem-01';
    state.canvasScale = 1.75;
    state.canvasOffsetX = 86;
    state.canvasOffsetY = 52;

    window.createNode('signal_source', 320, 240);
    await flushRuntime();

    const exported = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(exported.workbenchSnapshot.rootCanvasId).toBe('canvas-root');
    expect(exported.workbenchSnapshot.activeCanvasId).toBe(childCanvasId);
    expect(exported.workbenchSnapshot.canvasTrail).toEqual(['canvas-root', childCanvasId]);
    expect(exported.workbenchSnapshot.modelNodes).toEqual([
      expect.objectContaining({
        id: rootSubsystemId,
        type: 'subsystem_block',
        targetCanvasId: childCanvasId,
        props: expect.objectContaining({ subsystemId: 'saved-subsystem-01' })
      })
    ]);
    expect(exported.workbenchSnapshot.canvases['canvas-root'].nodes).toHaveLength(1);
    expect(exported.workbenchSnapshot.canvases[childCanvasId].nodes.filter((node) => node.type === 'signal_source')).toHaveLength(1);
    expect(exported.workbenchSnapshot.canvases[childCanvasId].nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);

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
    expect(importedState.canvases['canvas-root'].nodes[0]).toMatchObject({
      id: rootSubsystemId,
      type: 'subsystem_block',
      targetCanvasId: childCanvasId,
      props: expect.objectContaining({ subsystemId: 'saved-subsystem-01' })
    });
    expect(importedState.canvases[childCanvasId].nodes.filter((node) => node.type === 'signal_source')).toHaveLength(1);
    expect(importedState.canvases[childCanvasId].nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);
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
    expect(window.__GZ_SUBSYSTEM_PROPERTY_PANEL_SCHEMA__).toBeTruthy();
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

    expect(document.querySelectorAll('.blk.b-subsystem-port-in')).toHaveLength(0);
    expect(document.querySelectorAll('.blk.b-subsystem-port-out')).toHaveLength(0);
  });

  it('automatically resizes a subsystem block when its interface counts change', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    expect(subsystemNode.w).toBe(180);
    expect(subsystemNode.h).toBe(92);

    window.selectNode(subsystemNode.id);
    await flushRuntime();
    document.getElementById('subsystem-input-count').value = '6';
    document.getElementById('subsystem-output-count').value = '4';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.w).toBe(180);
    expect(subsystemNode.h).toBe(188);
    let subsystemShell = document.getElementById(`b-${subsystemNode.id}`);
    expect(subsystemShell?.style.height).toBe('188px');
    const inputPorts = [...subsystemShell.querySelectorAll('.node-port--input')];
    expect(inputPorts).toHaveLength(6);
    const inputPortTops = inputPorts.map((port) => Number.parseFloat(port.style.top));
    const inputPortGaps = inputPortTops.slice(1).map((top, index) => top - inputPortTops[index]);
    expect(Math.min(...inputPortGaps)).toBeGreaterThan(20);

    window.selectNode(subsystemNode.id);
    await flushRuntime();
    document.getElementById('subsystem-input-count').value = '1';
    document.getElementById('subsystem-output-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    await flushRuntime();
    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.w).toBe(180);
    expect(subsystemNode.h).toBe(92);
    subsystemShell = document.getElementById(`b-${subsystemNode.id}`);
    expect(subsystemShell?.style.height).toBe('92px');
  });

  it('keeps up to three top power interfaces compact and widens from the fourth', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const subsystemNode = window.__GZ_STATE__.canvases['canvas-root'].nodes[0];
    subsystemNode.props.interface.inputs = Array.from({ length: 3 }, (_, index) => ({
      id: `power-${index + 1}`,
      name: `设备 ${index + 1} · 电源输入`,
      type: '标量',
      side: 'top',
      order: index
    }));
    subsystemNode.props.interface.outputs = [];
    window.renderModelNodes();
    await flushRuntime();

    expect(subsystemNode.w).toBe(180);
    expect(subsystemNode.h).toBe(92);
    const topPorts = [...document.querySelectorAll(`#b-${subsystemNode.id} .node-port--input.node-port--top`)];
    expect(topPorts).toHaveLength(3);
    expect(topPorts.map((port) => Number.parseFloat(port.style.left))).toEqual([45, 90, 135]);

    subsystemNode.props.interface.inputs.push({
      id: 'power-4',
      name: '设备 4 · 电源输入',
      type: '标量',
      side: 'top',
      order: 3
    });
    window.renderModelNodes();
    await flushRuntime();

    expect(subsystemNode.w).toBe(216);
    expect(document.querySelectorAll(`#b-${subsystemNode.id} .node-port--input.node-port--top`)).toHaveLength(4);
  });

  it('derives subsystem interfaces from every unconnected internal component port with source details', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    window.openSubsystemCanvas(subsystemNode.id);
    await flushRuntime();

    window.createNode('flow_block', 360, 220);
    window.createNode('instrument_scope', 700, 220);
    await flushRuntime();

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    const flowNode = childCanvas.nodes.find((node) => node.type === 'flow_block');
    const scopeNode = childCanvas.nodes.find((node) => node.type === 'instrument_scope');
    flowNode.props.name = '姿态处理';
    flowNode.props.inputName = '姿态误差';
    flowNode.props.outputName = '修正量';
    scopeNode.props.name = '监视器';
    window.renderModelNodes();
    await flushRuntime();

    expect(subsystemNode.props.interfaceMode).toBe('auto');
    expect(subsystemNode.props.interface.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '姿态处理 · 姿态误差',
        componentNodeId: flowNode.id,
        componentPortIndex: 0,
        componentName: '姿态处理',
        componentPortName: '姿态误差'
      }),
      expect.objectContaining({ componentNodeId: scopeNode.id, componentName: '监视器' })
    ]));
    expect(subsystemNode.props.interface.outputs).toEqual([
      expect.objectContaining({
        name: '姿态处理 · 修正量',
        componentNodeId: flowNode.id,
        componentPortIndex: 0,
        componentName: '姿态处理',
        componentPortName: '修正量'
      })
    ]);

    const inputBoundaryNodes = childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port');
    const outputBoundaryNodes = childCanvas.nodes.filter((node) => node.type === 'subsystem_out_port');
    expect(inputBoundaryNodes).toHaveLength(3);
    expect(outputBoundaryNodes).toHaveLength(1);
    expect(childCanvas.edges.filter((edge) => edge.subsystemBoundaryMapping)).toHaveLength(4);

    connectCanvasNodes(childCanvas, 'edge-internal-flow-scope', flowNode.id, scopeNode.id, 0, 0);
    window.renderModelNodes();
    await flushRuntime();

    expect(subsystemNode.props.interface.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '姿态处理 · 姿态误差', componentNodeId: flowNode.id }),
      expect.objectContaining({ componentNodeId: scopeNode.id, componentPortIndex: 1 })
    ]));
    expect(subsystemNode.props.interface.inputs).toHaveLength(2);
    expect(subsystemNode.props.interface.outputs).toHaveLength(0);
    expect(childCanvas.edges.some((edge) => edge.id === 'edge-internal-flow-scope')).toBe(true);
    expect(childCanvas.edges.filter((edge) => edge.subsystemBoundaryMapping)).toHaveLength(2);

    window.goToRootCanvas();
    await flushRuntime();
    window.selectNode(subsystemNode.id);
    await flushRuntime();

    expect(document.getElementById('subsystem-input-count')).toBeNull();
    const automaticValues = [...document.querySelectorAll('.subsystem-intf-row input')].map((input) => input.value);
    expect(automaticValues).toContain('姿态处理');
    expect(automaticValues).toContain('姿态误差');

    const inputRow = document.querySelector(`.subsystem-intf-row[data-subsystem-role="input"][data-source-component-id="${flowNode.id}"]`);
    const inputId = subsystemNode.props.interface.inputs.find((item) => item.componentNodeId === flowNode.id).id;
    expect(inputRow.querySelector('[data-subsystem-field="id"]').readOnly).toBe(true);
    expect(inputRow.querySelector('[data-subsystem-element-index="0"]').readOnly).toBe(true);
    document.getElementById('prop-subsystem-id').value = ' auto-subsystem-01 ';
    window.saveSelectedNode();
    await flushRuntime();

    expect(subsystemNode.props.subsystemId).toBe('auto-subsystem-01');
    expect(subsystemNode.props.interface.inputs.find((item) => item.componentNodeId === flowNode.id)).toMatchObject({
      id: inputId,
      elementNames: ['姿态误差']
    });
    expect(childCanvas.nodes.some((item) => item.props?.interfacePortId === inputId)).toBe(true);
    window.renderModelNodes();
    expect(subsystemNode.props.interface.inputs.find((item) => item.componentNodeId === flowNode.id)).toMatchObject({
      id: inputId,
      elementNames: ['姿态误差']
    });
    expect(document.getElementById('prop-subsystem-id').value).toBe('auto-subsystem-01');
    expect(subsystemNode.id).not.toBe('auto-subsystem-01');
  });

  it('syncs automatic vector port ids and element names from the internal port', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    window.openSubsystemCanvas(subsystemNode.id);
    window.createNode('simulation_block', 360, 220);
    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    const simulationNode = childCanvas.nodes.find((node) => node.type === 'simulation_block');
    simulationNode.props.outputs = [{
      id: 'attitude-vector', name: '姿态向量', type: '向量',
      vectorLength: 2, vectorElementNames: ['横滚', '俯仰']
    }];
    window.renderModelNodes();
    window.goToRootCanvas();
    window.selectNode(subsystemNode.id);
    await flushRuntime();

    const outputIndex = subsystemNode.props.interface.outputs.findIndex((item) => item.componentPortName.includes('姿态向量'));
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    const outputRow = document.querySelector(`.subsystem-intf-row[data-subsystem-role="output"][data-index="${outputIndex}"]`);
    expect(outputRow.querySelectorAll('[data-subsystem-element-index]')).toHaveLength(2);
    expect(outputRow.querySelector('[data-subsystem-field="id"]').readOnly).toBe(true);
    expect(outputRow.querySelector('[data-subsystem-element-index="1"]').readOnly).toBe(true);
    simulationNode.props.outputs[0].vectorElementNames[1] = '新俯仰';
    window.saveSelectedNode();
    window.renderModelNodes();

    expect(subsystemNode.props.interface.outputs[outputIndex]).toMatchObject({
      id: 'attitude-vector',
      portId: 'attitude-vector',
      vectorLength: 2,
      vectorElementNames: ['横滚', '新俯仰']
    });
    expect(window.getNodePorts(subsystemNode).outputs[outputIndex].meta.portId).toBe('attitude-vector');
    expect(childCanvas.nodes.find((node) => node.props?.interfacePortId === 'attitude-vector')?.props)
      .toMatchObject({ vectorLength: 2, vectorElementNames: ['横滚', '新俯仰'] });
  });

  it('inherits complex-envelope input and output contracts and connects them outside the subsystem', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const subsystem = window.createNode('subsystem_block', 420, 320);
    window.openSubsystemCanvas(subsystem.id);
    const internal = window.createNode('simulation_block', 360, 220);
    const contract = {
      type: '复数包络',
      dataType: 'rf_complex_envelope',
      referenceFrequencyHz: 990000000,
      impedanceOhm: 75,
      unit: 'V'
    };
    internal.props.inputs = [{ id: 'rf-in', name: '射频输入', ...contract }];
    internal.props.outputs = [{ id: 'rf-out', name: '射频输出', ...contract }];
    window.renderModelNodes();
    window.goToRootCanvas();

    const state = window.__GZ_STATE__;
    const input = subsystem.props.interface.inputs[0];
    const output = subsystem.props.interface.outputs[0];
    for (const port of [input, output]) {
      expect(port).toMatchObject(contract);
    }
    const shellPorts = window.getNodePorts(subsystem);
    expect(shellPorts.inputs[0].meta).toMatchObject(contract);
    expect(shellPorts.outputs[0].meta).toMatchObject(contract);
    const boundaryNodes = state.canvases[subsystem.targetCanvasId].nodes.filter((node) =>
      ['rf-in', 'rf-out'].includes(node.props?.interfacePortId)
    );
    expect(boundaryNodes).toHaveLength(2);
    boundaryNodes.forEach((node) => expect(node.props).toMatchObject({
      portType: '复数包络',
      dataType: 'rf_complex_envelope',
      referenceFrequencyHz: 990000000,
      impedanceOhm: 75,
      unit: 'V'
    }));

    const source = window.createNode('simulation_block', 160, 240);
    source.props.inputs = [];
    source.props.outputs = [{ id: 'external-out', name: '外部输出', ...contract }];
    const target = window.createNode('simulation_block', 720, 240);
    target.props.inputs = [{ id: 'external-in', name: '外部输入', ...contract }];
    target.props.outputs = [];
    window.renderModelNodes();
    const click = { stopPropagation() {} };
    window.handlePortClick(click, source.id, 'output', 0);
    window.handlePortClick(click, subsystem.id, 'input', 0);
    window.handlePortClick(click, subsystem.id, 'output', 0);
    window.handlePortClick(click, target.id, 'input', 0);

    expect(state.canvases['canvas-root'].edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: source.id, targetNodeId: subsystem.id }),
      expect.objectContaining({ sourceNodeId: subsystem.id, targetNodeId: target.id })
    ]));
    const incoming = state.canvases['canvas-root'].edges.find((edge) => edge.targetNodeId === subsystem.id);
    const outgoing = state.canvases['canvas-root'].edges.find((edge) => edge.sourceNodeId === subsystem.id);
    expect(incoming.targetPortMeta).toMatchObject({
      type: 'rf_complex_envelope', referenceFrequencyHz: 990000000, impedanceOhm: 75, unit: 'V'
    });
    expect(outgoing.sourcePortMeta).toMatchObject({
      type: 'rf_complex_envelope', referenceFrequencyHz: 990000000, impedanceOhm: 75, unit: 'V'
    });
  });

  it('preserves complex-envelope contracts when wrapping a connected component', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    const contract = {
      type: '复数包络', dataType: 'rf_complex_envelope',
      referenceFrequencyHz: 915000000, impedanceOhm: 50, unit: 'V'
    };
    const source = window.createNode('simulation_block', 120, 220);
    source.props.inputs = [];
    source.props.outputs = [{ name: '源输出', ...contract }];
    const internal = window.createNode('simulation_block', 400, 220);
    internal.props.inputs = [{ name: '内部输入', ...contract }];
    internal.props.outputs = [{ name: '内部输出', ...contract }];
    const target = window.createNode('simulation_block', 720, 220);
    target.props.inputs = [{ name: '目标输入', ...contract }];
    target.props.outputs = [];
    const root = window.__GZ_STATE__.canvases['canvas-root'];
    connectCanvasNodes(root, 'rf-wrap-input', source.id, internal.id);
    connectCanvasNodes(root, 'rf-wrap-output', internal.id, target.id);

    window.selectNode(internal.id);
    const subsystem = window.wrapSelectionIntoSubsystem();
    expect(subsystem).not.toBeNull();
    expect(subsystem.props.interface.inputs.find((port) => port.componentPortName.includes('内部输入')))
      .toMatchObject(contract);
    expect(subsystem.props.interface.outputs.find((port) => port.componentPortName.includes('内部输出')))
      .toMatchObject(contract);
    expect(root.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: source.id, targetNodeId: subsystem.id }),
      expect.objectContaining({ sourceNodeId: subsystem.id, targetNodeId: target.id })
    ]));
  });

  it('keeps separate internal paths for automatic ports sharing one direction and id', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];
    window.openSubsystemCanvas(subsystemNode.id);
    window.createNode('simulation_block', 360, 220);
    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    const simulationNode = childCanvas.nodes.find((node) => node.type === 'simulation_block');
    simulationNode.props.inputs = [
      { id: 'MM', name: '输入 A', type: '标量', elementNames: ['内部元素 A'] },
      { id: 'MM', name: '输入 B', type: '标量', elementNames: ['内部元素 B'] }
    ];
    simulationNode.props.outputs = [];
    window.renderModelNodes();

    const ports = subsystemNode.props.interface.inputs.filter((port) => port.id === 'MM');
    expect(ports).toHaveLength(2);
    expect(ports.map((port) => port.elementNames)).toEqual([['内部元素 A'], ['内部元素 B']]);
    const boundaries = childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port' && node.props.interfacePortId === 'MM');
    expect(boundaries).toHaveLength(2);
    expect(new Set(boundaries.map((node) => node.id)).size).toBe(2);
    expect(childCanvas.edges.filter((edge) => edge.subsystemBoundaryMapping && boundaries.some((node) => node.id === edge.sourceNodeId)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ targetNodeId: simulationNode.id, targetPortIndex: 0 }),
        expect.objectContaining({ targetNodeId: simulationNode.id, targetPortIndex: 1 })
      ]));
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

  it('returns palette components from a deleted subsystem tree to the left palette', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('subsystem_block', 420, 320);
    const state = window.__GZ_STATE__;
    const subsystemNode = state.canvases['canvas-root'].nodes[0];

    window.openSubsystemCanvas(subsystemNode.id);
    const childComponent = window.createNode('scalar_to_vector4', 320, 260);
    childComponent.paletteKey = 'scalar_to_vector4';
    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: childComponent.paletteKey }
    }));
    window.createNode('subsystem_block', 600, 320);
    const nestedSubsystem = state.canvases[subsystemNode.targetCanvasId].nodes
      .find((node) => node.type === 'subsystem_block');

    window.openSubsystemCanvas(nestedSubsystem.id);
    const nestedComponent = window.createNode('display_console_1', 320, 260);
    nestedComponent.paletteKey = 'display_console_1';
    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: nestedComponent.paletteKey }
    }));
    await flushRuntime();

    expect(document.querySelector('[data-component="scalar_to_vector4"]')).toBeNull();
    expect(document.querySelector('[data-component="display_console_1"]')).toBeNull();

    window.goToRootCanvas();
    window.selectNode(subsystemNode.id);
    window.deleteSelectedNode();
    await flushRuntime();

    expect(document.querySelector('[data-component="scalar_to_vector4"]')).not.toBeNull();
    expect(document.querySelector('[data-component="display_console_1"]')).not.toBeNull();
    expect(state.canvases[subsystemNode.targetCanvasId]).toBeUndefined();
    expect(state.canvases[nestedSubsystem.targetCanvasId]).toBeUndefined();
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

  it('cuts off the signal on a subsystem output wire bound to a protocol fault', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();
    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('signal_source', 180, 220);
    window.createNode('subsystem_block', 440, 240);
    window.createNode('instrument_scope', 760, 240);
    window.createNode('protocol_fault_injector', 360, 440);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases['canvas-root'];
    const source = rootCanvas.nodes.find((node) => node.type === 'signal_source');
    const subsystem = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const scope = rootCanvas.nodes.find((node) => node.type === 'instrument_scope');
    const injector = rootCanvas.nodes.find((node) => node.type === 'protocol_fault_injector');
    source.props.amplitude = '2';
    source.props.frequency = '1';

    window.selectNode(subsystem.id);
    await flushRuntime();
    document.getElementById('subsystem-input-count').value = '1';
    document.getElementById('subsystem-output-count').value = '1';
    window.syncSubsystemInterfaceCounts();
    window.saveSelectedNode();
    await flushRuntime();

    connectCanvasNodes(rootCanvas, 'source-to-subsystem', source.id, subsystem.id);
    connectCanvasNodes(rootCanvas, 'subsystem-to-scope', subsystem.id, scope.id);
    const childCanvas = state.canvases[subsystem.targetCanvasId];
    const childInput = childCanvas.nodes.find((node) => node.type === 'subsystem_in_port');
    const childOutput = childCanvas.nodes.find((node) => node.type === 'subsystem_out_port');
    connectCanvasNodes(childCanvas, 'child-pass-through', childInput.id, childOutput.id);

    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    const baseline = window.__GZ_SIM__.actual.scopeSamples[scope.id]?.ch1 ?? [];
    expect(baseline.some((sample) => Math.abs(sample.actual) > 0.01)).toBe(true);

    const bound = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge', targetId: 'subsystem-to-scope', mathModel: 'data_cutoff'
    });
    expect(bound).toMatchObject({ ok: true, targetId: 'subsystem-to-scope' });

    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(pkg.faultInstances).toContainEqual(expect.objectContaining({
      targetId: pkg.edges.find((edge) => edge.targetNodeId === scope.id)?.id,
      faultType: 'signal_cutoff'
    }));

    window.simInit(true);
    for (let step = 0; step < 4; step += 1) window.simStep();
    const actual = window.__GZ_SIM__.actual.scopeSamples[scope.id]?.ch1 ?? [];
    expect(actual.every((sample) => Math.abs(sample.actual) < 1e-6)).toBe(true);
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
    state.faultTags.push({
      id: 'root-only-fault-tag',
      faultModelId: 'root-only-fault',
      name: '顶层故障标签',
      targetKind: 'node',
      targetId: sourceNode.id,
      hostNodeId: sourceNode.id,
      expanded: true,
      x: 120,
      y: 120
    });
    state.faultInjectionLinks.push({
      id: 'root-only-fault-link',
      faultModelId: 'root-only-fault',
      sourceTagId: 'root-only-fault-tag',
      targetNodeId: sourceNode.id
    });

    window.renderModelNodes();
    await flushRuntime();

    dispatchClick(document.getElementById(`b-${flowNode.id}`));
    dispatchClick(document.getElementById(`b-${simulationNode.id}`), { ctrlKey: true });
    await flushRuntime();

    expect(typeof window.wrapSelectionIntoSubsystem).toBe('function');

    state.manualDiagnosticTestPoints = [
      { pointId: 'M-wrap-in', edgeId: 'edge-wrap-source-flow', pointType: 'virtual', detects: [] },
      { pointId: 'M-wrap-out', edgeId: 'edge-wrap-sim-scope', pointType: 'virtual', detects: [] }
    ];
    state.installedDiagnosticTestPointIds = ['M-wrap-in', 'M-wrap-out'];

    window.wrapSelectionIntoSubsystem();
    await flushRuntime();

    const wrappedRootCanvas = state.canvases['canvas-root'];
    const subsystemNode = wrappedRootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    subsystemNode.props.subsystemId = 'wrapped-subsystem-01';

    expect(subsystemNode).toBeTruthy();
    expect(subsystemNode.w).toBe(180);
    expect(subsystemNode.props.interface.inputs.length).toBeGreaterThanOrEqual(1);
    expect(subsystemNode.props.interface.outputs).toHaveLength(1);
    const powerInput = subsystemNode.props.interface.inputs.find((item) => (
      item.componentNodeId === simulationNode.id && item.side === 'top'
    ));
    expect(powerInput).toMatchObject({ componentNodeId: simulationNode.id, side: 'top' });
    expect(powerInput.name).toContain('电源输入');
    expect(document.querySelector(`#b-${subsystemNode.id} .node-port--input.node-port--top`)).not.toBeNull();
    expect(wrappedRootCanvas.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['signal_source', 'instrument_scope', 'subsystem_block'])
    );
    expect(wrappedRootCanvas.nodes).toHaveLength(3);
    expect(wrappedRootCanvas.edges).toHaveLength(2);
    expect(wrappedRootCanvas.edges.some((edge) => edge.sourceNodeId === sourceNode.id && edge.targetNodeId === subsystemNode.id)).toBe(true);
    expect(wrappedRootCanvas.edges.some((edge) => edge.sourceNodeId === subsystemNode.id && edge.targetNodeId === scopeNode.id)).toBe(true);
    expect(state.manualDiagnosticTestPoints).toEqual([]);
    expect(state.installedDiagnosticTestPointIds).not.toEqual(expect.arrayContaining(['M-wrap-in', 'M-wrap-out']));

    const childCanvas = state.canvases[subsystemNode.targetCanvasId];
    expect(childCanvas).toBeTruthy();
    expect(childCanvas.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['flow_block', 'simulation_block', 'subsystem_in_port', 'subsystem_out_port'])
    );
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_in_port').length).toBeGreaterThanOrEqual(1);
    expect(childCanvas.nodes.filter((node) => node.type === 'subsystem_out_port')).toHaveLength(1);
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === flowNode.id && edge.targetNodeId === simulationNode.id)).toBe(true);

    const childInput = childCanvas.nodes.find((node) => node.type === 'subsystem_in_port' && node.props.componentNodeId === flowNode.id);
    const childOutput = childCanvas.nodes.find((node) => node.type === 'subsystem_out_port' && node.props.componentNodeId === simulationNode.id);
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === childInput.id && edge.targetNodeId === flowNode.id)).toBe(true);
    expect(childCanvas.edges.some((edge) => edge.sourceNodeId === simulationNode.id && edge.targetNodeId === childOutput.id)).toBe(true);

    const backendPackage = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(state);
    expect(backendPackage.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      sourceNode.id,
      flowNode.id,
      simulationNode.id,
      scopeNode.id
    ]));
    expect(backendPackage.nodes.some((node) => node.id === subsystemNode.id || node.type === 'subsystem_block')).toBe(false);
    expect(backendPackage.nodes.some((node) => node.type === 'subsystem_in_port' || node.type === 'subsystem_out_port')).toBe(false);
    expect(backendPackage.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: sourceNode.id, targetNodeId: flowNode.id }),
      expect.objectContaining({ sourceNodeId: flowNode.id, targetNodeId: simulationNode.id }),
      expect.objectContaining({ sourceNodeId: simulationNode.id, targetNodeId: scopeNode.id })
    ]));

    state.manualDiagnosticTestPoints = [{
      pointId: 'M-saved-subsystem-child',
      edgeId: 'edge-wrap-flow-sim',
      pointType: 'virtual',
      detects: []
    }];
    state.installedDiagnosticTestPointIds = ['M-saved-subsystem-child'];
    window.__GZ_SIM__.componentOutputs = {
      time: [0],
      steps: [{
        time: 0,
        actual: { [flowNode.id]: { output: 73 } },
        reference: { [flowNode.id]: { output: 73 } }
      }]
    };

    const resultPackage = await window.buildSimulationResultSnapshot();
    const savedExecutable = resultPackage.privateData.executableModel;
    expect(savedExecutable.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      sourceNode.id,
      flowNode.id,
      simulationNode.id,
      scopeNode.id
    ]));
    expect(savedExecutable.nodes.some((node) => node.id === 'wrapped-subsystem-01' || node.type === 'subsystem_block')).toBe(false);
    expect(savedExecutable.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: sourceNode.id, targetNodeId: flowNode.id }),
      expect.objectContaining({ sourceNodeId: flowNode.id, targetNodeId: simulationNode.id }),
      expect.objectContaining({ sourceNodeId: simulationNode.id, targetNodeId: scopeNode.id })
    ]));
    const savedConnections = resultPackage.publicData.renderData.connections;
    expect(savedConnections).toHaveLength(2);
    expect(savedConnections).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceDeviceId: sourceNode.id, targetDeviceId: 'wrapped-subsystem-01' }),
      expect.objectContaining({ sourceDeviceId: flowNode.id, targetDeviceId: simulationNode.id })
    ]));
    expect(savedConnections).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceDeviceId: sourceNode.id, targetDeviceId: flowNode.id }),
      expect.objectContaining({ sourceDeviceId: simulationNode.id, targetDeviceId: scopeNode.id })
    ]));
    expect(savedConnections.every((connection) => !Object.hasOwn(connection, 'backingEdgeIds'))).toBe(true);
    expect(savedExecutable.connectionBindings).toEqual(resultPackage.privateData.connectionBindings);
    const executableEdgeIds = new Set(savedExecutable.edges.map((edge) => edge.id));
    savedConnections.forEach((connection) => {
      const binding = resultPackage.privateData.connectionBindings.find((item) => (
        item.sourceDeviceId === connection.sourceDeviceId
        && item.sourcePort === connection.sourcePort
        && item.targetDeviceId === connection.targetDeviceId
        && item.targetPort === connection.targetPort
      ));
      expect(binding, `missing binding for ${connection.id}`).toBeTruthy();
      expect(binding.backingEdgeIds.some((id) => executableEdgeIds.has(id))).toBe(true);
    });
    const savedPrivateInputEdge = savedExecutable.edges.find((edge) => (
      edge.sourceNodeId === sourceNode.id && edge.targetNodeId === flowNode.id
    ));
    expect(resultPackage.privateData.connectionBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceDeviceId: sourceNode.id,
        targetDeviceId: 'wrapped-subsystem-01',
        backingEdgeIds: expect.arrayContaining([savedPrivateInputEdge.id])
      })
    ]));
    expect(resultPackage.privateData.connectionBindings.every((binding) => !Object.hasOwn(binding, 'publicConnectionId'))).toBe(true);
    expect(resultPackage.privateData.dMatrix.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointId: 'M-saved-subsystem-child', edgeId: 'edge-wrap-flow-sim' })
    ]));
    expect(resultPackage.publicData.initialSimulationResult.virtualMeasurements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pointId: 'M-saved-subsystem-child',
        sourceDeviceId: flowNode.id,
        samples: [{ time: 0, actual: 73 }]
      })
    ]));
    expect(resultPackage.publicData.renderData.devices).toContainEqual(expect.objectContaining({
      id: 'wrapped-subsystem-01',
      type: 'subsystem_block'
    }));
    expect(resultPackage.publicData.initialSimulationResult.summary).toMatchObject({
      nodeCount: savedExecutable.nodes.length,
      edgeCount: savedExecutable.edges.length
    });

    const externalInputEdge = wrappedRootCanvas.edges.find((edge) => (
      edge.sourceNodeId === sourceNode.id && edge.targetNodeId === subsystemNode.id
    ));
    state.manualDiagnosticTestPoints = [{
      pointId: 'M-subsystem-input',
      edgeId: externalInputEdge.id,
      pointType: 'virtual',
      detects: []
    }];
    state.installedDiagnosticTestPointIds = ['M-subsystem-input'];
    const diagnosticGraph = window.getDiagnosticKnowledgeGraph();
    const observedRelation = diagnosticGraph.relations.find((relation) => (
      relation.type === 'OBSERVES'
      && relation.source.kind === 'measurementPoint'
      && relation.source.id === 'M-subsystem-input'
      && relation.target.kind === 'signalEdge'
    ));
    expect(diagnosticGraph.nodes.some((node) => node.kind === 'component' && node.id === subsystemNode.id)).toBe(false);
    expect(diagnosticGraph.nodes.find((node) => node.kind === 'component' && node.id === sourceNode.id)?.label)
      .toBe(sourceNode.props.name);
    expect(diagnosticGraph.nodes.find((node) => node.kind === 'component' && node.id === flowNode.id)?.label)
      .toBe(flowNode.props.name);
    expect(diagnosticGraph.nodes.find((node) => node.kind === 'signalEdge' && node.id === observedRelation.target.id)?.label)
      .toContain(sourceNode.props.name);
    expect(observedRelation).toBeTruthy();
    expect(diagnosticGraph.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'OUTPUTS_TO', source: { kind: 'component', id: sourceNode.id }, target: { kind: 'signalEdge', id: observedRelation.target.id } }),
      expect.objectContaining({ type: 'INPUTS_TO', source: { kind: 'signalEdge', id: observedRelation.target.id }, target: { kind: 'component', id: flowNode.id } })
    ]));

    window.openSubsystemCanvas(subsystemNode.id);
    await flushRuntime();

    const visibleNodeIds = Array.from(document.querySelectorAll('#node-layer > .blk[id^="b-"]'))
      .map((element) => element.id.replace(/^b-/, ''));
    const visibleEdgeIds = Array.from(document.querySelectorAll('#edge-group .edge-path[data-edge-id]'))
      .map((element) => element.dataset.edgeId);

    const boundaryNodeIds = new Set(
      childCanvas.nodes
        .filter((node) => node.type === 'subsystem_in_port' || node.type === 'subsystem_out_port')
        .map((node) => node.id)
    );
    const expectedVisibleNodeIds = childCanvas.nodes
      .filter((node) => !boundaryNodeIds.has(node.id))
      .map((node) => node.id);
    const expectedVisibleEdgeIds = childCanvas.edges
      .filter((edge) => (
        (!boundaryNodeIds.has(edge.sourceNodeId) && !boundaryNodeIds.has(edge.targetNodeId))
        || (edge.subsystemBoundaryMapping && edge.linkedExternalEdgeId)
      ))
      .map((edge) => edge.id);

    expect(visibleNodeIds.sort()).toEqual(expectedVisibleNodeIds.sort());
    expect(visibleNodeIds).not.toContain(sourceNode.id);
    expect(visibleNodeIds).not.toContain(scopeNode.id);
    expect(visibleNodeIds).not.toContain(subsystemNode.id);
    expect(visibleEdgeIds.sort()).toEqual(expectedVisibleEdgeIds.sort());
    expect(visibleEdgeIds).not.toContain('edge-wrap-source-flow');
    expect(visibleEdgeIds).not.toContain('edge-wrap-sim-scope');
    expect(document.querySelector('[data-fault-tag-id="root-only-fault-tag"]')).toBeNull();
    expect(document.querySelector('[data-fault-injection-link="root-only-fault-link"]')).toBeNull();
  });

  it('unwraps a subsystem by rebuilding external-to-internal connections and removing stale test points', async () => {
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

    connectCanvasNodes(rootCanvas, 'edge-unwrap-source-flow', sourceNode.id, flowNode.id, 0, 0);
    connectCanvasNodes(rootCanvas, 'edge-unwrap-flow-sim', flowNode.id, simulationNode.id, 0, 0);
    connectCanvasNodes(rootCanvas, 'edge-unwrap-sim-scope', simulationNode.id, scopeNode.id, 0, 0);
    window.renderModelNodes();
    await flushRuntime();

    dispatchClick(document.getElementById(`b-${flowNode.id}`));
    dispatchClick(document.getElementById(`b-${simulationNode.id}`), { ctrlKey: true });
    await flushRuntime();
    window.wrapSelectionIntoSubsystem();
    await flushRuntime();

    const subsystemNode = rootCanvas.nodes.find((node) => node.type === 'subsystem_block');
    const childCanvasId = subsystemNode.targetCanvasId;
    const removedExternalEdge = rootCanvas.edges.find((edge) => edge.targetNodeId === subsystemNode.id);
    state.manualDiagnosticTestPoints = [{
      pointId: 'M-removed-external-edge',
      edgeId: removedExternalEdge.id,
      pointType: 'virtual',
      detects: []
    }];
    state.installedDiagnosticTestPointIds = ['M-removed-external-edge'];
    state.simulationTestPointIds = ['M-removed-external-edge'];
    expect(document.querySelector(`[data-unwrap-subsystem="${subsystemNode.id}"]`)).not.toBeNull();
    expect(typeof window.unwrapSelectedSubsystem).toBe('function');

    const result = window.unwrapSelectedSubsystem(subsystemNode.id);
    await flushRuntime();

    expect(result?.restoredNodes).toHaveLength(2);
    expect(state.canvases[childCanvasId]).toBeUndefined();
    expect(rootCanvas.nodes).toHaveLength(4);
    expect(rootCanvas.nodes.some((node) => node.type === 'subsystem_block')).toBe(false);
    expect(rootCanvas.nodes).toEqual(expect.arrayContaining([sourceNode, flowNode, simulationNode, scopeNode]));
    expect(rootCanvas.edges).toHaveLength(3);
    expect(rootCanvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: sourceNode.id, targetNodeId: flowNode.id, sourcePortIndex: 0, targetPortIndex: 0 }),
      expect.objectContaining({ sourceNodeId: flowNode.id, targetNodeId: simulationNode.id, sourcePortIndex: 0, targetPortIndex: 0 }),
      expect.objectContaining({ sourceNodeId: simulationNode.id, targetNodeId: scopeNode.id, sourcePortIndex: 0, targetPortIndex: 0 })
    ]));
    expect(result.removedDiagnosticPointIds).toContain('M-removed-external-edge');
    expect(state.manualDiagnosticTestPoints).toEqual([]);
    expect(state.installedDiagnosticTestPointIds).not.toContain('M-removed-external-edge');
    expect(state.simulationTestPointIds).not.toContain('M-removed-external-edge');
    expect(window.buildDiagnosticTestPointModel({ includeAllCanvases: true }).positions.map((point) => point.pointId))
      .not.toContain('M-removed-external-edge');
    expect(window.collectDataflowEdges().map((item) => item.edge.id)).not.toContain(removedExternalEdge.id);
    expect(state.activeCanvasId).toBe('canvas-root');
    expect(state.selBlk).toBeNull();
  });
});
