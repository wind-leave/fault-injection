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
  description: ''
};

const DOMAIN_DEFAULTS = {
  digital: {
    name: '数字信号源',
    signalDomain: 'digital',
    digitalMode: 'boolean',
    initialState: '0',
    highLevel: '1',
    lowLevel: '0',
    pulseWidth: '',
    period: '',
    dutyCycle: '',
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
    analogKind: 'generic',
    waveType: '正弦',
    amplitude: '1.0',
    frequency: '1.0',
    phase: '0',
    offset: '0',
    sampleRate: '',
    minValue: '',
    maxValue: '',
    unit: '',
    outputFormat: '标量'
  },
  rf: {
    name: '射频信号源',
    signalDomain: 'rf',
    rfKind: 'communication',
    centerFrequency: '',
    bandwidth: '',
    power: '',
    powerUnit: 'dBm',
    modulation: '',
    phase: '',
    snr: '',
    sampleRate: '',
    pulseWidth: '',
    prf: '',
    channel: '',
    polarization: '',
    rfProfile: '',
    outputFormat: '矩阵'
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
  return {
    ...createSignalSourceProps(signalDomain),
    ...original,
    signalDomain
  };
}

export function summarizeSignalSource(node = {}) {
  const props = normalizeSignalSourceProps(node.props ?? node);

  if (props.signalDomain === 'digital') {
    return ['数字', props.digitalMode, props.period ? `周期 ${props.period}` : ''].filter(Boolean).join(' · ');
  }

  if (props.signalDomain === 'command') {
    return ['指令', props.protocol || '协议', props.messageId || props.commandName || '未设置', props.payloadKind]
      .filter(Boolean)
      .join(' · ');
  }

  if (props.signalDomain === 'rf') {
    const fallbackSignal = props.modulation || (props.power ? `${props.power}${props.powerUnit || ''}` : '');
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
