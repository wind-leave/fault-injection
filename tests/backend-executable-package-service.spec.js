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
