import { describe, expect, it } from 'vitest';
import {
  readSimulationBlockValuesFromPanel,
  renderSimulationBlockFieldsFromSchema
} from '../src/services/simulationPropertyPanelSchema.js';

const moduleTypes = ['一阶函数', '微分', '积分'];
const portFormats = ['标量', '向量', '矩阵'];
const interfaceLimits = {
  inputs: [1, 6],
  outputs: [1, 6],
  middleVars: [0, 6]
};

describe('simulation property panel schema service', () => {
  it('renders editable fields for an unbound simulation block', () => {
    const html = renderSimulationBlockFieldsFromSchema({
      type: 'simulation_block',
      props: {
        name: '控制 <A>',
        moduleType: '积分',
        inputs: [{ name: '误差', type: '标量' }],
        outputs: [{ name: '控制量', type: '向量' }],
        middleVars: [{ name: '积分项', type: '标量' }],
        ffunctionNote: 'note <x>'
      }
    }, {
      moduleTypes,
      portFormats,
      interfaceLimits
    });

    expect(html).toContain('id="prop-name"');
    expect(html).toContain('id="prop-moduleType"');
    expect(html).toContain('id="sim-input-count"');
    expect(html).toContain('id="sim-output-count"');
    expect(html).toContain('id="sim-middle-count"');
    expect(html).toContain('id="prop-ffunctionNote"');
    expect(html).toContain('data-role="输入"');
    expect(html).toContain('data-role="输出"');
    expect(html).toContain('data-role="中间变量"');
    expect(html).toContain('电源接口');
    expect(html).toContain('只有接入类型和额定电压均匹配的电源，仿真组件才能运行。');
    expect(html).not.toContain('电源地');
    expect(html).toContain('控制 &lt;A&gt;');
    expect(html).toContain('note &lt;x&gt;');
    expect(html).toContain('<option value="积分" selected>积分</option>');
  });

  it('renders readonly Python binding fields without editable interface counts', () => {
    const html = renderSimulationBlockFieldsFromSchema({
      type: 'simulation_block',
      props: {
        name: 'PID',
        inputs: [{ name: '输入 1', type: '标量' }],
        outputs: [{ name: '输出 1', type: '标量' }],
        middleVars: []
      }
    }, {
      binding: {
        bound: true,
        fileName: 'pid.py',
        moduleName: 'pid_module',
        entryFunction: 'process',
        description: 'PID <controller>',
        executionMode: 'backend',
        sourcePackageName: '飞控模型包',
        portMapping: {
          inputs: [{ name: 'error', type: 'float' }],
          outputs: [{ name: 'command', type: 'float' }],
          middleVars: [{ name: 'integral', type: 'float' }]
        }
      },
      buildPythonBindingPortRows(items, kind) {
        return `<div data-python-kind="${kind}">${items.map((item) => item.name).join(',')}</div>`;
      },
      getPythonBindingSummary() {
        return 'error -> command';
      }
    });

    expect(html).toContain('id="prop-name"');
    expect(html).toContain('pid.py');
    expect(html).toContain('pid_module');
    expect(html).toContain('process');
    expect(html).toContain('PID &lt;controller&gt;');
    expect(html).toContain('data-python-port-kind="inputs"');
    expect(html).toContain('data-python-port-kind="outputs"');
    expect(html).not.toContain('中间变量观测端口');
    expect(html).not.toContain('data-python-port-kind="middleVars"');
    expect(html).toContain('电源接口');
    expect(html).not.toContain('执行方式');
    expect(html).not.toContain('执行模式');
    expect(html).not.toContain('error -&gt; command');
    expect(html).not.toContain('id="sim-input-count"');
    expect(html).not.toContain('id="prop-moduleType"');
  });

  it('renders current model parameter values as editable numeric fields and reads their changes', () => {
    const node = {
      type: 'simulation_block',
      props: {
        parameters: [
          { key: 'bias', name: '高度偏置', default: 0, unit: 'm', min: -1000, max: 1000 },
          { key: 'scale', name: '高度比例', default: 1, unit: '', min: 0, max: 10 }
        ],
        parameterValues: { bias: 2.5, scale: 1.2 }
      }
    };
    const binding = { bound: true, portMapping: { inputs: [], outputs: [], middleVars: [] } };
    const html = renderSimulationBlockFieldsFromSchema(node, { binding });

    expect(html).toContain('data-simulation-parameter="bias"');
    expect(html).toContain('value="2.5"');
    expect(html).toContain('高度偏置');

    document.body.innerHTML = html;
    document.querySelector('[data-simulation-parameter="bias"]').value = '3';
    document.querySelector('[data-simulation-parameter="scale"]').value = '0.75';

    expect(readSimulationBlockValuesFromPanel(node, document, { binding })).toEqual({
      values: {
        parameterValues: { bias: 3, scale: 0.75 }, parameterUnits: {},
        powerInputs: [{ name: '电源输入', type: '电源', supplyType: 'DC', voltage: '28V' }], powerOutputs: []
      },
      shouldPruneInvalidEdges: false
    });
  });

  it('reads the required supply type and rated voltage from the property panel', () => {
    const node = {
      type: 'simulation_block',
      props: { powerInputs: [{ name: '主电源', voltage: '28V', supplyType: 'DC' }] }
    };
    const binding = { bound: true, portMapping: { inputs: [], outputs: [], middleVars: [] } };
    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, { binding });

    document.querySelector('[data-simulation-power-type="0"]').value = 'AC';
    document.querySelector('[data-simulation-power-voltage="0"]').value = '220';

    expect(readSimulationBlockValuesFromPanel(node, document, { binding }).values.powerInputs).toEqual([
      { name: '主电源', type: '电源', supplyType: 'AC', voltage: '220V' }
    ]);
  });

  it('does not render or save a supply interface for an electrical component', () => {
    const node = {
      type: 'simulation_block',
      templateId: 'electrical_ac_power_source',
      props: { parameters: [] }
    };
    const binding = { bound: true, portMapping: { inputs: [], outputs: [], middleVars: [] } };
    const html = renderSimulationBlockFieldsFromSchema(node, { binding });

    expect(html).not.toContain('电源接口');
    expect(readSimulationBlockValuesFromPanel(node, document, { binding }).values).toEqual({
      parameterValues: {}, parameterUnits: {}
    });
  });

  it('converts a selected MHz frequency value to the backend Hz parameter', () => {
    const node = {
      type: 'simulation_block',
      props: {
        parameters: [{ key: 'center_frequency_hz', name: '中心频率', default: 100, unit: 'Hz' }],
        parameterValues: { center_frequency_hz: 2500000 },
        parameterUnits: { center_frequency_hz: 'MHz' }
      }
    };
    const binding = { bound: true, portMapping: { inputs: [], outputs: [], middleVars: [] } };
    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, { binding });

    expect(document.querySelector('[data-simulation-parameter="center_frequency_hz"]')?.value).toBe('2.5');
    expect(document.querySelector('[data-simulation-parameter-unit="center_frequency_hz"]')?.value).toBe('MHz');

    document.querySelector('[data-simulation-parameter="center_frequency_hz"]').value = '5';
    document.querySelector('[data-simulation-parameter-unit="center_frequency_hz"]').value = 'kHz';

    expect(readSimulationBlockValuesFromPanel(node, document, { binding })).toEqual({
      values: {
        parameterValues: { center_frequency_hz: 5000 },
        parameterUnits: { center_frequency_hz: 'kHz' },
        powerInputs: [{ name: '电源输入', type: '电源', supplyType: 'DC', voltage: '28V' }], powerOutputs: []
      },
      shouldPruneInvalidEdges: false
    });
  });

  it('renders declared parameter options as a selectable mode field', () => {
    const node = {
      type: 'simulation_block',
      props: {
        parameters: [{
          key: 'input_mode',
          name: '输入选择模式',
          default: 1,
          control: 'stepper',
          options: [
            { value: 1, label: '模式 1：第一路输入' },
            { value: 2, label: '模式 2：第二路输入' }
          ]
        }],
        parameterValues: { input_mode: 1 }
      }
    };
    const binding = { bound: true, portMapping: { inputs: [], outputs: [], middleVars: [] } };
    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, { binding });

    const mode = document.querySelector('[data-simulation-parameter="input_mode"]');
    expect(document.querySelector('[data-simulation-parameter-mode-switch="input_mode"]')).not.toBeNull();
    expect(document.querySelector('[data-simulation-parameter-mode-select="1"]')?.classList.contains('is-active')).toBe(true);
    expect(mode?.getAttribute('type')).toBe('hidden');
    expect(mode?.value).toBe('1');
    mode.value = '2';

    expect(readSimulationBlockValuesFromPanel(node, document, { binding }).values.parameterValues).toEqual({ input_mode: 2 });
  });

  it.skip('reads unbound simulation block values and normalizes interface counts', () => {
    const node = {
      type: 'simulation_block',
      props: {
        name: '仿真块',
        moduleType: '一阶函数',
        inputs: [{ name: '输入 1', type: '标量' }],
        outputs: [{ name: '输出 1', type: '标量' }],
        middleVars: [{ name: '中间量 1', type: '标量' }],
        ffunctionNote: 'old'
      }
    };

    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, {
      moduleTypes,
      portFormats,
      interfaceLimits
    });

    document.getElementById('prop-name').value = ' 仿真 A ';
    document.getElementById('prop-moduleType').value = '积分';
    document.getElementById('sim-input-count').value = '2';
    document.getElementById('sim-output-count').value = '1';
    document.getElementById('sim-middle-count').value = '0';
    document.querySelector('.sim-intf-row[data-role="输入"] [data-sim-field="name"]').value = '';
    document.querySelector('.sim-intf-row[data-role="输出"] [data-sim-field="name"]').value = '控制输出';
    document.getElementById('prop-ffunctionNote').value = ' 新说明 ';

    expect(readSimulationBlockValuesFromPanel(node, document, {
      interfaceLimits
    })).toEqual({
      values: {
        name: '仿真 A',
        moduleType: '积分',
        inputs: [
          { name: '输入 1', type: '标量' },
          { name: '输入 2', type: '标量' }
        ],
        outputs: [
          { name: '控制输出', type: '标量' }
        ],
        middleVars: [],
        ffunctionNote: '新说明'
      },
      shouldPruneInvalidEdges: true
    });
  });

  it.skip('reads only the editable name when a simulation block is Python-bound', () => {
    document.body.innerHTML = `
      <input id="prop-name" value=" Bound PID ">
      <select id="prop-moduleType"><option value="积分" selected>积分</option></select>
      <input id="sim-input-count" value="4">
    `;

    expect(readSimulationBlockValuesFromPanel({
      type: 'simulation_block',
      props: {
        name: 'PID',
        moduleType: '一阶函数',
        inputs: [{ name: '输入 1', type: '标量' }],
        outputs: [{ name: '输出 1', type: '标量' }],
        middleVars: []
      }
    }, document, {
      binding: { bound: true }
    })).toEqual({
      values: {
        name: 'Bound PID'
      },
      shouldPruneInvalidEdges: false
    });
  });
});
