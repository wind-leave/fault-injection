import { describe, expect, it } from 'vitest';
import { renderSimulationBlockFieldsFromSchema } from '../src/services/simulationPropertyPanelSchema.js';

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
    expect(html).toContain('data-python-kind="inputs"');
    expect(html).toContain('data-python-kind="outputs"');
    expect(html).toContain('data-python-kind="middleVars"');
    expect(html).toContain('backend');
    expect(html).toContain('error -&gt; command');
    expect(html).not.toContain('id="sim-input-count"');
    expect(html).not.toContain('id="prop-moduleType"');
  });
});
