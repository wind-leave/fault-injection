export const DEFAULT_FAULT_SLOT_LAYERS = ['physical', 'electrical', 'protocol'];

export const DEFAULT_FAULT_SLOT_LABELS = {
  physical: '物理层',
  electrical: '电气层',
  protocol: '协议层'
};

export const DEFAULT_FAULT_SLOT_ROLE_LABELS = {
  parameter: '参数',
  input: '输入',
  output: '输出',
  middle: '中间量',
  protocol: '协议'
};

const DEFAULT_COPY = {
  title: '可注入变量声明',
  description: '选择组件变量可被哪些故障层级关联。',
  variableHeader: '变量',
  layerHeader: '故障层级',
  empty: 'No fault slot variables available',
  help: '组件自己声明哪些参数、输入、输出或中间变量允许被物理层、电气层、协议层故障关联。'
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLayers(layers = DEFAULT_FAULT_SLOT_LAYERS) {
  const normalized = list(layers).map((layer) => String(layer)).filter(Boolean);
  return normalized.length ? normalized : DEFAULT_FAULT_SLOT_LAYERS;
}

function normalizeDeclaration(declaration = {}, layers = DEFAULT_FAULT_SLOT_LAYERS) {
  return normalizeLayers(layers).reduce((draft, layer) => {
    draft[layer] = list(declaration?.[layer]).map((key) => String(key)).filter(Boolean);
    return draft;
  }, {});
}

function getRoleLabel(role, roleLabels = DEFAULT_FAULT_SLOT_ROLE_LABELS) {
  return roleLabels?.[role] || role || '变量';
}

export function renderFaultSlotEditorFromSchema(options = {}) {
  const layers = normalizeLayers(options.layers);
  const layerLabels = options.layerLabels || DEFAULT_FAULT_SLOT_LABELS;
  const roleLabels = options.roleLabels || DEFAULT_FAULT_SLOT_ROLE_LABELS;
  const copy = { ...DEFAULT_COPY, ...(options.copy || {}) };
  const variables = list(options.variables);
  const declaration = normalizeDeclaration(options.declaration, layers);
  const selectedCount = layers.reduce((count, layer) => count + list(declaration[layer]).length, 0);

  const rows = variables.map((variable) => {
    const key = String(variable?.key || '');
    const layerChecks = layers.map((layer) => {
      const checked = declaration[layer].includes(key) ? 'checked' : '';
      return `
          <label class="props-layer-toggle">
            <input type="checkbox" data-fault-slot-layer="${escapeHtml(layer)}" data-fault-slot-var="${escapeHtml(key)}" ${checked}>
            <span>${escapeHtml(layerLabels?.[layer] || layer)}</span>
          </label>`;
    }).join('');

    return `
        <div class="props-fault-slot-row" data-fault-slot-variable="${escapeHtml(key)}">
          <div class="props-fault-variable">
            <strong>${escapeHtml(variable?.name || key)}</strong>
            <span><b>${escapeHtml(getRoleLabel(variable?.role, roleLabels))}</b><code>${escapeHtml(key)}</code></span>
          </div>
          <div class="props-fault-slot-layers">${layerChecks}</div>
        </div>`;
  }).join('');

  return `
      <div class="pgroup props-fault-section" data-fault-slot-editor>
        <div class="props-section-head">
          <div>
            <div class="pglbl">${escapeHtml(copy.title)}</div>
            <p>${escapeHtml(copy.description)}</p>
          </div>
          <span class="props-section-count">${escapeHtml(selectedCount)} / ${escapeHtml(variables.length * layers.length)}</span>
        </div>
        <div class="props-fault-slot-table">
          <div class="props-fault-slot-head">
            <span>${escapeHtml(copy.variableHeader)}</span>
            <span>${escapeHtml(copy.layerHeader)}</span>
          </div>
          ${rows || `<div class="props-empty-state">${escapeHtml(copy.empty)}</div>`}
        </div>
        <div class="props-help">${escapeHtml(copy.help)}</div>
      </div>`;
}

export function readFaultSlotDeclarationFromPanel(host, layers = DEFAULT_FAULT_SLOT_LAYERS) {
  const normalizedLayers = normalizeLayers(layers);
  const declaration = normalizedLayers.reduce((draft, layer) => {
    draft[layer] = [];
    return draft;
  }, {});

  host?.querySelectorAll?.('[data-fault-slot-layer][data-fault-slot-var]')?.forEach((input) => {
    if (!input.checked) {
      return;
    }
    const layer = input.dataset?.faultSlotLayer || input.getAttribute('data-fault-slot-layer');
    const key = input.dataset?.faultSlotVar || input.getAttribute('data-fault-slot-var');
    if (!declaration[layer] || !key || declaration[layer].includes(key)) {
      return;
    }
    declaration[layer].push(key);
  });

  return declaration;
}
