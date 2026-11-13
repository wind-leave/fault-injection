import { describe, expect, it } from 'vitest';
import { sampleNoise } from '../src/services/noiseFaultRuntime.js';
import { applyScalarFault, applyScalarFaultBindings, applyComplexEnvelopeFault } from '../src/services/faultInjectionService.js';

const types = ['gaussian_noise', 'uniform_white_noise', 'gaussian_colored_noise'];
function moments(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const kurtosis = values.reduce((sum, value) => sum + (value - mean) ** 4, 0) / values.length / variance ** 2;
  const lag = values.slice(1).reduce((sum, value, index) => sum + (value - mean) * (values[index] - mean), 0) / (values.length - 1) / variance;
  return { mean, variance, kurtosis, lag };
}

describe('additive noise faults', () => {
  it.each(types)('%s adds a repeatable sample and obeys its time window', (behavior) => {
    const params = { mean: 0.2, std: 1, amplitude: 1, alpha: 0.8, seed: 7, start: 1, duration: 2 };
    const state = {};
    const apply = (input, time, seed = 7) => applyScalarFault(input, { behavior, params: { ...params, seed }, time, state });
    expect(apply(5, 0)).toBe(5);
    const first = apply(5, 1);
    expect(first).not.toBe(5);
    expect(apply(50, 1) - first).toBeCloseTo(45);
    expect(apply(5, 1, 8)).not.toBe(first);
    expect(apply(5, 4)).toBe(5);
    const replay = applyScalarFault(5, { behavior, params, time: 1, state: {} });
    expect(replay).toBe(first);
  });

  it('produces Gaussian white, uniform white, and correlated Gaussian distributions', () => {
    const series = Object.fromEntries(types.map((type) => {
      const state = {};
      return [type, Array.from({ length: 8192 }, (_, index) => sampleNoise(type, { seed: 17, std: 2, amplitude: 2, alpha: 0.85 }, index, 'statistics', state))];
    }));
    const gaussian = moments(series.gaussian_noise);
    expect(Math.abs(gaussian.mean)).toBeLessThan(0.1);
    expect(gaussian.variance).toBeGreaterThan(3.7);
    expect(gaussian.variance).toBeLessThan(4.3);
    expect(gaussian.kurtosis).toBeGreaterThan(2.7);
    expect(gaussian.kurtosis).toBeLessThan(3.4);
    expect(Math.abs(gaussian.lag)).toBeLessThan(0.05);
    const uniform = moments(series.uniform_white_noise);
    expect(series.uniform_white_noise.every((value) => value >= -2 && value <= 2)).toBe(true);
    expect(uniform.variance).toBeGreaterThan(1.25);
    expect(uniform.variance).toBeLessThan(1.42);
    expect(Math.abs(uniform.lag)).toBeLessThan(0.05);
    const colored = moments(series.gaussian_colored_noise);
    expect(colored.variance).toBeGreaterThan(3.5);
    expect(colored.variance).toBeLessThan(4.5);
    expect(colored.lag).toBeGreaterThan(0.8);
    expect(colored.lag).toBeLessThan(0.9);
  });

  it.each(types)('%s uses independent vector lanes and I/Q components', (behavior) => {
    const params = { seed: 3, std: 0.2, amplitude: 0.2 };
    const envelope = { i: 10, q: 20, referenceFrequencyHz: 2e9, impedanceOhm: 50 };
    const state = {};
    const value = applyComplexEnvelopeFault([envelope, envelope], { behavior, params, state, time: 1 });
    const increments = value.flatMap((sample) => [sample.i - 10, sample.q - 20]);
    expect(new Set(increments).size).toBe(4);
    expect(value[0].referenceFrequencyHz).toBe(2e9);
    expect(value[1].impedanceOhm).toBe(50);
    expect(applyComplexEnvelopeFault([envelope, envelope], { behavior, params, state, time: 1 })).toEqual(value);
    const target = { id: 'wire', faultBindings: [{ bindingId: 'noise', layer: 'protocol', runtimeBehavior: behavior, parameters: params, active: true }] };
    const incrementsByLane = [0, 1].map((vectorIndex) => applyScalarFaultBindings(10, { target, vectorIndex, time: 1, stateBucket: {} }) - 10);
    expect(incrementsByLane[0]).not.toBe(incrementsByLane[1]);
  });

  it('does not round away sub-picosecond white noise samples', () => {
    expect(sampleNoise('gaussian_noise', {}, 1e-14, 'tiny')).not.toBe(sampleNoise('gaussian_noise', {}, 2e-14, 'tiny'));
  });

  it('superposes multiple noise faults without replacing the original signal', () => {
    const target = { id: 'module', faultBindings: types.map((runtimeBehavior) => ({
      bindingId: runtimeBehavior, runtimeBehavior, active: true,
      parameters: { mean: 0.5, std: 0, amplitude: 0 }
    })) };
    expect(applyScalarFaultBindings(10, { target, stateBucket: {}, time: 0 })).toBe(11.5);
  });
});
