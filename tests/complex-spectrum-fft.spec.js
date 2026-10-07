import { describe, expect, it } from 'vitest';
import { fftComplexForward } from '../src/services/complexSpectrumFft.js';

describe('fftComplexForward', () => {
  it('keeps an arbitrary coherent sample count instead of rounding it to a power of two', () => {
    const size = 100;
    const expectedBin = 17;
    const inputI = Float64Array.from({ length: size }, (_unused, index) => Math.cos(2 * Math.PI * expectedBin * index / size));
    const inputQ = Float64Array.from({ length: size }, (_unused, index) => Math.sin(2 * Math.PI * expectedBin * index / size));

    const result = fftComplexForward(inputI, inputQ);
    const magnitudes = Array.from(result.real, (value, index) => Math.hypot(value, result.imaginary[index]));
    const peakBin = magnitudes.indexOf(Math.max(...magnitudes));

    expect(result.real).toHaveLength(size);
    expect(peakBin).toBe(expectedBin);
    expect(magnitudes[expectedBin]).toBeCloseTo(size, 8);
  });
});
