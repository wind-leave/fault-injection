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
    expect(target.updateUI).toHaveBeenCalled();
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
