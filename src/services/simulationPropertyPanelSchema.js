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

function powerPorts(props = {}) {
  return {
    inputs: list(props.powerInputs).length
      ? list(props.powerInputs)
      : [{ name: '电源输入', type: '电源', voltage: '28V' }],
    outputs: list(props.powerOutputs).length
      ? list(props.powerOutputs)
      : [{ name: '电源地', type: '电源', voltage: '0V' }]
  };
}

function renderPowerInterfaceGroup(props, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const ports = powerPorts(props);
  const renderPort = (item, position, index) => `
    <div class="props-port-card">
      <div class="props-port-card__head">
        <span class="props-port-card__kind">${escape(position)}电源端口 ${index + 1}</span>
        <span class="pv pv-ok">已配置</span>
      </div>
      <div class="props-port-card__meta"><span>${escape(item?.name || '电源')}</span><span>${escape(item?.voltage || '--')}</span></div>
    </div>`;

  return `
    <div class="pgroup">
      <div class="pglbl">电源接口</div>
      <div class="props-help">上边为电源输入端口，下边为电源输出（地）端口；中间变量不会显示在画布边缘。</div>
      <div class="props-port-list">
        ${ports.inputs.map((item, index) => renderPort(item, '上侧', index)).join('')}
        ${ports.outputs.map((item, index) => renderPort(item, '下侧', index)).join('')}
      </div>
    </div>`;
}

function renderSupplyInterfaceGroup(props, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const inputs = list(props.powerInputs).length
    ? list(props.powerInputs)
    : [{ name: '电源输入', voltage: '28V', supplyType: 'DC' }];

  return `
    <div class="pgroup" data-simulation-supply-interface>
      <div class="pglbl">电源接口</div>
      <div class="props-help">只有接入类型和额定电压均匹配的电源，仿真组件才能运行。</div>
      <div class="props-port-list">${inputs.map((item, index) => `
        <div class="props-port-card">
          <div class="props-port-card__head">
            <span class="props-port-card__kind">电源输入 ${index + 1}</span>
            <span class="pv pv-ok">已配置</span>
          </div>
          <div class="props-row">
            <div class="props-field"><label>电源类型</label><select data-simulation-power-type="${index}">${buildSelectOptions(['DC', 'AC'], item?.supplyType || 'DC', helpers.buildSelectOptions)}</select></div>
            <div class="props-field"><label>额定电压（V）</label><input type="number" min="0" step="any" data-simulation-power-voltage="${index}" value="${escape(String(item?.voltage || '28').replace(/\s*V(?:AC|DC)?\s*$/i, ''))}"></div>
          </div>
          <div class="props-port-card__meta"><span>${escape(item?.name || '电源输入')}</span><span>${escape(item?.supplyType || 'DC')} · ${escape(item?.voltage || '28V')}</span></div>
        </div>`).join('')}</div>
    </div>`;
}

function shouldRenderSupplyInterface(node, helpers = {}) {
  if (typeof helpers.isElectricalComponent === 'function') {
    return !helpers.isElectricalComponent(node);
  }
  return !String(node?.templateId || node?.type || '').startsWith('electrical_');
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
          <div class="sim-intf-note">中间变量仅作为内部可观测数据，不显示为画布端口；如需写入中间变量，请使用“中间变量赋值块”。</div>
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
          <div class="sim-intf-meta">${middleVars.length} 个内部观测量</div>
        </div>
        <div class="sim-intf-list">${middleVars.length ? renderSimulationInterfaceRows(middleVars, '中间变量', helpers) : '<div class="sim-intf-note">当前没有暴露的中间变量端口。</div>'}</div>
      </div>
      ${shouldRenderSupplyInterface(node, helpers) ? renderSupplyInterfaceGroup(props, helpers) : ''}
      <div class="props-field"><label>函数说明</label><textarea id="prop-ffunctionNote">${escape(props.ffunctionNote || '')}</textarea></div>
      ${renderSimulationParameterFields(node, helpers)}
      <div class="pgroup">
        <div class="pglbl">Python 绑定</div>
        <div class="props-help">仿真块可以绑定 Python 文件。绑定后输入、输出和中间变量端口会由 Python 接口自动生成，端口显示名优先使用代码注释中的中文说明。</div>
      </div>`;
}

function renderPythonPortRows(binding, kind, helpers) {
  const escape = helpers.escapeHtml || escapeHtml;
  const items = list(binding?.portMapping?.[kind]);
  const kindLabel = {
    inputs: '输入端口',
    outputs: '输出端口',
    middleVars: '中间变量'
  }[kind] || '端口';
  if (!items.length) {
    return '<div class="props-help">当前没有可用端口</div>';
  }
  return `<div class="props-port-list">${items.map((item, index) => {
    const fallbackName = item?.displayName || item?.varName || item?.name || `${kind} ${index + 1}`;
    const status = kind === 'inputs'
      ? (item?.connected ? '<span class="pv pv-ok">已连接</span>' : '<span class="pv pv-fault">未连接</span>')
      : '<span class="pv pv-ok">已暴露</span>';
    return `
      <div class="props-port-card props-port-card--editable">
        <div class="props-port-card__head">
          <span class="props-port-card__kind">${escape(kindLabel)} ${index + 1}</span>
          ${status}
        </div>
        <div class="props-field">
          <label>端口名称</label>
          <input data-python-port-display-name data-python-port-kind="${escape(kind)}" data-python-port-index="${index}" value="${escape(fallbackName)}">
        </div>
        <div class="props-port-card__meta"><span>${escape(item?.type || 'any')}</span></div>
      </div>`;
  }).join('')}</div>`;
}

function simulationParameters(props = {}) {
  return list(props.parameters)
    .map((item, index) => {
      const key = textValue(item?.key ?? item?.varName ?? item?.name, '');
      if (!key) return null;
      const baseUnit = textValue(item?.unit, '');
      const selectedUnit = frequencyUnits(baseUnit).includes(props.parameterUnits?.[key])
        ? props.parameterUnits[key]
        : baseUnit;
      const storedValue = props.parameterValues?.[key] ?? item?.value ?? item?.default ?? '';
      return {
        key,
        name: textValue(item?.name ?? item?.displayName, key),
        baseUnit,
        unit: selectedUnit,
        value: convertFrequencyValue(storedValue, baseUnit, selectedUnit),
        min: item?.min,
        max: item?.max,
        step: item?.step,
        control: textValue(item?.control, ''),
        options: list(item?.options)
          .map((option) => ({
            value: option?.value,
            label: textValue(option?.label, option?.value)
          }))
          .filter((option) => option.value !== undefined && option.value !== null),
        index
      };
    })
    .filter(Boolean);
}

const FREQUENCY_UNIT_FACTORS = {
  hz: 1,
  khz: 1e3,
  mhz: 1e6,
  ghz: 1e9
};

function normalizeFrequencyUnit(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(FREQUENCY_UNIT_FACTORS, normalized) ? normalized : '';
}

function frequencyUnits(baseUnit) {
  return normalizeFrequencyUnit(baseUnit)
    ? ['Hz', 'kHz', 'MHz', 'GHz']
    : [];
}

function convertFrequencyValue(value, fromUnit, toUnit) {
  const numeric = Number(value);
  const fromFactor = FREQUENCY_UNIT_FACTORS[normalizeFrequencyUnit(fromUnit)];
  const toFactor = FREQUENCY_UNIT_FACTORS[normalizeFrequencyUnit(toUnit)];
  return Number.isFinite(numeric) && fromFactor && toFactor
    ? numeric * fromFactor / toFactor
    : value;
}

function renderSimulationParameterFields(node, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const parameters = simulationParameters(node?.props);
  if (!parameters.length) {
    return '';
  }

  return `
      <div class="pgroup" data-simulation-parameters>
        <div class="pglbl">模型参数</div>
        <div class="props-help">修改后将在下一次初始化仿真时应用到后端模型。</div>
        ${parameters.map((parameter) => {
          const limits = [parameter.min !== undefined ? `min="${escape(parameter.min)}"` : '', parameter.max !== undefined ? `max="${escape(parameter.max)}"` : '', parameter.step !== undefined ? `step="${escape(parameter.step)}"` : 'step="any"'].filter(Boolean).join(' ');
          const units = frequencyUnits(parameter.baseUnit);
          const unit = units.length
            ? `<select class="props-unit-select" data-simulation-parameter-unit="${escape(parameter.key)}">${buildSelectOptions(units, parameter.unit, helpers.buildSelectOptions)}</select>`
            : parameter.unit ? `<span class="props-unit">${escape(parameter.unit)}</span>` : '';
          const selectedOption = parameter.options.find((option) => String(option.value) === String(parameter.value)) || parameter.options[0];
          const input = parameter.options.length && parameter.control === 'stepper'
            ? `<div class="simulation-parameter-mode-switch" data-simulation-parameter-mode-switch="${escape(parameter.key)}">${parameter.options.map((option) => `<button type="button" class="${String(option.value) === String(selectedOption?.value) ? 'is-active' : ''}" data-simulation-parameter-mode-select="${escape(option.value)}" data-simulation-parameter-mode-key="${escape(parameter.key)}">${escape(option.label)}</button>`).join('')}<input type="hidden" data-simulation-parameter="${escape(parameter.key)}" value="${escape(selectedOption?.value ?? parameter.value)}"></div>`
            : parameter.options.length
              ? `<select data-simulation-parameter="${escape(parameter.key)}">${parameter.options.map((option) => `<option value="${escape(option.value)}" ${String(option.value) === String(parameter.value) ? 'selected' : ''}>${escape(option.label)}</option>`).join('')}</select>`
            : `<input id="sim-parameter-${parameter.index}" data-simulation-parameter="${escape(parameter.key)}" type="number" ${limits} value="${escape(parameter.value)}">`;
          return `
            <div class="props-field" data-simulation-parameter-row="${escape(parameter.key)}">
              <label for="sim-parameter-${parameter.index}">${escape(parameter.name)}</label>
              <div class="props-input-with-unit">
                ${input}
                ${unit}
              </div>
            </div>`;
        }).join('')}
      </div>`;
}

function readSimulationParameterValues(node, documentLike) {
  const existing = node?.props?.parameterValues && typeof node.props.parameterValues === 'object'
    ? node.props.parameterValues
    : {};
  const definitions = new Map(simulationParameters(node?.props).map((parameter) => [parameter.key, parameter]));
  const values = { ...existing };
  [...(documentLike?.querySelectorAll?.('[data-simulation-parameter]') || [])].forEach((element) => {
    const key = String(element.dataset?.simulationParameter ?? '').trim();
    const parameter = definitions.get(key);
    const numeric = Number(element.value);
    if (!key || !parameter || !Number.isFinite(numeric)) return;
    const selectedUnit = documentLike?.querySelector?.(`[data-simulation-parameter-unit="${key}"]`)?.value || parameter.unit;
    values[key] = convertFrequencyValue(numeric, selectedUnit, parameter.baseUnit);
  });
  return values;
}

function readSimulationParameterUnits(node, documentLike) {
  const definitions = new Map(simulationParameters(node?.props).map((parameter) => [parameter.key, parameter]));
  const units = { ...(node?.props?.parameterUnits ?? {}) };
  [...(documentLike?.querySelectorAll?.('[data-simulation-parameter-unit]') || [])].forEach((element) => {
    const key = String(element.dataset?.simulationParameterUnit ?? '').trim();
    if (key && definitions.has(key) && frequencyUnits(definitions.get(key).baseUnit).includes(element.value)) {
      units[key] = element.value;
    }
  });
  return units;
}

function renderBoundSimulationFields(node, binding, helpers = {}) {
  const escape = helpers.escapeHtml || escapeHtml;
  const props = node?.props || {};

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
      ${shouldRenderSupplyInterface(node, helpers) ? renderSupplyInterfaceGroup(props, helpers) : ''}
      ${renderSimulationParameterFields(node, helpers)}`;
}

function renderReadOnlySimulationInterface(html) {
  return html
    .replace(/(<input id="prop-name"[^>]*)(>)/g, '$1 disabled$2')
    .replace(/(<input id="sim-(?:input|output|middle)-count"[^>]*)(>)/g, '$1 disabled$2')
    .replace(/(<(?:input|select) data-sim-field="(?:name|type)"[^>]*)(>)/g, '$1 disabled$2')
    .replace(/(<input data-python-port-display-name[^>]*)(>)/g, '$1 disabled$2')
    .replace(/<button class="props-secondary" type="button" onclick="syncSimulationInterfaceCounts\(\)">[\s\S]*?<\/button>/, '');
}

function readPowerInputs(props, documentLike) {
  const current = list(props.powerInputs).length
    ? list(props.powerInputs)
    : [{ name: '电源输入', voltage: '28V', supplyType: 'DC' }];
  return current.map((item, index) => {
    const type = String(documentLike?.querySelector?.(`[data-simulation-power-type="${index}"]`)?.value || item?.supplyType || 'DC').toUpperCase() === 'AC' ? 'AC' : 'DC';
    const voltageValue = Number(documentLike?.querySelector?.(`[data-simulation-power-voltage="${index}"]`)?.value);
    const fallback = Number.parseFloat(String(item?.voltage || '28'));
    const voltage = Number.isFinite(voltageValue) && voltageValue >= 0
      ? voltageValue
      : (Number.isFinite(fallback) ? fallback : 28);
    return { ...item, name: item?.name || '电源输入', type: '电源', supplyType: type, voltage: `${voltage}V` };
  });
}

export function renderSimulationBlockFieldsFromSchema(node, helpers = {}) {
  const binding = helpers.binding || null;
  if (binding?.bound) {
    return renderReadOnlySimulationInterface(renderBoundSimulationFields(node, binding, helpers));
  }
  return renderReadOnlySimulationInterface(renderUnboundSimulationFields(node, helpers));
}

export function readSimulationBlockValuesFromPanel(node, documentLike, helpers = {}) {
  const props = node?.props || {};
  const binding = helpers.binding || null;
  const supplyValues = shouldRenderSupplyInterface(node, helpers)
    ? { powerInputs: readPowerInputs(props, documentLike), powerOutputs: [] }
    : {};

  if (binding?.bound) {
    return {
      values: {
        parameterValues: readSimulationParameterValues(node, documentLike),
        parameterUnits: readSimulationParameterUnits(node, documentLike),
        ...supplyValues
      },
      shouldPruneInvalidEdges: false
    };
  }

  return {
    values: {
      moduleType: documentLike?.getElementById?.('prop-moduleType')?.value || props.moduleType,
      ffunctionNote: textValue(documentLike?.getElementById?.('prop-ffunctionNote')?.value, props.ffunctionNote || ''),
      parameterValues: readSimulationParameterValues(node, documentLike),
      parameterUnits: readSimulationParameterUnits(node, documentLike),
      ...supplyValues
    },
    shouldPruneInvalidEdges: false
  };

  const name = textValue(documentLike?.getElementById?.('prop-name')?.value, props.name || '');

  if (binding?.bound) {
    const portDisplayNames = ['inputs', 'outputs', 'middleVars'].reduce((result, kind) => {
      result[kind] = [...(documentLike?.querySelectorAll?.(`[data-python-port-display-name][data-python-port-kind="${kind}"]`) || [])]
        .map((element, index) => textValue(element.value, list(binding?.portMapping?.[kind])[index]?.displayName || ''));
      return result;
    }, {});
    return {
      values: { name },
      portDisplayNames,
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
