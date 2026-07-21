import { describe, expect, it } from 'vitest';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';

describe('backendExecutablePackageService', () => {
  it('exports only backend executable canvas state', () => {
    const state = {
      packageId: 'pkg-1',
      simulationConfig: { duration: 1, stepSize: 0.1 },
      selectedNodeId: 'sim-1',
      viewport: { scale: 1.5 },
      modelNodes: [
        {
          id: 'source-1',
          type: 'signal_source',
          x: 100,
          y: 200,
          props: { value: 1 },
          outputs: [{ name: 'out' }]
        },
        {
          id: 'sim-1',
          type: 'simulation_block',
          props: { kp: 4.5 },
          pythonBinding: { moduleId: 'passthrough', entryFunction: 'process', rawSource: 'def process(): pass' },
          inputs: [{ name: 'input' }],
          outputs: [{ name: 'output' }]
        },
        {
          id: 'scope-1',
          type: 'instrument_scope',
          props: {},
          inputs: [{ name: 'CH1' }]
        }
      ],
      modelEdges: [
        { id: 'edge-1', sourceNodeId: 'source-1', sourcePortIndex: 0, targetNodeId: 'sim-1', targetPortIndex: 0 },
        { id: 'edge-2', sourceNodeId: 'sim-1', sourcePortIndex: 0, targetNodeId: 'scope-1', targetPortIndex: 0 }
      ],
      faultInstances: [],
      measurementPoints: [{ id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' }]
    };

    const pkg = buildBackendExecutablePackage(state);

    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.nodes[0]).toEqual({
      id: 'source-1',
      type: 'signal_source',
      parameters: { value: 1 },
      inputs: [],
      outputs: [{ name: 'out' }]
    });
    expect(pkg.nodes[1].pythonBinding).toEqual({ moduleId: 'passthrough', entryFunction: 'process' });
    expect(JSON.stringify(pkg)).not.toContain('rawSource');
    expect(JSON.stringify(pkg)).not.toContain('selectedNodeId');
    expect(JSON.stringify(pkg)).not.toContain('viewport');
    expect(JSON.stringify(pkg)).not.toContain('"x"');
  });

  it('uses default simulation config when state omits it', () => {
    const pkg = buildBackendExecutablePackage({ modelNodes: [], modelEdges: [] });

    expect(pkg.simulationConfig).toEqual({ duration: 10, stepSize: 0.1 });
  });

  it('exports numeric scalar fallbacks for all signal source domains', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'analog', type: 'signal_source', props: { signalDomain: 'analog', amplitude: '1.5' } },
        { id: 'digital', type: 'signal_source', props: { signalDomain: 'digital', initialState: '1' } },
        { id: 'command', type: 'signal_source', props: { signalDomain: 'command', payloadValue: '7' } },
        { id: 'rf', type: 'signal_source', props: { signalDomain: 'rf', power: '10' } }
      ],
      modelEdges: []
    });

    expect(pkg.nodes).toEqual([
      expect.objectContaining({ id: 'analog', parameters: expect.objectContaining({ amplitude: 1.5, value: 1.5 }) }),
      expect.objectContaining({ id: 'digital', parameters: expect.objectContaining({ initialState: 1, value: 1 }) }),
      expect.objectContaining({ id: 'command', parameters: expect.objectContaining({ payloadValue: 7, value: 7 }) }),
      expect.objectContaining({ id: 'rf', parameters: expect.objectContaining({ power: 10, value: 10 }) })
    ]);
  });

  it('exports analog signal waveform parameters for backend execution', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        {
          id: 'sine-source',
          type: 'signal_source',
          props: {
            signalDomain: 'analog',
            waveType: 'sine',
            amplitude: '0.08',
            frequency: '0.35',
            phase: '0.2',
            offset: '0.01'
          }
        }
      ],
      modelEdges: []
    });

    expect(pkg.nodes[0].parameters).toEqual(expect.objectContaining({
      signalDomain: 'analog',
      waveType: 'sine',
      amplitude: 0.08,
      frequency: 0.35,
      phase: 0.2,
      offset: 0.01,
      value: 0.08
    }));
  });

  it('maps an RF CW source to a backend sine carrier', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        {
          id: 'rf-cw-source',
          type: 'signal_source',
          props: {
            signalDomain: 'rf',
            modulation: 'cw',
            centerFrequency: '1',
            centerFrequencyUnit: 'GHz',
            power: '10'
          }
        }
      ],
      modelEdges: []
    });

    expect(pkg.nodes[0].parameters).toEqual(expect.objectContaining({
      signalDomain: 'rf',
      rfModulation: 'cw',
      centerFrequencyHz: 1e9,
      waveType: 'sine',
      amplitude: 10,
      frequency: 1e9,
      phase: 0,
      offset: 0,
      value: 10
    }));
  });

  it('exports every RF modulation parameter in backend units', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        {
          id: 'rf-am',
          type: 'signal_source',
          props: {
            signalDomain: 'rf',
            modulation: 'am',
            centerFrequency: '2.4',
            centerFrequencyUnit: 'GHz',
            power: '8',
            modulationDepth: '50',
            modulationRate: '5kHz',
            frequencyDeviation: '12kHz',
            phaseDeviation: `${Math.PI / 2}`,
            pulseWidth: '250us',
            prf: '1kHz',
            bandwidth: '20MHz',
            symbolRate: '10MHz',
            sampleRate: '40MHz',
            snr: '12'
          }
        }
      ],
      modelEdges: []
    });

    expect(pkg.nodes[0].parameters).toEqual(expect.objectContaining({
      rfModulation: 'am',
      centerFrequencyHz: 2.4e9,
      amplitude: 8,
      frequency: 2.4e9,
      modulationRateHz: 5e3,
      modulationDepthRatio: 0.5,
      frequencyDeviationHz: 12e3,
      phaseDeviationRad: Math.PI / 2,
      pulseWidthSeconds: 250e-6,
      prfHz: 1e3,
      bandwidthHz: 20e6,
      symbolRateHz: 10e6,
      sampleRateHz: 40e6,
      snrDb: 12,
      waveType: 'rf_am'
    }));
  });

  it('exports sum block signs for backend execution', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        {
          id: 'error-sum',
          type: 'sum_block',
          props: {
            inputCount: 2,
            signs: ['+', '-']
          }
        }
      ],
      modelEdges: []
    });

    expect(pkg.nodes[0].parameters).toEqual({
      inputCount: 2,
      signs: ['+', '-']
    });
  });

  it('drops edges and measurement points that reference unsupported nodes', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'source-1', type: 'signal_source', props: { value: 1 } },
        {
          id: 'sim-1',
          type: 'simulation_block',
          pythonBinding: { moduleId: 'passthrough' },
          props: {}
        },
        { id: 'logger-1', type: 'instrument_logger', props: {} },
        { id: 'scope-1', type: 'instrument_scope', props: {} }
      ],
      modelEdges: [
        { id: 'edge-kept', sourceNodeId: 'source-1', targetNodeId: 'sim-1' },
        { id: 'edge-dropped', sourceNodeId: 'sim-1', targetNodeId: 'logger-1' }
      ],
      measurementPoints: [
        { id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' },
        { id: 'logger-1.value', scopeNodeId: 'logger-1', channel: 'value' }
      ]
    });

    expect(pkg.nodes.map((node) => node.id)).toEqual(['source-1', 'sim-1', 'scope-1']);
    expect(pkg.edges.map((edge) => edge.id)).toEqual(['edge-kept']);
    expect(pkg.measurementPoints.map((point) => point.id)).toEqual(['scope-1.ch1']);
  });

  it('derives measurement points from connected scope inputs', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'source-1', type: 'signal_source', props: { value: 1 }, outputs: [{ name: 'signal' }] },
        {
          id: 'sim-1',
          type: 'simulation_block',
          props: {},
          pythonBinding: { moduleId: 'passthrough' },
          inputs: [{ name: 'input' }],
          outputs: [{ name: 'output' }]
        },
        {
          id: 'scope-1',
          type: 'instrument_scope',
          props: {},
          inputs: [{ name: 'CH1' }, { name: 'CH2' }]
        }
      ],
      modelEdges: [
        { id: 'edge-source-sim', sourceNodeId: 'source-1', sourcePortIndex: 0, targetNodeId: 'sim-1', targetPortIndex: 0 },
        { id: 'edge-sim-scope', sourceNodeId: 'sim-1', sourcePortIndex: 0, targetNodeId: 'scope-1', targetPortIndex: 1 }
      ],
      measurementPoints: []
    });

    expect(pkg.measurementPoints).toEqual([
      {
        id: 'scope-1.ch2',
        scopeNodeId: 'scope-1',
        channel: 'ch2'
      }
    ]);
  });

  it('normalizes explicit scope measurement channels from connected port indexes', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'source-1', type: 'signal_source', props: { value: 1 }, outputs: [{ name: 'signal' }] },
        {
          id: 'scope-1',
          type: 'instrument_scope',
          props: {},
          inputs: [{ name: 'CH1' }, { name: 'CH2' }]
        }
      ],
      modelEdges: [
        { id: 'edge-source-scope', sourceNodeId: 'source-1', sourcePortIndex: 0, targetNodeId: 'scope-1', targetPortIndex: 1 }
      ],
      measurementPoints: [
        { id: 'scope-1.ch2', scopeNodeId: 'scope-1', channel: 'ch1' }
      ]
    });

    expect(pkg.measurementPoints).toEqual([
      {
        id: 'scope-1.ch2',
        scopeNodeId: 'scope-1',
        channel: 'ch2',
        targetPortIndex: 1
      }
    ]);
  });

  it('exports frontend fault instances with backend runtime fields', () => {
    const pkg = buildBackendExecutablePackage({
      simulationConfig: { duration: 4, stepSize: 0.1 },
      modelNodes: [
        {
          id: 'node-imu',
          type: 'simulation_block',
          props: {},
          pythonBinding: { moduleId: 'imu_gyro', entryFunction: 'process' }
        }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'fault-inst-gyro-bias',
          faultTypeId: 'sensor_additive_bias',
          targetKind: 'node',
          targetId: 'node-imu',
          active: true,
          parameters: { offset: 0.25, start: 1.5, duration: 2 }
        }
      ]
    });

    expect(pkg.faultInstances).toEqual([
      expect.objectContaining({
        faultId: 'fault-inst-gyro-bias',
        faultType: 'sensor_bias',
        targetId: 'node-imu',
        enabled: true,
        startTime: 1.5,
        duration: 2,
        parameters: expect.objectContaining({ bias: 0.25 })
      })
    ]);
  });

  it('exports physical parameter step faults with executable parameter fields', () => {
    const pkg = buildBackendExecutablePackage({
      simulationConfig: { duration: 4, stepSize: 0.1 },
      modelNodes: [
        {
          id: 'node-controller',
          type: 'simulation_block',
          props: {},
          pythonBinding: { moduleId: 'attitude_controller', entryFunction: 'process' }
        }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'controller-gain-step',
          faultTypeId: 'physical_parameter_step',
          targetKind: 'node',
          targetId: 'node-controller',
          slotId: 'physical:controller_gain',
          active: true,
          parameters: { step_value: -0.35, start: 1 }
        }
      ]
    });

    expect(pkg.faultInstances).toEqual([
      expect.objectContaining({
        faultId: 'controller-gain-step',
        faultType: 'parameter_step',
        targetId: 'node-controller',
        startTime: 1,
        parameters: expect.objectContaining({ stepValue: -0.35 })
      })
    ]);
  });

  it('exports degradation, freeze, and random physical models as parameter faults', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'sensor-1', type: 'simulation_block', props: {}, pythonBinding: { moduleId: 'barometer_sensor' } }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'sensor-degradation',
          faultTypeId: 'degradation',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'params.scale',
          parameters: { scale: 0.8 }
        },
        {
          instanceId: 'sensor-freeze',
          faultTypeId: 'freeze',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'params.bias',
          parameters: {}
        },
        {
          instanceId: 'sensor-random',
          faultTypeId: 'random',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'params.bias',
          parameters: { seed: 7, std: 0.5 }
        },
        {
          instanceId: 'sensor-scale-alias',
          faultTypeId: 'custom-physical-fault',
          runtimeBehavior: 'scale',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'params.scale',
          parameters: { scale: 0.8 }
        },
        {
          instanceId: 'sensor-noise-alias',
          faultTypeId: 'custom-physical-fault',
          runtimeBehavior: 'noise',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'params.bias',
          parameters: { seed: 7, std: 0.5 }
        }
      ]
    });

    expect(pkg.faultInstances.map((fault) => fault.faultType)).toEqual([
      'parameter_degradation',
      'parameter_freeze',
      'parameter_random',
      'parameter_degradation',
      'parameter_random'
    ]);
  });

  it('keeps electrical input and output bindings as signal faults', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'sensor-1', type: 'simulation_block', props: {}, pythonBinding: { moduleId: 'barometer_sensor' } }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'input-bias',
          faultTypeId: 'bias',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'inputs.true_altitude',
          parameters: { bias: 0.5 }
        },
        {
          instanceId: 'output-noise',
          faultTypeId: 'noise',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'outputs.measured_altitude',
          parameters: { std: 0.2 }
        }
      ]
    });

    expect(pkg.faultInstances).toEqual([
      expect.objectContaining({
        faultType: 'sensor_bias',
        targetField: 'inputs.true_altitude',
        parameterKey: ''
      }),
      expect.objectContaining({
        faultType: 'noise_increase',
        targetField: 'outputs.measured_altitude',
        parameterKey: ''
      })
    ]);
  });

  it('normalizes legacy parameter targets and step values for physical fault models', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'sensor-1', type: 'simulation_block', props: {}, pythonBinding: { moduleId: 'barometer_sensor' } }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'bias-step',
          faultTypeId: 'step',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'parameter.bias',
          parameters: { step: 0.5 }
        },
        {
          instanceId: 'bias-random',
          faultTypeId: 'random',
          targetId: 'sensor-1',
          injectionForm: 'module-variable',
          targetField: 'parameters.bias',
          parameters: { seed: 1, std: 1 }
        }
      ]
    });

    expect(pkg.faultInstances).toEqual([
      expect.objectContaining({
        faultType: 'parameter_step',
        targetField: 'params.bias',
        parameterKey: 'bias',
        parameters: expect.objectContaining({ stepValue: 0.5 })
      }),
      expect.objectContaining({
        faultType: 'parameter_random',
        targetField: 'params.bias',
        parameterKey: 'bias',
        parameters: expect.objectContaining({ seed: 1, std: 1 })
      })
    ]);
  });

  it('exports layered module-variable bias faults as executable parameter faults', () => {
    const pkg = buildBackendExecutablePackage({
      simulationConfig: { duration: 4, stepSize: 0.1 },
      modelNodes: [
        {
          id: 'node-control-allocation',
          type: 'simulation_block',
          props: {},
          pythonBinding: { moduleId: 'control_allocation', entryFunction: 'process' }
        }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'layered-node-control-allocation-physical-allocation_gain',
          faultTypeId: 'layered-node-control-allocation-physical-allocation_gain',
          targetKind: 'node',
          targetId: 'node-control-allocation',
          injectionForm: 'module-variable',
          targetField: 'params.allocationGain',
          active: true,
          parameters: { bias: 0.1, start: 0 }
        }
      ]
    });

    expect(pkg.faultInstances).toEqual([
      expect.objectContaining({
        faultType: 'parameter_bias',
        parameterKey: 'allocationGain',
        targetId: 'node-control-allocation',
        parameters: expect.objectContaining({ bias: 0.1 })
      })
    ]);
  });

  it('omits inactive frontend fault instances from backend executable packages', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'node-imu', type: 'simulation_block', props: {}, pythonBinding: { moduleId: 'imu_gyro' } }
      ],
      modelEdges: [],
      faultInstances: [
        {
          instanceId: 'gyro_zero_bias_offset',
          faultTypeId: 'gyro_zero_bias_offset',
          targetKind: 'node',
          targetId: 'node-imu',
          active: false,
          enabled: false,
          parameters: { bias: 5, start: 1, duration: 2 }
        },
        {
          instanceId: 'motor_1_stuck_position',
          faultTypeId: 'motor_1_stuck_position',
          targetKind: 'node',
          targetId: 'node-imu',
          active: true,
          parameters: { value: 0.08, start: 1, duration: 2 }
        }
      ]
    });

    expect(pkg.faultInstances.map((fault) => fault.faultId)).toEqual(['motor_1_stuck_position']);
  });
});
