import { createSignalSourceProps } from './signalSourceDomainService.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const COMPONENT_GROUPS = [
  { id: 'signals', label: '系统信号', icon: '信', tone: 'system', defaultOpen: true },
  { id: 'signal-ops', label: '信号运算', icon: '算', tone: 'system', defaultOpen: true },
  { id: 'simulation', label: '仿真组件', icon: '仿', tone: 'system', defaultOpen: true },
  { id: 'subsystem', label: '子系统', icon: '子', tone: 'system', defaultOpen: true },
  { id: 'faults', label: '故障组件', icon: '故', tone: 'fault', defaultOpen: true },
  { id: 'instruments', label: '测量仪器', icon: '测', tone: 'instrument', defaultOpen: true },
  { id: 'can-lines', label: '总线与连接', icon: '线', tone: 'link', defaultOpen: true }
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
    group: 'signal-ops',
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
    group: 'signal-ops',
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
    group: 'signal-ops',
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
    group: 'signal-ops',
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
      iconClass: 'simulation'
    },
    defaults: {
      name: '仿真块',
      moduleType: '一阶函数',
      inputs: [{ name: '输入 1', type: '标量' }],
      outputs: [{ name: '输出 1', type: '标量' }],
      middleVars: [{ name: '中间量 1', type: '标量' }],
      ffunctionNote: '当前预留 Python 函数接口，可在后续导入函数定义。'
    }
  },
  airspeed_sensor: {
    type: 'airspeed_sensor',
    nodeType: 'simulation_block',
    templateId: 'airspeed_sensor',
    group: 'simulation',
    label: '空速传感器',
    badge: '仿真',
    className: 'b-sim',
    width: 196,
    height: 116,
    title: '测量真实空速并输出带零偏和比例系数的空速信号',
    palette: {
      icon: '空',
      iconClass: 'simulation'
    },
    defaults: {
      name: '空速传感器',
      moduleType: '传感器模型',
      inputs: [{ name: '真实空速', type: '标量', varName: 'true_airspeed', unit: 'm/s' }],
      outputs: [{ name: '测量空速', type: '标量', varName: 'measured_airspeed', unit: 'm/s' }],
      middleVars: [],
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
      executionConfig: {
        endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
        timeoutMs: 3000
      },
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
      signal: '流程块输出'
    }
  },
  instrument_spectrum: {
    type: 'instrument_spectrum',
    group: 'instruments',
    label: '频谱分析仪',
    badge: '仪器',
    className: 'b-inst',
    width: 158,
    height: 74,
    palette: {
      icon: '谱',
      iconClass: 'spectrum'
    },
    defaults: {
      name: '频谱分析仪',
      instrumentType: '频谱分析',
      sampleRate: '32kHz',
      signal: '仿真块输出'
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
      icon: '记',
      iconClass: 'logger'
    },
    defaults: {
      name: '数据记录仪',
      instrumentType: '数据记录',
      sampleRate: '10Hz',
      signal: '系统总线'
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
