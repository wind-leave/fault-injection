import {
  SIGNAL_DOMAINS,
  normalizeSignalSourceProps
} from './signalSourceDomainService.js';

const PORT_FORMATS = ['标量', '向量', '矩阵', '布尔', '事件'];

const ANALOG_KIND_OPTIONS = [
  { value: 'voltage', label: '电压信号' },
  { value: 'current', label: '电流信号' },
  { value: 'sensor', label: '传感器量' },
  { value: 'control', label: '控制量' },
  { value: 'generic', label: '通用模拟量' }
];

const WAVE_TYPE_OPTIONS = [
  { value: 'sine', label: '正弦' },
  { value: 'step', label: '阶跃' },
  { value: 'constant', label: '常值' },
  { value: 'ramp', label: '斜坡' },
  { value: 'noise', label: '噪声' }
];

const WAVE_TYPE_ALIASES = {
  正弦: 'sine',
  阶跃: 'step',
  常值: 'constant',
  斜坡: 'ramp',
  噪声: 'noise'
};

const DIGITAL_MODE_OPTIONS = [
  { value: 'boolean', label: '布尔取值' },
  { value: 'level', label: '双值电平' },
  { value: 'enum', label: '枚举取值' },
  { value: 'generic', label: '通用信号' }
];

const COMMAND_TYPE_OPTIONS = [
  { value: 'control', label: '控制指令' },
  { value: 'bus-message', label: '总线报文' },
  { value: 'task', label: '任务指令' },
  { value: 'mode', label: '模式指令' }
];

const RF_KIND_OPTIONS = [
  { value: 'communication', label: '通信射频' },
  { value: 'radar', label: '雷达射频' },
  { value: 'navigation', label: '导航射频' },
  { value: 'jamming', label: '干扰射频' },
  { value: 'generic', label: '通用射频' }
];

const RF_MODULATION_OPTIONS = [
  { value: 'cw', label: '连续波（CW）' },
  { value: 'am', label: '幅度调制（AM）' },
  { value: 'fm', label: '频率调制（FM）' },
  { value: 'pm', label: '相位调制（PM）' },
  { value: 'pulse', label: '脉冲调制' },
  { value: 'digital', label: '数字调制' },
  { value: 'noise', label: '噪声/干扰' }
];

const MULTIMETER_MODE_OPTIONS = [
  { value: '直流电压', label: '直流电压' },
  { value: '交流电压', label: '交流电压' },
  { value: '直流电流', label: '直流电流' },
  { value: '交流电流', label: '交流电流' },
  { value: '电阻', label: '电阻' },
  { value: '通断', label: '通断' }
];

const SELECT_OPTION_OVERRIDES = {
  analogKind: ANALOG_KIND_OPTIONS,
  waveType: WAVE_TYPE_OPTIONS,
  digitalMode: DIGITAL_MODE_OPTIONS,
  commandType: COMMAND_TYPE_OPTIONS,
  rfKind: RF_KIND_OPTIONS,
  measurementMode: MULTIMETER_MODE_OPTIONS
};

const PROPERTY_SCHEMAS = {
  signal_source: {
    type: 'signal_source',
    groups: [
      {
        label: '信号定义',
        placement: 'overview',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '信号源' },
          { key: 'signalDomain', label: '信号域', type: 'select', options: SIGNAL_DOMAINS, fallback: 'analog', row: 'signal-domain' },
          { key: 'signalName', label: '信号名称', type: 'text', fallback: '', row: 'signal-id' },
          { key: 'signalId', label: '信号 ID', type: 'text', fallback: '', row: 'signal-id' },
          { key: 'unit', label: '单位', type: 'text', fallback: '', row: 'signal-meta' },
          { key: 'description', label: '说明', type: 'text', fallback: '', row: 'signal-meta' }
        ]
      },
      {
        label: '端口配置',
        fields: [
          { key: 'outputPortName', label: '输出端口名称', type: 'text', fallback: '输出' }
        ]
      },
      {
        label: '数字信号配置',
        domains: ['digital'],
        fields: [
          { key: 'digitalMode', label: '取值类型', type: 'select', options: ['boolean', 'level', 'enum', 'generic'], fallback: 'boolean', row: 'digital-mode' },
          { key: 'digitalGearConfig', label: '挡位配置', type: 'digitalGearConfig' },
          { key: 'outputFormat', label: '输出格式', type: 'select', options: PORT_FORMATS, fallback: '布尔', row: 'digital-values' }
        ]
      },
      {
        label: '指令信号配置',
        domains: ['command'],
        fields: [
          { key: 'commandType', label: '指令类型', type: 'select', options: ['control', 'bus-message', 'task', 'mode'], fallback: 'control', row: 'command-type' },
          { key: 'commandName', label: '指令名称', type: 'text', fallback: '', row: 'command-type' },
          { key: 'protocol', label: '协议', type: 'select', options: ['CAN', 'CAN FD', 'UART', 'RS-485', 'Ethernet'], fallback: 'CAN', row: 'command-protocol' },
          { key: 'messageId', label: '报文 ID', type: 'text', fallback: '', row: 'command-protocol' },
          { key: 'payloadKind', label: '载荷类型', type: 'select', options: ['float32', 'float64', 'int8', 'int16', 'int32', 'uint8', 'uint16', 'uint32', 'boolean'], fallback: 'float32', row: 'command-payload' },
          { key: 'payloadValue', label: '载荷数值', type: 'text', fallback: '', row: 'command-payload' },
          { key: 'sendPeriod', label: '发送周期', type: 'text', fallback: '', row: 'command-timing' },
          { key: 'triggerCondition', label: '触发条件', type: 'text', fallback: '', row: 'command-timing' }
        ]
      },
      {
        label: '模拟信号配置',
        domains: ['analog'],
        fields: [
          { key: 'analogKind', label: '模拟类型', type: 'select', options: ['voltage', 'current', 'sensor', 'control', 'generic'], fallback: 'generic', row: 'analog-kind' },
          { key: 'waveType', label: '波形', type: 'select', options: ['正弦', '阶跃', '常值', 'sine', 'step', 'constant', 'ramp', 'noise'], fallback: '正弦', row: 'analog-kind' },
          { key: 'outputFormat', label: '输出格式', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'analog-format' },
          { key: 'amplitude', label: '幅值', type: 'text', fallback: '1.0', row: 'analog-basic', waveTypes: ['sine'] },
          { key: 'frequency', label: '频率 (Hz)', type: 'text', fallback: '1.0', row: 'analog-basic', waveTypes: ['sine'] },
          { key: 'phase', label: '相位 (°)', type: 'text', fallback: '0', row: 'analog-phase', waveTypes: ['sine'] },
          { key: 'offset', label: '偏置', type: 'text', fallback: '0', row: 'analog-phase', waveTypes: ['sine', 'noise'] },
          { key: 'initialValue', label: '初始值', type: 'text', fallback: '0', row: 'analog-step', waveTypes: ['step', 'ramp'] },
          { key: 'finalValue', label: '终值', type: 'text', fallback: '1.0', row: 'analog-step', waveTypes: ['step'] },
          { key: 'stepTime', label: '跃变时刻 (s)', type: 'text', fallback: '1.0', row: 'analog-step-time', waveTypes: ['step'] },
          { key: 'amplitude', label: '常值', type: 'text', fallback: '1.0', row: 'analog-constant', waveTypes: ['constant'] },
          { key: 'slope', label: '斜率 (单位/s)', type: 'text', fallback: '1.0', row: 'analog-ramp', waveTypes: ['ramp'] },
          { key: 'startTime', label: '开始时刻 (s)', type: 'text', fallback: '0', row: 'analog-ramp', waveTypes: ['ramp'] },
          { key: 'amplitude', label: '噪声标准差', type: 'text', fallback: '1.0', row: 'analog-noise', waveTypes: ['noise'] },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '', row: 'analog-rate' },
          { key: 'minValue', label: '下限', type: 'text', fallback: '', row: 'analog-limit' },
          { key: 'maxValue', label: '上限', type: 'text', fallback: '', row: 'analog-limit' }
        ]
      },
      {
        label: '射频信号配置',
        domains: ['rf'],
        fields: [
          { key: 'centerFrequencyUnit', label: '\u9891\u7387\u5355\u4f4d', type: 'select', options: ['Hz', 'kHz', 'MHz', 'GHz'], fallback: 'GHz', row: 'rf-frequency', order: 2 },
          { key: 'rfKind', label: '射频类型', type: 'select', options: RF_KIND_OPTIONS, fallback: 'communication', row: 'rf-kind' },
          { key: 'centerFrequency', label: '中心频率', type: 'text', fallback: '', row: 'rf-frequency' },
          { key: 'power', label: '功率', type: 'text', fallback: '', row: 'rf-power' },
          { key: 'powerUnit', label: '功率单位', type: 'select', options: ['dBm', 'W', 'mW'], fallback: 'dBm', row: 'rf-power' },
          { key: 'modulation', label: '调制方式', type: 'select', options: RF_MODULATION_OPTIONS, fallback: 'cw', row: 'rf-modulation' },
          { key: 'modulationDepth', label: '调制度 (%)', type: 'text', fallback: '', row: 'rf-modulation-parameter', rfModulations: ['am'] },
          { key: 'frequencyDeviation', label: '频偏', type: 'text', fallback: '', row: 'rf-modulation-parameter', rfModulations: ['fm'] },
          { key: 'phaseDeviation', label: '相偏 (°)', type: 'text', fallback: '', row: 'rf-modulation-parameter', rfModulations: ['pm'] },
          { key: 'modulationRate', label: '调制频率', type: 'text', fallback: '', row: 'rf-modulation-rate', rfModulations: ['am', 'fm', 'pm'] },
          { key: 'pulseWidth', label: '脉宽', type: 'text', fallback: '', row: 'rf-pulse', rfModulations: ['pulse'] },
          { key: 'prf', label: 'PRF', type: 'text', fallback: '', row: 'rf-pulse', rfModulations: ['pulse'] },
          { key: 'bandwidth', label: '带宽', type: 'text', fallback: '', row: 'rf-digital', rfModulations: ['digital', 'noise'] },
          { key: 'symbolRate', label: '符号率', type: 'text', fallback: '', row: 'rf-digital', rfModulations: ['digital'] },
          { key: 'sampleRate', label: '基带采样率', type: 'text', fallback: '', row: 'rf-quality', rfModulations: ['digital'] },
          { key: 'snr', label: '信噪比', type: 'text', fallback: '', row: 'rf-quality', rfModulations: ['noise'] }
        ]
      }
    ]
  },
  flow_block: {
    type: 'flow_block',
    groups: [
      {
        label: '信号适配配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '信号适配块' },
          { key: 'inputName', label: '输入名称', type: 'text', fallback: '输入信号', row: 'flow-input' },
          { key: 'inputFormat', label: '输入格式', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'flow-input' },
          { key: 'outputName', label: '输出名称', type: 'text', fallback: '输出信号', row: 'flow-output' },
          { key: 'outputFormat', label: '输出格式', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'flow-output' }
        ]
      }
    ]
  },
  gain_block: {
    type: 'gain_block',
    groups: [
      {
        label: '增益配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '增益块' },
          { key: 'gain', label: '增益系数', type: 'text', fallback: '1.0' },
          { key: 'inputFormat', label: '输入类型', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'gain-formats' },
          { key: 'outputFormat', label: '输出类型', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'gain-formats' }
        ]
      }
    ]
  },
  sum_block: {
    type: 'sum_block',
    groups: [
      {
        label: '求和配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '求和块' },
          { key: 'inputCount', label: '输入数量', type: 'number', valueType: 'integer', min: 2, max: 6, fallback: 2, row: 'sum-inputs' },
          { key: 'signs', label: '符号序列', type: 'text', valueType: 'signs', fallback: ['+', '+'], inputCountKey: 'inputCount', row: 'sum-inputs' },
          { key: 'outputFormat', label: '输出类型', type: 'select', options: PORT_FORMATS, fallback: '标量' }
        ]
      }
    ]
  },
  mux_block: {
    type: 'mux_block',
    groups: [
      {
        label: 'Mux 配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '多路复用块' },
          { key: 'inputCount', label: '输入数量', type: 'number', valueType: 'integer', min: 2, max: 6, fallback: 2, row: 'mux-inputs' },
          { key: 'outputFormat', label: '输出类型', type: 'select', options: PORT_FORMATS, fallback: '向量', row: 'mux-inputs' }
        ]
      }
    ]
  },
  instrument_scope: {
    type: 'instrument_scope',
    groups: [
      {
        label: '示波器配置',
        help: '也可以双击画布中的示波器打开波形窗口；右侧按钮提供同一入口，避免操作反馈不明显。',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '示波器' },
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '示波器', row: 'instrument-config' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '64kHz', row: 'instrument-config' },
          { key: 'signal', label: '通道说明', type: 'text', fallback: 'CH1 / CH2' },
          { key: 'inputPortNameCh1', label: 'CH1 输入端口名称', type: 'text', fallback: 'CH1', row: 'scope-port-names' },
          { key: 'inputPortNameCh2', label: 'CH2 输入端口名称', type: 'text', fallback: 'CH2', row: 'scope-port-names' }
        ]
      }
    ]
  },
  instrument_spectrum: {
    type: 'instrument_spectrum',
    groups: [
      {
        label: '',
        fields: [
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '频谱分析' },
          { key: 'amplitudeUnit', label: '幅值单位', type: 'text', fallback: 'dB', row: 'spectrum-unit' },
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号', row: 'spectrum-unit' },
          { key: 'inputPortName', label: '输入端口名称', type: 'text', fallback: '观测输入' }
        ]
      }
    ]
  },
  instrument_logger: {
    type: 'instrument_logger',
    groups: [
      {
        label: '仪器配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '数据记录仪' },
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '数据记录' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '10Hz' },
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号' },
          { key: 'inputPortName', label: '输入端口名称', type: 'text', fallback: '观测输入' }
        ]
      }
    ]
  },
  instrument_multimeter: {
    type: 'instrument_multimeter',
    groups: [
      {
        label: '',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '数字万用表' },
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '数字万用表' }
        ]
      }
    ]
  }
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeTextValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeInteger(value, field) {
  const fallback = Number.isFinite(Number(field.fallback)) ? Number(field.fallback) : 0;
  const parsed = Number.parseInt(value, 10);
  const initial = Number.isFinite(parsed) ? parsed : fallback;
  const withMin = Number.isFinite(Number(field.min)) ? Math.max(Number(field.min), initial) : initial;
  return Number.isFinite(Number(field.max)) ? Math.min(Number(field.max), withMin) : withMin;
}

function normalizeSigns(value, inputCount = 2) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '').trim().includes(' ')
      ? String(value ?? '').trim().split(/\s+/)
      : String(value ?? '').match(/[+-]/g) || [];

  return Array.from({ length: inputCount }, (_, index) => (
    source[index] === '-' ? '-' : '+'
  ));
}

function normalizeMultimeterMeasurementMode(value) {
  const raw = String(value ?? '').trim();
  const aliases = {
    'DC Voltage': '直流电压',
    'AC Voltage': '交流电压',
    'DC Current': '直流电流',
    'AC Current': '交流电流',
    Resistance: '电阻',
    Continuity: '通断'
  };
  return aliases[raw] || raw || '直流电压';
}

function getFieldValue(node, field) {
  const raw = node?.props?.[field.key];
  if (field.valueType === 'signs') {
    return normalizeSigns(raw ?? field.fallback, node?.props?.[field.inputCountKey] ?? 2).join(' ');
  }
  if (field.key === 'waveType') {
    const value = raw ?? field.fallback ?? '';
    return WAVE_TYPE_ALIASES[value] || value;
  }
  if (field.key === 'measurementMode') {
    return normalizeMultimeterMeasurementMode(raw ?? field.fallback);
  }
  if (field.key === 'centerFrequency') {
    return String(raw ?? field.fallback ?? '').replace(/\s*(?:GHz|MHz|kHz|Hz)\s*$/i, '');
  }
  if (field.key === 'centerFrequencyUnit') {
    const legacyUnit = String(node?.props?.centerFrequency ?? '').match(/(?:GHz|MHz|kHz|Hz)\s*$/i)?.[0]?.trim();
    return legacyUnit ?? raw ?? field.fallback ?? '';
  }
  return raw ?? field.fallback ?? '';
}

function buildSelectOptions(options, selected, helper) {
  if (typeof helper === 'function') {
    return helper(options, selected);
  }

  return options.map((option) => {
    const optionValue = typeof option === 'object' ? String(option.value) : String(option);
    const optionLabel = typeof option === 'object' ? String(option.label) : optionValue;
    const isSelected = optionValue === String(selected);
    return `<option value="${escapeHtml(optionValue)}"${isSelected ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
}

function splitDigitalGearValues(value) {
  return String(value ?? '')
    .split(/[,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDigitalGearValues(props = {}) {
  if (props.digitalMode === 'enum') {
    const values = splitDigitalGearValues(props.enumValues);
    return values.length ? values : ['0', '1'];
  }
  return [
    String(props.lowLevel ?? '0'),
    String(props.highLevel ?? '1')
  ];
}

function numberOrFallback(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getDigitalGenericBounds(props = {}) {
  const rawMin = numberOrFallback(props.minValue, 0);
  const rawMax = numberOrFallback(props.maxValue, 100);
  return {
    min: Math.min(rawMin, rawMax),
    max: Math.max(rawMin, rawMax)
  };
}

function clampNumber(value, min, max) {
  const numeric = numberOrFallback(value, min);
  return Math.min(max, Math.max(min, numeric));
}

function getDigitalGearIndex(value, gears) {
  const index = gears.findIndex((gear) => String(gear) === String(value));
  return index >= 0 ? index : 0;
}

function renderDigitalCurrentValueField(node, field, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props ?? {};
  if (props.digitalMode === 'generic') {
    const { min, max } = getDigitalGenericBounds(props);
    const currentValue = String(clampNumber(getFieldValue(node, field), min, max));
    return `
    <div class="digital-current-control" data-digital-current-control>
      <div class="digital-current-control__row">
        <input id="prop-initialState-slider" class="digital-current-control__slider" data-digital-current-slider type="range" min="${escape(min)}" max="${escape(max)}" step="1" value="${escape(currentValue)}">
        <input id="prop-initialState" class="digital-current-control__value" data-digital-current-value value="${escape(currentValue)}">
      </div>
    </div>`;
  }

  const gears = getDigitalGearValues(props);
  const currentValue = String(getFieldValue(node, field) || gears[0] || '0');
  const selectedIndex = getDigitalGearIndex(currentValue, gears);
  const max = Math.max(gears.length - 1, 0);

  return `
    <div class="digital-current-control" data-digital-current-control>
      <div class="digital-current-control__row">
        <input id="prop-initialState-slider" class="digital-current-control__slider" data-digital-current-slider type="range" min="0" max="${escape(max)}" step="1" value="${escape(selectedIndex)}">
        <input id="prop-initialState" class="digital-current-control__value" data-digital-current-value value="${escape(currentValue)}">
      </div>
    </div>`;
}

function renderDigitalGearConfigField(node, field, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props ?? {};

  if (props.digitalMode === 'generic') {
    return `
    <div class="digital-gear-config digital-gear-config--generic" data-digital-gear-config>
      <input id="prop-enumValues" type="hidden" value="${escape(props.enumValues ?? '')}">
      <input id="prop-lowLevel" type="hidden" value="${escape(props.lowLevel ?? '0')}">
      <input id="prop-highLevel" type="hidden" value="${escape(props.highLevel ?? '1')}">
      <div class="digital-gear-row" data-digital-generic-bound-row>
        <span class="digital-gear-row__index">最低</span>
        <input id="prop-minValue" data-digital-generic-bound="min" value="${escape(props.minValue ?? '0')}" aria-label="最低值">
      </div>
      <div class="digital-gear-row" data-digital-generic-bound-row>
        <span class="digital-gear-row__index">最高</span>
        <input id="prop-maxValue" data-digital-generic-bound="max" value="${escape(props.maxValue ?? '100')}" aria-label="最高值">
      </div>
    </div>`;
  }

  if (props.digitalMode === 'enum') {
    const gears = getDigitalGearValues(props);
    const rows = gears.map((gear, index) => `
      <div class="digital-gear-row" data-digital-gear-row>
        <span class="digital-gear-row__index">${index + 1}</span>
        <input data-digital-gear-value value="${escape(gear)}" aria-label="枚举挡位 ${index + 1}">
        <button type="button" class="digital-gear-row__delete" data-digital-gear-delete aria-label="删除挡位">删除</button>
      </div>
    `).join('');
    return `
      <div class="digital-gear-config" data-digital-gear-config>
        <input id="prop-enumValues" type="hidden" value="${escape(gears.join(','))}">
        <input id="prop-lowLevel" type="hidden" value="${escape(props.lowLevel ?? '0')}">
        <input id="prop-highLevel" type="hidden" value="${escape(props.highLevel ?? '1')}">
        <div class="digital-gear-list" data-digital-gear-list>${rows}</div>
        <button type="button" class="props-secondary digital-gear-add" data-digital-gear-add>添加挡位</button>
      </div>`;
  }

  return `
    <div class="digital-gear-config" data-digital-gear-config>
      <input id="prop-enumValues" type="hidden" value="${escape(props.enumValues ?? '')}">
      <div class="digital-gear-row" data-digital-gear-row>
        <span class="digital-gear-row__index">低</span>
        <input id="prop-lowLevel" data-digital-fixed-gear="low" value="${escape(props.lowLevel ?? '0')}" aria-label="低挡位">
      </div>
      <div class="digital-gear-row" data-digital-gear-row>
        <span class="digital-gear-row__index">高</span>
        <input id="prop-highLevel" data-digital-fixed-gear="high" value="${escape(props.highLevel ?? '1')}" aria-label="高挡位">
      </div>
    </div>`;
}

function renderField(node, field, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const id = `prop-${field.key}`;
  const value = getFieldValue(node, field);
  const label = field.key === 'phase'
    ? '\u76f8\u4f4d (rad)'
    : field.key === 'phaseDeviation'
      ? '\u76f8\u504f (rad)'
      : field.label;

  if (field.type === 'digitalCurrentValue') {
    return renderDigitalCurrentValueField(node, field, helpers);
  }

  if (field.type === 'digitalGearConfig') {
    return renderDigitalGearConfigField(node, field, helpers);
  }

  if (field.type === 'select') {
    const fieldOptions = SELECT_OPTION_OVERRIDES[field.key] || field.options || [];
    const options = buildSelectOptions(fieldOptions, value, helpers.buildSelectOptions);
    return `<div class="props-field"><label>${escape(label)}</label><select id="${id}">${options}</select></div>`;
  }

  if (field.type === 'number') {
    const min = field.min == null ? '' : ` min="${escape(field.min)}"`;
    const max = field.max == null ? '' : ` max="${escape(field.max)}"`;
    return `<div class="props-field"><label>${escape(label)}</label><input id="${id}" type="number"${min}${max} value="${escape(value)}"></div>`;
  }

  if (field.type === 'readonly') {
    return `<div class="props-field"><label>${escape(label)}</label><input value="${escape(value)}" disabled></div>`;
  }

  return `<div class="props-field"><label>${escape(label)}</label><input id="${id}" value="${escape(value)}"></div>`;
}

function renderFieldsInRows(node, fields, helpers) {
  const waveType = WAVE_TYPE_ALIASES[node?.props?.waveType] || node?.props?.waveType || 'sine';
  const rfModulation = node?.props?.modulation || 'cw';
  const visibleFields = fields.filter((field) => (
    (!field.waveTypes || field.waveTypes.includes(waveType))
    && (!field.rfModulations || field.rfModulations.includes(rfModulation))
  ));
  const rows = [];
  const consumed = new Set();

  visibleFields.forEach((field, index) => {
    if (!field.row || consumed.has(index)) {
      return;
    }

    const rowFields = visibleFields
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => candidate.row === field.row)
      .sort(({ candidate: left }, { candidate: right }) => (left.order ?? 0) - (right.order ?? 0));

    rowFields.forEach(({ candidateIndex }) => consumed.add(candidateIndex));
    rows.push(`<div class="props-row">${rowFields.map(({ candidate }) => renderField(node, candidate, helpers)).join('')}</div>`);
  });

  visibleFields.forEach((field, index) => {
    if (!consumed.has(index)) {
      rows.push(renderField(node, field, helpers));
    }
  });

  return rows.join('');
}

function getEditableFieldsForSchema(schema, group) {
  const fields = group.fields || [];
  if (schema?.type !== 'signal_source') {
    return fields;
  }
  return fields.filter((field) => field.key !== 'signalDomain');
}

function isSchemaGroupInPlacement(group, placement) {
  return (group.placement || 'parameters') === placement;
}

export function getComponentPropertySchema(type) {
  const schema = PROPERTY_SCHEMAS[type];
  return schema ? deepClone(schema) : null;
}

export function renderPropertyFieldsFromSchema(node, schema, helpers = {}) {
  if (!schema?.groups?.length) {
    return '';
  }

  const escape = helpers.escapeHtml || escapeHtml;
  const nodeForRender = schema.type === 'signal_source'
    ? { ...node, props: normalizeSignalSourceProps(node?.props ?? {}) }
    : node;
  const domain = nodeForRender?.props?.signalDomain;

  return schema.groups
    .filter((group) => isSchemaGroupInPlacement(group, 'parameters'))
    .filter((group) => !group.domains || group.domains.includes(domain)).map((group) => `
      <div class="pgroup">
        ${group.label ? `<div class="pglbl">${escape(group.label)}</div>` : ''}
        ${renderFieldsInRows(nodeForRender, getEditableFieldsForSchema(schema, group), helpers)}
        ${group.help ? `<div class="props-help">${escape(group.help)}</div>` : ''}
      </div>`).join('');
}

export function renderPropertyOverviewFieldsFromSchema(node, schema, helpers = {}) {
  if (!schema?.groups?.length) {
    return '';
  }

  const escape = helpers.escapeHtml || escapeHtml;
  const nodeForRender = schema.type === 'signal_source'
    ? { ...node, props: normalizeSignalSourceProps(node?.props ?? {}) }
    : node;
  const domain = nodeForRender?.props?.signalDomain;

  return schema.groups
    .filter((group) => isSchemaGroupInPlacement(group, 'overview'))
    .filter((group) => !group.domains || group.domains.includes(domain)).map((group) => `
      <div class="pgroup">
        ${group.label ? `<div class="pglbl">${escape(group.label)}</div>` : ''}
        ${renderFieldsInRows(nodeForRender, getEditableFieldsForSchema(schema, group), helpers)}
        ${group.help ? `<div class="props-help">${escape(group.help)}</div>` : ''}
      </div>`).join('');
}

export function readPropertyValuesFromSchema(schema, documentLike) {
  if (!schema?.groups?.length || !documentLike) {
    return null;
  }

  const values = {};
  const fields = schema.groups.flatMap((group) => getEditableFieldsForSchema(schema, group));

  fields.forEach((field) => {
    if (field.type === 'readonly') {
      return;
    }

    if (field.type === 'digitalGearConfig') {
      const lowLevel = documentLike.getElementById('prop-lowLevel');
      const highLevel = documentLike.getElementById('prop-highLevel');
      const enumValues = documentLike.getElementById('prop-enumValues');
      const minValue = documentLike.getElementById('prop-minValue');
      const maxValue = documentLike.getElementById('prop-maxValue');
      if (lowLevel) {
        values.lowLevel = normalizeTextValue(lowLevel.value, '0');
      }
      if (highLevel) {
        values.highLevel = normalizeTextValue(highLevel.value, '1');
      }
      if (enumValues) {
        values.enumValues = normalizeTextValue(enumValues.value, '');
      }
      if (minValue) {
        values.minValue = normalizeTextValue(minValue.value, '0');
      }
      if (maxValue) {
        values.maxValue = normalizeTextValue(maxValue.value, '100');
      }
      return;
    }

    const element = documentLike.getElementById(`prop-${field.key}`);
    if (!element) {
      return;
    }

    if (field.valueType === 'integer') {
      values[field.key] = normalizeInteger(element.value, field);
      return;
    }

    if (field.valueType === 'signs') {
      const inputCount = values[field.inputCountKey] ?? field.fallback?.length ?? 2;
      values[field.key] = normalizeSigns(element.value, inputCount);
      return;
    }

    if (field.type === 'select') {
      values[field.key] = element.value || field.fallback || '';
      return;
    }

    values[field.key] = normalizeTextValue(element.value, field.fallback ?? '');
  });

  return values;
}
