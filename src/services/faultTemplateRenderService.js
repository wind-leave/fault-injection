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

function selectedTemplateIds(selectedTemplates) {
  return new Set(list(selectedTemplates).map((item) => item?.id).filter(Boolean));
}

export function renderFaultTemplateGrid(host, options = {}) {
  if (!host) {
    return;
  }

  const category = options.category || '';
  const templates = list(options.templates);
  const selectedIds = selectedTemplateIds(options.selectedTemplates);
  const onToggle = typeof options.onToggle === 'function' ? options.onToggle : null;
  const documentLike = host.ownerDocument || document;

  host.innerHTML = '';
  templates.forEach((template) => {
    const card = documentLike.createElement('div');
    const selected = selectedIds.has(template.id);
    card.className = `tcard${selected ? ' on' : ''}`;

    const name = documentLike.createElement('div');
    name.className = 'tcard-name';
    name.textContent = text(template.name);

    const desc = documentLike.createElement('div');
    desc.className = 'tcard-desc';
    desc.textContent = text(template.desc);

    const tags = documentLike.createElement('div');
    tags.className = 'tcard-tags';
    list(template.tags).forEach((tagValue) => {
      const tag = documentLike.createElement('span');
      const color = text(template.c, '#2563eb');
      tag.className = 'ttag';
      tag.style.background = `color-mix(in srgb, ${color} 10%, #fff)`;
      tag.style.color = color;
      tag.style.border = `1px solid color-mix(in srgb, ${color} 20%, #e5e7eb)`;
      tag.textContent = text(tagValue);
      tags.appendChild(tag);
    });

    card.append(name, desc, tags);
    card.addEventListener('click', () => {
      onToggle?.({ ...template, layer: category }, card);
    });
    host.appendChild(card);
  });
}

export function renderFaultTemplateDetail(host, template, options = {}) {
  if (!host) {
    return;
  }

  if (!template?.id) {
    host.innerHTML = '<div class="tdph">选择模板查看详情</div>';
    return;
  }

  const getLayerLabel = typeof options.getLayerLabel === 'function' ? options.getLayerLabel : (layer) => layer || '';
  const tags = list(template.tags);
  host.innerHTML = `
    <div class="tdtitle">${escapeHtml(template.name)}</div>
    <div style="font-size:10px;color:var(--text2);line-height:1.5;margin-bottom:10px">${escapeHtml(template.desc)}</div>
    <div class="tdlbl">故障层级</div><div class="tdval">${escapeHtml(getLayerLabel(template.layer))}</div>
    <div class="tdlbl">故障类别</div><div class="tdval">${escapeHtml(tags[0] || '')}</div>
    <div class="tdlbl">持续特征</div><div class="tdval">${escapeHtml(tags[1] || '-')}</div>
    <div class="tdlbl">适用场景</div>
    <div style="font-size:10px;color:var(--text2);margin-top:3px;line-height:1.5">系统建模模块 / 信号链路<br>故障传播与退化仿真</div>
    <div class="tdlbl">危害阈值</div><div class="tdval">0.01 ~ 10.0</div>`;
}
