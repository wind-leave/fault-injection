import { describe, expect, it } from 'vitest';
import { createEmptyAuthoringPackage } from '../src/services/authoringModelService.js';
import {
  attachFaultTypeToTargetSlot,
  createFaultInstance,
  createFaultType,
  removeFaultInstance
} from '../src/services/faultAuthoringService.js';

function createNodePackage() {
  const pkg = createEmptyAuthoringPackage({
    modelId: 'fault-authoring-demo',
    modelName: 'Fault Authoring Demo'
  });

  return {
    ...pkg,
    systemModel: {
      ...pkg.systemModel,
      nodes: [
        {
          id: 'node-imu',
          faultSlots: [
            {
              slotId: 'gyro-feedback',
              displayName: 'Gyro Feedback',
              allowedFaultTypeIds: []
            }
          ]
        }
      ]
    },
    faultTypeCatalog: [
      createFaultType({
        id: 'gyro_zero_bias_drift',
        displayName: 'Gyro 零偏 - 缓慢漂移',
        layer: 'electrical',
        faultClass: '漂移故障',
        runtimeBehavior: 'drift',
        parameters: {
          rate: { label: '漂移速率', type: 'number', unit: 'rad/s²', default: 0.006 },
          start: { label: '开始时间', type: 'number', unit: 's', default: 3 }
        }
      })
    ]
  };
}

describe('faultAuthoringService', () => {
  it('creates fault types with parameter schemas and default parameters', () => {
    const faultType = createFaultType({
      id: 'gyro_zero_bias_drift',
      displayName: 'Gyro 零偏 - 缓慢漂移',
      name: 'Gyro 零偏 - 缓慢漂移',
      layer: 'electrical',
      faultClass: '漂移故障',
      modelClass: '漂移故障',
      runtimeBehavior: 'drift',
      parameters: {
        rate: { label: '漂移速率', type: 'number', unit: 'rad/s²', default: 0.006 },
        start: { label: '开始时间', type: 'number', unit: 's', default: 3 }
      }
    });

    expect(faultType).toMatchObject({
      id: 'gyro_zero_bias_drift',
      displayName: 'Gyro 零偏 - 缓慢漂移',
      layer: 'electrical',
      faultClass: '漂移故障',
      runtimeBehavior: 'drift',
      formula: '',
      parameters: {
        rate: { label: '漂移速率', type: 'number', unit: 'rad/s²', default: 0.006 },
        start: { label: '开始时间', type: 'number', unit: 's', default: 3 }
      },
      defaultParameters: {
        rate: 0.006,
        start: 3
      }
    });
  });

  it('immutably attaches a fault type to a node target slot', () => {
    const pkg = createNodePackage();
    const next = attachFaultTypeToTargetSlot(pkg, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });
    const repeated = attachFaultTypeToTargetSlot(next, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });

    expect(next).not.toBe(pkg);
    expect(next.systemModel.nodes[0].faultSlots[0].allowedFaultTypeIds).toEqual([
      'gyro_zero_bias_drift'
    ]);
    expect(pkg.systemModel.nodes[0].faultSlots[0].allowedFaultTypeIds).toEqual([]);
    expect(repeated.systemModel.nodes[0].faultSlots[0].allowedFaultTypeIds).toEqual([
      'gyro_zero_bias_drift'
    ]);
  });

  it('creates active fault instances with defaults and rejects duplicate target faults', () => {
    const pkg = attachFaultTypeToTargetSlot(createNodePackage(), {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });

    const created = createFaultInstance(pkg, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift',
      parameters: { rate: 0.01 }
    });
    const duplicate = createFaultInstance(created.package, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift',
      parameters: { rate: 0.02 }
    });

    expect(created.ok).toBe(true);
    expect(created.package.faultInstances).toEqual([
      expect.objectContaining({
        targetKind: 'node',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        faultTypeId: 'gyro_zero_bias_drift',
        parameters: { rate: 0.01, start: 3 },
        active: true
      })
    ]);
    expect(created.package.faultInstances[0].instanceId).toEqual(expect.any(String));
    expect(pkg.faultInstances).toEqual([]);
    expect(duplicate).toEqual({
      ok: false,
      error: 'duplicate-fault-instance',
      package: created.package
    });
  });

  it('removes fault instances by marking them inactive', () => {
    const pkg = {
      ...createNodePackage(),
      faultInstances: [
        {
          instanceId: 'fault-inst-1',
          targetKind: 'node',
          targetId: 'node-imu',
          slotId: 'gyro-feedback',
          faultTypeId: 'gyro_zero_bias_drift',
          parameters: { rate: 0.01, start: 3 },
          active: true
        }
      ]
    };

    const next = removeFaultInstance(pkg, 'fault-inst-1');

    expect(next).not.toBe(pkg);
    expect(next.faultInstances).toEqual([
      expect.objectContaining({
        instanceId: 'fault-inst-1',
        active: false
      })
    ]);
    expect(pkg.faultInstances[0].active).toBe(true);
  });

  it('creates edge fault instances for capability slots on edges', () => {
    const faultType = createFaultType({
      id: 'motor1_can_command_tamper',
      displayName: 'Motor1 CAN Command Tamper',
      runtimeBehavior: 'tamper'
    });
    const pkg = attachFaultTypeToTargetSlot(
      {
        ...createEmptyAuthoringPackage(),
        systemModel: {
          nodes: [],
          edges: [
            {
              id: 'edge-motor-motor1',
              faultSlots: [
                {
                  slotId: 'motor1-can-command',
                  allowedFaultTypeIds: []
                }
              ]
            }
          ]
        },
        faultTypeCatalog: [faultType]
      },
      {
        targetKind: 'edge',
        targetId: 'edge-motor-motor1',
        slotId: 'motor1-can-command',
        faultTypeId: 'motor1_can_command_tamper'
      }
    );

    const created = createFaultInstance(pkg, {
      targetKind: 'edge',
      targetId: 'edge-motor-motor1',
      slotId: 'motor1-can-command',
      faultTypeId: 'motor1_can_command_tamper'
    });

    expect(created.ok).toBe(true);
    expect(created.package.faultInstances).toEqual([
      expect.objectContaining({
        targetKind: 'edge',
        targetId: 'edge-motor-motor1',
        slotId: 'motor1-can-command',
        faultTypeId: 'motor1_can_command_tamper',
        parameters: {},
        active: true
      })
    ]);
  });
});
