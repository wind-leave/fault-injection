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
      sim.duration = 0.3;
      sim.stepSize = 0.1;
      sim.actual = { scopeSamples: {} };
      sim.reference = { scopeSamples: {} };
      sim.componentOutputs = { time: [], steps: [] };
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

  it('records backend component outputs for a connected spectrum analyzer', () => {
    const target = createRuntimeTarget();
    target.__GZ_STATE__.canvases = {
      'canvas-root': {
        nodes: [
          { id: 'source-1', type: 'signal_source', outputs: [{ name: 'out' }] },
          { id: 'spectrum-1', type: 'instrument_spectrum' }
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
          { time: 0, actual: { 'source-1': { out: 1 } }, reference: { 'source-1': { out: 1 } } },
          { time: 0.1, actual: { 'source-1': { out: 1.5 } }, reference: { 'source-1': { out: 1 } } }
        ]
      },
      metrics: { sampleCount: 2, stepIndex: 2, time: 0.2, done: false }
    });

    expect(target.__GZ_SIM__.actual.instrumentSamples['spectrum-1']).toEqual([
      { t: 0, actual: 1 },
      { t: 0.1, actual: 1.5 }
    ]);
    expect(target.__GZ_SIM__.reference.instrumentSamples['spectrum-1']).toBeUndefined();
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

  it('deletes the backend session when simulation stops', async () => {
    const target = createRuntimeTarget();

    installBackendStepSimulationRuntime(target);
    await target.simStep();
    await target.simStop('manual');

    expect(target.__GZ_BACKEND_SIMULATION__.deleteSession).toHaveBeenCalledWith('session-1');
    expect(target.__GZ_SIM__.backendSessionId).toBe('');
  });
});
