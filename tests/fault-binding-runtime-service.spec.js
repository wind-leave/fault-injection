import { describe, expect, it } from 'vitest';
import {
  createFaultInstanceRecord,
  createFaultTagLinkRecord,
  createFaultTagRecord,
  createRuntimePayloadFromInstance,
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
});
