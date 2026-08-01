import { createSignalSourceProps } from './signalSourceDomainService.js';
import {
  DISPLAY_CONSOLE_INPUTS,
  DISPLAY_CONSOLE_PRESETS,
  createDisplayConsoleConfig
} from '../constants/displayConsoleConfig.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SIMULATION_COMPONENT_MIN_WIDTH = 196;
const SIMULATION_COMPONENT_MIN_HEIGHT = 116;
const SIMULATION_COMPONENT_MAX_WIDTH = 320;
const SIMULATION_COMPONENT_MAX_HEIGHT = 360;

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? Math.round(dimension) : null;
}

function resolveSimulationComponentDimensions(inputs, outputs, width, height) {
  const portCount = Math.max(inputs.length, outputs.length, 1);
  const automaticWidth = Math.min(
    SIMULATION_COMPONENT_MAX_WIDTH,
    SIMULATION_COMPONENT_MIN_WIDTH + Math.max(0, portCount - 2) * 16
  );
  const automaticHeight = Math.min(
    SIMULATION_COMPONENT_MAX_HEIGHT,
    Math.max(SIMULATION_COMPONENT_MIN_HEIGHT, 76 + portCount * 28)
  );
  return {
    width: positiveDimension(width) ?? automaticWidth,
    height: positiveDimension(height) ?? automaticHeight
  };
}

function createDisplayConsoleTemplates() {
  return Object.fromEntries(Object.entries(DISPLAY_CONSOLE_PRESETS).map(([templateId, preset]) => {
    const displayConfig = createDisplayConsoleConfig(preset);
    return [templateId, {
      type: templateId,
      nodeType: 'display_console',
      templateId,
      group: 'display-control',
      label: preset.name || templateId,
      badge: '显控',
      className: 'b-display-console',
      width: 196,
      height: 118,
      palette: {
        icon: '显',
        iconClass: 'display-control'
      },
      defaults: {
        name: preset.name || templateId,
        consoleType: '射频参数显控',
        displayConfig,
        inputPortNames: displayConfig.inputs.map((item) => item.label)
      }
    }];
  }));
}

const DISPLAY_CONSOLE_TEMPLATES = createDisplayConsoleTemplates();

/**
 * Build a Python-backed simulation component from one concise interface
 * definition.  The workbench still receives its legacy `defaults`, `ports`
 * and `pythonBinding.portMapping` shapes, but component authors only describe
 * each signal and parameter once.
 */
export function createPythonSimulationComponent({
  type,
  simulationMenu,
  label,
  moduleType,
  inputs = [],
  outputs = [],
  parameters = [],
  rawSource,
  description = `${label}模型`,
  entryFunction = 'process',
  executionMode = 'mock',
  badge = '仿真',
  className = 'b-sim',
  width,
  height,
  title,
  palette = { icon: '仿', iconClass: 'simulation' },
  powerInputs = [{ name: '电源输入', type: '电源', voltage: '28V' }],
  powerOutputs = [{ name: '电源地', type: '电源', voltage: '0V' }],
  ffunctionNote = '',
  faultSlots = []
}) {
  const dimensions = resolveSimulationComponentDimensions(inputs, outputs, width, height);
  const fileName = `${type}.py`;
  const isVector = (item) => item.dataType === 'vector' || item.type === 'vector' || item.type === '向量';
  const signalType = (item) => item.type ?? (isVector(item) ? 'vector' : 'float');
  const displayType = (item) => item.displayType ?? (isVector(item) ? '向量' : '标量');
  const vectorContract = (item) => (isVector(item) && Number.isInteger(item.vectorLength) && item.vectorLength > 0
    ? { dataType: 'vector', vectorLength: item.vectorLength }
    : {});
  const makePort = (item, direction, index) => {
    const portId = String(item.portId ?? '').trim();
    if (!portId) {
      throw new Error(`${type}.${direction}s[${index}].portId is required`);
    }
    return {
      id: String(item.id ?? portId),
      portId,
      signalId: `${type}.${item.varName}`,
      varName: item.varName,
      name: item.name,
      displayName: item.name,
      type: signalType(item),
      ...vectorContract(item),
      ...(item.unit ? { unit: item.unit } : {}),
      direction
    };
  };
  const makeBindingPort = (port, item, connected = false) => ({
    portId: port.portId,
    signalId: port.signalId,
    varName: port.varName,
    displayName: port.displayName,
    type: port.type,
    ...(port.dataType ? { dataType: port.dataType } : {}),
    ...(port.vectorLength ? { vectorLength: port.vectorLength } : {}),
    ...(item.default === undefined ? {} : { default: item.default }),
    comment: item.name,
    ...(connected ? { connected: false } : {})
  });
  const ports = {
    inputs: inputs.map((item, index) => makePort(item, 'input', index)),
    outputs: outputs.map((item, index) => makePort(item, 'output', index))
  };
  const parsedInterface = {
    fileName,
    moduleName: type,
    description,
    entryFunction,
    inputs: [
      ...inputs.map((item) => ({
        name: item.varName,
        displayName: item.name,
        type: signalType(item),
        ...vectorContract(item),
        comment: item.name,
        default: null
      })),
      ...parameters.map((item) => ({
        name: item.key,
        displayName: item.name,
        type: signalType(item),
        comment: item.name,
        default: item.default
      }))
    ],
    outputs: outputs.map((item) => ({
      name: item.varName,
      displayName: item.name,
      type: signalType(item),
      ...vectorContract(item),
      comment: item.name
    })),
    middleVars: [],
    ...(rawSource ? { rawSource } : {})
  };

  return {
    type,
    nodeType: 'simulation_block',
    templateId: type,
    group: 'simulation',
    ...(simulationMenu ? { simulationMenu } : {}),
    label,
    badge,
    className,
    width: dimensions.width,
    height: dimensions.height,
    ...(title ? { title } : {}),
    palette,
    defaults: {
      name: label,
      moduleType,
      inputs: inputs.map((item) => ({
        name: item.name,
        type: displayType(item),
        ...vectorContract(item),
        varName: item.varName,
        ...(item.unit ? { unit: item.unit } : {})
      })),
      outputs: outputs.map((item) => ({
        name: item.name,
        type: displayType(item),
        ...vectorContract(item),
        varName: item.varName,
        ...(item.unit ? { unit: item.unit } : {})
      })),
      middleVars: [],
      powerInputs: clone(powerInputs),
      powerOutputs: clone(powerOutputs),
      parameters: clone(parameters),
      ffunctionNote
    },
    ports,
    pythonBinding: {
      bound: true,
      moduleId: type,
      fileName,
      moduleName: type,
      moduleCategory: moduleType,
      description,
      entryFunction,
      parsedInterface,
      ...(rawSource ? { rawSource } : {}),
      executionMode,
      portMapping: {
        inputs: ports.inputs.map((port, index) => makeBindingPort(port, { ...inputs[index], default: null }, true)),
        outputs: ports.outputs.map((port, index) => makeBindingPort(port, outputs[index])),
        middleVars: []
      }
    },
    faultSlots: clone(faultSlots)
  };
}

export const COMPONENT_GROUPS = [
  { id: 'signals', label: '系统信号', icon: '信', tone: 'system', defaultOpen: true },
  { id: 'simulation', label: '仿真组件', icon: '仿', tone: 'system', defaultOpen: true },
  { id: 'subsystem', label: '子系统', icon: '子', tone: 'system', defaultOpen: true },
  { id: 'faults', label: '故障组件', icon: '故', tone: 'fault', defaultOpen: true },
  { id: 'instruments', label: '测量仪器', icon: '测', tone: 'instrument', defaultOpen: true },
  { id: 'display-control', label: '显控组件', icon: '显', tone: 'system', defaultOpen: true },
  { id: 'can-lines', label: '总线与连接', icon: '线', tone: 'link', defaultOpen: true }
];

// 仿真组件在左侧工具箱中的二级菜单。新增模板时只需设置
// `simulationMenu`，即可自动归入对应分类。
export const SIMULATION_MENU_SECTIONS = [
  { id: 'signal-processing', label: '信号处理模型', icon: '信', defaultOpen: true },
  { id: 'rf-signal', label: '射频信号模型', icon: 'RF', defaultOpen: true }
];

export const COMPONENT_REGISTRY = {
  signal_source: {
    type: 'signal_source',
    nodeType: 'signal_source',
    group: 'signals',
    label: '模拟信号源',
    badge: '模拟',
    className: 'b-source',
    width: 164,
    height: 84,
    palette: {
      icon: 'A',
      iconClass: 'source'
    },
    defaults: createSignalSourceProps('analog')
  },
  signal_source_digital: {
    type: 'signal_source_digital',
    nodeType: 'signal_source',
    group: 'signals',
    label: '数字信号源',
    badge: '数字',
    className: 'b-source',
    width: 164,
    height: 84,
    palette: {
      icon: 'D',
      iconClass: 'source'
    },
    defaults: createSignalSourceProps('digital')
  },
  signal_source_command: {
    type: 'signal_source_command',
    nodeType: 'signal_source',
    group: 'signals',
    label: '指令信号源',
    badge: '指令',
    className: 'b-source',
    width: 164,
    height: 84,
    palette: {
      icon: 'C',
      iconClass: 'source'
    },
    defaults: createSignalSourceProps('command')
  },
  signal_source_rf: {
    type: 'signal_source_rf',
    nodeType: 'signal_source',
    group: 'signals',
    label: '射频信号源',
    badge: '射频',
    className: 'b-source',
    width: 164,
    height: 84,
    palette: {
      icon: 'RF',
      iconClass: 'source'
    },
    defaults: createSignalSourceProps('rf')
  },
  middle_var_assign: {
    type: 'middle_var_assign',
    group: 'signals',
    label: '中间变量赋值块',
    badge: '赋值',
    className: 'b-assign',
    width: 176,
    height: 82,
    palette: {
      visible: false,
      icon: '中',
      iconClass: 'middle'
    },
    defaults: {
      name: '中间变量赋值块',
      targetNodeId: '',
      targetVarName: '',
      assignMode: 'constant',
      constantValue: '0'
    }
  },
  flow_block: {
    type: 'flow_block',
    group: 'legacy-hidden',
    label: '信号适配块',
    badge: '适配',
    className: 'b-flow',
    width: 168,
    height: 88,
    title: '统一输入输出的数据类型和格式',
    palette: {
      icon: 'F',
      iconClass: 'flow'
    },
    defaults: {
      name: '信号适配块',
      inputName: '输入信号',
      inputFormat: '标量',
      outputName: '输出信号',
      outputFormat: '标量'
    }
  },
  gain_block: {
    type: 'gain_block',
    group: 'legacy-hidden',
    label: '增益块',
    badge: '增益',
    className: 'b-gain',
    width: 156,
    height: 84,
    palette: {
      icon: '×',
      iconClass: 'gain'
    },
    defaults: {
      name: '增益块',
      gain: '1.0',
      inputFormat: '标量',
      outputFormat: '标量'
    }
  },
  sum_block: {
    type: 'sum_block',
    group: 'legacy-hidden',
    label: '求和块',
    badge: '求和',
    className: 'b-sum',
    width: 164,
    height: 88,
    palette: {
      icon: '+',
      iconClass: 'sum'
    },
    defaults: {
      name: '求和块',
      inputCount: 2,
      signs: ['+', '+'],
      outputFormat: '标量'
    }
  },
  mux_block: {
    type: 'mux_block',
    group: 'legacy-hidden',
    label: 'Mux 块',
    badge: 'Mux',
    className: 'b-mux',
    width: 164,
    height: 88,
    palette: {
      icon: 'M',
      iconClass: 'mux'
    },
    defaults: {
      name: 'Mux 块',
      inputCount: 2,
      outputFormat: '向量'
    }
  },
  simulation_block: {
    type: 'simulation_block',
    group: 'simulation',
    label: '仿真块',
    badge: '仿真',
    className: 'b-sim',
    width: 174,
    height: 92,
    palette: {
      icon: 'P',
      iconClass: 'simulation',
      visible: false
    },
    defaults: {
      name: '仿真块',
      moduleType: '一阶函数',
      inputs: [{ name: '输入 1', type: '标量' }],
      outputs: [{ name: '输出 1', type: '标量' }],
      middleVars: [{ name: '中间量 1', type: '标量' }],
      powerInputs: [{ name: '电源输入', type: '电源', voltage: '28V' }],
      powerOutputs: [{ name: '电源地', type: '电源', voltage: '0V' }],
      ffunctionNote: '当前预留 Python 函数接口，可在后续导入函数定义。'
    }
  },
  airspeed_sensor: {
    type: 'airspeed_sensor',
    nodeType: 'simulation_block',
    templateId: 'airspeed_sensor',
    group: 'simulation',
    simulationMenu: 'sensing',
    label: '空速传感器',
    badge: '仿真',
    className: 'b-sim',
    width: 196,
    height: 116,
    title: '测量真实空速并输出带零偏和比例系数的空速信号',
    palette: {
      visible: false,
      icon: '空',
      iconClass: 'simulation'
    },
    defaults: {
      name: '空速传感器',
      moduleType: '传感器模型',
      inputs: [{ name: '真实空速', type: '标量', varName: 'true_airspeed', unit: 'm/s' }],
      outputs: [{ name: '测量空速', type: '标量', varName: 'measured_airspeed', unit: 'm/s' }],
      middleVars: [],
      powerInputs: [{ name: '电源输入', type: '电源', voltage: '28V' }],
      powerOutputs: [{ name: '电源地', type: '电源', voltage: '0V' }],
      parameters: [
        { key: 'bias', name: '零偏', layer: 'physical', default: 0, unit: 'm/s' },
        { key: 'scale', name: '比例系数', layer: 'physical', default: 1 }
      ],
      ffunctionNote: '内置空速传感器模型：measured_airspeed = (true_airspeed + bias) * scale'
    },
    ports: {
      inputs: [
        {
          id: 'input-0',
          portId: 'input-0',
          signalId: 'airspeed_sensor.true_airspeed',
          varName: 'true_airspeed',
          name: '真实空速',
          displayName: '真实空速',
          type: 'float',
          unit: 'm/s',
          direction: 'input'
        }
      ],
      outputs: [
        {
          id: 'output-0',
          portId: 'output-0',
          signalId: 'airspeed_sensor.measured_airspeed',
          varName: 'measured_airspeed',
          name: '测量空速',
          displayName: '测量空速',
          type: 'float',
          unit: 'm/s',
          direction: 'output'
        }
      ]
    },
    pythonBinding: {
      bound: true,
      moduleId: 'airspeed_sensor',
      fileName: 'airspeed_sensor.py',
      moduleName: 'airspeed_sensor',
      moduleCategory: '传感器模型',
      description: '空速传感器模型',
      entryFunction: 'process',
      parsedInterface: {
        fileName: 'airspeed_sensor.py',
        moduleName: 'airspeed_sensor',
        description: '空速传感器模型',
        entryFunction: 'process',
        inputs: [
          { name: 'true_airspeed', displayName: '真实空速', type: 'float', comment: '真实空速', default: null },
          { name: 'bias', displayName: '零偏', type: 'float', comment: '零偏', default: 0 },
          { name: 'scale', displayName: '比例系数', type: 'float', comment: '比例系数', default: 1 }
        ],
        outputs: [
          { name: 'measured_airspeed', displayName: '测量空速', type: 'float', comment: '测量空速' }
        ],
        middleVars: [],
        rawSource: 'def process(true_airspeed: float, bias: float = 0.0, scale: float = 1.0):\n    measured_airspeed = (true_airspeed + bias) * scale\n    return measured_airspeed\n'
      },
      rawSource: 'def process(true_airspeed: float, bias: float = 0.0, scale: float = 1.0):\n    measured_airspeed = (true_airspeed + bias) * scale\n    return measured_airspeed\n',
      executionMode: 'mock',
      portMapping: {
        inputs: [
          {
            portId: 'input-0',
            signalId: 'airspeed_sensor.true_airspeed',
            varName: 'true_airspeed',
            displayName: '真实空速',
            type: 'float',
            default: null,
            comment: '真实空速',
            connected: false
          }
        ],
        outputs: [
          {
            portId: 'output-0',
            signalId: 'airspeed_sensor.measured_airspeed',
            varName: 'measured_airspeed',
            displayName: '测量空速',
            type: 'float',
            comment: '测量空速'
          }
        ],
        middleVars: []
      }
    },
    faultSlots: [
      {
        slotId: 'physical:airspeed_bias',
        slotName: '空速零偏',
        displayName: '空速零偏',
        layer: 'physical',
        kind: 'parameter',
        targetField: 'parameters.bias',
        allowedModels: ['bias'],
        allowedFaultTypeIds: ['airspeed_bias_offset']
      },
      {
        slotId: 'physical:airspeed_scale',
        slotName: '比例系数漂移',
        displayName: '比例系数漂移',
        layer: 'physical',
        kind: 'parameter',
        targetField: 'parameters.scale',
        allowedModels: ['drift'],
        allowedFaultTypeIds: ['airspeed_scale_drift']
      }
    ]
  },
  barometer_sensor: createPythonSimulationComponent({
    type: 'barometer_sensor',
    simulationMenu: 'sensing',
    label: '气压高度传感器',
    moduleType: '传感器模型',
    title: '测量真实高度并输出带零偏和比例系数的高度信号',
    palette: { visible: false, icon: '高', iconClass: 'simulation' },
    description: '气压高度传感器模型',
    inputs: [
      { portId: 'input-0', name: '真实高度', varName: 'true_altitude', unit: 'm' }
    ],
    outputs: [
      { portId: 'output-0', name: '测量高度', varName: 'measured_altitude', unit: 'm' }
    ],
    parameters: [
      { key: 'bias', name: '零偏', default: 0, unit: 'm' },
      { key: 'scale', name: '比例系数', default: 1 }
    ],
    ffunctionNote: '内置气压高度传感器模型：measured_altitude = (true_altitude + bias) * scale',
    executionMode: 'backend',
    faultSlots: [
    ]
  }),
  vector2_passthrough: createPythonSimulationComponent({
    type: 'vector2_passthrough',
    simulationMenu: 'signal-processing',
    label: '二维向量传递组件',
    moduleType: '向量处理模型',
    title: '将长度为 2 的输入向量逐元素传递到长度为 2 的输出向量',
    palette: { icon: 'V2', iconClass: 'simulation' },
    description: '二维向量传递仿真组件',
    inputs: [
      {
        portId: 'input-0',
        name: '二维输入向量',
        varName: 'input_vector',
        type: 'vector',
        vectorLength: 2
      }
    ],
    outputs: [
      {
        portId: 'output-0',
        name: '二维输出向量',
        varName: 'output_vector',
        type: 'vector',
        vectorLength: 2
      }
    ],
    ffunctionNote: '将输入二维向量逐元素传递至输出端口。',
    executionMode: 'backend'
  }),
  rf_four_channel_source: createPythonSimulationComponent({
    type: 'rf_four_channel_source',
    simulationMenu: 'rf-signal',
    label: '四通道射频数据源',
    moduleType: '射频信号源模型',
    title: '无输入，按仿真时间输出四路同步脉冲射频数据',
    palette: { icon: 'RF4', iconClass: 'simulation' },
    description: '四通道射频数据源仿真组件',
    inputs: [],
    outputs: [
      {
        portId: 'output-0',
        name: '射频数据（四组）',
        varName: 'rf_samples',
        type: 'vector',
        vectorLength: 4,
        unit: 'V'
      }
    ],
    parameters: [
      { key: 'sample_1', name: '通道 1 幅度', default: 1.0, unit: 'V' },
      { key: 'sample_2', name: '通道 2 幅度', default: 0.8, unit: 'V' },
      { key: 'sample_3', name: '通道 3 幅度', default: 0.6, unit: 'V' },
      { key: 'sample_4', name: '通道 4 幅度', default: 0.4, unit: 'V' },
      { key: 'center_frequency_hz', name: '中心频率', default: 100, unit: 'Hz' },
      { key: 'pulse_width_seconds', name: '脉宽', default: 0.001, unit: 's' },
      { key: 'pulse_period_seconds', name: '重周', default: 0.001, unit: 's' },
      { key: 'phase_deg', name: '初始相位', default: 0, unit: '°' }
    ],
    ffunctionNote: '内置四通道射频脉冲源：每个仿真步按中心频率、脉宽和重周计算四路同步载波，脉冲窗口外输出为 0。',
    executionMode: 'backend'
  }),
  rf_pulse_feature_extractor: createPythonSimulationComponent({
    type: 'rf_pulse_feature_extractor',
    simulationMenu: 'rf-signal',
    label: '射频脉冲特征提取',
    moduleType: '射频信号处理模型',
    title: '对 A/D 采样后的标量射频信号进行 FFT 与脉冲包络分析，输出四项脉冲参数',
    palette: { icon: 'FFT', iconClass: 'simulation' },
    description: '射频脉冲中心频率、重复周期、脉宽和 8 位幅度提取组件',
    inputs: [
      { portId: 'input-0', name: '射频信号', varName: 'rf_signal', unit: 'V' }
    ],
    outputs: [
      { portId: 'output-0', name: '中心频率', varName: 'center_frequency_hz', unit: 'Hz' },
      { portId: 'output-1', name: '重复周期', varName: 'pulse_period_seconds', unit: 's' },
      { portId: 'output-2', name: '脉宽', varName: 'pulse_width_seconds', unit: 's' },
      { portId: 'output-3', name: '脉冲幅度', varName: 'pulse_amplitude_adc', unit: 'ADC(0-255)' }
    ],
    parameters: [
      { key: 'fft_size', name: 'FFT 点数', default: 64 },
      { key: 'adc_full_scale', name: 'A/D 满量程', default: 1, unit: 'V' },
      { key: 'envelope_threshold_adc', name: '包络门限', default: 12, unit: 'ADC' }
    ],
    ffunctionNote: '输入按 A/D 8 位量化后进入滑动 FFT，主频谱峰值给出中心频率；对整流包络作门限检测，以上升沿间隔计算重复周期、以高电平持续时间计算脉宽；脉冲幅度输出为 0–255 的整数。',
    executionMode: 'backend'
  }),
  rf_downconverter: createPythonSimulationComponent({
    type: 'rf_downconverter',
    simulationMenu: 'rf-signal',
    label: '射频下变频器',
    moduleType: '射频处理模型',
    title: '将单路实数射频输入与本振混频、低通滤波后输出中频 I/Q 信号',
    palette: { icon: '↓RF', iconClass: 'simulation' },
    description: '单路射频下变频仿真组件',
    inputs: [
      { portId: 'input-0', name: '射频输入', varName: 'rf_input', unit: 'V' }
    ],
    outputs: [
      { portId: 'output-0', name: '中频 I', varName: 'if_i', unit: 'V' },
      { portId: 'output-1', name: '中频 Q', varName: 'if_q', unit: 'V' }
    ],
    parameters: [
      { key: 'lo_frequency_hz', name: '本振频率', default: 990000000, unit: 'Hz' },
      { key: 'lo_phase_deg', name: '本振相位', default: 0, unit: '°' },
      { key: 'conversion_gain', name: '变频增益', default: 1 },
      { key: 'low_pass_cutoff_hz', name: '低通截止频率', default: 20000000, unit: 'Hz' }
    ],
    ffunctionNote: '单路实数射频信号与本振正交混频，输出低通后的中频 I/Q 两路标量；默认本振为 990 MHz，可将 1 GHz 射频下变至约 10 MHz 中频。',
    executionMode: 'backend'
  }),
  Test: createPythonSimulationComponent({
    type: 'Test',
    simulationMenu: 'rf-signal',
    label: '测试',
    moduleType: '测试',
    title: '无输入，按仿真时间输出四路同步脉冲射频数据',
    palette: { icon: 'T', iconClass: 'simulation' },
    description: '测试',
    inputs: [
      {
        portId: 'output-0',
        name: '射频数据（四组）',
        varName: 'sample_1',
        type: 'vector',
        vectorLength: 4
      }
    ],
    outputs: [
      { portId: 'output-0', name: '射频数据 1', varName: 'rf_samples_1' },
      { portId: 'output-1', name: '射频数据 2', varName: 'rf_samples_2' },
      { portId: 'output-2', name: '射频数据 3', varName: 'rf_samples_3' },
      { portId: 'output-3', name: '射频数据 4', varName: 'rf_samples_4' }
    ],
    parameters: [
    ],
    ffunctionNote: '测试组件',
    executionMode: 'backend'
  }),
  rf_limit_amplify_downconvert_split8: createPythonSimulationComponent({
    type: 'rf_limit_amplify_downconvert_split8',
    simulationMenu: 'rf-signal',
    label: '射频限放下变频八路功分',
    moduleType: '射频处理模型',
    title: '四路射频数据经限幅、放大、下变频及 4 分 8 后输出八路标量信号',
    palette: { icon: 'RF8', iconClass: 'simulation' },
    description: '射频限幅、放大、下变频与八路功分仿真组件',
    inputs: [
      {
        portId: 'input-0',
        name: '四路射频输入',
        varName: 'rf_input',
        type: 'vector',
        vectorLength: 4,
        unit: 'V'
      }
    ],
    outputs: Array.from({ length: 8 }, (_, index) => ({
      portId: `output-${index}`,
      name: `射频输出 ${index + 1}`,
      varName: `rf_output_${index + 1}`,
      unit: 'V'
    })),
    parameters: [
      { key: 'limit_amplitude', name: '限幅值', default: 1, unit: 'V' },
      { key: 'gain_db', name: '放大增益', default: 0, unit: 'dB' },
      { key: 'lo_frequency_hz', name: '本振频率', default: 99, unit: 'Hz' },
      { key: 'lo_phase_deg', name: '本振相位', default: 0, unit: '°' },
      { key: 'conversion_gain', name: '下变频增益', default: 1 },
      { key: 'low_pass_cutoff_hz', name: '下变频低通截止频率', default: 5, unit: 'Hz' },
      { key: 'split_insertion_loss_db', name: '功分插入损耗', default: 0, unit: 'dB' }
    ],
    ffunctionNote: '处理顺序：四路输入分别执行限幅 → 放大 → 下变频与低通滤波（I 路）→ 1 分 2；默认差频为 1 Hz，最终输出八个独立标量。',
    executionMode: 'backend'
  }),
  subsystem_block: {
    type: 'subsystem_block',
    group: 'subsystem',
    label: '子系统块',
    badge: '子系统',
    className: 'b-subsystem',
    width: 180,
    height: 92,
    palette: {
      icon: '子',
      iconClass: 'subsystem'
    },
    defaults: {
      name: '子系统块',
      description: '',
      targetCanvasId: ''
    }
  },
  subsystem_in_port: {
    type: 'subsystem_in_port',
    group: 'subsystem',
    palette: {
      visible: false
    },
    label: '子系统输入口',
    badge: 'IN',
    className: 'b-subsystem-port-in',
    width: 132,
    height: 72,
    defaults: {
      name: '子系统输入口'
    }
  },
  subsystem_out_port: {
    type: 'subsystem_out_port',
    group: 'subsystem',
    palette: {
      visible: false
    },
    label: '子系统输出口',
    badge: 'OUT',
    className: 'b-subsystem-port-out',
    width: 132,
    height: 72,
    defaults: {
      name: '子系统输出口'
    }
  },
  physical_fault_injector: {
    type: 'physical_fault_injector',
    group: 'faults',
    label: '物理层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    palette: {
      icon: 'F',
      iconClass: 'fault'
    },
    defaults: {
      name: '物理层注入',
      faultType: '物理参数故障',
      layer: '物理层',
      layerKey: 'physical'
    }
  },
  electrical_fault_injector: {
    type: 'electrical_fault_injector',
    group: 'faults',
    label: '电气层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    palette: {
      icon: 'E',
      iconClass: 'fault'
    },
    defaults: {
      name: '电气层注入',
      faultType: '电气信号故障',
      layer: '电气层',
      layerKey: 'electrical'
    }
  },
  protocol_fault_injector: {
    type: 'protocol_fault_injector',
    group: 'faults',
    label: '协议层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    palette: {
      icon: 'P',
      iconClass: 'fault'
    },
    defaults: {
      name: '协议层注入',
      faultType: '数字协议故障',
      layer: '协议层',
      layerKey: 'protocol'
    }
  },
  instrument_scope: {
    type: 'instrument_scope',
    group: 'instruments',
    label: '示波器',
    badge: '仪器',
    className: 'b-inst',
    width: 150,
    height: 74,
    palette: {
      icon: '波',
      iconClass: 'scope'
    },
    defaults: {
      name: '示波器',
      instrumentType: '波形监测',
      sampleRate: '64kHz',
      signal: '流程块输出',
      inputPortNameCh1: 'CH1',
      inputPortNameCh2: 'CH2'
    }
  },
  instrument_spectrum: {
    type: 'instrument_spectrum',
    group: 'instruments',
    label: '频谱分析仪',
    badge: '频谱',
    className: 'b-inst',
    width: 172,
    height: 82,
    palette: {
      icon: '谱',
      iconClass: 'spectrum'
    },
    defaults: {
      name: '频谱分析仪',
      instrumentType: '频谱分析',
      sampleRate: '32kHz',
      signal: '仿真块输出',
      inputPortName: '观测输入',
      frequencyRange: '0-16kHz',
      fftSize: '1024',
      windowFunction: 'Hann',
      amplitudeUnit: 'dB',
      referenceLevel: '10',
      attenuation: '0',
      preamp: 'off',
      rbw: '0.1',
      vbw: '0.1',
      sweepTime: '100',
      detector: 'Sample',
      traceMode: 'Clear/Write',
      markerFrequency: ''
    }
  },
  instrument_logger: {
    type: 'instrument_logger',
    group: 'instruments',
    label: '数据记录仪',
    badge: '仪器',
    className: 'b-inst',
    width: 158,
    height: 74,
    palette: {
      visible: false,
      icon: '记',
      iconClass: 'logger'
    },
    defaults: {
      name: '数据记录仪',
      instrumentType: '数据记录',
      sampleRate: '10Hz',
      signal: '系统总线',
      inputPortNameHigh: '正端（VΩ）',
      inputPortNameLow: '负端（COM）'
    }
  },
  instrument_multimeter: {
    type: 'instrument_multimeter',
    group: 'instruments',
    label: '数字万用表',
    badge: '万用表',
    className: 'b-inst',
    width: 166,
    height: 82,
    palette: {
      icon: 'VΩ',
      iconClass: 'multimeter'
    },
    defaults: {
      name: '数字万用表',
      instrumentType: '数字万用表',
      measurementMode: '直流电压',
      positiveLead: { nodeId: '', direction: '', portIndex: 0 },
      negativeLead: { nodeId: '', direction: '', portIndex: 0 },
      range: 'Auto',
      refreshRate: '5Hz',
      sampleRate: '5Hz',
      signal: '输入信号',
      inputPortName: '观测输入'
    }
  },
  display_console: {
    type: 'display_console',
    group: 'display-control',
    label: '显控台',
    badge: '显控',
    className: 'b-display-console',
    width: 196,
    height: 118,
    palette: {
      visible: false,
      icon: '显',
      iconClass: 'display-control'
    },
    defaults: {
      name: '显控台',
      consoleType: '射频参数显控',
      inputPortNames: DISPLAY_CONSOLE_INPUTS.map((item) => item.label),
      displayConfig: createDisplayConsoleConfig()
    }
  },
  display_console_1: {
    type: 'display_console_1',
    nodeType: 'display_console',
    templateId: 'display_console_1',
    group: 'display-control',
    label: '显控台 1',
    badge: '显控',
    className: 'b-display-console',
    width: 196,
    height: 118,
    palette: {
      icon: '显1',
      iconClass: 'display-control'
    },
    defaults: {
      name: DISPLAY_CONSOLE_PRESETS.display_console_1.name,
      consoleType: '射频参数显控',
      displayConfig: createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1),
      inputPortNames: createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1).inputs.map((item) => item.label)
    }
  },
  display_console_2: {
    type: 'display_console_2',
    nodeType: 'display_console',
    templateId: 'display_console_2',
    group: 'display-control',
    label: '显控台 2',
    badge: '显控',
    className: 'b-display-console',
    width: 196,
    height: 118,
    palette: {
      icon: '显2',
      iconClass: 'display-control'
    },
    defaults: {
      name: DISPLAY_CONSOLE_PRESETS.display_console_2.name,
      consoleType: '射频参数显控',
      displayConfig: createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_2),
      inputPortNames: createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_2).inputs.map((item) => item.label)
    }
  },
  link_normal: {
    type: 'link_normal',
    group: 'can-lines',
    paletteKind: 'line-tool',
    lineType: 'normal',
    label: '普通连接线',
    badge: '连接',
    className: 'b-link',
    width: 154,
    height: 64,
    palette: {
      icon: '线',
      iconClass: 'link'
    },
    defaults: {
      name: '普通连接线',
      linkType: '普通连接线',
      sourcePort: '源端口',
      targetPort: '目标端口'
    }
  },
  link_can: {
    type: 'link_can',
    group: 'can-lines',
    paletteKind: 'line-tool',
    lineType: 'can',
    label: 'CAN 总线',
    badge: '连接',
    className: 'b-link',
    width: 154,
    height: 64,
    palette: {
      icon: 'CAN',
      iconClass: 'link'
    },
    defaults: {
      name: 'CAN 总线',
      linkType: 'CAN 总线',
      sourcePort: '节点 A',
      targetPort: '节点 B'
    }
  }
};

// 以配置文件为准生成显控台模板。新增 DISPLAY_CONSOLE_PRESETS 项后，会自动出现在左侧显控组件栏。
Object.assign(COMPONENT_REGISTRY, DISPLAY_CONSOLE_TEMPLATES);
delete COMPONENT_REGISTRY.airspeed_sensor;
delete COMPONENT_REGISTRY.barometer_sensor;

export function buildComponentLibraryFromRegistry(registry = COMPONENT_REGISTRY) {
  return Object.fromEntries(
    Object.entries(registry).map(([type, item]) => [
      type,
      {
        label: item.label,
        badge: item.badge,
        className: item.className,
        nodeType: item.nodeType,
        templateId: item.templateId,
        width: item.width,
        height: item.height,
        defaults: clone(item.defaults),
        ports: item.ports ? clone(item.ports) : undefined,
        pythonBinding: item.pythonBinding ? clone(item.pythonBinding) : undefined,
        faultSlots: item.faultSlots ? clone(item.faultSlots) : undefined
      }
    ])
  );
}

export function getPaletteGroups(groups = COMPONENT_GROUPS, registry = COMPONENT_REGISTRY) {
  const entries = Object.entries(registry);

  return groups.map((group) => ({
    ...clone(group),
    components: entries
      .filter(([, item]) => item.group === group.id && item.palette?.visible !== false)
      .map(([type, item]) => ({
        type,
        ...clone(item)
      }))
  }));
}

export function getSimulationMenuSections(
  components = [],
  sections = SIMULATION_MENU_SECTIONS
) {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const categorized = new Map();

  components.forEach((component) => {
    const sectionId = sectionById.has(component.simulationMenu)
      ? component.simulationMenu
      : 'uncategorized';
    const items = categorized.get(sectionId) ?? [];
    items.push(component);
    categorized.set(sectionId, items);
  });

  const resolvedSections = categorized.has('uncategorized')
    ? [...sections, { id: 'uncategorized', label: '未分类模型', icon: '其', defaultOpen: true }]
    : sections;

  return resolvedSections
    .filter((section) => categorized.has(section.id))
    .map((section) => ({
      ...clone(section),
      components: categorized.get(section.id)
    }));
}
