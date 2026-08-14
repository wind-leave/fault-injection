const DEFAULT_PORT_FORMATS = ['标量', '向量', '矩阵', '布尔', '事件'];
const DEFAULT_INTERFACE_LIMITS = {
  inputs: [0, 6],
  outputs: [0, 6]
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

function textValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function buildSelectOptions(options, selected, helper) {
  if (typeof helper === 'function') {
    return helper(options, selected);
  }

  return options.map((option) => {
    const optionText = String(option);
    const selectedAttr = optionText === String(selected) ? ' selected' : '';
    return `<option value="${escapeHtml(optionText)}"${selectedAttr}>${escapeHtml(optionText)}</option>`;
  }).join('');
}

function getRolePrefix(role) {
  return role === 'input' ? '输入' : '输出';
}

function clampInterfaceCount(value, limits = [0, 6]) {
  const parsed = Number.parseInt(value, 10);
  const minimum = Number.isFinite(Number(limits[0])) ? Number(limits[0]) : 0;
  const maximum = Number.isFinite(Number(limits[1])) ? Number(limits[1]) : Math.max(minimum, parsed || minimum);
  const count = Number.isFinite(parsed) ? parsed : minimum;
  return Math.min(maximum, Math.max(minimum, count));
}

function normalizeSubsystemInterfaceList(items, prefix, minCount = 0) {
  const normalized = list(items).map((item, index) => ({
    ...(item && typeof item === 'object' ? item : {}),
    id: textValue(item?.id, `${prefix}-${index + 1}`),
    name: textValue(item?.name, `${prefix} ${index + 1}`),
    type: textValue(item?.type, '标量'),
    order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
  }));

  while (normalized.length < minCount) {
    normalized.push({
      id: `${prefix}-${normalized.length + 1}`,
      name: `${prefix} ${normalized.length + 1}`,
      type: '标量',
      order: normalized.length
    });
  }

  const targetCount = Math.max(minCount, normalized.length);
  return normalized.slice(0, targetCount).map((item, index) => ({
    ...item,
    order: index
  }));
}

function renderAutomaticSubsystemInterfaceRows(items, role, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const prefix = getRolePrefix(role);
  return list(items).map((item, index) => `
      <div class="sim-intf-row subsystem-intf-row" data-subsystem-role="${role}" data-index="${index}" data-port-id="${escape(item.id)}" data-source-component-id="${escape(item.componentNodeId || '')}">
        <div class="props-field">
          <label>${prefix} ${index + 1}</label>
          <input value="${escape(item.name)}" readonly>
        </div>
        <div class="props-field">
          <label>来源组件</label>
          <input value="${escape(item.componentName || item.componentNodeId || '--')}" readonly>
        </div>
        <div class="props-field">
          <label>来源端口</label>
          <input value="${escape(item.componentPortName || '--')}" readonly>
        </div>
      </div>`).join('');
}

function ensureSubsystemInterface(nodeOrProps) {
  const props = nodeOrProps?.props || nodeOrProps || {};
  const source = props.interface && typeof props.interface === 'object' ? props.interface : {};

  return {
    inputs: normalizeSubsystemInterfaceList(source.inputs, '输入', 0),
    outputs: normalizeSubsystemInterfaceList(source.outputs, '输出', 0)
  };
}

function renderSubsystemInterfaceRows(items, role, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const portFormats = helpers.portFormats || DEFAULT_PORT_FORMATS;
  const prefix = getRolePrefix(role);

  return list(items).map((item, index) => `
      <div class="sim-intf-row subsystem-intf-row" data-subsystem-role="${role}" data-index="${index}" data-port-id="${escape(item.id)}">
        <div class="props-field">
          <label>${prefix}名称 ${index + 1}</label>
          <input data-subsystem-field="name" value="${escape(item.name)}">
        </div>
        <div class="props-field">
          <label>${prefix}类型</label>
          <select data-subsystem-field="type">${buildSelectOptions(portFormats, item.type, helpers.buildSelectOptions)}</select>
        </div>
      </div>`).join('');
}

function readSubsystemInterfaceRows(documentLike, role) {
  const prefix = getRolePrefix(role);
  if (!documentLike?.querySelectorAll) {
    return [];
  }

  return [...documentLike.querySelectorAll(`.subsystem-intf-row[data-subsystem-role="${role}"]`)].map((row, index) => ({
    id: row.dataset.portId || `${prefix}-${index + 1}`,
    name: textValue(row.querySelector('[data-subsystem-field="name"]')?.value, `${prefix} ${index + 1}`),
    type: textValue(row.querySelector('[data-subsystem-field="type"]')?.value, '标量'),
    order: index
  }));
}

export function renderSubsystemBlockFieldsFromSchema(node, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props || {};
  const intf = ensureSubsystemInterface(node);
  const limits = helpers.interfaceLimits || DEFAULT_INTERFACE_LIMITS;
  const canvasId = helpers.canvasId || node?.targetCanvasId || '--';
  const automatic = props.interfaceMode === 'auto';

  if (automatic) {
    return `
      <div class="pgroup">
        <div class="pglbl">子系统设置</div>
        <div class="props-field"><label>模块名称</label><input id="prop-name" value="${escape(props.name || '')}"></div>
        <div class="props-field"><label>模块说明</label><textarea id="prop-description" rows="3" placeholder="可填写子系统职责、输入输出说明">${escape(props.description || '')}</textarea></div>
        <div class="prow"><span class="pk">子画布 ID</span><span class="pv">${escape(canvasId || '--')}</span></div>
      </div>
      <div class="sim-intf-toolbar">
        <div class="sim-intf-note">输入输出接口根据子系统内部所有未连接端口自动生成；内部连线变化后会自动刷新。</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">自动输入接口</div>
          <div class="sim-intf-meta">${intf.inputs.length} 个未连接输入端口</div>
        </div>
        <div class="sim-intf-list">${intf.inputs.length ? renderAutomaticSubsystemInterfaceRows(intf.inputs, 'input', helpers) : '<div class="sim-intf-note">内部组件没有未连接的输入端口。</div>'}</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">自动输出接口</div>
          <div class="sim-intf-meta">${intf.outputs.length} 个未连接输出端口</div>
        </div>
        <div class="sim-intf-list">${intf.outputs.length ? renderAutomaticSubsystemInterfaceRows(intf.outputs, 'output', helpers) : '<div class="sim-intf-note">内部组件没有未连接的输出端口。</div>'}</div>
      </div>`;
  }

  return `
      <div class="pgroup">
        <div class="pglbl">子系统设置</div>
        <div class="props-field"><label>模块名称</label><input id="prop-name" value="${escape(props.name || '')}"></div>
        <div class="props-field"><label>模块说明</label><textarea id="prop-description" rows="3" placeholder="可填写子系统职责、输入输出说明">${escape(props.description || '')}</textarea></div>
        <div class="prow"><span class="pk">子画布 ID</span><span class="pv">${escape(canvasId || '--')}</span></div>
      </div>
      <div class="sim-intf-toolbar">
        <div class="sim-intf-counts">
          <div class="props-field"><label>输入数量</label><input id="subsystem-input-count" type="number" min="${escape(limits.inputs?.[0] ?? 0)}" max="${escape(limits.inputs?.[1] ?? 6)}" value="${intf.inputs.length}"></div>
          <div class="props-field"><label>输出数量</label><input id="subsystem-output-count" type="number" min="${escape(limits.outputs?.[0] ?? 0)}" max="${escape(limits.outputs?.[1] ?? 6)}" value="${intf.outputs.length}"></div>
        </div>
        <button class="props-secondary" type="button" onclick="syncSubsystemInterfaceCounts()">同步接口数量</button>
        <div class="sim-intf-note">父层子系统块显示这些稳定端口；进入子系统后会自动同步为内部边界输入/输出节点。</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">输入接口</div>
          <div class="sim-intf-meta">${intf.inputs.length} 个父层输入</div>
        </div>
        <div class="sim-intf-list">${intf.inputs.length ? renderSubsystemInterfaceRows(intf.inputs, 'input', helpers) : '<div class="sim-intf-note">当前没有输入接口。</div>'}</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">输出接口</div>
          <div class="sim-intf-meta">${intf.outputs.length} 个父层输出</div>
        </div>
        <div class="sim-intf-list">${intf.outputs.length ? renderSubsystemInterfaceRows(intf.outputs, 'output', helpers) : '<div class="sim-intf-note">当前没有输出接口。</div>'}</div>
      </div>`;
}

export function readSubsystemBlockValuesFromPanel(node, documentLike, helpers = {}) {
  const props = node?.props || {};
  const limits = helpers.interfaceLimits || DEFAULT_INTERFACE_LIMITS;
  const inputCount = clampInterfaceCount(documentLike?.getElementById?.('subsystem-input-count')?.value, limits.inputs);
  const outputCount = clampInterfaceCount(documentLike?.getElementById?.('subsystem-output-count')?.value, limits.outputs);

  return {
    values: {
      name: textValue(documentLike?.getElementById?.('prop-name')?.value, props.name || ''),
      description: textValue(documentLike?.getElementById?.('prop-description')?.value, ''),
      interface: {
        inputs: normalizeSubsystemInterfaceList(
          readSubsystemInterfaceRows(documentLike, 'input').slice(0, inputCount),
          '输入',
          inputCount
        ),
        outputs: normalizeSubsystemInterfaceList(
          readSubsystemInterfaceRows(documentLike, 'output').slice(0, outputCount),
          '输出',
          outputCount
        )
      }
    },
    shouldSyncBoundaryNodes: true,
    shouldPruneInvalidEdges: true
  };
}

export function renderSubsystemBoundaryPortFieldsFromSchema(node, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const metaLabel = helpers.label || (node?.type === 'subsystem_in_port' ? '子系统输入边界' : '子系统输出边界');
  const role = node?.type === 'subsystem_in_port' ? '输入边界' : '输出边界';

  return `
      <div class="pgroup">
        <div class="props-title">${escape(node?.props?.name || metaLabel)}</div>
        <div class="props-sub">${escape(metaLabel)} · 边界端口</div>
      </div>
      <div class="pgroup">
        <div class="pglbl">边界映射</div>
        <div class="prow"><span class="pk">边界类型</span><span class="pv">${escape(role)}</span></div>
        <div class="prow"><span class="pk">接口 ID</span><span class="pv">${escape(node?.props?.interfacePortId || '--')}</span></div>
        <div class="prow"><span class="pk">信号类型</span><span class="pv">${escape(node?.props?.portType || '标量')}</span></div>
      </div>
      <div class="pgroup">
        <div class="props-help">边界端口由父层子系统接口自动生成。请返回父层子系统块编辑接口，不要直接修改这里。</div>
      </div>`;
}
