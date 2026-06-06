import { describe, expect, it } from 'vitest';
import faultCatalog from '../fault-types/fault-type-catalog.json';
import {
  applyScalarFault,
  applyScalarFaultBindings,
  appendFaultBinding,
  buildFaultPythonModuleSpec,
  createFaultBinding,
  createInjectedFaultPayload,
  findCompatibleFaultTarget,
  getFaultBindings,
  getFaultRuntimeBehavior,
  hasActiveFaultBinding,
  inferFaultPropagationMode,
  resolveFaultParameters
} from '../src/services/faultInjectionService.js';

describe('faultInjectionService', () => {
  it('maps every PDF-derived catalog entry to an executable runtime behavior and Python wrapper', () => {
    faultCatalog.faultTypes.forEach((faultModel) => {
      const behavior = getFaultRuntimeBehavior(faultModel);
      const moduleSpec = buildFaultPythonModuleSpec(faultModel);

      expect(behavior, faultModel.id).toBeTruthy();
      expect(moduleSpec).toMatchObject({
        entryFunction: 'process',
        parsedInterface: expect.objectContaining({
          entryFunction: 'process'
        })
      });
      expect(moduleSpec.source).toContain('def process');
    });
  });

  it('does not classify generic efficiency loss as protocol packet loss', () => {
    const legacyMotorFault = {
      id: 'motor_efficiency_loss',
      name: 'Motor Efficiency Loss',
      layer: 'electrical',
      parameter: 'efficiency'
    };
    expect(getFaultRuntimeBehavior(legacyMotorFault)).toBe('');
    expect(inferFaultPropagationMode(legacyMotorFault)).toBe('signalTransform');
  });

  it('merges injected parameter overrides ahead of catalog defaults', () => {
    const faultModel = faultCatalog.faultTypes.find((item) => item.id === 'sensor_additive_bias');
    const payload = createInjectedFaultPayload(faultModel, { offset: '0.42', start: '2' });
    const params = resolveFaultParameters(faultModel, payload);

    expect(payload).toMatchObject({
      modelId: 'sensor_additive_bias',
      layer: 'electrical',
      runtimeBehavior: 'additive_bias'
    });
    expect(params.offset).toBe('0.42');
    expect(params.start).toBe('2');
    expect(applyScalarFault(1, {
      faultModel,
      injectedFault: payload,
      time: 2,
      state: {}
    })).toBeCloseTo(1.42);
  });

  it('exposes explicit bias overlay and noise injection catalog entries for existing fault blocks', () => {
    const biasOverlay = faultCatalog.faultTypes.find((item) => item.id === 'fault_bias_overlay');
    const noiseInjection = faultCatalog.faultTypes.find((item) => item.id === 'fault_noise_injection');

    expect(biasOverlay).toMatchObject({
      name: '偏置叠加故障',
      layer: 'electrical',
      platformImplementation: expect.objectContaining({
        existingModule: 'fault_bias',
        recommendedModule: 'fault_bias'
      })
    });
    expect(noiseInjection).toMatchObject({
      name: '噪声注入故障',
      layer: 'electrical',
      platformImplementation: expect.objectContaining({
        existingModule: 'fault_noise',
        recommendedModule: 'fault_noise'
      })
    });
    expect(getFaultRuntimeBehavior(biasOverlay)).toBe('additive_bias');
    expect(getFaultRuntimeBehavior(noiseInjection)).toBe('noise');
    expect(applyScalarFault(1, {
      faultModel: biasOverlay,
      injectedFault: createInjectedFaultPayload(biasOverlay, { offset: '0.25' }),
      time: 0,
      state: {}
    })).toBeCloseTo(1.25);
  });

  it('applies representative physical, electrical, and protocol faults with state', () => {
    expect(applyScalarFault(1, {
      faultModel: { id: 'physical_parameter_drift', defaultParameters: { rate: 0.5, start: 2 } },
      time: 5,
      state: {}
    })).toBeCloseTo(2.5);

    const freezeState = {};
    const freezeModel = { id: 'signal_freeze', defaultParameters: { start: 0 } };
    expect(applyScalarFault(3, { faultModel: freezeModel, time: 0, state: freezeState })).toBe(3);
    expect(applyScalarFault(9, { faultModel: freezeModel, time: 1, state: freezeState })).toBe(3);

    const delayState = {};
    const delayModel = { id: 'fixed_delay', defaultParameters: { delay_steps: 2, start: 0 } };
    expect(applyScalarFault(10, { faultModel: delayModel, time: 0, state: delayState })).toBe(0);
    expect(applyScalarFault(20, { faultModel: delayModel, time: 0.1, state: delayState })).toBe(0);
    expect(applyScalarFault(30, { faultModel: delayModel, time: 0.2, state: delayState })).toBe(10);
  });

  it('executes layered injector math-model aliases with task parameters', () => {
    expect(getFaultRuntimeBehavior({ runtimeBehavior: 'bias' })).toBe('additive_bias');
    expect(getFaultRuntimeBehavior({ runtimeBehavior: 'dropout' })).toBe('packet_loss');
    expect(getFaultRuntimeBehavior({ runtimeBehavior: 'delay' })).toBe('fixed_delay');

    expect(applyScalarFault(1, {
      faultModel: { runtimeBehavior: 'bias' },
      params: { bias: 5, start: 1, duration: 2 },
      time: 1.5,
      state: {}
    })).toBeCloseTo(6);

    const holdState = {};
    expect(applyScalarFault(4, {
      faultModel: { runtimeBehavior: 'freeze' },
      params: { mode: 'hold', start: 1, duration: 2 },
      time: 0.9,
      state: holdState
    })).toBe(4);
    expect(applyScalarFault(9, {
      faultModel: { runtimeBehavior: 'freeze' },
      params: { mode: 'hold', start: 1, duration: 2 },
      time: 1.1,
      state: holdState
    })).toBe(4);

    expect(applyScalarFault(9, {
      faultModel: { runtimeBehavior: 'freeze' },
      params: { mode: 'zero', value: 0, start: 1, duration: 2 },
      time: 1.5,
      state: {}
    })).toBe(0);

    expect(applyScalarFault(2, {
      faultModel: { runtimeBehavior: 'tamper' },
      params: { scale: 1.5, bias: 0, start: 1, duration: 2 },
      time: 2,
      state: {}
    })).toBeCloseTo(3);
  });

  it('finds injection targets from selected items or module bindings', () => {
    const gpsFault = faultCatalog.faultTypes.find((item) => item.id === 'signal_freeze');
    const protocolFault = faultCatalog.faultTypes.find((item) => item.id === 'random_packet_loss');
    const nodes = [
      { id: 'node-controller', type: 'simulation_block', pythonBinding: { moduleId: 'attitude_pid' }, props: { name: 'Controller' } },
      { id: 'node-gps', type: 'simulation_block', pythonBinding: { moduleId: 'gps_velocity' }, props: { name: 'GPS Velocity' } }
    ];
    const edges = [
      { id: 'edge-normal', lineType: 'normal' },
      { id: 'edge-can', lineType: 'can' }
    ];

    expect(findCompatibleFaultTarget(gpsFault, { nodes, edges })).toEqual({
      kind: 'node',
      id: 'node-gps',
      reason: 'module-target'
    });
    expect(findCompatibleFaultTarget(protocolFault, { nodes, edges, selectedEdgeId: 'edge-can' })).toEqual({
      kind: 'edge',
      id: 'edge-can',
      reason: 'selected-can-edge'
    });
  });

  it('prefers explicit component fault slots over a selected but incompatible module', () => {
    const faultModel = {
      id: 'gyro_zero_bias_offset',
      layer: 'electrical',
      name: 'Gyro bias'
    };
    const nodes = [
      {
        id: 'node-motor',
        type: 'simulation_block',
        props: { name: 'Motor Mixer' },
        faultSlots: [
          {
            slotId: 'electrical:motor_command',
            layer: 'electrical',
            allowedFaultIds: ['motor_efficiency_loss'],
            bindingObject: 'M1_指令'
          }
        ]
      },
      {
        id: 'node-imu',
        type: 'simulation_block',
        props: { name: 'IMU Gyro' },
        faultSlots: [
          {
            slotId: 'electrical:imu_rate',
            layer: 'electrical',
            allowedFaultIds: ['gyro_zero_bias_offset'],
            bindingObject: 'IMU_角速度'
          }
        ]
      }
    ];

    expect(findCompatibleFaultTarget(faultModel, {
      nodes,
      edges: [],
      selectedNodeId: 'node-motor'
    })).toMatchObject({
      kind: 'node',
      id: 'node-imu',
      reason: 'fault-slot'
    });
  });

  it('routes communication-layer CAN faults to compatible protocol edges', () => {
    const communicationFault = {
      id: 'can_bus_delay',
      name: 'CAN Feedback Delay',
      layer: 'communication',
      moduleTargets: ['edge-imu-error']
    };
    const nodes = [
      { id: 'node-imu', type: 'simulation_block', props: { name: 'IMU Gyro', moduleType: 'sensors' } }
    ];
    const edges = [
      { id: 'edge-normal', lineType: 'normal' },
      {
        id: 'edge-imu-error',
        lineType: 'can',
        signalId: 'imu.pitch_rate',
        channelId: 'CAN-FC-IMU',
        messageId: '0x184'
      }
    ];

    expect(findCompatibleFaultTarget(communicationFault, { nodes, edges })).toEqual({
      kind: 'edge',
      id: 'edge-imu-error',
      reason: 'module-target-can-edge'
    });
  });

  it('creates multi-fault bindings with propagation semantics for signal-flow graph rendering', () => {
    const sensorBias = faultCatalog.faultTypes.find((item) => item.id === 'sensor_additive_bias');
    const physicalBias = faultCatalog.faultTypes.find((item) => item.id === 'physical_parameter_bias');
    const packetLoss = faultCatalog.faultTypes.find((item) => item.id === 'random_packet_loss');

    expect(inferFaultPropagationMode(sensorBias)).toBe('signalTransform');
    expect(inferFaultPropagationMode(physicalBias)).toBe('parameterInfluence');
    expect(inferFaultPropagationMode(packetLoss)).toBe('protocolEdge');
    expect(inferFaultPropagationMode({ id: 'local_probe', propagationMode: 'localOnly' })).toBe('localOnly');

    const target = { id: 'node-gps', type: 'simulation_block' };
    const first = createFaultBinding(sensorBias, { offset: '0.2' }, { targetId: target.id, targetKind: 'node' });
    const second = createFaultBinding(physicalBias, { delta_p: '0.1' }, { targetId: target.id, targetKind: 'node' });

    appendFaultBinding(target, first);
    appendFaultBinding(target, second);

    expect(target.injectedFault).toMatchObject({ modelId: 'physical_parameter_bias' });
    expect(getFaultBindings(target)).toHaveLength(2);
    expect(hasActiveFaultBinding(target)).toBe(true);
    expect(getFaultBindings(target)[0]).toMatchObject({
      faultModelId: 'sensor_additive_bias',
      propagationMode: 'signalTransform',
      visualRole: 'fault-source',
      active: true
    });
    expect(getFaultBindings(target)[1]).toMatchObject({
      faultModelId: 'physical_parameter_bias',
      propagationMode: 'parameterInfluence'
    });
  });

  it('keeps a stable binding slot when the same fault is reconfigured', () => {
    const faultModel = faultCatalog.faultTypes.find((item) => item.id === 'sensor_additive_bias');
    const target = { id: 'node-imu', type: 'simulation_block' };

    appendFaultBinding(target, createFaultBinding(faultModel, { offset: '0.1' }, { targetId: target.id }));
    appendFaultBinding(target, createFaultBinding(faultModel, { offset: '0.3' }, { targetId: target.id }));

    expect(getFaultBindings(target)).toHaveLength(1);
    expect(getFaultBindings(target)[0].parameters.offset).toBe('0.3');
    expect(target.injectedFault.parameters.offset).toBe('0.3');
  });

  it('keeps the same fault type on different module variables as separate bindings', () => {
    const faultModel = faultCatalog.faultTypes.find((item) => item.id === 'sensor_additive_bias');
    const target = { id: 'node-controller', type: 'simulation_block' };

    appendFaultBinding(target, createFaultBinding(faultModel, {
      slotId: 'electrical:attitude_error',
      bindingObject: 'attitude_error',
      targetVariable: 'attitude_error',
      parameters: { offset: '0.1' }
    }, { targetId: target.id, targetKind: 'node' }));
    appendFaultBinding(target, createFaultBinding(faultModel, {
      slotId: 'electrical:torque_request',
      bindingObject: 'torque_request',
      targetVariable: 'torque_request',
      parameters: { offset: '0.2' }
    }, { targetId: target.id, targetKind: 'node' }));

    expect(target.faultBindings).toHaveLength(2);
    expect(target.faultBindings.map((binding) => binding.slotId)).toEqual([
      'electrical:attitude_error',
      'electrical:torque_request'
    ]);
    expect(target.faultBindings.map((binding) => binding.bindingObject)).toEqual([
      'attitude_error',
      'torque_request'
    ]);
  });

  it('composes active scalar fault bindings in a deterministic order', () => {
    const target = { id: 'node-sensor', type: 'simulation_block' };
    appendFaultBinding(target, createFaultBinding({
      id: 'bias_fault',
      layer: 'electrical',
      runtimeBehavior: 'additive_bias'
    }, { offset: 0.5 }, { targetId: target.id }));
    appendFaultBinding(target, createFaultBinding({
      id: 'scale_fault',
      layer: 'electrical',
      runtimeBehavior: 'scale'
    }, { scale: 2 }, { targetId: target.id }));

    expect(applyScalarFaultBindings(1, {
      target,
      stateBucket: {},
      time: 0,
      dt: 0.1
    })).toBeCloseTo(3);

    target.faultBindings[1].active = false;
    expect(applyScalarFaultBindings(1, {
      target,
      stateBucket: {},
      time: 0,
      dt: 0.1
    })).toBeCloseTo(1.5);
  });
});
