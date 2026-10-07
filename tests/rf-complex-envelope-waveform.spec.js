import { describe, expect, it } from 'vitest';
import { reconstructRealRfSample } from '../src/services/rfComplexEnvelopeWaveform.js';

describe('reconstructRealRfSample', () => {
  it('reconstructs the real RF waveform from I/Q and reference frequency', () => {
    const envelope = { i: 2, q: 0.5, referenceFrequencyHz: 10 };

    expect(reconstructRealRfSample(envelope, 0)).toBeCloseTo(2, 12);
    expect(reconstructRealRfSample(envelope, 0.025)).toBeCloseTo(-0.5, 12);
    expect(reconstructRealRfSample(envelope, 0.05)).toBeCloseTo(-2, 12);
    expect(reconstructRealRfSample(envelope, 0.075)).toBeCloseTo(0.5, 12);
  });

  it('leaves ordinary scalar signals unchanged', () => {
    expect(reconstructRealRfSample(1.25, 0.1)).toBe(1.25);
  });
});

