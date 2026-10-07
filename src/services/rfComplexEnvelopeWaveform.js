/**
 * Convert one complex-envelope sample to the corresponding real RF voltage.
 *
 * The envelope convention used by the simulator is z(t) = I(t) + jQ(t), so
 * the physical real signal is Re{z(t) exp(j 2 pi f_ref t)}.
 */
export function reconstructRealRfSample(value, timeSeconds = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const i = Number(value.i ?? value.re);
  const q = Number(value.q ?? value.im);
  const referenceFrequencyHz = Number(value.referenceFrequencyHz);
  const time = Number(timeSeconds);
  if (
    !Number.isFinite(i)
    || !Number.isFinite(q)
    || !Number.isFinite(referenceFrequencyHz)
    || !Number.isFinite(time)
  ) {
    return value;
  }

  // Reducing whole carrier cycles before evaluating sin/cos improves numeric
  // stability for high reference frequencies and long simulation timelines.
  const carrierCycles = referenceFrequencyHz * time;
  const fractionalCycle = carrierCycles - Math.trunc(carrierCycles);
  const phase = 2 * Math.PI * fractionalCycle;
  return i * Math.cos(phase) - q * Math.sin(phase);
}

