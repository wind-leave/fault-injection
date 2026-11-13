export const NOISE_FAULT_DEFINITIONS = Object.freeze([
  { id: 'gaussian_noise', name: '独立高斯噪声', formula: 'y_fault = y + N(mean, std²)', defaultParameters: { mean: 0, std: 0.1, seed: 1, start: 0, duration: '' } },
  { id: 'uniform_white_noise', name: '均匀分布白噪声', formula: 'y_fault = y + mean + U(-amplitude, amplitude)', defaultParameters: { mean: 0, amplitude: 0.1, seed: 1, start: 0, duration: '' } },
  { id: 'gaussian_colored_noise', name: '高斯有色噪声', formula: 'y_fault = y + mean + n; n = alpha*n_prev + std*sqrt(1-alpha²)*N(0,1)', defaultParameters: { mean: 0, std: 0.1, alpha: 0.9, seed: 1, start: 0, duration: '' } }
]);

export const NOISE_FAULT_TYPES = Object.freeze(NOISE_FAULT_DEFINITIONS.map(({ id }) => id));

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatHex(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Counter-based sampling: repeat evaluations of one timestamp are identical,
// including simulations with sub-picosecond steps. Channels use separate streams.
function uniform(seed, stream, time, salt) {
  const bytes = new TextEncoder().encode(`${floatHex(seed)}|${stream}|${floatHex(time)}|${salt}`);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash + 0.5) / 4294967296;
}

export function sampleNoise(type, parameters = {}, time = 0, stream = '', state = {}) {
  const seed = finite(parameters.seed, 1);
  const mean = finite(parameters.mean, 0);
  const std = Math.max(0, finite(parameters.std, 0.1));
  if (type === 'uniform_white_noise') {
    return mean + (2 * uniform(seed, stream, time, 'u') - 1) * Math.max(0, finite(parameters.amplitude, 0.1));
  }
  const gaussian = Math.sqrt(-2 * Math.log(uniform(seed, stream, time, 'a')))
    * Math.cos(2 * Math.PI * uniform(seed, stream, time, 'b'));
  if (type !== 'gaussian_colored_noise') return mean + std * gaussian;
  const alpha = Math.max(-0.999, Math.min(0.999, finite(parameters.alpha, 0.9)));
  const signature = JSON.stringify([seed, mean, std, alpha, parameters.start, parameters.duration]);
  state.noiseStreams ??= {};
  const previous = state.noiseStreams[stream];
  if (previous?.time === time && previous.signature === signature) return mean + previous.value;
  const value = previous && previous.signature === signature && previous.time < time
    ? alpha * previous.value + std * Math.sqrt(1 - alpha * alpha) * gaussian
    : std * gaussian;
  state.noiseStreams[stream] = { time, value, signature };
  return mean + value;
}
