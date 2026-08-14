function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function firstText(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function numberOrFallback(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export const RF_VECTOR_LENGTH_LIMITS = { min: 2, max: 16 };

export function normalizeRfVectorLength(value, fallback = 4) {
  const numeric = Math.trunc(Number(value));
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(RF_VECTOR_LENGTH_LIMITS.max, Math.max(RF_VECTOR_LENGTH_LIMITS.min, base));
}

export function getRfVectorValues(value, length = 4) {
  const expectedLength = normalizeRfVectorLength(length);
  const source = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,，;；\s]+/);
  const values = source
    .map((item) => Number(String(item ?? '').trim()))
    .filter(Number.isFinite);
  return Array.from({ length: expectedLength }, (_, index) => values[index] ?? 1);
}

export function formatRfVectorValues(value, length = 4) {
  return getRfVectorValues(value, length).join(', ');
}

export function isRfVectorOutput(props = {}) {
  return normalizeSignalDomain(props.signalDomain) === 'rf'
    && ['vector', '向量'].includes(String(props.outputFormat ?? '').trim().toLowerCase());
}

export const SIGNAL_DOMAINS = [
  { value: 'digital', label: '数字信号' },
  { value: 'command', label: '指令信号' },
  { value: 'analog', label: '模拟信号' },
  { value: 'rf', label: '射频信号' }
];

export const SIGNAL_DOMAIN_VALUES = SIGNAL_DOMAINS.map((item) => item.value);

const COMMON_DEFAULTS = {
  signalName: '',
  signalId: '',
  unit: '',
  description: '',
  outputPortName: '输出'
};

const DOMAIN_DEFAULTS = {
  digital: {
    name: '数字信号源',
    signalDomain: 'digital',
    digitalMode: 'boolean',
    initialState: '0',
    minValue: '0',
    maxValue: '100',
    highLevel: '1',
    lowLevel: '0',
    enumValues: '',
    outputFormat: '布尔'
  },
  command: {
    name: '指令信号源',
    signalDomain: 'command',
    commandType: 'control',
    commandName: '',
    protocol: 'CAN',
    messageId: '',
    payloadKind: 'float32',
    payloadSchema: '',
    payloadValue: '',
    sendPeriod: '',
    triggerCondition: '',
    outputFormat: '事件'
  },
  analog: {
    name: '模拟信号源',
    signalDomain: 'analog',
    waveType: '正弦',
    amplitude: '1.0',
    frequency: '1.0',
    phase: '0',
    offset: '0',
    dutyCycle: '50',
    lowValue: '0',
    unit: '',
    outputFormat: '标量'
  },
  rf: {
    name: '射频信号源',
    signalDomain: 'rf',
    centerFrequency: '',
    bandwidth: '',
    // 0 dBm corresponds to a non-zero, 50-ohm RF carrier.  A source with an
    // unspecified level should not silently become a zero-amplitude source.
    power: '0',
    powerUnit: 'dBm',
    modulation: 'cw',
    modulationDepth: '',
    modulationRate: '',
    frequencyDeviation: '',
    phaseDeviation: '',
    symbolRate: '',
    phase: '',
    snr: '',
    sampleRate: '',
    pulseWidth: '',
    pulseWidthUnit: 'μs',
    pulsePeriod: '',
    pulsePeriodUnit: 'ms',
    channel: '',
    polarization: '',
    rfProfile: '',
    outputFormat: '标量',
    rfVectorLength: 4,
    rfVectorConfigMode: 'batch',
    rfVectorValues: '1, 1, 1, 1'
  }
};

export function normalizeSignalDomain(value) {
  return SIGNAL_DOMAIN_VALUES.includes(value) ? value : 'analog';
}

export function createSignalSourceProps(domain = 'analog', overrides = {}) {
  const normalizedDomain = normalizeSignalDomain(domain);
  return {
    ...clone(COMMON_DEFAULTS),
    ...clone(DOMAIN_DEFAULTS[normalizedDomain]),
    ...clone(overrides),
    signalDomain: normalizedDomain
  };
}

export function normalizeSignalSourceProps(props = {}) {
  const original = clone(props ?? {});
  const signalDomain = normalizeSignalDomain(original.signalDomain);
  const normalized = {
    ...createSignalSourceProps(signalDomain),
    ...original,
    signalDomain
  };

  // 将旧模型中“250us”这类带单位的时长拆分成数值与单位，便于属性面板继续编辑。
  if (signalDomain === 'rf') {
    // Older canvases stored an empty string for an unedited RF power field.
    // Treat that as the source default so the backend does not export a zero
    // carrier solely because a legacy model lacks this optional UI value.
    if (!String(normalized.power ?? '').trim()) {
      normalized.power = '0';
    }
    normalized.rfVectorLength = normalizeRfVectorLength(normalized.rfVectorLength);
    normalized.rfVectorConfigMode = normalized.rfVectorConfigMode === 'item' ? 'item' : 'batch';
    normalized.rfVectorValues = formatRfVectorValues(normalized.rfVectorValues, normalized.rfVectorLength);
    ['pulseWidth', 'pulsePeriod'].forEach((key) => {
      const unitKey = `${key}Unit`;
      if (Object.prototype.hasOwnProperty.call(original, unitKey)) return;
      const match = String(original[key] ?? '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(ns|us|μs|µs|ms|s)\s*$/i);
      if (!match) return;
      normalized[key] = match[1];
      normalized[unitKey] = match[2].toLowerCase().replace(/^us$/, 'μs').replace('µ', 'μ');
    });
  }

  // Preserve pulse behavior for models saved before PRF was replaced by
  // the pulse repetition period (重周).
  if (signalDomain === 'rf' && !String(normalized.pulsePeriod ?? '').trim() && String(original.prf ?? '').trim()) {
    const text = String(original.prf).trim().toLowerCase();
    const value = Number.parseFloat(text);
    const multiplier = /ghz\s*$/.test(text) ? 1e9
      : /mhz\s*$/.test(text) ? 1e6
        : /khz\s*$/.test(text) ? 1e3
          : 1;
    if (Number.isFinite(value) && value > 0) {
      normalized.pulsePeriod = String(1000 / (value * multiplier));
      normalized.pulsePeriodUnit = 'ms';
    }
  }

  return normalized;
}

export function summarizeSignalSource(node = {}) {
  const props = normalizeSignalSourceProps(node.props ?? node);

  if (props.signalDomain === 'digital') {
    const valueText = firstText(props.initialState, props.value, props.lowLevel);
    return ['数字', props.digitalMode, valueText !== '' ? `取值 ${valueText}` : ''].filter(Boolean).join(' · ');
  }

  if (props.signalDomain === 'command') {
    return ['指令', props.protocol || '协议', props.messageId || props.commandName || '未设置', props.payloadKind]
      .filter(Boolean)
      .join(' · ');
  }

  if (props.signalDomain === 'rf') {
    const level = props.power === '' ? '' : `${props.power}${props.powerUnit || ''}`;
    const fallbackSignal = [props.modulation, level].filter(Boolean).join(' · ');
    return ['射频', props.centerFrequency || '未设置频点', props.bandwidth || '未设置带宽', fallbackSignal]
      .filter(Boolean)
      .join(' · ');
  }

  const amplitude = `${props.amplitude ?? '1.0'}${props.unit ?? ''}`;
  return ['模拟', props.waveType || '信号', amplitude, props.frequency].filter(Boolean).join(' · ');
}

export function getSignalSourceScalarFallback(props = {}) {
  const normalized = normalizeSignalSourceProps(props);

  if (normalized.signalDomain === 'digital') {
    return numberOrFallback(normalized.initialState, 0);
  }

  if (normalized.signalDomain === 'command') {
    return numberOrFallback(firstText(normalized.commandValue, normalized.payloadValue), 0);
  }

  if (normalized.signalDomain === 'rf') {
    return numberOrFallback(normalized.power, 0);
  }

  return numberOrFallback(firstText(normalized.value, normalized.amplitude), 0);
}
