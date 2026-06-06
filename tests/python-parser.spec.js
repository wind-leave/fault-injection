import { describe, expect, it } from 'vitest';
import { parsePythonBindingSource } from '../src/services/pythonParserService.js';

const PID_SOURCE = `
"""
Module: pid_controller
Description: PID 控制器计算模块
"""

def process(
    error: float,           # 输入：误差信号
    dt: float = 0.01,       # 输入：时间步长
    kp: float = 1.0,        # 输入：比例系数
    ki: float = 0.1,        # 输入：积分系数
    kd: float = 0.05        # 输入：微分系数
) -> tuple:
    """
    主处理函数，系统将自动识别此函数作为模块的计算入口。
    """
    # @observable
    integral = 0.0          # 中间变量：积分累积
    # @observable
    derivative = 0.0        # 中间变量：微分项

    integral += error * dt
    derivative = (error - 0) / dt

    output = kp * error + ki * integral + kd * derivative

    # @observable
    saturated_output = max(-1.0, min(1.0, output))  # 中间变量：饱和输出
    return output, saturated_output   # 输出：控制量, 饱和控制量
`;

describe('parsePythonBindingSource', () => {
  it('extracts interface metadata and Chinese display labels from a process() function', () => {
    const result = parsePythonBindingSource({
      fileName: 'pid_controller.py',
      source: PID_SOURCE
    });

    expect(result.fileName).toBe('pid_controller.py');
    expect(result.moduleName).toBe('pid_controller');
    expect(result.description).toBe('PID 控制器计算模块');
    expect(result.entryFunction).toBe('process');
    expect(result.inputs).toEqual([
      { name: 'error', displayName: '误差信号', type: 'float', default: null, comment: '误差信号' },
      { name: 'dt', displayName: '时间步长', type: 'float', default: '0.01', comment: '时间步长' },
      { name: 'kp', displayName: '比例系数', type: 'float', default: '1.0', comment: '比例系数' },
      { name: 'ki', displayName: '积分系数', type: 'float', default: '0.1', comment: '积分系数' },
      { name: 'kd', displayName: '微分系数', type: 'float', default: '0.05', comment: '微分系数' }
    ]);
    expect(result.outputs).toEqual([
      { name: 'output_0', displayName: '控制量', type: 'float', comment: '控制量' },
      { name: 'output_1', displayName: '饱和控制量', type: 'float', comment: '饱和控制量' }
    ]);
    expect(result.middleVars).toEqual([
      { name: 'integral', displayName: '积分累积', type: 'float', comment: '积分累积' },
      { name: 'derivative', displayName: '微分项', type: 'float', comment: '微分项' },
      { name: 'saturated_output', displayName: '饱和输出', type: 'float', comment: '饱和输出' }
    ]);
  });

  it('supports compact Chinese comments for port display labels', () => {
    const result = parsePythonBindingSource({
      fileName: 'force_model.py',
      source: `
def process(force: float, mass: float = 2.0): # 输入：力, 质量
    # @observable
    acceleration = force / mass # 中间变量：加速度
    return acceleration # 输出：加速度输出
`
    });

    expect(result.inputs.map((item) => item.displayName)).toEqual(['力', '质量']);
    expect(result.outputs[0]).toMatchObject({ name: 'output_0', displayName: '加速度输出' });
    expect(result.middleVars[0]).toMatchObject({ name: 'acceleration', displayName: '加速度' });
  });

  it('prefers # @entry when multiple functions exist', () => {
    const result = parsePythonBindingSource({
      fileName: 'entry_case.py',
      source: `
def helper(x: float):
    return x

# @entry
def run(signal: float, gain: float = 2.0):
    return signal * gain
`
    });

    expect(result.entryFunction).toBe('run');
    expect(result.inputs).toEqual([
      { name: 'signal', displayName: 'signal', type: 'float', default: null, comment: '' },
      { name: 'gain', displayName: 'gain', type: 'float', default: '2.0', comment: '' }
    ]);
    expect(result.outputs).toEqual([{ name: 'output_0', displayName: 'output_0', type: 'float', comment: '' }]);
  });

  it('throws a structured parse error when no entry function exists', () => {
    expect(() =>
      parsePythonBindingSource({
        fileName: 'broken.py',
        source: 'x = 1\ny = 2'
      })
    ).toThrow(/PYTHON_PARSE_ERROR/);
  });
});
