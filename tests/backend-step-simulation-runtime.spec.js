import { describe, expect, it, vi } from 'vitest';
import {
  appendBackendSimulationChunk,
  installBackendStepSimulationRuntime
} from '../src/services/backendStepSimulationRuntime.js';

function createRuntimeTarget() {
  const sim = {
    inited: false,
    running: false,
    paused: false,
    hasSamples: false,
    time: 0,
    duration: 0.3,
    stepIndex: 0,
    stepSize: 0.1,
    actual: { scopeSamples: {} },
    reference: { scopeSamples: {} },
    componentOutputs: { time: [], steps: [] }
  };
  const state = { step: 2, simDone: false };
  return {
    __GZ_SIM__: sim,
    __GZ_STATE__: state,
    __GZ_BACKEND_SIMULATION__: {
      buildExecutablePackage: vi.fn(() => ({ schemaVersion: 1 })),
      createSession: vi.fn(async () => ({ status: 'success', sessionId: 'session-1' })),
      stepSession: vi.fn(async () => ({
        status: 'success',
        sessionId: 'session-1',
        curves: {
          time: [0],
          channels: {
            'scope-1.ch1.actual': [1.2],
            'scope-1.ch1.reference': [1.0],
            'scope-1.ch2.actual': [2.2],
            'scope-1.ch2.reference': [2.0]
          }
        },
        metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false },
        events: []
      })),
      deleteSession: vi.fn(async () => ({ status: 'success' }))
    },
    simInit: vi.fn(() => {
      sim.inited = true;
      sim.running = false;
      sim.paused = false;
      sim.hasSamples = false;
      sim.time = 0;
      sim.stepIndex = 0;
      sim.duration = 0.3;
      sim.stepSize = 0.1;
      sim.actual = { scopeSamples: {} };
      sim.reference = { scopeSamples: {} };
      sim.componentOutputs = { time: [], steps: [] };
      state.simDone = false;
    }),
    simStep: vi.fn(),
    simRun: vi.fn(),
    simPause: vi.fn(),
    simStop: vi.fn(),
    updateUI: vi.fn(),
    renderScopeWindows: vi.fn(),
    renderSpectrumInstrument: vi.fn(),
    publishSimulationRuntimeSummary: vi.fn(),
    setInterval: vi.fn(() => 123),
    clearInterval: vi.fn()
  };
}

describe('backend step simulation runtime', () => {
  it('appends backend chunk channels into dual scope sample buckets', () => {
    const target = createRuntimeTarget();

    appendBackendSimulationChunk(target, {
      curves: {
        time: [0, 0.1],
        channels: {
          'scope-1.ch1.actual': [1, 1.1],
          'scope-1.ch1.reference': [0.9, 1],
          'scope-1.ch2.actual': [2, 2.1]
        }
      },
      metrics: { sampleCount: 2, stepIndex: 2, time: 0.2, done: false }
    });

    expect(target.__GZ_SIM__.actual.scopeSamples['scope-1'].ch1).toEqual([
      { t: 0, actual: 1 },
      { t: 0.1, actual: 1.1 }
    ]);
    expect(target.__GZ_SIM__.reference.scopeSamples['scope-1'].ch1).toEqual([
      { t: 0, actual: 0.9 },
      { t: 0.1, actual: 1 }
    ]);
    expect(target.__GZ_SIM__.actual.scopeSamples['scope-1'].ch2).toEqual([
      { t: 0, actual: 2 },
      { t: 0.1, actual: 2.1 }
    ]);
    expect(target.__GZ_SIM__.time).toBe(0.2);
    expect(target.__GZ_SIM__.stepIndex).toBe(2);
    expect(target.__GZ_SIM__.hasSamples).toBe(true);
  });

  it('appends backend component output traces for export', () => {
    const target = createRuntimeTarget();

    appendBackendSimulationChunk(target, {
      curves: {
        time: [0, 0.1],
        channels: {}
      },
      componentOutputs: {
        time: [0, 0.1],
        steps: [
          {
            time: 0,
            actual: { 'source-1': { out: 1 }, 'sim-1': { output: 1 } },
            reference: { 'source-1': { out: 1 }, 'sim-1': { output: 1 } }
          },
          {
            time: 0.1,
            actual: { 'source-1': { out: 1 }, 'sim-1': { output: 1.5 } },
            reference: { 'source-1': { out: 1 }, 'sim-1': { output: 1 } }
          }
        ]
      },
      metrics: { sampleCount: 2, stepIndex: 2, time: 0.2, done: false }
    });

    expect(target.__GZ_SIM__.componentOutputs.time).toEqual([0, 0.1]);
    expect(target.__GZ_SIM__.componentOutputs.steps).toHaveLength(2);
    expect(target.__GZ_SIM__.componentOutputs.steps[1].actual['sim-1'].output).toBe(1.5);
    expect(target.__GZ_SIM__.componentOutputs.steps[1].reference['sim-1'].output).toBe(1);
  });

  it('syncs backend vector outputs into frontend node and edge runtime state', () => {
    const target = createRuntimeTarget();
    target.__GZ_SIM__.actual.nodeStates = {
      vectorizer: { lastOutput: 0, lastOutputs: [0] }
    };
    target.__GZ_SIM__.actual.edgeStates = {
      'edge-vector-display': { lastOutput: 0 }
    };
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          {
            id: 'vectorizer',
            type: 'simulation_block',
            props: {
              outputs: [{ varName: 'vector_output', dataType: 'vector', vectorLength: 4 }]
            }
          },
          { id: 'display-1', type: 'display_console' }
        ],
        edges: [{
          id: 'edge-vector-display',
          sourceNodeId: 'vectorizer',
          sourcePortIndex: 0,
          targetNodeId: 'display-1',
          targetPortIndex: 0
        }]
      }
    };
    const actualVector = [0.19011852116866196, 0.19011852116866196, 0.19011852116866196, 0.19011852116866196];
    const referenceVector = [0.19, 0.19, 0.19, 0.19];

    appendBackendSimulationChunk(target, {
      curves: { time: [0], channels: {} },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: { vectorizer: { vector_output: actualVector } },
          reference: { vectorizer: { vector_output: referenceVector } }
        }]
      },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    });

    expect(target.__GZ_SIM__.actual.nodeStates.vectorizer.lastOutputs).toEqual([actualVector]);
    expect(target.__GZ_SIM__.actual.nodeStates.vectorizer.lastOutput).toEqual(actualVector);
    expect(target.__GZ_SIM__.actual.edgeStates['edge-vector-display'].lastOutput).toEqual(actualVector);
    expect(target.__GZ_SIM__.reference.nodeStates.vectorizer.lastOutputs).toEqual([referenceVector]);
    expect(target.__GZ_SIM__.reference.edgeStates['edge-vector-display'].lastOutput).toEqual(referenceVector);
  });

  it('syncs scalar and multi-port backend outputs for every simulation component', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.modelNodes = [
      {
        id: 'scalar-component',
        type: 'simulation_block',
        outputs: [{ varName: 'scalar_output' }]
      },
      {
        id: 'multi-component',
        type: 'simulation_block',
        outputs: [
          { varName: 'first_output' },
          { varName: 'second_output' }
        ]
      },
      { id: 'scalar-target', type: 'instrument_scope' },
      { id: 'multi-target', type: 'instrument_scope' }
    ];
    target.__GZ_STATE__.modelEdges = [
      {
        id: 'edge-scalar',
        sourceNodeId: 'scalar-component',
        sourcePortIndex: 0,
        targetNodeId: 'scalar-target',
        targetPortIndex: 0
      },
      {
        id: 'edge-multi-second',
        sourceNodeId: 'multi-component',
        sourcePortIndex: 1,
        targetNodeId: 'multi-target',
        targetPortIndex: 0
      }
    ];

    appendBackendSimulationChunk(target, {
      curves: { time: [0], channels: {} },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: {
            'scalar-component': { scalar_output: 3.25 },
            // Deliberately reverse object field order: port metadata must win.
            'multi-component': { second_output: 22, first_output: 11 }
          },
          reference: {
            'scalar-component': { scalar_output: 3 },
            'multi-component': { second_output: 20, first_output: 10 }
          }
        }]
      },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    });

    expect(target.__GZ_SIM__.actual.nodeStates['scalar-component'].lastOutputs).toEqual([3.25]);
    expect(target.__GZ_SIM__.actual.edgeStates['edge-scalar'].lastOutput).toBe(3.25);
    expect(target.__GZ_SIM__.actual.nodeStates['multi-component'].lastOutputs).toEqual([11, 22]);
    expect(target.__GZ_SIM__.actual.edgeStates['edge-multi-second'].lastOutput).toBe(22);
    expect(target.__GZ_SIM__.reference.nodeStates['multi-component'].lastOutputs).toEqual([10, 20]);
  });

  it('keeps the complete component output trace beyond the rolling display capacity', () => {
    const target = createRuntimeTarget();
    const steps = [0, 0.1, 0.2].map((time, index) => ({
      time,
      actual: { 'sim-1': { output: index } },
      reference: { 'sim-1': { output: index } }
    }));

    appendBackendSimulationChunk(target, {
      curves: { time: steps.map((step) => step.time), channels: {} },
      componentOutputs: { time: steps.map((step) => step.time), steps },
      metrics: { sampleCount: steps.length, stepIndex: steps.length, time: 0.3, done: false }
    }, { sampleLimit: 2 });

    expect(target.__GZ_SIM__.componentOutputs.time).toEqual([0, 0.1, 0.2]);
    expect(target.__GZ_SIM__.componentOutputs.steps.map((step) => step.actual['sim-1'].output)).toEqual([0, 1, 2]);
  });

  it('records backend component outputs for a connected spectrum analyzer', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          { id: 'source-1', type: 'signal_source', outputs: [{ name: 'out', dataType: 'vector', vectorLength: 2 }] },
          { id: 'spectrum-1', type: 'instrument_spectrum', props: { vectorChannel: 2 } }
        ],
        edges: [{
          id: 'edge-source-spectrum',
          sourceNodeId: 'source-1',
          sourcePortIndex: 0,
          targetNodeId: 'spectrum-1',
          targetPortIndex: 0
        }]
      }
    };

    appendBackendSimulationChunk(target, {
      curves: { time: [0, 0.1], channels: {} },
      componentOutputs: {
        time: [0, 0.1],
        steps: [
          { time: 0, actual: { 'source-1': { out: [1, 4] } }, reference: { 'source-1': { out: [1, 4] } } },
          { time: 0.1, actual: { 'source-1': { out: [1.5, 5] } }, reference: { 'source-1': { out: [1, 4] } } }
        ]
      },
      metrics: { sampleCount: 2, stepIndex: 2, time: 0.2, done: false }
    });

    expect(target.__GZ_SIM__.actual.instrumentSamples['spectrum-1']).toEqual([
      { t: 0, actual: 4 },
      { t: 0.1, actual: 5 }
    ]);
    expect(target.__GZ_SIM__.reference.instrumentSamples['spectrum-1']).toBeUndefined();
  });

  it('samples the selected output port of a multi-output simulation component', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.modelNodes = [
      {
        id: 'multi-component',
        type: 'simulation_block',
        props: {
          outputs: [
            { varName: 'first_output' },
            { varName: 'second_output' }
          ]
        }
      },
      { id: 'logger-1', type: 'instrument_logger', props: {} }
    ];
    target.__GZ_STATE__.modelEdges = [{
      id: 'multi-logger',
      sourceNodeId: 'multi-component',
      sourcePortIndex: 1,
      targetNodeId: 'logger-1',
      targetPortIndex: 0
    }];

    appendBackendSimulationChunk(target, {
      curves: { time: [0], channels: {} },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: { 'multi-component': { second_output: 22, first_output: 11 } },
          reference: { 'multi-component': { second_output: 20, first_output: 10 } }
        }]
      },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    });

    expect(target.__GZ_SIM__.actual.instrumentSamples['logger-1']).toEqual([
      { t: 0, actual: 22, reference: 20 }
    ]);
  });

  it('decimates spectrum instrument samples to its configured sampling rate', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          { id: 'source-1', type: 'signal_source', outputs: [{ name: 'out' }] },
          { id: 'spectrum-1', type: 'instrument_spectrum', props: { sampleRate: '1kHz' } }
        ],
        edges: [{
          id: 'edge-source-spectrum',
          sourceNodeId: 'source-1',
          sourcePortIndex: 0,
          targetNodeId: 'spectrum-1',
          targetPortIndex: 0
        }]
      }
    };
    const steps = Array.from({ length: 11 }, (_, index) => ({
      time: index * 0.0001,
      actual: { 'source-1': { out: index } },
      reference: { 'source-1': { out: index } }
    }));

    appendBackendSimulationChunk(target, {
      curves: { time: steps.map((step) => step.time), channels: {} },
      componentOutputs: { time: steps.map((step) => step.time), steps },
      metrics: { sampleCount: steps.length, stepIndex: steps.length, time: 0.0011, done: false }
    });

    expect(target.__GZ_SIM__.actual.instrumentSamples['spectrum-1']).toEqual([
      { t: 0, actual: 0 },
      { t: 0.001, actual: 10 }
    ]);
  });

  it('retains spectrum samples up to its FFT window instead of the generic 720-point limit', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          { id: 'source-1', type: 'signal_source', outputs: [{ name: 'out' }] },
          { id: 'spectrum-1', type: 'instrument_spectrum', props: { sampleRate: '1kHz', fftSize: 1024 } }
        ],
        edges: [{
          id: 'edge-source-spectrum',
          sourceNodeId: 'source-1',
          sourcePortIndex: 0,
          targetNodeId: 'spectrum-1',
          targetPortIndex: 0
        }]
      }
    };
    const steps = Array.from({ length: 1024 }, (_, index) => ({
      time: index * 0.001,
      actual: { 'source-1': { out: index } },
      reference: { 'source-1': { out: index } }
    }));

    appendBackendSimulationChunk(target, {
      curves: { time: steps.map((step) => step.time), channels: {} },
      componentOutputs: { time: steps.map((step) => step.time), steps },
      metrics: { sampleCount: steps.length, stepIndex: steps.length, time: 1.024, done: false }
    });

    const samples = target.__GZ_SIM__.actual.instrumentSamples['spectrum-1'];
    expect(samples).toHaveLength(1024);
    expect(samples[0]).toEqual({ t: 0, actual: 0 });
    expect(samples.at(-1)?.actual).toBe(1023);
    expect(samples.at(-1)?.t).toBeCloseTo(1.023);
  });

  it('measures a component input for voltage, an edge value for current, and 1 ohm for resistance', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          { id: 'positive-source', type: 'signal_source', outputs: [{ name: 'out' }] },
          { id: 'target-component', type: 'simulation_block', inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] },
          {
            id: 'meter-1',
            type: 'instrument_multimeter',
            props: {
              measurementMode: '直流电压',
              positiveLead: { nodeId: 'target-component', direction: 'input', portIndex: 0 },
              negativeLead: { nodeId: 'target-component', direction: 'output', portIndex: 0 }
            }
          }
        ],
        edges: [{
          id: 'edge-positive-component',
          sourceNodeId: 'positive-source',
          sourcePortIndex: 0,
          targetNodeId: 'target-component',
          targetPortIndex: 0
        }]
      }
    };
    const chunk = {
      curves: { time: [0], channels: {} },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: { 'positive-source': { out: 12 } },
          reference: { 'positive-source': { out: 10 } }
        }]
      },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    };

    appendBackendSimulationChunk(target, chunk);
    expect(target.__GZ_SIM__.actual.instrumentSamples['meter-1']).toEqual([
      { t: 0, actual: 12, reference: 10 }
    ]);

    target.__GZ_STATE__.canvases['canvas-root'].nodes.find((node) => node.id === 'meter-1').props = {
      measurementMode: '直流电流',
      positiveLead: { nodeId: 'positive-source', direction: 'output', portIndex: 0 },
      negativeLead: { nodeId: 'target-component', direction: 'input', portIndex: 0 }
    };
    appendBackendSimulationChunk(target, {
      ...chunk,
      curves: { time: [0.1], channels: {} },
      componentOutputs: {
        ...chunk.componentOutputs,
        time: [0.1],
        steps: [{ ...chunk.componentOutputs.steps[0], time: 0.1 }]
      },
      metrics: { sampleCount: 1, stepIndex: 2, time: 0.2, done: false }
    });

    expect(target.__GZ_SIM__.actual.instrumentSamples['meter-1']).toEqual([
      { t: 0, actual: 12, reference: 10 },
      { t: 0.1, actual: 12, reference: 10 }
    ]);

    target.__GZ_STATE__.canvases['canvas-root'].nodes.find((node) => node.id === 'meter-1').props = {
      measurementMode: '电阻',
      positiveLead: { nodeId: 'target-component', direction: 'input', portIndex: 0 },
      negativeLead: { nodeId: 'target-component', direction: 'output', portIndex: 0 }
    };
    appendBackendSimulationChunk(target, {
      ...chunk,
      curves: { time: [0.2], channels: {} },
      componentOutputs: { ...chunk.componentOutputs, time: [0.2], steps: [{ ...chunk.componentOutputs.steps[0], time: 0.2 }] }
    });
    expect(target.__GZ_SIM__.actual.instrumentSamples['meter-1'].at(-1)).toEqual({ t: 0.2, actual: 1, reference: 1 });

    target.__GZ_STATE__.canvases['canvas-root'].nodes.find((node) => node.id === 'meter-1').props = {
      measurementMode: '直流电流',
      positiveLead: { nodeId: 'target-component', direction: 'input', portIndex: 0 },
      negativeLead: { nodeId: 'target-component', direction: 'output', portIndex: 0 }
    };
    appendBackendSimulationChunk(target, {
      ...chunk,
      curves: { time: [0.3], channels: {} },
      componentOutputs: { ...chunk.componentOutputs, time: [0.3], steps: [{ ...chunk.componentOutputs.steps[0], time: 0.3 }] }
    });
    expect(target.__GZ_SIM__.actual.instrumentSamples['meter-1']).toHaveLength(3);

    target.__GZ_STATE__.canvases['canvas-root'].nodes.find((node) => node.id === 'meter-1').props = {
      measurementMode: '直流电流',
      positiveLead: { nodeId: 'target-component', direction: 'input', portIndex: 0 },
      negativeLead: { nodeId: 'positive-source', direction: 'output', portIndex: 0 }
    };
    appendBackendSimulationChunk(target, {
      ...chunk,
      curves: { time: [0.4], channels: {} },
      componentOutputs: { ...chunk.componentOutputs, time: [0.4], steps: [{ ...chunk.componentOutputs.steps[0], time: 0.4 }] }
    });
    expect(target.__GZ_SIM__.actual.instrumentSamples['meter-1'].at(-1)).toEqual({ t: 0.4, actual: -12, reference: -10 });
  });

  it('overrides simStep to create a backend session and append one step', async () => {
    const target = createRuntimeTarget();

    installBackendStepSimulationRuntime(target);
    await target.simStep();

    expect(target.__GZ_BACKEND_SIMULATION__.buildExecutablePackage).toHaveBeenCalledWith(target.__GZ_STATE__);
    expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledWith({ schemaVersion: 1 });
    expect(target.__GZ_BACKEND_SIMULATION__.stepSession).toHaveBeenCalledWith('session-1', { steps: 1 });
    expect(target.__GZ_SIM__.actual.scopeSamples['scope-1'].ch1.at(-1)).toEqual({ t: 0, actual: 1.2 });
    expect(target.__GZ_SIM__.reference.scopeSamples['scope-1'].ch2.at(-1)).toEqual({ t: 0, actual: 2.0 });
    expect(target.__GZ_SIM__.stepIndex).toBe(1);
    expect(target.__GZ_STATE__.step).toBe(3);
    expect(target.renderSpectrumInstrument).toHaveBeenCalled();
    expect(target.updateUI).toHaveBeenCalled();
  });

  it('clears stale local samples when creating a backend session from an initialized simulation', async () => {
    const target = createRuntimeTarget();
    target.__GZ_SIM__.inited = true;
    target.__GZ_SIM__.actual.scopeSamples = {
      'scope-1': { ch1: [{ t: 9.9, actual: 999 }], ch2: [] }
    };
    target.__GZ_SIM__.reference.scopeSamples = {
      'scope-1': { ch1: [{ t: 9.9, actual: 888 }], ch2: [] }
    };
    target.__GZ_SIM__.componentOutputs = {
      time: [9.9],
      steps: [
        {
          time: 9.9,
          actual: {
            'node-command-shaper': { output: 0.425779 },
            'node-imu': { output: 0.095687 },
            'node-error-sum': { output: 0.002059 }
          },
          reference: {}
        }
      ]
    };
    target.__GZ_BACKEND_SIMULATION__.stepSession.mockResolvedValueOnce({
      status: 'success',
      sessionId: 'session-1',
      curves: {
        time: [0],
        channels: {
          'scope-1.ch1.actual': [0.33],
          'scope-1.ch1.reference': [0.33]
        }
      },
      componentOutputs: {
        time: [0],
        steps: [
          {
            time: 0,
            actual: {
              'node-command-shaper': { output: 0.425779 },
              'node-imu': { output: 0.095687 },
              'node-error-sum': { output: 0.330092 }
            },
            reference: {}
          }
        ]
      },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    });

    installBackendStepSimulationRuntime(target);
    await target.simStep();

    expect(target.__GZ_SIM__.actual.scopeSamples['scope-1'].ch1).toEqual([{ t: 0, actual: 0.33 }]);
    expect(target.__GZ_SIM__.reference.scopeSamples['scope-1'].ch1).toEqual([{ t: 0, actual: 0.33 }]);
    expect(target.__GZ_SIM__.componentOutputs.time).toEqual([0]);
    expect(target.__GZ_SIM__.componentOutputs.steps[0].actual['node-error-sum'].output).toBe(0.330092);
  });

  it('recreates the backend session after a parameter edit invalidates the simulation', async () => {
    const target = createRuntimeTarget();
    installBackendStepSimulationRuntime(target);
    await target.simStep();

    target.__GZ_SIM__.inited = false;
    target.__GZ_SIM__.staleBackendSessionId = 'session-1';
    target.__GZ_SIM__.backendSessionId = '';
    await target.simStep();

    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('session-1');
    expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledTimes(2);
    expect(target.__GZ_BACKEND_SIMULATION__.stepSession).toHaveBeenLastCalledWith('session-1', { steps: 1 });
  });

  it('discards the backend session before running after a parameter edit', async () => {
    const target = createRuntimeTarget();
    installBackendStepSimulationRuntime(target);
    await target.simStep();

    target.__GZ_SIM__.inited = false;
    await target.simRun();

    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('session-1');
    expect(target.__GZ_SIM__.backendSessionId).toBe('');
  });

  it('deletes the backend session when simulation stops', async () => {
    const target = createRuntimeTarget();

    installBackendStepSimulationRuntime(target);
    await target.simStep();
    await target.simStop('manual');

    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('session-1');
    expect(target.__GZ_SIM__.backendSessionId).toBe('');
  });

  it('keeps the second simulation session when the first session finishes deleting late', async () => {
    const target = createRuntimeTarget();
    let sessionSequence = 0;
    let finishFirstDelete;
    const firstDelete = new Promise((resolve) => {
      finishFirstDelete = resolve;
    });
    target.__GZ_BACKEND_SIMULATION__.createSession.mockImplementation(async () => {
      sessionSequence += 1;
      return { status: 'success', sessionId: `session-${sessionSequence}` };
    });
    target.__GZ_BACKEND_SIMULATION__.deleteSession.mockImplementation((sessionId) => (
      sessionId === 'session-1' ? firstDelete : Promise.resolve({ status: 'success' })
    ));

    installBackendStepSimulationRuntime(target);
    await target.simStep();
    expect(target.__GZ_SIM__.backendSessionId).toBe('session-1');

    const firstStop = target.simStop('completed');
    expect(target.__GZ_SIM__.backendSessionId).toBe('');
    target.simInit(true);
    const secondStep = target.simStep();
    await Promise.resolve();
    expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledTimes(1);

    finishFirstDelete({ status: 'success' });
    await firstStop;
    await secondStep;

    expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledTimes(2);
    expect(target.__GZ_BACKEND_SIMULATION__.stepSession).toHaveBeenLastCalledWith('session-2', { steps: 1 });
    expect(target.__GZ_SIM__.backendSessionId).toBe('session-2');
    expect(target.__GZ_SIM__.componentOutputs.time).toEqual([]);
  });

  it('runs a completed simulation a second time with a fresh backend session', async () => {
    const target = createRuntimeTarget();
    const timerCallbacks = [];
    let sessionSequence = 0;
    target.setInterval.mockImplementation((callback) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    });
    target.__GZ_BACKEND_SIMULATION__.createSession.mockImplementation(async () => {
      sessionSequence += 1;
      return { status: 'success', sessionId: `session-${sessionSequence}` };
    });
    target.__GZ_BACKEND_SIMULATION__.stepSession.mockImplementation(async (sessionId) => ({
      status: 'success',
      sessionId,
      curves: { time: [0], channels: { 'scope-1.ch1.actual': [sessionSequence] } },
      componentOutputs: { time: [0], steps: [] },
      metrics: { sampleCount: 1, stepIndex: 3, time: 0.3, done: true }
    }));

    installBackendStepSimulationRuntime(target);
    await target.simRun();
    await timerCallbacks[0]();
    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('session-1');

    await target.simRun();
    await timerCallbacks[1]();

    expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledTimes(2);
    expect(target.__GZ_BACKEND_SIMULATION__.stepSession).toHaveBeenLastCalledWith('session-2', { steps: 1 });
    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenLastCalledWith('session-2');
  });

  it('ignores a late step response from the previous simulation run', async () => {
    const target = createRuntimeTarget();
    let finishFirstStep;
    const firstStep = new Promise((resolve) => {
      finishFirstStep = resolve;
    });
    target.__GZ_BACKEND_SIMULATION__.stepSession.mockImplementationOnce(() => firstStep);

    installBackendStepSimulationRuntime(target);
    const pendingStep = target.simStep();
    await vi.waitFor(() => {
      expect(target.__GZ_BACKEND_SIMULATION__.stepSession).toHaveBeenCalledTimes(1);
    });
    target.simInit(true);

    finishFirstStep({
      status: 'success',
      curves: { time: [0], channels: { 'scope-1.ch1.actual': [99] } },
      componentOutputs: { time: [0], steps: [] },
      metrics: { sampleCount: 1, stepIndex: 1, time: 0.1, done: false }
    });
    await pendingStep;

    expect(target.__GZ_SIM__.actual.scopeSamples).toEqual({});
    expect(target.__GZ_SIM__.time).toBe(0);
    expect(target.__GZ_SIM__.stepIndex).toBe(0);
  });

  it('discards a backend session that finishes creating after reinitialization', async () => {
    const target = createRuntimeTarget();
    let finishCreate;
    target.__GZ_BACKEND_SIMULATION__.createSession.mockImplementationOnce(() => new Promise((resolve) => {
      finishCreate = resolve;
    }));

    installBackendStepSimulationRuntime(target);
    const pendingStep = target.simStep();
    await vi.waitFor(() => {
      expect(target.__GZ_BACKEND_SIMULATION__.createSession).toHaveBeenCalledTimes(1);
    });
    target.simInit(true);
    finishCreate({ status: 'success', sessionId: 'stale-session' });
    await pendingStep;
    await vi.waitFor(() => {
      expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('stale-session');
    });

    expect(target.__GZ_BACKEND_SIMULATION__.stepSession).not.toHaveBeenCalled();
    expect(target.__GZ_SIM__.backendSessionId).toBe('');
    expect(target.__GZ_SIM__.time).toBe(0);
  });
});
