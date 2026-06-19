const DEFAULT_MODULE_TYPES = ['一阶函数', '微分', '积分'];
const DEFAULT_PORT_FORMATS = ['标量', '向量', '矩阵', '布尔', '事件'];
const DEFAULT_INTERFACE_LIMITS = {
  inputs: [1, 6],
  outputs: [1, 6],
  middleVars: [0, 6]
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function list(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clampInterfaceCount(value, limits = [0, 6]) {
  const parsed = Number.parseInt(value, 10);
  const fallback = Number.isFinite(Number(limits[0])) ? Number(limits[0]) : 0;
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(
    Number.isFinite(Number(limits[1])) ? Number(limits[1]) : count,
    Math.max(fallback, count)
  );
}

function normalizeSimulationInterfaceList(items, prefix, fallbackType = '标量', count = items.length) {
  const base = list(items).map((item, index) => ({
    name: textValue(item?.name, `${prefix} ${index + 1}`),
    type: textValue(item?.type, fallbackType)
  }));

  while (base.length < count) {
    base.push({
      name: `${prefix} ${base.length + 1}`,
      type: fallbackType
    });
  }

  return base.slice(0, count);
}

function readSimulationInterfaceRows(documentLike, role, fallbackType = '标量') {
  if (!documentLike?.querySelectorAll) {
    return [];
  }

  return [...documentLike.querySelectorAll(`.sim-intf-row[data-role="${role}"]`)].map((row, index) => ({
    name: textValue(row.querySelector('[data-sim-field="name"]')?.value, `${role} ${index + 1}`),
    type: textValue(row.querySelector('[data-sim-field="type"]')?.value, fallbackType)
  }));
}

function renderSimulationInterfaceRows(items, prefix, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const portFormats = helpers.portFormats || DEFAULT_PORT_FORMATS;

  return list(items).map((item, index) => `
      <div class="sim-intf-row" data-role="${escape(prefix)}" data-index="${index}">
        <div class="props-field">
          <label>${escape(prefix)}名称 ${index + 1}</label>
          <input data-sim-field="name" value="${escape(item?.name || `${prefix} ${index + 1}`)}">
        </div>
        <div class="props-field">
          <label>${escape(prefix)}类型</label>
          <select data-sim-field="type">${buildSelectOptions(portFormats, item?.type || '标量', helpers.buildSelectOptions)}</select>
        </div>
      </div>`).join('');
}

function renderUnboundSimulationFields(node, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props || {};
  const moduleTypes = helpers.moduleTypes || DEFAULT_MODULE_TYPES;
  const limits = helpers.interfaceLimits || DEFAULT_INTERFACE_LIMITS;
  const inputs = list(props.inputs);
  const outputs = list(props.outputs);
  const middleVars = list(props.middleVars);

  return `
      <div class="pgroup">
        <div class="pglbl">仿真接口</div>
        <div class="props-field"><label>模块名称</label><input id="prop-name" value="${escape(props.name || '')}"></div>
        <div class="props-field"><label>模块类型</label><select id="prop-moduleType">${buildSelectOptions(moduleTypes, props.moduleType, helpers.buildSelectOptions)}</select></div>
        <div class="sim-intf-toolbar">
          <div class="sim-intf-counts">
            <div class="props-field"><label>输入数量</label><input id="sim-input-count" type="number" min="${escape(limits.inputs?.[0] ?? 1)}" max="${escape(limits.inputs?.[1] ?? 6)}" value="${inputs.length}"></div>
            <div class="props-field"><label>输出数量</label><input id="sim-output-count" type="number" min="${escape(limits.outputs?.[0] ?? 1)}" max="${escape(limits.outputs?.[1] ?? 6)}" value="${outputs.length}"></div>
            <div class="props-field"><label>中间变量数量</label><input id="sim-middle-count" type="number" min="${escape(limits.middleVars?.[0] ?? 0)}" max="${escape(limits.middleVars?.[1] ?? 6)}" value="${middleVars.length}"></div>
          </div>
          <button class="props-secondary" type="button" onclick="syncSimulationInterfaceCounts()">同步接口数量</button>
          <div class="sim-intf-note">中间变量端口位于模块上方，作为可观测输出；如需写入中间变量，请使用“中间变量赋值块”。</div>
        </div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">输入端口</div>
          <div class="sim-intf-meta">${inputs.length} 个左侧端口</div>
        </div>
        <div class="sim-intf-list">${renderSimulationInterfaceRows(inputs, '输入', helpers)}</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">输出端口</div>
          <div class="sim-intf-meta">${outputs.length} 个右侧输出</div>
        </div>
        <div class="sim-intf-list">${renderSimulationInterfaceRows(outputs, '输出', helpers)}</div>
      </div>
      <div class="sim-intf-group">
        <div class="sim-intf-head">
          <div class="sim-intf-title">中间变量</div>
          <div class="sim-intf-meta">${middleVars.length} 个顶部观测端口</div>
        </div>
        <div class="sim-intf-list">${middleVars.length ? renderSimulationInterfaceRows(middleVars, '中间变量', helpers) : '<div class="sim-intf-note">当前没有暴露的中间变量端口。</div>'}</div>
      </div>
      <div class="props-field"><label>函数说明</label><textarea id="prop-ffunctionNote">${escape(props.ffunctionNote || '')}</textarea></div>
      <div class="pgroup">
        <div class="pglbl">Python 绑定</div>
        <div class="props-help">仿真块可以绑定 Python 文件。绑定后输入、输出和中间变量端口会由 Python 接口自动生成，端口显示名优先使用代码注释中的中文说明。</div>
      </div>`;
}

function renderPythonPortRows(binding, kind, helpers) {
  if (typeof helpers.buildPythonBindingPortRows === 'function') {
    return helpers.buildPythonBindingPortRows(list(binding?.portMapping?.[kind]), kind);
  }
  return list(binding?.portMapping?.[kind]).map((item, index) => `
      <div class="prow">
        <span class="pk">${escapeHtml(item?.name || `${kind} ${index + 1}`)}</span>
        <span class="pv">${escapeHtml(item?.type || 'value')}</span>
      </div>`).join('');
}

function renderBoundSimulationFields(node, binding, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props || {};
  const summary = typeof helpers.getPythonBindingSummary === 'function'
    ? helpers.getPythonBindingSummary(node)
    : '';

  return `
      <div class="pgroup">
        <div class="pglbl">仿真块设置</div>
        <div class="props-field"><label>模块名称</label><input id="prop-name" value="${escape(props.name || '')}"></div>
        <div class="props-field"><label>绑定文件</label><input value="${escape(binding?.fileName || '')}" disabled></div>
        <div class="props-row">
          <div class="props-field"><label>模块名</label><input value="${escape(binding?.moduleName || '-')}" disabled></div>
          <div class="props-field"><label>入口函数</label><input value="${escape(binding?.entryFunction || 'process')}" disabled></div>
        </div>
        <div class="props-help">${escape(binding?.description || '已绑定 Python 接口，端口由解析结果自动生成。')}</div>
      </div>
      <div class="pgroup">
        <div class="pglbl">输入端口</div>
        ${renderPythonPortRows(binding, 'inputs', helpers)}
      </div>
      <div class="pgroup">
        <div class="pglbl">输出端口</div>
        ${renderPythonPortRows(binding, 'outputs', helpers)}
      </div>
      <div class="pgroup">
        <div class="pglbl">中间变量观测端口</div>
        ${renderPythonPortRows(binding, 'middleVars', helpers)}
        <div class="props-help">中间变量默认作为顶部观测输出存在；如果需要在仿真过程中对其赋值，请拖入“中间变量赋值块”。</div>
      </div>
      <div class="pgroup">
        <div class="pglbl">执行方式</div>
        <div class="prow"><span class="pk">执行模式</span><span class="pv">${escape(binding?.executionMode || 'mock')}</span></div>
        <div class="prow"><span class="pk">执行说明</span><span class="pv">${binding?.executionMode === 'backend' ? '后端执行' : '前端模拟'}</span></div>
        <div class="prow"><span class="pk">来源模型包</span><span class="pv">${escape(binding?.sourcePackageName || '未关联模型包')}</span></div>
        <div class="prow"><span class="pk">接口摘要</span><span class="pv">${escape(summary)}</span></div>
      </div>`;
}

export function renderSimulationBlockFieldsFromSchema(node, helpers = {}) {
  const binding = helpers.binding || null;
  if (binding?.bound) {
    return renderBoundSimulationFields(node, binding, helpers);
  }
  return renderUnboundSimulationFields(node, helpers);
}

export function readSimulationBlockValuesFromPanel(node, documentLike, helpers = {}) {
  const props = node?.props || {};
  const binding = helpers.binding || null;
  const name = textValue(documentLike?.getElementById?.('prop-name')?.value, props.name || '');

  if (binding?.bound) {
    return {
      values: { name },
      shouldPruneInvalidEdges: false
    };
  }

  const limits = helpers.interfaceLimits || DEFAULT_INTERFACE_LIMITS;
  const inputCount = clampInterfaceCount(documentLike?.getElementById?.('sim-input-count')?.value, limits.inputs);
  const outputCount = clampInterfaceCount(documentLike?.getElementById?.('sim-output-count')?.value, limits.outputs);
  const middleCount = clampInterfaceCount(documentLike?.getElementById?.('sim-middle-count')?.value, limits.middleVars);
  const inputFallbackType = list(props.inputs)[0]?.type || '标量';
  const outputFallbackType = list(props.outputs)[0]?.type || '标量';
  const middleFallbackType = list(props.middleVars)[0]?.type || '标量';

  return {
    values: {
      name,
      moduleType: documentLike?.getElementById?.('prop-moduleType')?.value || props.moduleType,
      inputs: normalizeSimulationInterfaceList(
        readSimulationInterfaceRows(documentLike, '输入', '标量').slice(0, inputCount),
        '输入',
        inputFallbackType,
        inputCount
      ),
      outputs: normalizeSimulationInterfaceList(
        readSimulationInterfaceRows(documentLike, '输出', '标量').slice(0, outputCount),
        '输出',
        outputFallbackType,
        outputCount
      ),
      middleVars: normalizeSimulationInterfaceList(
        readSimulationInterfaceRows(documentLike, '中间变量', '标量').slice(0, middleCount),
        '中间变量',
        middleFallbackType,
        middleCount
      ),
      ffunctionNote: textValue(documentLike?.getElementById?.('prop-ffunctionNote')?.value, props.ffunctionNote || '')
    },
    shouldPruneInvalidEdges: true
  };
}
