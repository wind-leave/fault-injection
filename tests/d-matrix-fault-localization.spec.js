import { describe, expect, it } from 'vitest';
import { diagnoseDMatrixFaultCombinations } from '../src/services/dMatrixFaultLocalization.js';

const pointCodes = ['M1', 'M2', 'M3', 'M7', 'M8', 'M9'];
const signatures = {
  allocation: [1, 1, 1, 0, 0, 0],
  voltageDrop: [0, 1, 1, 1, 1, 0],
  voltageLimit: [1, 0, 0, 1, 0, 1],
  canCommand: [0, 0, 1, 1, 1, 1]
};

function matrix(enabledFaultIds = ['voltageDrop', 'voltageLimit']) {
  return {
    points: pointCodes.map((code) => ({ pointId: code, shortName: code })),
    rows: Object.entries(signatures).map(([faultId, values]) => ({
      faultId,
      faultName: faultId,
      enabled: enabledFaultIds.includes(faultId),
      cells: values.map((value, index) => ({ pointId: pointCodes[index], detectable: Boolean(value) }))
    }))
  };
}

describe('D-matrix fault localization', () => {
  it('finds every matching combination, including disabled fault rows', () => {
    const states = Object.fromEntries(pointCodes.map((code) => [code, 'abnormal']));
    const result = diagnoseDMatrixFaultCombinations(matrix(), states);
    const faultSets = result.candidates.map((candidate) => candidate.faultIds);
    expect(faultSets).toHaveLength(7);
    expect(faultSets).toContainEqual(['voltageDrop', 'voltageLimit']);
    expect(faultSets).toContainEqual(['allocation', 'canCommand']);
    expect(faultSets).toContainEqual(['allocation', 'voltageDrop', 'voltageLimit']);
    expect(faultSets).toContainEqual(['allocation', 'voltageDrop', 'voltageLimit', 'canCommand']);
    expect(result.candidates[0].mode).toBe('multiple');
  });

  it('keeps exact single-fault matches', () => {
    const states = Object.fromEntries(pointCodes.map((code, index) => [code, signatures.voltageDrop[index] ? 'abnormal' : 'normal']));
    const result = diagnoseDMatrixFaultCombinations(matrix(['voltageDrop', 'voltageLimit']), states);
    expect(result.candidates.map((candidate) => candidate.faultIds)).toEqual([['voltageDrop']]);
  });

  it('keeps the same candidate universe when no fault is enabled for injection', () => {
    const states = Object.fromEntries(pointCodes.map((code) => [code, 'abnormal']));
    const result = diagnoseDMatrixFaultCombinations(matrix([]), states);
    expect(result.candidates).toHaveLength(7);
  });

  it('lists every equivalent combination when all four faults are enabled', () => {
    const states = Object.fromEntries(pointCodes.map((code) => [code, 'abnormal']));
    const result = diagnoseDMatrixFaultCombinations(matrix(Object.keys(signatures)), states);
    expect(result.candidates).toHaveLength(7);
    expect(result.candidates.slice(0, 2).map((candidate) => candidate.faultIds)).toEqual([
      ['allocation', 'canCommand'],
      ['voltageDrop', 'voltageLimit']
    ]);
  });

  it('requires all point states before diagnosing', () => {
    const result = diagnoseDMatrixFaultCombinations(matrix(), { M1: 'abnormal' });
    expect(result.complete).toBe(false);
    expect(result.incompletePointIds).toContain('M2');
  });
});
