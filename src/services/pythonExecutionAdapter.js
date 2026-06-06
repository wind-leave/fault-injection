function sanitizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readInputEnvironment(payload) {
  return Object.fromEntries(
    Object.entries(payload.inputs ?? {}).map(([key, value]) => [key, sanitizeNumber(value)])
  );
}

function normalizePythonExpression(expression) {
  return String(expression ?? '')
    .replace(/#.*$/g, '')
    .replace(/\bfloat\s*\(/g, '(')
    .replace(/\bint\s*\(/g, '(')
    .replace(/\babs\s*\(/g, 'abs(')
    .trim();
}

function evaluatePythonExpression(expression, env) {
  const normalized = normalizePythonExpression(expression);
  if (!normalized || !/^[\w\s+\-*/().,]+$/.test(normalized)) {
    return null;
  }

  const identifiers = Array.from(new Set(normalized.match(/\b[A-Za-z_]\w*\b/g) ?? []));
  const allowedFunctions = new Set(['max', 'min', 'abs']);
  const variableNames = identifiers.filter((name) => !allowedFunctions.has(name));

  if (variableNames.some((name) => !Object.prototype.hasOwnProperty.call(env, name))) {
    return null;
  }

  try {
    const fn = new Function(
      ...variableNames,
      'max',
      'min',
      'abs',
      `"use strict"; return (${normalized});`
    );
    return sanitizeNumber(fn(
      ...variableNames.map((name) => env[name]),
      Math.max,
      Math.min,
      Math.abs
    ));
  } catch {
    return null;
  }
}

function buildSourceExecutionResult(payload) {
  const source = String(payload.source ?? '').trim();
  if (!source) {
    return null;
  }

  const env = readInputEnvironment(payload);
  const assignments = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('def ') && !line.startsWith('return '));

  for (const line of assignments) {
    const match = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }
    const [, name, expression] = match;
    const value = evaluatePythonExpression(expression, env);
    if (value === null) {
      return null;
    }
    env[name] = value;
  }

  const outputNames = payload.outputNames ?? [];
  const middleVarNames = payload.middleVarNames ?? [];
  const canResolveOutputs = outputNames.length > 0 && outputNames.every((name) => Object.prototype.hasOwnProperty.call(env, name));
  const canResolveMiddleVars = middleVarNames.every((name) => Object.prototype.hasOwnProperty.call(env, name));

  if (!canResolveOutputs || !canResolveMiddleVars) {
    return null;
  }

  return {
    outputs: Object.fromEntries(outputNames.map((name) => [name, sanitizeNumber(env[name])])),
    middleVars: Object.fromEntries(middleVarNames.map((name) => [name, sanitizeNumber(env[name])]))
  };
}

function buildMockExecutionResult(payload) {
  const sourceResult = buildSourceExecutionResult(payload);
  if (sourceResult) {
    return sourceResult;
  }

  const values = Object.values(payload.inputs ?? {});
  const baseValue = typeof values[0] === 'number' ? values[0] : Number(values[0] ?? 0);
  const aggregate = values.reduce((sum, value) => sum + Number(value ?? 0), 0);

  return {
    outputs: Object.fromEntries(
      (payload.outputNames ?? []).map((name, index) => [
        name,
        Number((baseValue + aggregate * 0.12 + index * 0.1).toFixed(6))
      ])
    ),
    middleVars: Object.fromEntries(
      (payload.middleVarNames ?? []).map((name, index) => [
        name,
        Number(((aggregate || baseValue) * (index + 1) * 0.1).toFixed(6))
      ])
    )
  };
}

export function executePythonBindingSync({ adapterMode = 'mock', payload }) {
  if (adapterMode === 'backend' && typeof window !== 'undefined' && typeof window.__GZ_PYTHON_BACKEND_SYNC__ === 'function') {
    return window.__GZ_PYTHON_BACKEND_SYNC__(payload);
  }

  return buildMockExecutionResult(payload);
}

export async function executePythonBinding({
  adapterMode = 'mock',
  endpoint = '/api/python-flow/execute',
  payload,
  fetchImpl = globalThis.fetch
}) {
  if (adapterMode === 'backend') {
    if (typeof fetchImpl !== 'function') {
      throw new Error('PYTHON_EXECUTION_FAILED: fetch unavailable');
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`PYTHON_EXECUTION_FAILED: ${response.status}`);
    }

    return response.json();
  }

  return buildMockExecutionResult(payload);
}
