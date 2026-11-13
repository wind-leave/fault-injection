// @vitest-environment node
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  convertDisplayConsoleConfig,
  extractDisplayConsoleConfiguration
} from '../tools/convert_display_console_config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools/convert_display_console_config.mjs');
const roots = [];

async function temporaryDirectory() {
  const parent = path.join(repoRoot, 'tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'console-converter-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    // These directories are created by this test and are always inside repo/tmp.
    if (path.dirname(root) !== path.join(repoRoot, 'tmp') || !path.basename(root).startsWith('console-converter-')) throw new Error('Unexpected temporary path');
    await rm(root, { recursive: true, force: true });
  }
});

const minimalSource = `
export const DISPLAY_CONSOLE_INPUTS = [{key:'temperature',label:'温度',type:'float',}];
export let DISPLAY_CONSOLE_VECTOR_PORT_ID = 'temperature-input';
export const DISPLAY_CONSOLE_COLUMNS = [{key:'temperature',label:'温度',source:'input',inputIndex:0,}];
export const DISPLAY_CONSOLE_PRESETS = {
  display_console_8: {
    name: '温度显控台',
    controls: [{componentType:'discovered_temperature_sensor',parameterKeys:['bias'],}],
    sharedParameters: [{key:'bias',bindings:[{componentType:'discovered_temperature_sensor',parameterKey:'bias'},],}],
  },
};
export function createDisplayConsoleConfig() { throw new Error('This function must not run'); }
`;

describe('display-console JS to JSON converter', () => {
  it('converts all four data exports in the real source without changing it', async () => {
    const filename = path.join(repoRoot, 'src/constants/displayConsoleConfig.js');
    const source = await readFile(filename, 'utf8');
    const result = extractDisplayConsoleConfiguration(source, filename);
    const constants = await import('../src/constants/displayConsoleConfig.js');
    expect(Object.keys(result)).toEqual(['DISPLAY_CONSOLE_INPUTS', 'DISPLAY_CONSOLE_VECTOR_PORT_ID', 'DISPLAY_CONSOLE_COLUMNS', 'DISPLAY_CONSOLE_PRESETS']);
    for (const key of Object.keys(result)) expect(result[key]).toEqual(constants[key]);
    expect(await readFile(filename, 'utf8')).toBe(source);
  });

  it('handles BOM, comments, trailing commas, negative values and retains controls and shared parameters', () => {
    const source = '\uFEFF// 中文注释\r\n' + minimalSource.replace("type:'float',", "type:'float',displayScale:-1e-6,generateMeasurementPoint:false,");
    const result = extractDisplayConsoleConfiguration(source);
    expect(result.DISPLAY_CONSOLE_INPUTS[0]).toMatchObject({ displayScale: -0.000001, generateMeasurementPoint: false });
    expect(result.DISPLAY_CONSOLE_PRESETS.display_console_8.sharedParameters[0].bindings[0].parameterKey).toBe('bias');
  });

  it('supports named export aliases, static references, spreads, arithmetic, template strings and data property references', () => {
    const result = extractDisplayConsoleConfiguration(`
      import { notUsed } from './file-that-does-not-exist.js';
      const key = 'temperature', input = {key, label:'温度', type:'float', displayScale:1 / 1000};
      const base = [input], inputs = [...base];
      const port = \`input-\${key}\`;
      const columns = [{key:input.key, label:'温度' + '读数', source:'input', inputIndex:inputs.length - 1}];
      const original = {display_console_8:{name:'现场台'}};
      const presets = {...original};
      export {inputs as DISPLAY_CONSOLE_INPUTS, port as DISPLAY_CONSOLE_VECTOR_PORT_ID,
              columns as DISPLAY_CONSOLE_COLUMNS, presets as DISPLAY_CONSOLE_PRESETS};
    `);
    expect(result.DISPLAY_CONSOLE_VECTOR_PORT_ID).toBe('input-temperature');
    expect(result.DISPLAY_CONSOLE_INPUTS[0].displayScale).toBe(0.001);
    expect(result.DISPLAY_CONSOLE_COLUMNS[0]).toMatchObject({ label: '温度读数', inputIndex: 0 });
  });

  it('reports missing exports instead of silently substituting the current version defaults', () => {
    expect(() => extractDisplayConsoleConfiguration(minimalSource.replace("export let DISPLAY_CONSOLE_VECTOR_PORT_ID = 'temperature-input';", ''))).toThrow('缺少配置导出：DISPLAY_CONSOLE_VECTOR_PORT_ID');
  });

  it.each([
    [minimalSource + '\nDISPLAY_CONSOLE_PRESETS.display_console_8.name = "changed";', '顶层执行语句'],
    [minimalSource + '\nconst mutate = (DISPLAY_CONSOLE_PRESETS.display_console_8.name = "changed");', '顶层变量初始化'],
    [minimalSource.replace("'temperature-input'", 'getPortId()'), '不支持函数调用生成配置'],
    [minimalSource.replace("'temperature-input'", 'unknownVariable'), '无法静态读取变量'],
    [minimalSource.replace("'temperature-input'", 'loopA') + '\nconst loopA = loopB, loopB = loopA;', '循环引用'],
    [minimalSource.replace('inputIndex:0', 'inputIndex:1'), 'inputIndex']
  ])('rejects unsupported or invalid configuration with a useful error', (source, message) => {
    expect(() => extractDisplayConsoleConfiguration(source)).toThrow(message);
  });

  it('validates before writing, preserves existing output on errors, and makes overwrite explicit', async () => {
    const root = await temporaryDirectory();
    const input = path.join(root, '其他版本配置.js'), output = path.join(root, 'display-console.json');
    await writeFile(input, minimalSource, 'utf8');
    await writeFile(output, '{"original":true}\n', 'utf8');
    await expect(convertDisplayConsoleConfig({ input, output })).rejects.toThrow('--overwrite');
    expect(await readFile(output, 'utf8')).toBe('{"original":true}\n');
    await writeFile(input, minimalSource.replace('inputIndex:0', 'inputIndex:9'), 'utf8');
    await expect(convertDisplayConsoleConfig({ input, output, overwrite: true })).rejects.toThrow('inputIndex');
    expect(await readFile(output, 'utf8')).toBe('{"original":true}\n');
    await writeFile(input, minimalSource, 'utf8');
    expect((await convertDisplayConsoleConfig({ input, output, overwrite: true })).status).toBe('written');
    expect(JSON.parse(await readFile(output, 'utf8')).DISPLAY_CONSOLE_VECTOR_PORT_ID).toBe('temperature-input');
    expect((await convertDisplayConsoleConfig({ input, output })).status).toBe('unchanged');
    expect(await readFile(input, 'utf8')).toBe(minimalSource);
    await expect(convertDisplayConsoleConfig({ input, output: input, overwrite: true })).rejects.toThrow('不能相同');
  });

  it('supports a dry check and runs the CLI from another working directory with Unicode and spaces in paths', async () => {
    const root = await temporaryDirectory();
    const input = path.join(root, '旧版本 配置.js'), output = path.join(root, '运行配置', 'display-console.json');
    await writeFile(input, minimalSource, 'utf8');
    expect((await convertDisplayConsoleConfig({ input, output, check: true })).status).toBe('checked');
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const cli = spawnSync(process.execPath, [script, '--input', input, '--output', output], { cwd: root, encoding: 'utf8' });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('转换成功');
    expect(JSON.parse(await readFile(output, 'utf8')).DISPLAY_CONSOLE_PRESETS.display_console_8.name).toBe('温度显控台');
    await writeFile(input, minimalSource.replace('inputIndex:0', 'inputIndex:2'), 'utf8');
    const invalid = spawnSync(process.execPath, [script, '--input', input, '--output', output, '--overwrite'], { cwd: root, encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('inputIndex');
    const help = spawnSync(process.execPath, [script, '--help'], { cwd: root, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--check');
  });
});
