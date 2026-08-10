const FAULT_PARAMETER_LABELS = {
  value: '注入值',
  bias: '偏置值',
  std: '噪声标准差',
  seed: '随机种子',
  start: '开始时间',
  duration: '持续时间',
  mode: '写入方式',
  rate: '漂移速率',
  step: '突变量',
  scale: '衰减系数',
  attenuation_db: '衰减量 (dB)',
  attenuationDb: '衰减量 (dB)',
  delay_steps: '延迟步数',
  delay_seconds: '延迟时间',
  drop_rate: '丢包率',
  dropRate: '丢包率',
  loss_rate: '丢包率',
  noise_type: '噪声类型',
  probability: '发生概率',
  amplitude: '幅值',
  frequency: '频率',
  threshold: '阈值',
  hold_value: '保持值',
  fault_value: '故障值'
};

const FAULT_PARAMETER_CHOICES = {
  mode: [
    { value: 'overwrite', label: '覆盖写入' },
    { value: 'add', label: '叠加' },
    { value: 'multiply', label: '倍率调整' },
    { value: 'zero', label: '置零卡住' },
    { value: 'hold', label: '保持原值' }
  ],
  noise_type: [
    { value: 'gaussian', label: '高斯噪声' },
    { value: 'uniform', label: '均匀噪声' },
    { value: 'impulse', label: '脉冲噪声' }
  ]
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getFaultParameterLabel(key) {
  return FAULT_PARAMETER_LABELS[key] || key;
}

export function getFaultParameterChoices(key) {
  return FAULT_PARAMETER_CHOICES[key] || [];
}

export function getFaultParameterChoiceLabel(key, value) {
  const match = getFaultParameterChoices(key).find((option) => String(option.value) === String(value));
  return match?.label || String(value ?? '');
}

export function renderFaultParameterControl(key, value, dataAttributeName = 'data-fault-param') {
  const attrName = String(dataAttributeName || 'data-fault-param');
  const attrValue = escapeHtml(key);
  const choices = getFaultParameterChoices(key);

  if (choices.length) {
    const selected = choices.some((option) => String(option.value) === String(value))
      ? String(value)
      : String(choices[0].value);
    const label = getFaultParameterChoiceLabel(key, selected);

    return `
      <details class="fault-param-dropdown" data-fault-param-dropdown="${escapeHtml(key)}">
        <summary>
          <span data-fault-param-choice-label>${escapeHtml(label)}</span>
          <span class="fault-param-dropdown__caret">⌄</span>
        </summary>
        <div class="fault-param-dropdown__menu">
          ${choices.map((option) => `
            <button type="button" data-fault-param-choice data-fault-param-choice-value="${escapeHtml(option.value)}" aria-selected="${String(option.value) === selected ? 'true' : 'false'}">${escapeHtml(option.label)}</button>
          `).join('')}
        </div>
        <input type="hidden" ${attrName}="${attrValue}" value="${escapeHtml(selected)}">
      </details>
    `;
  }

  return `<input ${attrName}="${attrValue}" value="${escapeHtml(value)}" aria-label="${escapeHtml(getFaultParameterLabel(key))}">`;
}

export function renderFaultParameterRows(parameters = {}, options = {}) {
  const dataAttributeName = options.dataAttributeName || 'data-fault-param';
  const rowClassName = options.rowClassName || 'target-fault-param-row';
  const emptyHtml = options.emptyHtml || '<div class="target-fault-param-empty">No parameters</div>';
  const entries = Object.entries(parameters || {});

  if (!entries.length) {
    return emptyHtml;
  }

  return entries.map(([key, value]) => `
      <label class="${escapeHtml(rowClassName)}">
        <span>${escapeHtml(getFaultParameterLabel(key))}</span>
        ${renderFaultParameterControl(key, value, dataAttributeName)}
      </label>`).join('');
}

export function readFaultParameterValuesFromPanel(host, dataAttributeName = 'data-fault-param') {
  const draft = {};
  host?.querySelectorAll?.(`[${dataAttributeName}]`)?.forEach((input) => {
    const key = input.getAttribute(dataAttributeName);
    if (key) {
      draft[key] = input.value;
    }
  });
  return draft;
}
