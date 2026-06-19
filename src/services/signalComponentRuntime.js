const MIN_MULTI_INPUT_COUNT = 2;

export function sanitizeSignalValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeSignalValue);
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseSignalScalar(value, fallback = 0) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampInputCount(value, fallback = MIN_MULTI_INPUT_COUNT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(MIN_MULTI_INPUT_COUNT, parsed);
}

function normalizeSigns(signs, inputCount) {
  const source = Array.isArray(signs) ? signs : String(signs || '').split('');
  return Array.from({ length: inputCount }, (_, index) => (
    source[index] === '-' ? '-' : '+'
  ));
}

export function isSignalUtilityType(type) {
  return type === 'gain_block' || type === 'sum_block' || type === 'mux_block';
}

export function normalizeSignalUtilityNode(node) {
  if (!node || !isSignalUtilityType(node.type)) {
    return node;
  }

  node.props = node.props && typeof node.props === 'object' ? node.props : {};

  if (node.type === 'gain_block') {
    node.props.gain = String(node.props.gain ?? '1.0');
    node.props.inputFormat = node.props.inputFormat || '标量';
    node.props.outputFormat = node.props.outputFormat || '标量';
  }

  if (node.type === 'sum_block') {
    node.props.inputCount = clampInputCount(node.props.inputCount);
    node.props.signs = normalizeSigns(node.props.signs, node.props.inputCount);
    node.props.outputFormat = node.props.outputFormat || '标量';
  }

  if (node.type === 'mux_block') {
    node.props.inputCount = clampInputCount(node.props.inputCount);
    node.props.outputFormat = node.props.outputFormat || '向量';
  }

  return node;
}

export function evaluateFlowBlockOutputs(inputValues = []) {
  return {
    outputs: [sanitizeSignalValue(inputValues[0] ?? 0)],
    middleValues: []
  };
}

export function evaluateSignalUtilityOutputs(node, inputValues = []) {
  if (!node || !isSignalUtilityType(node.type)) {
    return null;
  }

  normalizeSignalUtilityNode(node);

  if (node.type === 'gain_block') {
    const inputValue = sanitizeSignalValue(inputValues[0] ?? 0);
    const gain = parseSignalScalar(node.props?.gain, 1);
    return {
      outputs: [sanitizeSignalValue(inputValue * gain)],
      middleValues: []
    };
  }

  if (node.type === 'sum_block') {
    let total = 0;
    for (let index = 0; index < node.props.inputCount; index += 1) {
      const value = sanitizeSignalValue(inputValues[index] ?? 0);
      const sign = node.props.signs?.[index] === '-' ? -1 : 1;
      total += sign * value;
    }

    return {
      outputs: [sanitizeSignalValue(total)],
      middleValues: []
    };
  }

  const packed = Array.from(
    { length: node.props.inputCount },
    (_, index) => sanitizeSignalValue(inputValues[index] ?? 0)
  );

  return {
    outputs: [packed],
    middleValues: []
  };
}
