import { parse } from '@babel/parser';
import { readFile, mkdir, lstat, realpath, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateDisplayConsoleRuntimeConfiguration } from '../src/services/displayConsoleRuntimeConfig.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_NAMES = [
  'DISPLAY_CONSOLE_INPUTS',
  'DISPLAY_CONSOLE_VECTOR_PORT_ID',
  'DISPLAY_CONSOLE_COLUMNS',
  'DISPLAY_CONSOLE_PRESETS'
];

function sourceError(node, message) {
  const location = node?.loc?.start;
  return new Error(`${location ? `第 ${location.line} 行，第 ${location.column + 1} 列：` : ''}${message}`);
}

// Read data expressions rather than importing the supplied module. Function
// bodies/imports are never executed and do not need a browser or other project.
export function extractDisplayConsoleConfiguration(source, filename = 'displayConsoleConfig.js') {
  const ast = parse(source.replace(/^\uFEFF/, ''), { sourceType: 'module', sourceFilename: filename });
  const declarations = new Map();
  const exports = new Map();
  function checkInitializer(node) {
    if (!node || ['FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) return;
    if (['CallExpression', 'OptionalCallExpression', 'AssignmentExpression', 'UpdateExpression', 'AwaitExpression', 'NewExpression', 'TaggedTemplateExpression', 'YieldExpression'].includes(node.type)) {
      throw sourceError(node, '顶层变量初始化中存在执行操作，请使用静态配置数据（不支持函数调用生成配置）');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => { if (child?.type) checkInitializer(child); });
      else if (value?.type) checkInitializer(value);
    }
  }
  function addVariables(declaration, exported) {
    for (const item of declaration.declarations) {
      if (item.id.type !== 'Identifier') throw sourceError(item, '不支持顶层解构声明，请把配置写成普通变量声明');
      checkInitializer(item.init);
      declarations.set(item.id.name, item);
      if (exported) exports.set(item.id.name, item.id.name);
    }
  }
  for (const statement of ast.program.body) {
    if (statement.type === 'VariableDeclaration') addVariables(statement, false);
    else if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration?.type === 'VariableDeclaration') addVariables(statement.declaration, true);
      else if (statement.declaration && statement.declaration.type !== 'FunctionDeclaration') {
        throw sourceError(statement, '不支持此导出声明，请使用配置变量或函数声明');
      }
      for (const specifier of statement.specifiers) {
        const exportedName = specifier.exported.name ?? specifier.exported.value;
        if (!EXPORT_NAMES.includes(exportedName)) continue;
        if (statement.source) throw sourceError(statement, `${exportedName} 必须在本文件中定义，不支持从其他文件转导出`);
        exports.set(exportedName, specifier.local.name);
      }
    } else if (!['FunctionDeclaration', 'ImportDeclaration', 'EmptyStatement'].includes(statement.type)) {
      // Ignoring a mutation such as PRESETS.x = ... would silently export stale
      // data. Refuse executable top-level statements instead of guessing.
      throw sourceError(statement, '配置文件包含顶层执行语句，请将配置直接写入变量声明；函数体可以保留');
    }
  }
  const missing = EXPORT_NAMES.filter((name) => !exports.has(name));
  if (missing.length) throw new Error(`缺少配置导出：${missing.join('、')}`);

  const resolving = new Set();
  const values = new Map();
  function variable(name, node) {
    if (values.has(name)) return values.get(name);
    const declaration = declarations.get(name);
    if (!declaration?.init) throw sourceError(node, `无法静态读取变量 ${name}；请使用本文件中的配置数据`);
    if (resolving.has(name)) throw sourceError(node, `配置变量存在循环引用：${name}`);
    resolving.add(name);
    const value = evaluate(declaration.init);
    resolving.delete(name);
    values.set(name, value);
    return value;
  }
  function propertyKey(node, computed) {
    const key = !computed && node.type === 'Identifier' ? node.name : evaluate(node);
    if (!['string', 'number'].includes(typeof key)) throw sourceError(node, '对象键必须是字符串或数值');
    if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw sourceError(node, `不支持配置键 ${key}`);
    return String(key);
  }
  function evaluate(node) {
    switch (node.type) {
      case 'StringLiteral':
      case 'BooleanLiteral':
        return node.value;
      case 'NumericLiteral':
        if (!Number.isFinite(node.value)) throw sourceError(node, '配置中不能使用非有限数值');
        return node.value;
      case 'NullLiteral': return null;
      case 'Identifier': return variable(node.name, node);
      case 'ArrayExpression': {
        const result = [];
        for (const element of node.elements) {
          if (!element) throw sourceError(node, '数组不能包含空位');
          if (element.type === 'SpreadElement') {
            const spread = evaluate(element.argument);
            if (!Array.isArray(spread)) throw sourceError(element, '数组展开值必须是数组');
            result.push(...spread);
          } else result.push(evaluate(element));
        }
        return result;
      }
      case 'ObjectExpression': {
        const result = Object.create(null);
        for (const property of node.properties) {
          if (property.type === 'SpreadElement') {
            const spread = evaluate(property.argument);
            if (!spread || typeof spread !== 'object' || Array.isArray(spread)) throw sourceError(property, '对象展开值必须是对象');
            Object.assign(result, spread);
          } else if (property.type === 'ObjectProperty') {
            result[propertyKey(property.key, property.computed)] = evaluate(property.value);
          } else throw sourceError(property, '配置数据中不能包含方法、getter 或 setter');
        }
        return result;
      }
      case 'UnaryExpression': {
        const value = evaluate(node.argument);
        if (node.operator === '!') return !value;
        if (typeof value !== 'number' || !['+', '-'].includes(node.operator)) throw sourceError(node, '仅支持数值正负号和布尔取反');
        return node.operator === '-' ? -value : value;
      }
      case 'BinaryExpression': {
        const left = evaluate(node.left), right = evaluate(node.right);
        if (node.operator === '+' && typeof left === 'string' && typeof right === 'string') return left + right;
        if (typeof left !== 'number' || typeof right !== 'number') throw sourceError(node, '算术表达式两侧必须都是数值');
        const operations = { '+': () => left + right, '-': () => left - right, '*': () => left * right, '/': () => left / right, '%': () => left % right, '**': () => left ** right };
        if (!Object.hasOwn(operations, node.operator)) throw sourceError(node, `不支持运算符 ${node.operator}`);
        const result = operations[node.operator]();
        if (!Number.isFinite(result)) throw sourceError(node, '表达式结果必须是有限数值');
        return result;
      }
      case 'TemplateLiteral': {
        let result = node.quasis[0].value.cooked;
        for (let index = 0; index < node.expressions.length; index += 1) {
          const value = evaluate(node.expressions[index]);
          if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw sourceError(node, '模板字符串只能引用简单数据');
          result += String(value) + node.quasis[index + 1].value.cooked;
        }
        return result;
      }
      case 'MemberExpression': {
        const value = evaluate(node.object);
        const key = propertyKey(node.property, node.computed);
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw sourceError(node, `配置数据不存在属性 ${key}`);
        return value[key];
      }
      default:
        throw sourceError(node, `无法静态转换 ${node.type}，请将配置改为直接的数据声明（不支持函数调用生成配置）`);
    }
  }
  const configuration = Object.fromEntries(EXPORT_NAMES.map((name) => [name, variable(exports.get(name), declarations.get(exports.get(name)))]));
  return validateDisplayConsoleRuntimeConfiguration(configuration);
}

async function existingFile(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function convertDisplayConsoleConfig({
  input = path.join(PROJECT_ROOT, 'src/constants/displayConsoleConfig.js'),
  output = path.join(PROJECT_ROOT, 'output/display-console.json'),
  overwrite = false,
  check = false
} = {}) {
  input = path.resolve(input);
  output = path.resolve(output);
  if (input === output) throw new Error('输入文件与输出文件不能相同');
  const configuration = extractDisplayConsoleConfiguration(await readFile(input, 'utf8'), input);
  if (check) return { status: 'checked', input, output, configuration };
  const contents = `${JSON.stringify(configuration, null, 2)}\n`;
  const existing = await existingFile(output);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error(`输出路径必须是普通文件：${output}`);
  if (existing && await realpath(input) === await realpath(output)) throw new Error('输入文件与输出文件不能指向同一文件');
  if (existing) {
    if (await readFile(output, 'utf8') === contents) return { status: 'unchanged', input, output, configuration };
    if (!overwrite) throw new Error(`输出文件已存在：${output}；替换时添加 --overwrite`);
  }
  await mkdir(path.dirname(output), { recursive: true });
  if (!existing) {
    // Exclusive creation also prevents accidentally replacing a file created
    // between the existence check and the write.
    await writeFile(output, contents, { encoding: 'utf8', flag: 'wx' });
  } else {
    const temporary = path.join(path.dirname(output), `.display-console-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, output);
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return { status: 'written', input, output, configuration };
}

const HELP = `将 displayConsoleConfig.js 的四项数据导出转换为显控台运行时 JSON。

用法：node tools/convert_display_console_config.mjs [选项]
  -i, --input <文件>   源 JS（默认：本项目 src/constants/displayConsoleConfig.js）
  -o, --output <文件>  输出 JSON（默认：本项目 output/display-console.json）
      --overwrite     允许替换内容不同的已有输出文件
      --check         只检查源文件及配置，不写文件
  -h, --help          显示帮助

支持注释、单引号、尾随逗号、科学计数法、静态变量引用及数组/对象展开。
函数保留在平台程序中，不写入 JSON；源文件中的函数、导入和执行语句不会运行。
`;

export async function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args, options: {
      input: { type: 'string', short: 'i' }, output: { type: 'string', short: 'o' },
      overwrite: { type: 'boolean' }, check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
    } });
    if (values.help) { console.log(HELP); return 0; }
    const result = await convertDisplayConsoleConfig(values);
    const config = result.configuration;
    const summary = `${config.DISPLAY_CONSOLE_INPUTS.length} 个输入元素，${config.DISPLAY_CONSOLE_COLUMNS.length} 列，${Object.keys(config.DISPLAY_CONSOLE_PRESETS).length} 个显控台`;
    console.log(`${{ checked: '检查通过', unchanged: '内容一致，无需更新', written: '转换成功' }[result.status]}：${summary}`);
    if (!values.check) console.log(`输出：${result.output}`);
    return 0;
  } catch (error) {
    console.error(`转换失败：${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
