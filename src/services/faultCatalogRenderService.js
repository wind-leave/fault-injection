function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function escapeHtml(value = '') {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function defaultLayerLabel(layer) {
  return layer || '';
}

function defaultMeta(model) {
  return `${model?.tags?.[0] || 'Fault'} · ${model?.layer || ''} · ${model?.createdAt || '-'}`;
}

function layerIcon(layer) {
  if (layer === 'electrical') {
    return '电';
  }
  if (layer === 'physical') {
    return '物';
  }
  return '协';
}

export function renderFaultCatalogList(host, hintHost, options = {}) {
  if (!host) {
    return;
  }

  const models = list(options.models);
  const importedIds = new Set(list(options.importedModels).map((model) => model?.id).filter(Boolean));
  const selectedId = options.selectedId || '';
  const buildMeta = typeof options.buildMeta === 'function' ? options.buildMeta : defaultMeta;
  const getLayerLabel = typeof options.getLayerLabel === 'function' ? options.getLayerLabel : defaultLayerLabel;
  const renderItem = typeof options.renderItem === 'function' ? options.renderItem : null;
  const selectIgnoreSelector = options.selectIgnoreSelector || '';
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
  const documentLike = host.ownerDocument || document;

  host.innerHTML = '';
  if (!models.length) {
    host.innerHTML = `<div class="ifm-empty">${escapeHtml(options.emptyMessage || '当前没有可导入的故障模型，请先从模板库新建。')}</div>`;
  } else {
    models.forEach((model) => {
      const imported = importedIds.has(model.id);
      const item = documentLike.createElement('div');
      item.className = `ifm-item${selectedId === model.id ? ' on' : ''}${imported ? ' is-imported' : ''}`;
      item.dataset.faultId = model.id || '';
      item.innerHTML = renderItem ? renderItem(model, imported) : `
        <div class="ifm-icon">${escapeHtml(layerIcon(model.layer))}</div>
        <div style="min-width:0;flex:1">
          <div class="ifm-name">${escapeHtml(model.name)}</div>
          <div class="ifm-meta">${escapeHtml(buildMeta(model))}</div>
        </div>
        ${imported ? '<span class="ifm-state">已导入</span>' : ''}`;
      item.addEventListener('click', (event) => {
        if (selectIgnoreSelector && event.target?.closest?.(selectIgnoreSelector)) {
          return;
        }
        onSelect?.(model.id, event);
      });
      host.appendChild(item);
    });
  }

  if (!hintHost) {
    return;
  }

  const selected = models.find((model) => model.id === selectedId);
  hintHost.textContent = selected
    ? `已选：${selected.name} · ${getLayerLabel(selected.layer)}`
    : '已选：未选择故障模型';
}
