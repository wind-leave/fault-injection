import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PythonBindingDialog from '../src/components/dialogs/PythonBindingDialog.vue';
import { createSimulationBlockPythonBinding } from '../src/composables/useWorkbenchState.js';
import { getPythonBindingPortCounts } from '../src/services/canvasGraph.js';
import { executePythonBindingSync } from '../src/services/pythonExecutionAdapter.js';

const parsedInterface = {
  fileName: 'pid_controller.py',
  moduleName: 'pid_controller',
  description: 'PID 控制器计算模块',
  entryFunction: 'process',
  inputs: [
    { name: 'error', type: 'float', default: null, comment: '误差信号' },
    { name: 'dt', type: 'float', default: '0.01', comment: '时间步长' }
  ],
  outputs: [
    { name: 'output_0', type: 'float', comment: '控制量' },
    { name: 'output_1', type: 'float', comment: '饱和控制量' }
  ],
  middleVars: [
    { name: 'integral', type: 'float', comment: '积分累计' }
  ],
  rawSource: 'def process(error, dt=0.01): return error, error'
};

describe('Python binding UI and state helpers', () => {
  it('renders parsed interface summary in the dialog', () => {
    const wrapper = mount(PythonBindingDialog, {
      props: {
        open: true,
        targetNode: { id: 'node-1', label: '仿真块 1' },
        parsedInterface
      }
    });

    expect(wrapper.text()).toContain('绑定 Python 文件');
    expect(wrapper.text()).toContain('pid_controller.py');
    expect(wrapper.text()).toContain('误差信号');
    expect(wrapper.text()).toContain('确认绑定');
  });

  it('maps parsed interface into runtime binding metadata', () => {
    const binding = createSimulationBlockPythonBinding(parsedInterface);

    expect(binding.bound).toBe(true);
    expect(binding.fileName).toBe('pid_controller.py');
    expect(binding.portMapping.inputs[0]).toMatchObject({
      portId: 'input-0',
      varName: 'error',
      displayName: '误差信号',
      type: 'float',
      connected: false
    });
    expect(binding.portMapping.outputs[1]).toMatchObject({
      portId: 'output-1',
      varName: 'output_1'
    });
    expect(binding.portMapping.middleVars[0]).toMatchObject({
      portId: 'middle-0',
      varName: 'integral'
    });
  });

  it('derives dynamic port counts from a bound simulation block', () => {
    const counts = getPythonBindingPortCounts({
      type: 'simulation_block',
      pythonBinding: createSimulationBlockPythonBinding(parsedInterface)
    });

    expect(counts).toEqual({ inputs: 2, outputs: 2, middleVars: 1 });
  });

  it('returns deterministic values in mock execution mode', () => {
    const result = executePythonBindingSync({
      adapterMode: 'mock',
      payload: {
        nodeId: 'node-1',
        inputs: { error: 0.5, dt: 0.01 },
        outputNames: ['output_0', 'output_1'],
        middleVarNames: ['integral']
      }
    });

    expect(result.outputs.output_0).toBeTypeOf('number');
    expect(result.outputs.output_1).toBeTypeOf('number');
    expect(result.middleVars.integral).toBeTypeOf('number');
  });

  it('runs simple bound Python source in mock execution mode', () => {
    const source = [
      'def process(pitch_command=0.0):',
      '    value = float(pitch_command)',
      '    shaped_command = max(min(value, 1.0), -1.0)',
      '    filtered_command = shaped_command',
      '    return {"shaped_command": shaped_command}, {"filtered_command": filtered_command}'
    ].join('\n');

    const result = executePythonBindingSync({
      adapterMode: 'mock',
      payload: {
        moduleName: 'command_shaper',
        fileName: 'command_shaper.py',
        entryFunction: 'process',
        source,
        inputs: { pitch_command: 1.8 },
        outputNames: ['shaped_command'],
        middleVarNames: ['filtered_command']
      }
    });

    expect(result.outputs.shaped_command).toBe(1);
    expect(result.middleVars.filtered_command).toBe(1);
  });
});
