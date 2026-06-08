const PORT_FORMATS = ['标量', '向量', '矩阵', '布尔', '事件'];
const SIGNAL_WAVE_TYPES = ['正弦', '阶跃', '常值'];

const PROPERTY_SCHEMAS = {
  signal_source: {
    type: 'signal_source',
    groups: [
      {
        label: '信号定义',
        help: '信号源用于提供系统建模和仿真的输入激励，可直接连接到流程块、仿真块或示波器。',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '信号源' },
          { key: 'waveType', label: '信号类型', type: 'select', options: SIGNAL_WAVE_TYPES, fallback: '正弦', row: 'signal-kind' },
          { key: 'outputFormat', label: '输出格式', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'signal-kind' },
          { key: 'amplitude', label: '幅值', type: 'text', fallback: '1.0', row: 'signal-params' },
          { key: 'frequency', label: '频率 / 周期', type: 'text', fallback: '1.0', row: 'signal-params' }
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
        label: '仪器配置',
        fields: [
          { key: 'name', label: '模块名称', type: 'text', fallback: '频谱分析仪' },
          { key: 'instrumentType', label: '仪器类型', type: 'readonly', fallback: '频谱分析' },
          { key: 'sampleRate', label: '采样率', type: 'text', fallback: '10Hz' },
          { key: 'signal', label: '观测信号', type: 'text', fallback: '输入信号' }
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

function getFieldValue(node, field) {
  const raw = node?.props?.[field.key];
  if (field.valueType === 'signs') {
    return normalizeSigns(raw ?? field.fallback, node?.props?.[field.inputCountKey] ?? 2).join(' ');
  }
  return raw ?? field.fallback ?? '';
}

function buildSelectOptions(options, selected, helper) {
  if (typeof helper === 'function') {
    return helper(options, selected);
  }

  return options.map((option) => {
    const optionText = String(option);
    const isSelected = optionText === String(selected);
    return `<option value="${escapeHtml(optionText)}"${isSelected ? ' selected' : ''}>${escapeHtml(optionText)}</option>`;
  }).join('');
}

function renderField(node, field, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const id = `prop-${field.key}`;
  const value = getFieldValue(node, field);

  if (field.type === 'select') {
    const options = buildSelectOptions(field.options || [], value, helpers.buildSelectOptions);
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

export function getComponentPropertySchema(type) {
  const schema = PROPERTY_SCHEMAS[type];
  return schema ? deepClone(schema) : null;
}

export function renderPropertyFieldsFromSchema(node, schema, helpers = {}) {
  if (!schema?.groups?.length) {
    return '';
  }

  const escape = helpers.escapeHtml || escapeHtml;
  return schema.groups.map((group) => `
      <div class="pgroup">
        <div class="pglbl">${escape(group.label)}</div>
        ${renderFieldsInRows(node, group.fields || [], helpers)}
        ${group.help ? `<div class="props-help">${escape(group.help)}</div>` : ''}
      </div>`).join('');
}

export function readPropertyValuesFromSchema(schema, documentLike) {
  if (!schema?.groups?.length || !documentLike) {
    return null;
  }

  const values = {};
  const fields = schema.groups.flatMap((group) => group.fields || []);

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
