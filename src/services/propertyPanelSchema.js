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
  常值: 'constant'
};

const DIGITAL_MODE_OPTIONS = [
  { value: 'boolean', label: '布尔量' },
  { value: 'level', label: '电平信号' },
  { value: 'pulse', label: '脉冲信号' },
  { value: 'enum', label: '枚举状态' }
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
        label: '数字信号配置',
        domains: ['digital'],
        fields: [
          { key: 'digitalMode', label: '数字模式', type: 'select', options: ['boolean', 'level', 'pulse', 'enum'], fallback: 'boolean', row: 'digital-mode' },
          { key: 'initialState', label: '初始状态', type: 'text', fallback: '0', row: 'digital-mode' },
          { key: 'highLevel', label: '高电平', type: 'text', fallback: '1', row: 'digital-level' },
          { key: 'lowLevel', label: '低电平', type: 'text', fallback: '0', row: 'digital-level' },
          { key: 'pulseWidth', label: '脉宽', type: 'text', fallback: '', row: 'digital-pulse' },
          { key: 'period', label: '周期', type: 'text', fallback: '', row: 'digital-pulse' },
          { key: 'dutyCycle', label: '占空比', type: 'text', fallback: '', row: 'digital-duty' },
          { key: 'enumValues', label: '枚举值', type: 'text', fallback: '', row: 'digital-duty' }
        ]
      },
      {
        label: '指令信号配置',
        domains: ['command'],
        fields: [
          { key: 'commandType', label: '指令类型', type: 'select', options: ['control', 'bus-message', 'task', 'mode'], fallback: 'control', row: 'command-type' },
          { key: 'commandName', label: '指令名称', type: 'text', fallback: '', row: 'command-type' },
          { key: 'protocol', label: '协议', type: 'text', fallback: 'CAN', row: 'command-protocol' },
          { key: 'messageId', label: '报文 ID', type: 'text', fallback: '', row: 'command-protocol' },
          { key: 'payloadKind', label: '载荷类型', type: 'text', fallback: 'float32', row: 'command-payload' },
          { key: 'payloadValue', label: '载荷数值', type: 'text', fallback: '', row: 'command-payload' },
          { key: 'payloadSchema', label: '载荷结构', type: 'text', fallback: '', row: 'command-schema' },
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
          { key: 'amplitude', label: '幅值', type: 'text', fallback: '1.0', row: 'analog-basic' },
          { key: 'frequency', label: '频率 / 周期', type: 'text', fallback: '1.0', row: 'analog-basic' },
          { key: 'phase', label: '相位', type: 'text', fallback: '0', row: 'analog-phase' },
          { key: 'offset', label: '偏置', type: 'text', fallback: '0', row: 'analog-phase' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '', row: 'analog-rate' },
          { key: 'minValue', label: '下限', type: 'text', fallback: '', row: 'analog-limit' },
          { key: 'maxValue', label: '上限', type: 'text', fallback: '', row: 'analog-limit' }
        ]
      },
      {
        label: '射频信号配置',
        domains: ['rf'],
        fields: [
          { key: 'rfKind', label: '射频类型', type: 'select', options: ['communication', 'radar', 'navigation', 'jamming', 'generic'], fallback: 'communication', row: 'rf-kind' },
          { key: 'centerFrequency', label: '中心频率', type: 'text', fallback: '', row: 'rf-frequency' },
          { key: 'bandwidth', label: '带宽', type: 'text', fallback: '', row: 'rf-frequency' },
          { key: 'power', label: '功率', type: 'text', fallback: '', row: 'rf-power' },
          { key: 'powerUnit', label: '功率单位', type: 'select', options: ['dBm', 'W', 'mW'], fallback: 'dBm', row: 'rf-power' },
          { key: 'modulation', label: '调制方式', type: 'text', fallback: '', row: 'rf-modulation' },
          { key: 'phase', label: '相位', type: 'text', fallback: '', row: 'rf-modulation' },
          { key: 'snr', label: '信噪比', type: 'text', fallback: '', row: 'rf-quality' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '', row: 'rf-quality' },
          { key: 'pulseWidth', label: '脉宽', type: 'text', fallback: '', row: 'rf-pulse' },
          { key: 'prf', label: 'PRF', type: 'text', fallback: '', row: 'rf-pulse' },
          { key: 'channel', label: '信道', type: 'text', fallback: '', row: 'rf-extra' },
          { key: 'polarization', label: '极化', type: 'text', fallback: '', row: 'rf-extra' },
          { key: 'rfProfile', label: 'RF 配置', type: 'text', fallback: '', row: 'rf-profile' }
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
          { key: 'signal', label: '通道说明', type: 'text', fallback: 'CH1 / CH2' }
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
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '32kHz', row: 'spectrum-sampling' },
          { key: 'frequencyRange', label: '频率范围', type: 'text', fallback: '0-16kHz', row: 'spectrum-sampling' },
          { key: 'fftSize', label: 'FFT 点数', type: 'text', fallback: '1024', row: 'spectrum-analysis' },
          { key: 'windowFunction', label: '窗函数', type: 'text', fallback: 'Hann', row: 'spectrum-analysis' },
          { key: 'amplitudeUnit', label: '幅值单位', type: 'text', fallback: 'dB', row: 'spectrum-unit' },
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号', row: 'spectrum-unit' }
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
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号' }
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
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '数字万用表' },
          { key: 'measurementMode', label: '测量模式', type: 'select', options: MULTIMETER_MODE_OPTIONS, fallback: '直流电压', row: 'meter-mode' },
          { key: 'range', label: '量程', type: 'text', fallback: 'Auto', row: 'meter-mode' },
          { key: 'refreshRate', label: '刷新率', type: 'text', fallback: '5Hz', row: 'meter-rate' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '5Hz', row: 'meter-rate' },
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号' }
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

function renderField(node, field, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const id = `prop-${field.key}`;
  const value = getFieldValue(node, field);

  if (field.type === 'select') {
    const fieldOptions = SELECT_OPTION_OVERRIDES[field.key] || field.options || [];
    const options = buildSelectOptions(fieldOptions, value, helpers.buildSelectOptions);
    return `<div class="props-field"><label>${escape(field.label)}</label><select id="${id}">${options}</select></div>`;
  }

  if (field.type === 'number') {
    const min = field.min == null ? '' : ` min="${escape(field.min)}"`;
    const max = field.max == null ? '' : ` max="${escape(field.max)}"`;
    return `<div class="props-field"><label>${escape(field.label)}</label><input id="${id}" type="number"${min}${max} value="${escape(value)}"></div>`;
  }

  if (field.type === 'readonly') {
    return `<div class="props-field"><label>${escape(field.label)}</label><input value="${escape(value)}" disabled></div>`;
  }

  return `<div class="props-field"><label>${escape(field.label)}</label><input id="${id}" value="${escape(value)}"></div>`;
}

function renderFieldsInRows(node, fields, helpers) {
  const rows = [];
  const consumed = new Set();

  fields.forEach((field, index) => {
    if (!field.row || consumed.has(index)) {
      return;
    }

    const rowFields = fields
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => candidate.row === field.row);

    rowFields.forEach(({ candidateIndex }) => consumed.add(candidateIndex));
    rows.push(`<div class="props-row">${rowFields.map(({ candidate }) => renderField(node, candidate, helpers)).join('')}</div>`);
  });

  fields.forEach((field, index) => {
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

  return schema.groups.filter((group) => !group.domains || group.domains.includes(domain)).map((group) => `
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
