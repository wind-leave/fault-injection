const LAYER_LABELS = {
  physical: '物理层',
  electrical: '电气层',
  protocol: '协议层'
};

const RUNTIME_LABELS = {
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
  fallbackRuntime: '按故障库定义'
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
  const targetKindLabel = options.targetKindLabel || (tag.targetKind === 'edge' ? '连接线' : '模块');

  return `
        <div class="pgroup fault-tag-inspector fault-tag-overview-panel" data-fault-tag-inspector="${escapeHtml(tag.id)}">
          <div class="pglbl">${escapeHtml(COPY.overviewTitle)}</div>
          <div class="props-fault-card">
            <div class="props-fault-card__top">
              <div>
                <strong>${escapeHtml(tag.name || COPY.fallbackFaultName)}</strong>
                <span>${escapeHtml(runtimeLabel)} · ${escapeHtml(layerLabel)}</span>
              </div>
              <span class="props-state-pill is-faulted">${escapeHtml(COPY.injected)}</span>
            </div>
          </div>
          <div class="fault-tag-binding-card">
            <div><span>${escapeHtml(COPY.targetObject)}</span><strong>${escapeHtml(targetName)}</strong></div>
            <div><span>${escapeHtml(COPY.targetParameter)}</span><strong>${escapeHtml(targetParameter)}</strong></div>
            <div><span>${escapeHtml(COPY.targetType)}</span><strong>${escapeHtml(targetKindLabel)}</strong></div>
            <div><span>${escapeHtml(COPY.runtimeBehavior)}</span><strong>${escapeHtml(runtimeLabel)}</strong></div>
          </div>
          <div class="fault-tag-param-preview">
            <div class="fault-tag-param-preview__head">
              <div class="pglbl">${escapeHtml(COPY.parametersTitle)}</div>
              <button type="button" class="props-secondary fault-tag-param-edit" data-fault-tag-edit-params>${escapeHtml(COPY.editParameters)}</button>
            </div>
            ${renderParameterPreviewRows(parameters)}
          </div>
        </div>
      `;
}

export function renderFaultTagParameterPanel(options = {}) {
  const tag = options.tag || {};
  const parameters = options.parameters || tag.parameters || {};
  const params = getEntries(parameters);

  return `
        <div class="pgroup fault-tag-param-panel" data-fault-tag-param-panel="${escapeHtml(tag.id)}">
          <div class="pglbl">${escapeHtml(COPY.parametersTitle)}</div>
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
