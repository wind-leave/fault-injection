import {
  DISPLAY_CONSOLE_COLUMNS,
  DISPLAY_CONSOLE_INPUTS,
  DISPLAY_CONSOLE_PRESETS,
  DISPLAY_CONSOLE_VECTOR_PORT_ID,
  applyDisplayConsoleConfiguration
} from '../constants/displayConsoleConfig.js';

const DEFAULT_CONFIGURATION = JSON.parse(JSON.stringify({
  DISPLAY_CONSOLE_INPUTS,
  DISPLAY_CONSOLE_VECTOR_PORT_ID,
  DISPLAY_CONSOLE_COLUMNS,
  DISPLAY_CONSOLE_PRESETS
}));
export const DISPLAY_CONSOLE_CONFIG_URL = `${import.meta.env?.BASE_URL ?? './'}config/display-console.json`;

function check(condition, path, message) {
  if (!condition) throw new Error(`${path}：${message}`);
}

function object(value, path) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), path, '必须是对象');
}

function text(value, path) {
  check(typeof value === 'string' && value.trim().length > 0, path, '必须是非空字符串');
}

function keys(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) {
    check(allowed.includes(key), `${path}.${key}`, '不支持的配置项');
  }
}

function array(value, path) {
  check(Array.isArray(value), path, '必须是数组');
}

function unique(values, path) {
  check(new Set(values).size === values.length, path, '存在重复标识');
}

function identifier(value, path) {
  text(value, path);
  check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !Object.hasOwn(Object.prototype, value) && value !== 'prototype', path, '必须是有效且非保留的字段标识');
}

function validateInputProperties(value, location) {
  if ('label' in value) text(value.label, `${location}.label`);
  if ('type' in value) check(value.type === 'float', `${location}.type`, '当前仅支持 float');
  if ('unit' in value) check(typeof value.unit === 'string', `${location}.unit`, '必须是字符串');
  if ('displayScale' in value) check(typeof value.displayScale === 'number' && Number.isFinite(value.displayScale), `${location}.displayScale`, '必须是有限数值');
  if ('generateMeasurementPoint' in value) check(typeof value.generateMeasurementPoint === 'boolean', `${location}.generateMeasurementPoint`, '必须是布尔值');
}

function validateInputs(inputs, path, definitions) {
  keys(inputs, definitions.map((input) => input.key), path);
  for (const [key, value] of Object.entries(inputs)) {
    const location = `${path}.${key}`;
    if (typeof value === 'string') {
      text(value, location);
      continue;
    }
    keys(value, ['label', 'type', 'unit', 'displayScale', 'generateMeasurementPoint'], location);
    validateInputProperties(value, location);
  }
}

function validateColumn(column, path, inputCount) {
  if ('label' in column) text(column.label, `${path}.label`);
  if ('value' in column) {
    check(column.value === null || ['string', 'number', 'boolean'].includes(typeof column.value), `${path}.value`, '必须是字符串、数值、布尔值或 null');
    if (typeof column.value === 'number') check(Number.isFinite(column.value), `${path}.value`, '必须是有限数值');
  }
  if ('source' in column) check(['input', 'status', 'time', 'static'].includes(column.source), `${path}.source`, '必须是 input、status、time 或 static');
  if ('inputIndex' in column) check(Number.isInteger(column.inputIndex) && column.inputIndex >= 0 && column.inputIndex < inputCount, `${path}.inputIndex`, `必须是 0–${inputCount - 1} 的整数`);
  if (column.source === 'input') check(Number.isInteger(column.inputIndex), path, '读取输入时必须指定 inputIndex');
}

// Validate the entire document before touching the live configuration. A failed
// edit must never partially change port layouts or control permissions.
export function validateDisplayConsolePresets(presets, {
  inputs = DISPLAY_CONSOLE_INPUTS,
  columns = DISPLAY_CONSOLE_COLUMNS
} = {}) {
  object(presets, '配置');
  for (const [id, preset] of Object.entries(presets)) {
    check(/^display_console_[A-Za-z0-9_]+$/.test(id), id, '显控台标识必须以 display_console_ 开头');
    keys(preset, ['name', 'inputs', 'fields', 'ports', 'controls', 'sharedParameters'], id);
    if ('name' in preset) text(preset.name, `${id}.name`);
    if ('inputs' in preset) validateInputs(preset.inputs, `${id}.inputs`, inputs);
    if ('fields' in preset) {
      keys(preset.fields, columns.map((column) => column.key), `${id}.fields`);
      for (const [key, field] of Object.entries(preset.fields)) {
        const path = `${id}.fields.${key}`;
        keys(field, ['label', 'value', 'source', 'inputIndex'], path);
        validateColumn({ ...columns.find((column) => column.key === key), ...field }, path, inputs.length);
      }
    }
    if ('ports' in preset) {
      array(preset.ports, `${id}.ports`);
      check(preset.ports.length > 0, `${id}.ports`, '至少需要一个向量输入端口');
      preset.ports.forEach((port, index) => {
        const path = `${id}.ports[${index}]`;
        keys(port, ['id', 'name', 'inputs'], path);
        text(port.id, `${path}.id`);
        if ('name' in port) text(port.name, `${path}.name`);
        if ('inputs' in port) validateInputs(port.inputs, `${path}.inputs`, inputs);
      });
      unique(preset.ports.map((port) => port.id), `${id}.ports`);
    }
    if ('controls' in preset) {
      array(preset.controls, `${id}.controls`);
      preset.controls.forEach((control, index) => {
        const path = `${id}.controls[${index}]`;
        keys(control, ['componentType', 'label', 'parameterKeys'], path);
        text(control.componentType, `${path}.componentType`);
        if ('label' in control) text(control.label, `${path}.label`);
        array(control.parameterKeys, `${path}.parameterKeys`);
        check(control.parameterKeys.length > 0, `${path}.parameterKeys`, '至少指定一个参数');
        control.parameterKeys.forEach((key) => text(key, `${path}.parameterKeys`));
        unique(control.parameterKeys, `${path}.parameterKeys`);
      });
      unique(preset.controls.map((control) => control.componentType), `${id}.controls`);
    }
    if ('sharedParameters' in preset) {
      array(preset.sharedParameters, `${id}.sharedParameters`);
      preset.sharedParameters.forEach((parameter, index) => {
        const path = `${id}.sharedParameters[${index}]`;
        keys(parameter, ['key', 'label', 'bindings'], path);
        text(parameter.key, `${path}.key`);
        if ('label' in parameter) text(parameter.label, `${path}.label`);
        array(parameter.bindings, `${path}.bindings`);
        check(parameter.bindings.length > 0, `${path}.bindings`, '至少指定一个绑定');
        parameter.bindings.forEach((binding, bindingIndex) => {
          const location = `${path}.bindings[${bindingIndex}]`;
          keys(binding, ['componentType', 'parameterKey'], location);
          text(binding.componentType, `${location}.componentType`);
          text(binding.parameterKey, `${location}.parameterKey`);
        });
        unique(parameter.bindings.map((binding) => JSON.stringify([binding.componentType, binding.parameterKey])), `${path}.bindings`);
      });
      unique(preset.sharedParameters.map((parameter) => parameter.key), `${id}.sharedParameters`);
    }
  }
  return JSON.parse(JSON.stringify(presets));
}

export function validateDisplayConsoleRuntimeConfiguration(document) {
  object(document, '配置');
  const configuration = JSON.parse(JSON.stringify(DEFAULT_CONFIGURATION));
  // Keep accepting the original JSON that only contained a preset mapping.
  const isFullConfiguration = Object.keys(document).some((key) => key.startsWith('DISPLAY_CONSOLE_'));
  if (isFullConfiguration) {
    keys(document, Object.keys(DEFAULT_CONFIGURATION), '配置');
    Object.assign(configuration, document);
  } else {
    configuration.DISPLAY_CONSOLE_PRESETS = document;
  }

  const inputs = configuration.DISPLAY_CONSOLE_INPUTS;
  array(inputs, 'DISPLAY_CONSOLE_INPUTS');
  check(inputs.length > 0, 'DISPLAY_CONSOLE_INPUTS', '至少需要一个向量元素');
  inputs.forEach((input, index) => {
    const path = `DISPLAY_CONSOLE_INPUTS[${index}]`;
    keys(input, ['key', 'label', 'type', 'unit', 'displayScale', 'generateMeasurementPoint'], path);
    identifier(input.key, `${path}.key`);
    text(input.label, `${path}.label`);
    validateInputProperties(input, path);
  });
  unique(inputs.map((input) => input.key), 'DISPLAY_CONSOLE_INPUTS');
  text(configuration.DISPLAY_CONSOLE_VECTOR_PORT_ID, 'DISPLAY_CONSOLE_VECTOR_PORT_ID');

  const columns = configuration.DISPLAY_CONSOLE_COLUMNS;
  array(columns, 'DISPLAY_CONSOLE_COLUMNS');
  check(columns.length > 0, 'DISPLAY_CONSOLE_COLUMNS', '至少需要一列');
  columns.forEach((column, index) => {
    const path = `DISPLAY_CONSOLE_COLUMNS[${index}]`;
    keys(column, ['key', 'label', 'value', 'source', 'inputIndex'], path);
    identifier(column.key, `${path}.key`);
    text(column.label, `${path}.label`);
    validateColumn(column, path, inputs.length);
  });
  unique(columns.map((column) => column.key), 'DISPLAY_CONSOLE_COLUMNS');
  validateDisplayConsolePresets(configuration.DISPLAY_CONSOLE_PRESETS, { inputs, columns });
  return JSON.parse(JSON.stringify(configuration));
}

export async function loadDisplayConsoleRuntimeConfig({
  fetchImpl = globalThis.fetch,
  url = DISPLAY_CONSOLE_CONFIG_URL,
  timeoutMs = 5000
} = {}) {
  const controller = new AbortController();
  let timeout;
  try {
    const configuration = await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return validateDisplayConsoleRuntimeConfiguration(await response.json());
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('读取配置超时'));
        }, timeoutMs);
      })
    ]);
    applyDisplayConsoleConfiguration(configuration);
    return { source: 'external', error: '' };
  } catch (error) {
    applyDisplayConsoleConfiguration(DEFAULT_CONFIGURATION);
    return { source: 'builtin', error: `显控台配置加载失败，已使用内置默认配置。${error.message}。请修正配置后刷新页面。` };
  } finally {
    clearTimeout(timeout);
  }
}
