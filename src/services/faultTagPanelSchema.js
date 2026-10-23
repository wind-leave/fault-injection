const LAYER_LABELS = {
  physical: '物理层',
  electrical: '电气层',
  protocol: '协议层'
};

const RUNTIME_LABELS = {
  gaussian_noise: '独立高斯噪声',
  uniform_white_noise: '均匀分布白噪声',
  gaussian_colored_noise: '高斯有色噪声',
  bias: '偏差故障',
  stuck: '卡死故障',
  freeze: '卡死故障',
  tamper: '数据篡改',
  delay: '延迟故障',
  dropout: '丢包故障',
  stale: '旧值重放',
  overwrite: '覆盖写入'
};

const PARAMETER_LABELS = {
  mean: '噪声均值',
  alpha: '相关系数 α',
  scale: '篡改倍率',
  bias: '偏置值',
  value: '故障值',
  start: '开始时间',
  duration: '持续时间',
  mode: '写入方式',
  drop_rate: '丢包率',
  delay: '延迟时间',
  delay_steps: '延迟步数',
  seed: '随机种子',
  lock_value: '卡死值',
  offset: '偏置值',
  std: '标准差',
  period: '周期',
  duty: '占空比'
};

const COPY = {
  faultName: '\u6545\u969c\u540d\u79f0',
  applyName: '\u5e94\u7528\u540d\u79f0',
  cleanNameStatus: '\u540d\u79f0\u672a\u4fee\u6539',
  dirtyNameStatus: '\u6709\u672a\u5e94\u7528\u7684\u540d\u79f0\u4fee\u6539',
  overviewTitle: '绑定概览',
  parametersTitle: '故障参数',
  targetObject: '目标对象',
  targetParameter: '目标参数',
  targetType: '目标类型',
  runtimeBehavior: '运行行为',
  injected: '已注入',
  editParameters: '修改参数',
  reset: '取消修改',
  apply: '应用修改',
  cleanStatus: '参数未修改',
  emptyParameters: '该故障没有额外参数。',
  fallbackFaultName: '故障',
  fallbackLayer: '未指定层级',
  fallbackTargetParameter: '未关联',
  fallbackRuntime: '按故障库定义',
  injectedChannels: '\u6ce8\u5165\u8def\u6570'
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getEntries(parameters = {}) {
  return Object.entries(parameters || {});
}

export function getFaultTagLayerLabel(layer) {
  return LAYER_LABELS[layer] || layer || COPY.fallbackLayer;
}

export function getFaultTagRuntimeLabel(value) {
  return RUNTIME_LABELS[String(value)] || value || COPY.fallbackRuntime;
}

export function getFaultTagParameterLabel(key) {
  return PARAMETER_LABELS[key] || key;
}

function firstText(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
  return value === undefined ? '' : String(value);
}

export function getFaultTagTargetParameter(tag = {}) {
  return firstText(
    tag.bindingObject,
    tag.targetVariable,
    tag.targetField,
    tag.injectedFault?.bindingObject,
    tag.injectedFault?.targetVariable,
    tag.injectedFault?.targetField,
    tag.slotName,
    tag.slotId,
    COPY.fallbackTargetParameter
  );
}

export function getFaultTagInjectedChannels(tag = {}) {
  const source = tag.injectedFault ?? tag;
  const scope = String(tag.vectorInjectionScope ?? source.vectorInjectionScope ?? '').toLowerCase();
  const vectorElementNames = tag.vectorElementNames ?? source.vectorElementNames;
  const hasNamedElements = Array.isArray(vectorElementNames) && vectorElementNames.some((name) => String(name ?? '').trim());
  const labelForIndex = (index) => String(vectorElementNames?.[index] ?? '').trim() || `\u7b2c ${index + 1} \u8def`;
  if (scope === 'all') return '\u5168\u90e8\u8def';
  if (scope === 'item') {
    const index = Number(tag.vectorIndex ?? source.vectorIndex ?? 0);
    return Number.isInteger(index) && index >= 0 ? labelForIndex(index) : '';
  }
  const indices = tag.vectorIndices ?? source.vectorIndices;
  if (scope !== 'items' || !Array.isArray(indices)) return '';
  const selected = [...new Set(indices.map(Number).filter((index) => Number.isInteger(index) && index >= 0))]
    .sort((left, right) => left - right);
  if (!selected.length) return '';
  return hasNamedElements
    ? selected.map(labelForIndex).join('\u3001')
    : `\u7b2c ${selected.map((index) => index + 1).join('\u3001')} \u8def`;
}

function renderParameterPreviewRows(parameters = {}) {
  const params = getEntries(parameters);

  if (!params.length) {
    return `<div class="props-empty-inline">${escapeHtml(COPY.emptyParameters)}</div>`;
  }

  return params.map(([key, value]) => `
      <div class="fault-tag-param-preview__row">
        <span>${escapeHtml(getFaultTagParameterLabel(key))}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join('');
}

function renderParameterEditorRows(parameters = {}) {
  const params = getEntries(parameters);

  if (!params.length) {
    return `<div class="props-empty-inline">${escapeHtml(COPY.emptyParameters)}</div>`;
  }

  return params.map(([key, value]) => `
      <label class="fault-tag-param-row">
        <span>${escapeHtml(getFaultTagParameterLabel(key))}</span>
        <input value="${escapeHtml(value)}" data-fault-tag-param="${escapeHtml(key)}">
      </label>
    `).join('');
}

export function renderFaultTagOverviewPanel(options = {}) {
  const tag = options.tag || {};
  const parameters = options.parameters || tag.parameters || {};
  const layerLabel = options.layerLabel || getFaultTagLayerLabel(tag.layer);
  const runtimeValue = options.runtimeValue || tag.runtimeBehavior || tag.mathModel || tag.modelClass || '';
  const runtimeLabel = options.runtimeLabel || getFaultTagRuntimeLabel(runtimeValue);
  const targetName = options.targetName || tag.targetName || tag.targetId || '目标对象';
  const targetParameter = options.targetParameter || getFaultTagTargetParameter(tag);
  const injectedChannels = options.injectedChannels ?? getFaultTagInjectedChannels(tag);
  const targetKindLabel = options.targetKindLabel || (tag.targetKind === 'edge' ? '连接线' : '模块');

  return `
        <div class="pgroup fault-tag-inspector fault-tag-overview-panel" data-fault-tag-inspector="${escapeHtml(tag.id)}">
          <div class="pglbl">${escapeHtml(COPY.overviewTitle)}</div>
          <div class="fault-tag-name-editor" data-fault-tag-name-editor="${escapeHtml(tag.id)}">
            <label class="fault-tag-param-row">
              <span>${escapeHtml(COPY.faultName)}</span>
              <input value="${escapeHtml(tag.name || COPY.fallbackFaultName)}" data-fault-tag-name>
            </label>
            <div class="fault-tag-param-actions">
              <span data-fault-tag-name-status>${escapeHtml(COPY.cleanNameStatus)}</span>
              <div>
                <button type="button" class="props-secondary fault-tag-name-reset" data-fault-tag-name-reset disabled>${escapeHtml(COPY.reset)}</button>
                <button type="button" class="props-save fault-tag-name-apply" data-fault-tag-name-apply disabled>${escapeHtml(COPY.applyName)}</button>
              </div>
            </div>
          </div>
          <div class="fault-tag-binding-card">
            <div><span>${escapeHtml(COPY.targetObject)}</span><strong>${escapeHtml(targetName)}</strong></div>
            <div><span>${escapeHtml(COPY.targetParameter)}</span><strong>${escapeHtml(targetParameter)}</strong></div>
            ${injectedChannels ? `<div><span>${escapeHtml(COPY.injectedChannels)}</span><strong>${escapeHtml(injectedChannels)}</strong></div>` : ''}
            <div><span>${escapeHtml(COPY.targetType)}</span><strong>${escapeHtml(targetKindLabel)}</strong></div>
            <div><span>${escapeHtml(COPY.runtimeBehavior)}</span><strong>${escapeHtml(runtimeLabel)}</strong></div>
          </div>
        </div>
      `;
}

export function renderFaultTagParameterPanel(options = {}) {
  const tag = options.tag || {};
  const parameters = options.parameters || tag.parameters || {};
  const params = getEntries(parameters);
  const enabled = tag.runtimeEnabled ?? tag.injectedFault?.active ?? tag.injectedFault?.enabled ?? true;

  return `
        <div class="pgroup fault-tag-param-panel" data-fault-tag-param-panel="${escapeHtml(tag.id)}">
          <div class="pglbl">${escapeHtml(COPY.parametersTitle)}</div>
          <label class="fault-tag-param-row">
            <span>是否启用</span>
            <select data-fault-tag-enabled aria-label="是否启用">
              <option value="true"${enabled ? ' selected' : ''}>启用</option>
              <option value="false"${enabled ? '' : ' selected'}>禁用</option>
            </select>
          </label>
          ${renderParameterEditorRows(parameters)}
          ${params.length ? `
            <div class="fault-tag-param-actions">
              <span data-fault-tag-param-status>${escapeHtml(COPY.cleanStatus)}</span>
              <div>
                <button type="button" class="props-secondary fault-tag-param-reset" data-fault-tag-reset disabled>${escapeHtml(COPY.reset)}</button>
                <button type="button" class="props-save fault-tag-param-apply" data-fault-tag-apply disabled>${escapeHtml(COPY.apply)}</button>
              </div>
            </div>
          ` : ''}
        </div>
      `;
}

export function readFaultTagParameterDraftFromPanel(host) {
  const draft = {};
  host?.querySelectorAll?.('[data-fault-tag-param]')?.forEach((input) => {
    const key = input.getAttribute('data-fault-tag-param');
    if (key) {
      draft[key] = input.value;
    }
  });
  return draft;
}
