function createParseError(message, line = null) {
  const error = new Error(`PYTHON_PARSE_ERROR: ${message}`);
  error.code = 'PYTHON_PARSE_ERROR';
  error.line = line;
  return error;
}

function normalizeSource(source) {
  return source.replace(/\r\n/g, '\n');
}

function parseModuleMetadata(source, fileName) {
  const docstringMatch = source.match(/("""|''')([\s\S]*?)\1/);
  const docBlock = docstringMatch?.[2] ?? '';
  const moduleName = docBlock.match(/Module:\s*([A-Za-z0-9_]+)/)?.[1] ?? fileName.replace(/\.py$/i, '');
  const description = docBlock.match(/Description:\s*(.+)/)?.[1]?.trim() ?? '';
  return { moduleName, description };
}

function collectTopLevelFunctions(source) {
  const regex =
    /(^|\n)([ \t]*)(#\s*@entry\s*\n)?([ \t]*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^\n:]+))?:[ \t]*(?:#\s*(.*))?/g;
  const functions = [];
  let match;

  while ((match = regex.exec(source))) {
    const indent = match[4] ?? '';
    if (indent.length !== 0) {
      continue;
    }

    const startIndex = match.index + match[1].length;
    const line = source.slice(0, startIndex).split('\n').length;
    functions.push({
      startIndex,
      line,
      isEntry: Boolean(match[3]),
      name: match[5],
      paramsSource: match[6],
      returnAnnotation: match[7]?.trim() ?? '',
      headerComment: match[8]?.trim() ?? ''
    });
  }

  return functions
    .sort((left, right) => left.startIndex - right.startIndex)
    .map((item, index, list) => ({
      ...item,
      endIndex: list[index + 1]?.startIndex ?? source.length
    }));
}

function pickEntryFunction(functions) {
  if (functions.length === 0) {
    throw createParseError('未找到可识别的入口函数');
  }

  const tagged = functions.find((item) => item.isEntry);
  if (tagged) {
    return tagged;
  }

  const processFn = functions.find((item) => item.name === 'process');
  if (processFn) {
    return processFn;
  }

  if (functions.length === 1) {
    return functions[0];
  }

  throw createParseError('找到多个顶层函数，但没有 @entry 或 process 入口');
}

function splitTopLevelCommaList(text) {
  const parts = [];
  let current = '';
  let depth = 0;

  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function stripRolePrefix(comment) {
  return String(comment ?? '')
    .trim()
    .replace(/^(输入|输出|中间变量|观测变量|可观测变量)\s*[:：]\s*/u, '')
    .trim();
}

function cleanDisplayName({ name, comment }) {
  const cleanedComment = stripRolePrefix(comment);
  return cleanedComment || name;
}

function parseRoleCommentList(comment) {
  const cleaned = stripRolePrefix(comment);
  return cleaned ? splitTopLevelCommaList(cleaned) : [];
}

function splitParamSignatureAndComment(segment) {
  const hashIndex = segment.indexOf('#');
  if (hashIndex < 0) {
    return {
      signature: segment.trim().replace(/,$/, ''),
      comment: ''
    };
  }

  return {
    signature: segment.slice(0, hashIndex).trim().replace(/,$/, ''),
    comment: segment.slice(hashIndex + 1).trim()
  };
}

function parseParams(paramsSource, baseLine, headerComment = '') {
  const compactComments = parseRoleCommentList(headerComment);
  const rawParts = [];

  if (paramsSource.includes('#')) {
    paramsSource
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const { signature, comment } = splitParamSignatureAndComment(line);
        const parts = splitTopLevelCommaList(signature.replace(/,$/, '')).filter(Boolean);
        const inlineComments = parseRoleCommentList(comment);
        parts.forEach((part, index) => {
          rawParts.push({
            signature: part,
            comment: inlineComments[index] ?? (parts.length === 1 ? stripRolePrefix(comment) : '')
          });
        });
      });
  } else {
    splitTopLevelCommaList(paramsSource)
      .filter(Boolean)
      .forEach((signature, index) => {
        rawParts.push({
          signature,
          comment: compactComments[index] ?? ''
        });
      });
  }

  return rawParts.map((part, index) => {
    const { signature, comment: inlineComment } = typeof part === 'string'
      ? splitParamSignatureAndComment(part)
      : part;
    const match = signature
      .trim()
      .match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$/);

    if (!match) {
      throw createParseError(`无法解析参数定义: ${signature}`, baseLine + index);
    }

    const comment = stripRolePrefix(inlineComment || compactComments[index] || '');
    return {
      name: match[1],
      displayName: cleanDisplayName({ name: match[1], comment }),
      type: match[2]?.trim() ?? 'any',
      default: match[3]?.trim() ?? null,
      comment
    };
  });
}

function getFunctionBody(source, fn) {
  const fullSlice = source.slice(fn.startIndex, fn.endIndex);
  const headerEndIndex = fullSlice.indexOf('\n');
  if (headerEndIndex === -1) {
    return '';
  }
  return fullSlice.slice(headerEndIndex + 1);
}

function parseOutputs(body, returnAnnotation) {
  const bodyLines = body.split('\n');
  const returnLine = [...bodyLines].reverse().find((line) => line.trim().startsWith('return '));
  const returnMatch = returnLine?.match(/return\s+(.+?)(?:\s*#\s*(.+))?$/);
  const outputCommentParts = parseRoleCommentList(returnMatch?.[2] ?? '');

  let outputCount = 1;
  if (returnMatch?.[1]) {
    outputCount = splitTopLevelCommaList(returnMatch[1]).length;
  } else if (/Tuple?\[/.test(returnAnnotation)) {
    outputCount = splitTopLevelCommaList(returnAnnotation.replace(/^Tuple?\[/, '').replace(/\]$/, '')).length;
  }

  return Array.from({ length: Math.max(1, outputCount) }, (_, index) => {
    const name = `output_${index}`;
    const comment = stripRolePrefix(outputCommentParts[index] ?? '');
    return {
      name,
      displayName: cleanDisplayName({ name, comment }),
      type: 'float',
      comment
    };
  });
}

function parseObservableVars(body) {
  const lines = body.split('\n');
  const vars = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('@observable')) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex].trim();
      if (!line) {
        continue;
      }
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=.*?(?:#\s*(.+))?$/);
      if (match) {
        const comment = stripRolePrefix(match[2] ?? '');
        vars.push({
          name: match[1],
          displayName: cleanDisplayName({ name: match[1], comment }),
          type: 'float',
          comment
        });
      }
      break;
    }
  }

  return vars;
}

export function parsePythonBindingSource({ fileName, source }) {
  const normalizedSource = normalizeSource(source);
  const { moduleName, description } = parseModuleMetadata(normalizedSource, fileName);
  const functions = collectTopLevelFunctions(normalizedSource);
  const entryFunction = pickEntryFunction(functions);
  const body = getFunctionBody(normalizedSource, entryFunction);

  return {
    fileName,
    moduleName,
    description,
    entryFunction: entryFunction.name,
    inputs: parseParams(entryFunction.paramsSource, entryFunction.line, entryFunction.headerComment),
    outputs: parseOutputs(body, entryFunction.returnAnnotation),
    middleVars: parseObservableVars(body),
    rawSource: normalizedSource
  };
}

export { createParseError };
