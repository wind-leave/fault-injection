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
    expect(html).toContain('data-python-port-kind="middleVars"');
    expect(html).toContain('backend');
    expect(html).toContain('error -&gt; command');
    expect(html).not.toContain('id="sim-input-count"');
    expect(html).not.toContain('id="prop-moduleType"');
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
