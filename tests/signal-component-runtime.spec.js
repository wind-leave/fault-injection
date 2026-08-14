import { describe, expect, it } from 'vitest';
import {
  evaluateFlowBlockOutputs,
  evaluateSignalUtilityOutputs,
  isSignalUtilityType,
  normalizeSignalUtilityNode,
  parseSignalScalar,
  sanitizeSignalValue
} from '../src/services/signalComponentRuntime.js';

describe('signal component runtime', () => {
  it('sanitizes scalar and vector values', () => {
    expect(sanitizeSignalValue('3.5')).toBe(3.5);
    expect(sanitizeSignalValue('bad')).toBe(0);
    expect(sanitizeSignalValue([1, '2', 'bad'])).toEqual([1, 2, 0]);
  });

  it('parses scalar configuration with fallback', () => {
    expect(parseSignalScalar('2.25', 1)).toBe(2.25);
    expect(parseSignalScalar('', 1)).toBe(1);
    expect(parseSignalScalar('abc', 4)).toBe(4);
  });

  it('passes normal flow block input through as a sanitized output', () => {
    expect(evaluateFlowBlockOutputs(['4.2'])).toEqual({
      outputs: [4.2],
      middleValues: []
    });
    expect(evaluateFlowBlockOutputs([])).toEqual({
      outputs: [0],
      middleValues: []
    });
  });

  it('evaluates gain, sum, and mux utility outputs', () => {
    expect(evaluateSignalUtilityOutputs({
      type: 'gain_block',
      props: { gain: '2.5' }
    }, [4])).toEqual({
      outputs: [10],
      middleValues: []
    });

    expect(evaluateSignalUtilityOutputs({
      type: 'sum_block',
      props: { inputCount: 3, signs: ['+', '-', '+'] }
    }, [7, 2, '3'])).toEqual({
      outputs: [8],
      middleValues: []
    });

    expect(evaluateSignalUtilityOutputs({
      type: 'mux_block',
      props: { inputCount: 3 }
    }, [1, '2', 'bad'])).toEqual({
      outputs: [[1, 2, 0]],
      middleValues: []
    });
  });

  it('normalizes signal utility node props in place', () => {
    const sum = {
      type: 'sum_block',
      props: {
        inputCount: '5',
        signs: ['-', '+']
      }
    };
    const mux = {
      type: 'mux_block',
      props: {
        inputCount: '1',
        outputFormat: ''
      }
    };

    expect(isSignalUtilityType('sum_block')).toBe(true);
    expect(isSignalUtilityType('flow_block')).toBe(false);
    expect(normalizeSignalUtilityNode(sum)).toBe(sum);
    expect(sum.props).toMatchObject({
      inputCount: 5,
      signs: ['-', '+', '+', '+', '+'],
      outputFormat: '标量'
    });

    normalizeSignalUtilityNode(mux);
    expect(mux.props).toMatchObject({
      inputCount: 2,
      outputFormat: '向量'
    });
  });
});
