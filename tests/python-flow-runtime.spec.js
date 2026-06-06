import { describe, expect, it, vi } from 'vitest';
import {
  executeFlowBlockPythonBindingSync,
  getPythonBindingDefaultValue
} from '../src/services/pythonFlowBindingRuntime.js';

const binding = {
  bound: true,
  fileName: 'pid_controller.py',
  moduleName: 'pid_controller',
  entryFunction: 'process',
  rawSource: 'def process(error, dt=0.01): return error, dt',
  portMapping: {
    inputs: [
      { varName: 'error', displayName: 'error', type: 'float', default: null, connected: true },
      { varName: 'dt', displayName: 'dt', type: 'float', default: '0.01', connected: false }
    ],
    outputs: [
      { varName: 'output_0', displayName: 'output', type: 'float' },
      { varName: 'output_1', displayName: 'clamped', type: 'float' }
    ],
    middleVars: [
      { varName: 'integral', displayName: 'integral', type: 'float' }
    ]
  }
};

describe('pythonFlowBindingRuntime', () => {
  it('coerces default input values by declared type', () => {
    expect(getPythonBindingDefaultValue({ type: 'float', default: '0.25' })).toBe(0.25);
    expect(getPythonBindingDefaultValue({ type: 'int', default: '2' })).toBe(2);
    expect(getPythonBindingDefaultValue({ type: 'bool', default: 'true' })).toBe(1);
    expect(getPythonBindingDefaultValue({ type: 'bool', default: 'False' })).toBe(0);
    expect(getPythonBindingDefaultValue({ type: 'float', default: null })).toBe(0);
  });

  it('builds backend payloads with connected inputs and default fallbacks', () => {
    const executeSync = vi.fn(() => ({
      outputs: { output_0: 0.42, output_1: 0.21 },
      middleVars: { integral: 1.5 }
    }));

    const result = executeFlowBlockPythonBindingSync({
      nodeId: 'node-3',
      binding,
      inputValues: [0.5],
      mode: 'actual',
      time: 1.2,
      dt: 0.05,
      executeSync
    });

    expect(executeSync).toHaveBeenCalledTimes(1);
    expect(executeSync.mock.calls[0][0]).toMatchObject({
      adapterMode: 'mock',
      payload: {
        nodeId: 'node-3',
        moduleName: 'pid_controller',
        fileName: 'pid_controller.py',
        entryFunction: 'process',
        mode: 'actual',
        time: 1.2,
        dt: 0.05,
        inputs: {
          error: 0.5,
          dt: 0.01
        },
        inputNames: ['error', 'dt'],
        outputNames: ['output_0', 'output_1'],
        middleVarNames: ['integral']
      }
    });
    expect(result.outputs).toEqual([0.42, 0.21]);
    expect(result.middleValues).toEqual([1.5]);
    expect(result.payload.inputs.dt).toBe(0.01);
  });

  it('applies the electrical-fault hook only to the primary actual output', () => {
    const result = executeFlowBlockPythonBindingSync({
      nodeId: 'node-9',
      binding,
      inputValues: [0.25, 0.1],
      mode: 'actual',
      executeSync: () => ({
        outputs: { output_0: 1, output_1: 2 },
        middleVars: { integral: 3 }
      }),
      applyElectricalFault: (value) => value + 10
    });

    expect(result.outputs).toEqual([11, 2]);
    expect(result.middleValues).toEqual([3]);
  });
});
