import { describe, expect, it } from 'vitest';
import {
  applyFaultBindingToState,
  createFaultInstancePlan,
  createFaultRemovalRef,
  createFaultInstanceRecord,
  createFaultTagLinkRecord,
  createFaultTagRecord,
  createRuntimeFaultBindingWithAdapter,
  createRuntimePayloadFromInstance,
  createRuntimePayloadWithAdapter,
  faultRecordMatchesRemovalRef,
  getFaultSlotVectorLength,
  getCompatibleFaultModelsForTarget,
  getCompatibleFaultOptionsForTarget,
  getCompatibleSlotForFault,
  refreshFaultCancellationState,
  removeFaultRuntimeArtifactsFromState,
  syncFaultPayloadFromBindings,
  upsertFaultInstanceRecord,
  upsertFaultRuntimeRecord,
  upsertFaultTagLinkRecord,
  upsertFaultTagRecord,
  upsertInjectedFaultMap
} from '../src/services/faultBindingRuntimeService.js';

describe('fault binding runtime service', () => {
  const model = {
    id: 'gyro_zero_bias',
    name: 'Gyro zero bias',
    displayName: 'Gyro zero bias fault',
    layer: 'electrical',
    runtimeBehavior: 'additive_bias',
    faultClass: 'sensor',
    modelClass: 'sensor_fault',
    defaultParameters: {
      bias: 0.1,
      start: 0
    }
  };

  const target = {
    id: 'node-imu',
    props: { name: 'IMU' }
  };

  const slot = {
    slotId: 'electrical:gyro_rate',
    slotName: 'Gyro rate',
    layer: 'electrical',
    bindingObject: 'gyro_rate',
    targetField: 'outputs.gyro_rate'
  };

  it('creates a normalized fault instance record for a target slot', () => {
    const instance = createFaultInstanceRecord({
      target,
      model,
      slot,
      targetKind: 'node',
      parameters: { bias: '0.2', start: 0 },
      bindingObject: 'gyro_rate',
      injectionForm: 'signal-transform',
      instanceId: 'fault-inst-fixed'
    });

    expect(instance).toEqual({
      instanceId: 'fault-inst-fixed',
      faultTypeId: 'gyro_zero_bias',
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'electrical:gyro_rate',
      slotName: 'Gyro rate',
      layer: 'electrical',
      injectionForm: 'signal-transform',
      bindingObject: 'gyro_rate',
      targetVariable: 'gyro_rate',
      targetField: 'outputs.gyro_rate',
      displayName: 'Gyro zero bias fault',
      parameters: { bias: '0.2', start: 0 },
      active: true,
      visual: { expanded: false }
    });
  });

  it('creates a fault instance plan and rejects duplicate active instances', () => {
    const plan = createFaultInstancePlan({
      target,
      model,
      slot,
      existingInstances: [],
      parameterOverrides: { bias: '0.2' },
      instanceId: 'fault-inst-planned'
    });

    expect(plan).toEqual({
      ok: true,
      instance: {
        instanceId: 'fault-inst-planned',
        faultTypeId: 'gyro_zero_bias',
        targetKind: 'node',
        targetId: 'node-imu',
        slotId: 'electrical:gyro_rate',
        slotName: 'Gyro rate',
        layer: 'electrical',
        injectionForm: 'module-variable',
        bindingObject: 'gyro_rate',
        targetVariable: 'gyro_rate',
        targetField: 'outputs.gyro_rate',
        displayName: 'Gyro zero bias fault',
        parameters: { bias: '0.2', start: 0 },
        active: true,
        visual: { expanded: false }
      },
      model,
      slot,
      targetKind: 'node',
      slotId: 'electrical:gyro_rate',
      parameters: { bias: '0.2', start: 0 },
      bindingObject: 'gyro_rate',
      injectionForm: 'module-variable'
    });

    const duplicate = createFaultInstancePlan({
      target,
      model,
      slot,
      existingInstances: [plan.instance],
      parameterOverrides: { bias: '0.3' }
    });

    expect(duplicate).toEqual({
      ok: false,
      error: 'duplicate-fault-instance',
      instance: plan.instance,
      model,
      slot
    });
  });

  it('persists a selected vector item from the fault slot through the runtime payload', () => {
    const vectorSlot = {
      ...slot,
      dataType: 'vector',
      vectorLength: 3
    };
    const plan = createFaultInstancePlan({
      target,
      model,
      slot: vectorSlot,
      existingInstances: [],
      vectorInjectionScope: 'item',
      vectorIndex: 2,
      instanceId: 'fault-inst-vector-item'
    });

    expect(getFaultSlotVectorLength(vectorSlot)).toBe(3);
    expect(plan.instance).toMatchObject({
      vectorInjectionScope: 'item',
      vectorIndex: 2
    });
    expect(createRuntimePayloadFromInstance({ model, instance: plan.instance })).toMatchObject({
      vectorInjectionScope: 'item',
      vectorIndex: 2
    });
  });

  it('persists selected vector channels and infers a vector parameter from its default value', () => {
    const vectorSlot = {
      ...slot,
      dataType: 'vector',
      default: '[1.0, 2.0, 3.0, 4.0]'
    };
    const plan = createFaultInstancePlan({
      target,
      model,
      slot: vectorSlot,
      existingInstances: [],
      vectorInjectionScope: 'items',
      vectorIndices: [0, 2, 2, 9],
      instanceId: 'fault-inst-vector-items'
    });

    expect(getFaultSlotVectorLength(vectorSlot)).toBe(4);
    expect(plan.instance).toMatchObject({
      vectorInjectionScope: 'items',
      vectorIndices: [0, 2, 3]
    });
    expect(createRuntimePayloadFromInstance({ model, instance: plan.instance })).toMatchObject({
      vectorInjectionScope: 'items',
      vectorIndices: [0, 2, 3]
    });
  });

  it('does not treat scalar slots with stale length metadata as vectors', () => {
    const scalarSlot = {
      ...slot,
      dataType: 'scalar',
      vectorLength: 4
    };
    const plan = createFaultInstancePlan({
      target,
      model,
      slot: scalarSlot,
      existingInstances: [],
      vectorInjectionScope: 'items',
      vectorIndices: [0, 2],
      instanceId: 'fault-inst-scalar-stale-length'
    });

    expect(getFaultSlotVectorLength(scalarSlot)).toBe(0);
    expect(plan.instance).not.toHaveProperty('vectorInjectionScope');
  });

  it('selects compatible fault options from target capability slots', () => {
    const capabilityMap = [{
      targetId: 'node-imu',
      targetKind: 'node',
      faultSlots: [
        {
          slotId: 'electrical:gyro_rate',
          slotName: 'Gyro rate',
          layer: 'electrical',
          allowedFaultIds: ['gyro_zero_bias']
        },
        {
          slotId: 'electrical:accel',
          slotName: 'Acceleration',
          layer: 'electrical',
          runtimeBehaviors: ['additive_noise']
        },
        {
          slotId: 'protocol:can_frame',
          slotName: 'CAN frame',
          layer: 'protocol',
          allowedFaultIds: ['can_delay']
        }
      ]
    }];
    const faultModels = [
      model,
      {
        id: 'sensor_noise',
        name: 'Sensor noise',
        layer: 'electrical',
        runtimeBehavior: 'additive_noise',
        parameters: { sigma: { default: 0.05 } }
      },
      {
        id: 'can_delay',
        name: 'CAN delay',
        layer: 'protocol',
        runtimeBehavior: 'fixed_delay'
      }
    ];

    const options = getCompatibleFaultOptionsForTarget(target, {
      capabilityMap,
      faultModels,
      filters: { layer: 'electrical', targetKind: 'node' }
    });

    expect(options).toEqual([
      {
        model: expect.objectContaining({
          id: 'gyro_zero_bias',
          defaultParameters: { bias: 0.1, start: 0 }
        }),
        slot: capabilityMap[0].faultSlots[0],
        slotId: 'electrical:gyro_rate'
      },
      {
        model: expect.objectContaining({
          id: 'sensor_noise',
          defaultParameters: { sigma: 0.05 }
        }),
        slot: capabilityMap[0].faultSlots[1],
        slotId: 'electrical:accel'
      }
    ]);

    expect(getCompatibleFaultModelsForTarget(target, {
      capabilityMap,
      faultModels,
      filters: { layer: 'electrical' }
    }).map((item) => item.id)).toEqual(['gyro_zero_bias', 'sensor_noise']);

    expect(getCompatibleSlotForFault(target, 'sensor_noise', '', {
      capabilityMap,
      faultModels
    })).toBe(capabilityMap[0].faultSlots[1]);

    expect(getCompatibleSlotForFault(target, 'can_delay', 'protocol:can_frame', {
      capabilityMap,
      faultModels,
      filters: { layer: 'protocol' }
    })).toBe(capabilityMap[0].faultSlots[2]);
  });

  it('creates runtime payload and visual tag records from an instance', () => {
    const instance = createFaultInstanceRecord({
      target,
      model,
      slot,
      targetKind: 'node',
      parameters: { bias: '0.2', start: 0 },
      bindingObject: 'gyro_rate',
      injectionForm: 'signal-transform',
      instanceId: 'fault-inst-fixed'
    });

    const payload = createRuntimePayloadFromInstance({
      model,
      instance,
      basePayload: {
        modelId: 'gyro_zero_bias',
        name: 'Gyro zero bias',
        layer: 'electrical',
        runtimeBehavior: 'additive_bias',
        parameters: { bias: '0.2', start: 0 }
      }
    });

    expect(payload).toMatchObject({
      modelId: 'gyro_zero_bias',
      faultTypeId: 'gyro_zero_bias',
      instanceId: 'fault-inst-fixed',
      name: 'Gyro zero bias fault',
      slotId: 'electrical:gyro_rate',
      bindingObject: 'gyro_rate',
      targetField: 'outputs.gyro_rate',
      injectionForm: 'signal-transform',
      parameters: { bias: '0.2', start: 0 }
    });

    const tag = createFaultTagRecord({
      instance,
      model,
      target,
      payload,
      box: { x: 10, y: 20, w: 204, h: 76 },
      hostNodeId: 'node-imu',
      targetName: 'IMU',
      layerLabel: 'Electrical'
    });

    expect(tag).toMatchObject({
      id: 'fault-tag-gyro_zero_bias',
      type: 'fault_tag',
      faultModelId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault',
      layer: 'Electrical',
      targetKind: 'node',
      targetId: 'node-imu',
      hostNodeId: 'node-imu',
      targetName: 'IMU',
      slotId: 'electrical:gyro_rate',
      bindingObject: 'gyro_rate',
      parameters: { bias: '0.2', start: 0 },
      injectedFault: payload,
      x: 10,
      y: 20,
      w: 204,
      h: 76
    });

    expect(createFaultTagLinkRecord({ instance, tag })).toEqual({
      id: 'fault-link-gyro_zero_bias-target',
      faultModelId: 'gyro_zero_bias',
      sourceTagId: 'fault-tag-gyro_zero_bias',
      targetNodeId: 'node-imu',
      targetEdgeId: null,
      role: 'fault-tag-attachment',
      label: '故障注入'
    });
  });

  it('creates runtime payloads through an optional fault runtime adapter', () => {
    const adapter = {
      createInjectedFaultPayload: (faultModel, parameters) => ({
        modelId: faultModel.id,
        name: `${faultModel.name} adapter`,
        layer: faultModel.layer,
        runtimeBehavior: faultModel.runtimeBehavior,
        parameters,
        adapterOnly: true
      })
    };

    expect(createRuntimePayloadWithAdapter({
      adapter,
      model,
      parameters: { bias: '0.3' },
      instance: {
        faultTypeId: model.id,
        displayName: model.displayName,
        slotId: slot.slotId,
        slotName: slot.slotName,
        bindingObject: slot.bindingObject,
        targetField: slot.targetField,
        injectionForm: 'module-variable'
      }
    })).toMatchObject({
      modelId: 'gyro_zero_bias',
      faultTypeId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault',
      adapterOnly: true,
      parameters: { bias: '0.3' },
      slotId: 'electrical:gyro_rate',
      bindingObject: 'gyro_rate',
      targetField: 'outputs.gyro_rate',
      injectionForm: 'module-variable'
    });

    expect(createRuntimePayloadWithAdapter({
      model,
      parameters: { bias: '0.4' },
      instance: { faultTypeId: model.id, displayName: model.displayName }
    })).toMatchObject({
      modelId: 'gyro_zero_bias',
      faultTypeId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault',
      parameters: { bias: '0.4' }
    });
  });

  it('creates and appends runtime fault bindings through an optional adapter', () => {
    const targetWithAdapter = { id: 'node-imu', faultBindings: [] };
    const payload = {
      modelId: model.id,
      faultTypeId: model.id,
      instanceId: 'fault-inst-fixed',
      name: model.displayName,
      layer: model.layer,
      runtimeBehavior: model.runtimeBehavior,
      parameters: { bias: '0.2' },
      slotId: slot.slotId,
      slotName: slot.slotName,
      bindingObject: slot.bindingObject,
      targetField: slot.targetField,
      injectionForm: 'module-variable'
    };
    const adapter = {
      createFaultBinding: (faultModel, injectedFault, context) => ({
        bindingId: `adapter-${injectedFault.modelId}`,
        faultModelId: faultModel.id,
        targetId: context.targetId,
        targetKind: context.targetKind,
        injectedFault
      }),
      appendFaultBinding: (target, binding) => {
        target.faultBindings.push(binding);
      }
    };

    const adapterBinding = createRuntimeFaultBindingWithAdapter({
      adapter,
      target: targetWithAdapter,
      model,
      payload,
      targetKind: 'node'
    });

    expect(adapterBinding).toMatchObject({
      bindingId: 'adapter-gyro_zero_bias',
      faultModelId: 'gyro_zero_bias',
      targetId: 'node-imu',
      slotId: 'electrical:gyro_rate',
      bindingObject: 'gyro_rate',
      targetVariable: 'gyro_rate',
      targetField: 'outputs.gyro_rate',
      injectionForm: 'module-variable'
    });
    expect(targetWithAdapter.faultBindings).toEqual([adapterBinding]);

    const targetWithoutAdapter = { id: 'node-imu', faultBindings: [] };
    const fallbackBinding = createRuntimeFaultBindingWithAdapter({
      target: targetWithoutAdapter,
      model,
      payload,
      targetKind: 'node'
    });

    expect(fallbackBinding).toMatchObject({
      bindingId: 'fault-inst-fixed::node-imu',
      faultModelId: 'gyro_zero_bias',
      propagationMode: 'signalTransform',
      active: true
    });
    expect(targetWithoutAdapter.faultBindings).toEqual([fallbackBinding]);
  });

  it('upserts runtime state records by their fault identity', () => {
    const previousInstance = {
      instanceId: 'old-instance',
      faultTypeId: 'gyro_zero_bias',
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'electrical:gyro_rate',
      parameters: { bias: '0.1' }
    };
    const nextInstance = {
      ...previousInstance,
      instanceId: 'new-instance',
      parameters: { bias: '0.2' }
    };

    expect(upsertFaultInstanceRecord([previousInstance], nextInstance)).toEqual([nextInstance]);

    const payload = {
      instanceId: 'new-instance',
      modelId: 'gyro_zero_bias',
      faultTypeId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault',
      parameters: { bias: '0.2' }
    };

    expect(upsertFaultRuntimeRecord([
      { instanceId: 'new-instance', modelId: 'old', status: 'active' },
      { instanceId: 'other', modelId: 'other', status: 'active' }
    ], payload)).toEqual([
      { instanceId: 'other', modelId: 'other', status: 'active' },
      {
        ...payload,
        faultId: 'gyro_zero_bias',
        status: 'active'
      }
    ]);

    expect(upsertInjectedFaultMap({ old: { status: 'active' } }, payload)).toEqual({
      old: { status: 'active' },
      gyro_zero_bias: {
        ...payload,
        status: 'active'
      }
    });
  });

  it('upserts visual fault tag and link records by fault model id', () => {
    const tag = {
      id: 'fault-tag-gyro_zero_bias',
      faultModelId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault'
    };
    const link = {
      id: 'fault-link-gyro_zero_bias-target',
      faultModelId: 'gyro_zero_bias',
      sourceTagId: tag.id,
      targetNodeId: 'node-imu',
      targetEdgeId: null,
      role: 'fault-tag-attachment',
      label: 'Fault link'
    };

    expect(upsertFaultTagRecord([
      { id: 'stale-tag', faultModelId: 'gyro_zero_bias' },
      { id: 'other-tag', faultModelId: 'other' }
    ], tag)).toEqual([
      { id: 'other-tag', faultModelId: 'other' },
      tag
    ]);

    expect(upsertFaultTagLinkRecord([
      { id: 'stale-link', faultModelId: 'gyro_zero_bias' },
      { id: 'other-link', faultModelId: 'other' }
    ], link)).toEqual([
      { id: 'other-link', faultModelId: 'other' },
      link
    ]);
  });

  it('applies a fault binding to target and runtime state', () => {
    const instance = createFaultInstanceRecord({
      target,
      model,
      slot,
      targetKind: 'node',
      parameters: { bias: '0.2', start: 0 },
      bindingObject: 'gyro_rate',
      injectionForm: 'signal-transform',
      instanceId: 'fault-inst-fixed'
    });
    const payload = createRuntimePayloadFromInstance({
      model,
      instance,
      parameters: instance.parameters,
      basePayload: {
        modelId: model.id,
        name: model.name,
        runtimeBehavior: model.runtimeBehavior
      }
    });
    const state = {
      faultedBlks: ['node-controller'],
      faultInstances: [{ instanceId: 'old', faultTypeId: 'other_fault' }],
      injectedFaults: [],
      activeFaults: [],
      appliedFaults: [],
      injectedFaultMap: {},
      faultTags: [],
      faultInjectionLinks: []
    };

    const result = applyFaultBindingToState(state, { ...target, faultBindings: [] }, {
      model,
      instance,
      payload,
      tag: {
        box: { x: 10, y: 20, w: 204, h: 76 },
        hostNodeId: 'node-imu',
        targetName: 'IMU',
        layerLabel: 'Electrical'
      },
      link: { label: 'Fault link' }
    });

    expect(result.target.injectedFault).toEqual(payload);
    expect(result.target.faultBindings).toEqual([{
      bindingId: 'fault-inst-fixed::node-imu',
      faultModelId: 'gyro_zero_bias',
      faultTypeId: 'gyro_zero_bias',
      name: 'Gyro zero bias fault',
      layer: 'electrical',
      runtimeBehavior: 'additive_bias',
      parameters: { bias: '0.2', start: 0 },
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'electrical:gyro_rate',
      slotName: 'Gyro rate',
      bindingObject: 'gyro_rate',
      targetVariable: 'gyro_rate',
      targetField: 'outputs.gyro_rate',
      injectionForm: 'signal-transform',
      visualRole: 'fault-source',
      propagationMode: 'signalTransform',
      canPropagate: true,
      active: true,
      injectedFault: payload
    }]);
    expect(result.state.faultInstances).toEqual([
      { instanceId: 'old', faultTypeId: 'other_fault' },
      instance
    ]);
    expect(result.state.injectedFaults).toEqual([{ ...payload, faultId: 'gyro_zero_bias', status: 'active' }]);
    expect(result.state.activeFaults).toEqual([{ ...payload, faultId: 'gyro_zero_bias', status: 'active' }]);
    expect(result.state.appliedFaults).toEqual([{ ...payload, faultId: 'gyro_zero_bias', status: 'active' }]);
    expect(result.state.injectedFaultMap).toEqual({
      gyro_zero_bias: { ...payload, status: 'active' }
    });
    expect(result.state.faultTags).toEqual([
      expect.objectContaining({
        id: 'fault-tag-gyro_zero_bias',
        faultModelId: 'gyro_zero_bias',
        targetId: 'node-imu',
        hostNodeId: 'node-imu',
        x: 10,
        y: 20
      })
    ]);
    expect(result.state.faultInjectionLinks).toEqual([{
      id: 'fault-link-gyro_zero_bias-target',
      faultModelId: 'gyro_zero_bias',
      sourceTagId: 'fault-tag-gyro_zero_bias',
      targetNodeId: 'node-imu',
      targetEdgeId: null,
      role: 'fault-tag-attachment',
      label: 'Fault link'
    }]);
    expect(result.state.faultedBlks).toEqual(['node-controller', 'node-imu']);
  });

  it('creates and matches normalized removal references for fault bindings', () => {
    const binding = {
      bindingId: 'binding-gyro-zero',
      faultModelId: 'gyro_zero_bias',
      instanceId: 'fault-inst-1',
      slotId: 'electrical:gyro_rate',
      targetKind: 'node',
      targetId: 'node-imu'
    };

    const ref = createFaultRemovalRef('node', target, binding, 0);

    expect(ref).toEqual({
      targetKind: 'node',
      targetId: 'node-imu',
      bindingId: 'binding-gyro-zero',
      instanceId: 'fault-inst-1',
      faultId: 'gyro_zero_bias',
      slotId: 'electrical:gyro_rate'
    });

    expect(faultRecordMatchesRemovalRef({
      instanceId: 'fault-inst-1',
      modelId: 'gyro_zero_bias',
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'electrical:gyro_rate'
    }, ref)).toBe(true);

    expect(faultRecordMatchesRemovalRef({
      modelId: 'gyro_zero_bias',
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'electrical:accel'
    }, ref)).toBe(false);

    expect(faultRecordMatchesRemovalRef({
      modelId: 'gyro_zero_bias',
      targetKind: 'node',
      targetId: 'node-controller',
      slotId: 'electrical:gyro_rate'
    }, ref)).toBe(false);
  });

  it('syncs target injected fault from remaining active bindings', () => {
    const targetWithRemainingBinding = {
      id: 'node-imu',
      injectedFault: { modelId: 'old_fault', name: 'Old fault' },
      faultBindings: [
        {
          faultModelId: 'gyro_zero_bias',
          name: 'Gyro zero bias',
          layer: 'electrical',
          runtimeBehavior: 'additive_bias',
          parameters: { bias: '0.2' },
          active: false
        },
        {
          faultModelId: 'sensor_noise',
          name: 'Sensor noise',
          layer: 'electrical',
          runtimeBehavior: 'additive_noise',
          parameters: { sigma: '0.05' },
          active: true,
          injectedFault: {
            modelId: 'sensor_noise',
            name: 'Sensor noise payload',
            parameters: { sigma: '0.05' }
          }
        }
      ]
    };

    expect(syncFaultPayloadFromBindings(targetWithRemainingBinding)).toEqual({
      target: {
        ...targetWithRemainingBinding,
        injectedFault: {
          modelId: 'sensor_noise',
          name: 'Sensor noise payload',
          parameters: { sigma: '0.05' }
        }
      },
      changed: true
    });

    const targetWithoutRemainingBinding = {
      id: 'node-imu',
      injectedFault: { modelId: 'gyro_zero_bias', name: 'Gyro zero bias' },
      faultBindings: [
        {
          faultModelId: 'gyro_zero_bias',
          name: 'Gyro zero bias',
          layer: 'electrical',
          runtimeBehavior: 'additive_bias',
          parameters: { bias: '0.2' },
          active: false
        }
      ]
    };

    expect(syncFaultPayloadFromBindings(targetWithoutRemainingBinding)).toEqual({
      target: {
        id: 'node-imu',
        faultBindings: targetWithoutRemainingBinding.faultBindings
      },
      changed: true
    });
  });

  it('refreshes fault cancellation state for nodes and edges', () => {
    const nodeTarget = {
      id: 'node-imu',
      injectedFault: { modelId: 'gyro_zero_bias', name: 'Gyro zero bias' },
      faultBindings: [
        { faultModelId: 'gyro_zero_bias', active: false }
      ]
    };
    const state = {
      faultedBlks: ['node-imu', 'node-controller']
    };
    const simulation = {
      actual: {
        nodeStates: {
          'node-imu': {
            bindingStates: { gyro_rate: 1 },
            output: 2
          },
          'node-controller': {
            bindingStates: { command: 1 }
          }
        },
        edgeStates: {
          'edge-can': { frame: 'stale' }
        }
      }
    };

    const nodeResult = refreshFaultCancellationState(state, simulation, {
      targetKind: 'node',
      target: nodeTarget,
      hasActiveFault: false
    });

    expect(nodeResult.target).toEqual({
      id: 'node-imu',
      faultBindings: nodeTarget.faultBindings
    });
    expect(nodeResult.state.faultedBlks).toEqual(['node-controller']);
    expect(nodeResult.simulation.actual.nodeStates['node-imu']).toEqual({ output: 2 });
    expect(nodeResult.simulation.actual.nodeStates['node-controller']).toEqual({
      bindingStates: { command: 1 }
    });
    expect(nodeResult.simulation.actual.edgeStates['edge-can']).toEqual({ frame: 'stale' });
    expect(nodeResult.changed).toBe(true);

    const activeNodeResult = refreshFaultCancellationState(state, simulation, {
      targetKind: 'node',
      target: {
        id: 'node-imu',
        faultBindings: [
          {
            faultModelId: 'sensor_noise',
            active: true,
            injectedFault: { modelId: 'sensor_noise', name: 'Sensor noise' }
          }
        ]
      }
    });

    expect(activeNodeResult.state.faultedBlks).toEqual(['node-imu', 'node-controller']);
    expect(activeNodeResult.target.injectedFault).toEqual({ modelId: 'sensor_noise', name: 'Sensor noise' });
    expect(activeNodeResult.simulation.actual.nodeStates['node-imu']).toEqual({
      bindingStates: { gyro_rate: 1 },
      output: 2
    });

    const edgeResult = refreshFaultCancellationState(nodeResult.state, nodeResult.simulation, {
      targetKind: 'edge',
      target: { id: 'edge-can' },
      hasActiveFault: false
    });

    expect(edgeResult.simulation.actual.edgeStates).toEqual({});
    expect(edgeResult.state.faultedBlks).toEqual(['node-controller']);
    expect(edgeResult.changed).toBe(true);
  });

  it('removes runtime artifacts for cleared fault bindings', () => {
    const state = {
      injectedFaults: [
        { instanceId: 'fault-inst-1', modelId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' },
        { instanceId: 'fault-inst-2', modelId: 'other_fault', targetId: 'node-controller', targetKind: 'node' }
      ],
      activeFaults: [
        { instanceId: 'fault-inst-1', modelId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' }
      ],
      appliedFaults: [
        { instanceId: 'fault-inst-1', modelId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' }
      ],
      selectedFaults: [
        { faultTypeId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' }
      ],
      faultInjectionResults: [
        { faultId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' }
      ],
      faultInstances: [
        {
          instanceId: 'fault-inst-1',
          faultTypeId: 'gyro_zero_bias',
          targetId: 'node-imu',
          targetKind: 'node',
          slotId: 'electrical:gyro_rate',
          active: true
        },
        {
          instanceId: 'fault-inst-2',
          faultTypeId: 'other_fault',
          targetId: 'node-controller',
          targetKind: 'node',
          active: true
        }
      ],
      faultTags: [
        { id: 'tag-gyro', faultModelId: 'gyro_zero_bias', targetId: 'node-imu', targetKind: 'node' },
        { id: 'tag-other', faultModelId: 'other_fault', targetId: 'node-controller', targetKind: 'node' }
      ],
      faultInjectionLinks: [
        { id: 'link-gyro', faultModelId: 'gyro_zero_bias', sourceTagId: 'tag-gyro', targetNodeId: 'node-imu' },
        { id: 'link-other', faultModelId: 'other_fault', sourceTagId: 'tag-other', targetNodeId: 'node-controller' }
      ],
      injectedFaultMap: {
        gyro_zero_bias: { modelId: 'gyro_zero_bias' },
        other_fault: { modelId: 'other_fault' }
      }
    };

    const result = removeFaultRuntimeArtifactsFromState(state, [{
      instanceId: 'fault-inst-1',
      faultId: 'gyro_zero_bias',
      targetId: 'node-imu',
      targetKind: 'node',
      slotId: 'electrical:gyro_rate'
    }], {
      target: { id: 'node-imu' },
      now: '2026-06-11T00:00:00.000Z',
      disabledReason: 'test-clear'
    });

    expect(result.changed).toBe(true);
    expect(result.state.injectedFaults).toEqual([
      { instanceId: 'fault-inst-2', modelId: 'other_fault', targetId: 'node-controller', targetKind: 'node' }
    ]);
    expect(result.state.activeFaults).toEqual([]);
    expect(result.state.appliedFaults).toEqual([]);
    expect(result.state.selectedFaults).toEqual([]);
    expect(result.state.faultInjectionResults).toEqual([]);
    expect(result.state.faultInstances).toEqual([
      {
        instanceId: 'fault-inst-1',
        faultTypeId: 'gyro_zero_bias',
        targetId: 'node-imu',
        targetKind: 'node',
        slotId: 'electrical:gyro_rate',
        active: false,
        enabled: false,
        disabledAt: '2026-06-11T00:00:00.000Z',
        disabledReason: 'test-clear'
      },
      {
        instanceId: 'fault-inst-2',
        faultTypeId: 'other_fault',
        targetId: 'node-controller',
        targetKind: 'node',
        active: true
      }
    ]);
    expect(result.state.faultTags).toEqual([
      { id: 'tag-other', faultModelId: 'other_fault', targetId: 'node-controller', targetKind: 'node' }
    ]);
    expect(result.state.faultInjectionLinks).toEqual([
      { id: 'link-other', faultModelId: 'other_fault', sourceTagId: 'tag-other', targetNodeId: 'node-controller' }
    ]);
    expect(result.state.injectedFaultMap).toEqual({
      other_fault: { modelId: 'other_fault' }
    });
  });
});
