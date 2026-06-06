import { executePythonBindingSync } from './pythonExecutionAdapter.js';

function normalizeType(type) {
  return String(type ?? 'any').trim().toLowerCase();
}

function readNamedValue(collection, item, index) {
  if (Array.isArray(collection)) {
    return collection[index];
  }
  if (!collection || typeof collection !== 'object') {
    return undefined;
  }
  if (item?.varName && Object.prototype.hasOwnProperty.call(collection, item.varName)) {
    return collection[item.varName];
  }
  if (item?.displayName && Object.prototype.hasOwnProperty.call(collection, item.displayName)) {
    return collection[item.displayName];
  }
  return undefined;
}

function sanitizeNumber(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
}

export function getPythonBindingDefaultValue(port) {
  const type = normalizeType(port?.type);
  const fallback = port?.default;

  if (fallback === null || fallback === undefined || fallback === '') {
    return 0;
  }

  if (type === 'bool' || type === 'boolean') {
    if (typeof fallback === 'boolean') {
      return fallback ? 1 : 0;
    }
    const normalized = String(fallback).trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized) ? 1 : 0;
  }

  if (type === 'str' || type === 'string') {
    return fallback;
  }

  return sanitizeNumber(fallback);
}

export function executeFlowBlockPythonBindingSync({
  nodeId,
  binding,
  inputValues = [],
  mode = 'actual',
  time = 0,
  dt = 0.1,
  adapterMode,
  adapterEndpoint,
  executeSync = executePythonBindingSync,
  applyElectricalFault
}) {
  const inputs = binding?.portMapping?.inputs ?? [];
  const outputs = binding?.portMapping?.outputs ?? [];
  const middleVars = binding?.portMapping?.middleVars ?? [];

  const payloadInputs = Object.fromEntries(
    inputs.map((item, index) => {
      const upstreamValue = inputValues[index];
      const value = upstreamValue === undefined
        ? getPythonBindingDefaultValue(item)
        : sanitizeNumber(upstreamValue);
      return [item.varName, value];
    })
  );

  const payload = {
    nodeId,
    moduleName: binding?.moduleName ?? null,
    fileName: binding?.fileName ?? null,
    entryFunction: binding?.entryFunction ?? 'process',
    mode,
    time,
    dt,
    inputs: payloadInputs,
    inputNames: inputs.map((item) => item.varName),
    outputNames: outputs.map((item) => item.varName),
    middleVarNames: middleVars.map((item) => item.varName),
    source: binding?.rawSource ?? '',
    endpoint: adapterEndpoint
  };

  const response = executeSync({
    adapterMode: adapterMode ?? binding?.executionMode ?? 'mock',
    endpoint: adapterEndpoint ?? binding?.executionConfig?.endpoint,
    payload
  }) ?? {};

  const resolvedOutputs = outputs.map((item, index) => {
    const rawValue = readNamedValue(response.outputs, item, index);
    return sanitizeNumber(rawValue);
  });

  const resolvedMiddleValues = middleVars.map((item, index) => {
    const rawValue = readNamedValue(response.middleVars, item, index);
    return sanitizeNumber(rawValue);
  });

  if (mode === 'actual' && typeof applyElectricalFault === 'function' && resolvedOutputs.length) {
    resolvedOutputs[0] = sanitizeNumber(applyElectricalFault(resolvedOutputs[0], payload));
  }

  return {
    outputs: resolvedOutputs,
    middleValues: resolvedMiddleValues,
    payload,
    response
  };
}

export const executeSimulationBlockPythonBindingSync = executeFlowBlockPythonBindingSync;
