import { describe, expect, it } from 'vitest';
import {
  buildDMatrixRows,
  upsertDetectability
} from '../src/services/diagnosticAuthoringService.js';

const pkg = {
  faultTypeCatalog: [
    { id: 'gyro_zero_bias_drift', displayName: 'Gyro 零偏 - 缓慢漂移' },
    { id: 'motor1_stuck', displayName: '1号电机卡死' }
  ],
  diagnosticModel: {
    testPoints: [
      { testPointId: 'M1', displayName: '指令测点' },
      { testPointId: 'M3', displayName: 'IMU 反馈测点' }
    ],
    detectabilityMatrix: [
      {
        faultTypeId: 'gyro_zero_bias_drift',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        testPointId: 'M3',
        detectable: true,
        signature: '均值漂移',
        confidence: 0.9
      },
      {
        faultTypeId: 'motor1_stuck',
        targetId: 'node-motor-1',
        slotId: 'motor-state',
        testPointId: 'M1',
        detectable: false,
        signature: '指令端无明显异常',
        confidence: 0.2
      }
    ]
  }
};

describe('diagnosticAuthoringService', () => {
  it('appends detectability rows keyed by fault, target, slot, and test point', () => {
    const next = upsertDetectability(pkg, {
      faultTypeId: 'gyro_zero_bias_drift',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      testPointId: 'M1',
      detectable: true,
      signature: '指令端漂移',
      confidence: 0.7
    });

    expect(next).not.toBe(pkg);
    expect(pkg.diagnosticModel.detectabilityMatrix).toHaveLength(2);
    expect(next.diagnosticModel.detectabilityMatrix).toEqual([
      ...pkg.diagnosticModel.detectabilityMatrix,
      {
        faultTypeId: 'gyro_zero_bias_drift',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        testPointId: 'M1',
        detectable: true,
        signature: '指令端漂移',
        confidence: 0.7
      }
    ]);
  });

  it('replaces existing detectability rows with the same fault, target, slot, and test point key', () => {
    const next = upsertDetectability(pkg, {
      faultTypeId: 'motor1_stuck',
      targetId: 'node-motor-1',
      slotId: 'motor-state',
      testPointId: 'M1',
      detectable: true,
      signature: '',
      confidence: Number.NaN
    });

    expect(next.diagnosticModel.detectabilityMatrix).toEqual([
      pkg.diagnosticModel.detectabilityMatrix[0],
      {
        faultTypeId: 'motor1_stuck',
        targetId: 'node-motor-1',
        slotId: 'motor-state',
        testPointId: 'M1',
        detectable: true,
        signature: '',
        confidence: 0
      }
    ]);
    expect(pkg.diagnosticModel.detectabilityMatrix[1].detectable).toBe(false);
  });

  it('builds D-matrix rows grouped by fault, target, and slot with fault names and test point columns', () => {
    expect(buildDMatrixRows(pkg)).toEqual([
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        M1: 0,
        M3: 1
      },
      {
        faultTypeId: 'motor1_stuck',
        faultName: '1号电机卡死',
        targetId: 'node-motor-1',
        slotId: 'motor-state',
        M1: 0,
        M3: 0
      }
    ]);
  });

  it('defaults missing test point columns to 0', () => {
    const rows = buildDMatrixRows({
      ...pkg,
      diagnosticModel: {
        ...pkg.diagnosticModel,
        detectabilityMatrix: [pkg.diagnosticModel.detectabilityMatrix[0]]
      }
    });

    expect(rows).toEqual([
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        M1: 0,
        M3: 1
      }
    ]);
  });

  it('keeps detectability rows with the same fault but different target or slot as separate D-matrix rows', () => {
    const next = upsertDetectability(pkg, {
      faultTypeId: 'gyro_zero_bias_drift',
      targetId: 'node-imu-backup',
      slotId: 'gyro-feedback',
      testPointId: 'M3',
      detectable: true
    });
    const withDifferentSlot = upsertDetectability(next, {
      faultTypeId: 'gyro_zero_bias_drift',
      targetId: 'node-imu',
      slotId: 'gyro-backup-feedback',
      testPointId: 'M1',
      detectable: true
    });

    expect(buildDMatrixRows(withDifferentSlot)).toEqual([
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        M1: 0,
        M3: 1
      },
      {
        faultTypeId: 'motor1_stuck',
        faultName: '1号电机卡死',
        targetId: 'node-motor-1',
        slotId: 'motor-state',
        M1: 0,
        M3: 0
      },
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu-backup',
        slotId: 'gyro-feedback',
        M1: 0,
        M3: 1
      },
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu',
        slotId: 'gyro-backup-feedback',
        M1: 1,
        M3: 0
      }
    ]);
  });
});
