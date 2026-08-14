import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulationBlockPythonBinding } from '../../src/composables/useWorkbenchState.js';
import { buildFlightModelPackage } from '../../src/services/flightModelPackageService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'public', 'model-packages');
const outputFile = path.join(outputDir, 'evtol-small-flight-control-fault-display.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsedModule({ moduleName, description, inputs, outputs, middleVars = [], source }) {
  return {
    fileName: `${moduleName}.py`,
    moduleName,
    description,
    entryFunction: 'process',
    inputs,
    outputs,
    middleVars,
    rawSource: source
  };
}

function moduleEntry(definition, category) {
  return {
    parsed: parsedModule(definition),
    category
  };
}

function makeBinding(moduleId, sourcePackage) {
  const entry = modules[moduleId];
  const binding = createSimulationBlockPythonBinding(entry.parsed, {
    moduleId,
    moduleCategory: entry.category,
    sourcePackageId: sourcePackage.modelId,
    sourcePackageName: sourcePackage.modelName,
    executionMode: 'mock'
  });

  return binding;
}

function electricalSlot(name, role, targetField, signalId = '') {
  return {
    slotId: `electrical:${name.replace(/\s+/g, '_')}`,
    slotName: name,
    layer: 'electrical',
    targetField,
    allowedModels: ['bias', 'noise', 'freeze', 'intermittent', 'scale'],
    variableKey: name.replace(/\s+/g, '_'),
    variableRole: role,
    signalId,
    unit: '',
    parameterKey: ''
  };
}

function physicalSlot(slotId, name, targetField, unit = '', allowedModels = ['bias', 'drift', 'step', 'degradation', 'freeze', 'random']) {
  return {
    slotId,
    slotName: name,
    layer: 'physical',
    targetField,
    allowedModels,
    variableKey: slotId.replace(/^physical:/, ''),
    variableRole: 'parameter',
    signalId: '',
    unit,
    parameterKey: slotId.replace(/^physical:/, '')
  };
}

function protocolSlot(slotId, name, signalId, channelId, messageId) {
  return {
    slotId,
    slotName: name,
    layer: 'protocol',
    targetField: 'can.payload',
    allowedModels: ['delay', 'dropout', 'tamper', 'stale'],
    signalId,
    channelId,
    messageId,
    variableKey: signalId,
    variableRole: 'protocol'
  };
}

function simNode({
  id,
  x,
  y,
  w = 190,
  h = 108,
  name,
  moduleType,
  moduleId,
  inputs,
  outputs,
  middleVars = [],
  modelParameters = [],
  note = '',
  faultSlots = []
}) {
  return {
    id,
    type: 'simulation_block',
    x,
    y,
    w,
    h,
    props: {
      name,
      moduleType,
      inputs,
      outputs,
      middleVars,
      ffunctionNote: note,
      modelParameters,
      faultInjection: {
        physical: modelParameters.map((item) => item.key),
        electrical: [
          ...inputs.map((item) => item.name),
          ...outputs.map((item) => item.name),
          ...middleVars.map((item) => item.name)
        ],
        protocol: []
      }
    },
    pythonBinding: makeBinding(moduleId, packageMeta),
    faultSlots
  };
}

function edge({
  id,
  sourceNodeId,
  targetNodeId,
  sourcePortIndex = 0,
  targetPortIndex = 0,
  lineType = 'normal',
  label,
  signalId,
  signalUnit = '',
  channelId,
  messageId,
  faultSlots = []
}) {
  const base = {
    id,
    sourceNodeId,
    targetNodeId,
    sourcePortIndex,
    targetPortIndex,
    lineType,
    label,
    signalId,
    signalUnit,
    faultSlots: [
      electricalSlot('signal_value', label, 'signal.value', signalId),
      ...faultSlots
    ]
  };

  if (lineType === 'can') {
    return {
      ...base,
      channelId,
      messageId,
      payloadKind: 'float32',
      faultPropagationPolicy: 'propagates',
      signalChannels: [
        {
          signalId,
          channelId,
          messageId,
          payloadKind: 'float32',
          signalUnit,
          faultPropagationPolicy: 'propagates'
        }
      ],
      faultSlots: [
        protocolSlot('protocol:can_message', messageId, signalId, channelId, messageId),
        ...base.faultSlots
      ]
    };
  }

  return base;
}

function capability(targetId, targetKind, targetName, faultSlots) {
  return {
    targetId,
    targetKind,
    targetName,
    faultSlots: clone(faultSlots)
  };
}

function stripNodePythonBinding(node) {
  if (node?.type !== 'simulation_block' || !node?.pythonBinding?.bound) {
    return node;
  }

  const binding = node.pythonBinding;
  return {
    ...node,
    pythonBinding: {
      bound: true,
      moduleId: binding.moduleId,
      fileName: binding.fileName,
      moduleName: binding.moduleName,
      moduleCategory: binding.moduleCategory,
      sourcePackageId: binding.sourcePackageId,
      sourcePackageName: binding.sourcePackageName,
      entryFunction: binding.entryFunction,
      executionMode: binding.executionMode,
      executionConfig: binding.executionConfig
    }
  };
}

function stripSnapshotPythonBindings(snapshot) {
  return {
    ...snapshot,
    modelNodes: Array.isArray(snapshot.modelNodes)
      ? snapshot.modelNodes.map(stripNodePythonBinding)
      : []
  };
}

function stripPythonModuleDuplicateSource(module) {
  if (!module?.parsedInterface?.rawSource) {
    return module;
  }

  const parsedInterface = { ...module.parsedInterface };
  delete parsedInterface.rawSource;
  return {
    ...module,
    parsedInterface
  };
}

function sourceNode(id, x, y, name, waveType, amplitude, frequency, outputFormat = 'scalar') {
  return {
    id,
    type: 'signal_source',
    x,
    y,
    w: 170,
    h: 86,
    props: {
      name,
      waveType,
      amplitude,
      frequency,
      outputFormat
    },
    pythonBinding: null,
    faultSlots: []
  };
}

function instrumentNode(id, type, x, y, name, signalKeys) {
  return {
    id,
    type,
    x,
    y,
    w: 205,
    h: 92,
    props: {
      name,
      signalKeys,
      sampleWindow: 120
    },
    pythonBinding: null,
    faultSlots: []
  };
}

const packageMeta = {
  modelId: 'evtol-small-flight-control-fault-display',
  modelName: 'eVTOL 小型飞控系统故障注入展示模型',
  description: '由 Simulink eVTOL 飞控模型抽象而来的平台展示拓扑，覆盖指令、PID 控制、控制分配、电机执行器、8 路旋翼、气动力/力矩、6DOF 机体、传感器故障注入和测量仪器。',
  systemFamily: 'uav-flight-control',
  supportedFaultLibraries: ['uav-flight-control-faults'],
  capabilities: {
    displayModel: true,
    closedLoop: true,
    rotorCount: 8,
    sourceModel: 'eVTOL_Small_nonandlin_algorithm_validation.slx'
  },
  source: {
    origin: 'simulink-abstraction',
    sourcePath: 'D:/项目方案/eVTOL飞控系统/eVTOL_Small_nonandlin_algorithm_validation.slx',
    sourceRelease: 'Simulink R2024a',
    notes: '展示模型保留故障注入平台所需的拓扑、端口、测点和故障槽；Python 模块用于演示响应趋势，不等同于原 Simulink 数值仿真。'
  }
};

const modules = {
  pid_controller: moduleEntry({
    moduleName: 'pid_controller',
    description: 'Attitude PID controller abstraction for the Simulink eVTOL model',
    inputs: [
      { name: 'attitude_command', type: 'float', default: 0, comment: '姿态指令' },
      { name: 'attitude_feedback', type: 'float', default: 0, comment: '姿态反馈' }
    ],
    outputs: [{ name: 'moment_command', type: 'float', comment: '力矩指令' }],
    middleVars: [
      { name: 'attitude_error', type: 'float', comment: '姿态误差' },
      { name: 'integrator_state', type: 'float', comment: '积分状态' }
    ],
    source: `"""Module: pid_controller
Description: Attitude PID controller abstraction for the Simulink eVTOL model
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(attitude_command=0.0, attitude_feedback=0.0, dt=0.02, state=None):
    state = state or {}
    error = _clamp(float(attitude_command) - float(attitude_feedback), -0.6, 0.6)
    integrator = _clamp(float(state.get("integrator", 0.0)) + error * float(dt), -0.35, 0.35)
    moment_command = _clamp(1.35 * error + 0.18 * integrator, -0.45, 0.45)
    return {"outputs": {"moment_command": moment_command}, "state": {"integrator": integrator}, "middleVars": {"attitude_error": error, "integrator_state": integrator}}
`
  }, 'control'),
  control_allocation: moduleEntry({
    moduleName: 'control_allocation',
    description: 'Control allocation from attitude moment and speed or altitude requests to total actuator command',
    inputs: [
      { name: 'moment_command', type: 'float', default: 0, comment: '力矩指令' },
      { name: 'speed_command', type: 'float', default: 0, comment: '速度指令' },
      { name: 'altitude_command', type: 'float', default: 0, comment: '高度指令' }
    ],
    outputs: [{ name: 'actuator_command', type: 'float', comment: '执行器总指令' }],
    middleVars: [{ name: 'allocation_margin', type: 'float', comment: '分配裕度' }],
    source: `"""Module: control_allocation
Description: Control allocation abstraction
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(moment_command=0.0, speed_command=0.0, altitude_command=0.0):
    raw = 0.72 * float(moment_command) + 0.18 * float(speed_command) + 0.10 * float(altitude_command)
    actuator_command = _clamp(raw, -1.0, 1.0)
    return {"actuator_command": actuator_command}, {"allocation_margin": 1.0 - abs(actuator_command)}
`
  }, 'control_allocation'),
  voltage_drop: moduleEntry({
    moduleName: 'voltage_drop',
    description: 'DC bus voltage drop abstraction before motor actuation',
    inputs: [
      { name: 'actuator_command', type: 'float', default: 0, comment: '执行器总指令' },
      { name: 'bus_voltage', type: 'float', default: 1, comment: '母线电压比例' }
    ],
    outputs: [{ name: 'voltage_limited_command', type: 'float', comment: '电压限幅后指令' }],
    middleVars: [{ name: 'voltage_margin', type: 'float', comment: '电压裕度' }],
    source: `"""Module: voltage_drop
Description: Voltage drop abstraction
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(actuator_command=0.0, bus_voltage=1.0):
    voltage = _clamp(bus_voltage, 0.45, 1.05)
    command = _clamp(float(actuator_command) * voltage, -1.0, 1.0)
    return {"voltage_limited_command": command}, {"voltage_margin": voltage}
`
  }, 'power'),
  motor_actuator: moduleEntry({
    moduleName: 'motor_actuator',
    description: 'Eight-channel motor actuator command distributor',
    inputs: [{ name: 'voltage_limited_command', type: 'float', default: 0, comment: '电压限幅后指令' }],
    outputs: Array.from({ length: 8 }, (_, index) => ({
      name: `rotor_${index + 1}_command`,
      type: 'float',
      comment: `${index + 1}号旋翼指令`
    })),
    middleVars: [{ name: 'actuator_state', type: 'float', comment: '执行器状态' }],
    source: `"""Module: motor_actuator
Description: Eight-channel motor actuator command distributor
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(voltage_limited_command=0.0):
    command = _clamp(voltage_limited_command, -1.0, 1.0)
    outputs = {f"rotor_{index}_command": command for index in range(1, 9)}
    return outputs, {"actuator_state": command}
`
  }, 'actuation'),
  rotor_motor: moduleEntry({
    moduleName: 'rotor_motor',
    description: 'Rotor and motor first-order response abstraction',
    inputs: [
      { name: 'rotor_command', type: 'float', default: 0, comment: '旋翼指令' }
    ],
    outputs: [{ name: 'rotor_thrust', type: 'float', comment: '旋翼推力' }],
    middleVars: [{ name: 'rotor_speed_state', type: 'float', comment: '转速状态' }],
    source: `"""Module: rotor_motor
Description: Rotor and motor first-order response abstraction
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(rotor_command=0.0, dt=0.02, state=None):
    state = state or {}
    previous = float(state.get("rotor_speed", 0.0))
    target = _clamp(rotor_command, -1.0, 1.0)
    alpha = _clamp(float(dt) / (0.18 + float(dt)), 0.0, 1.0)
    rotor_speed = previous + alpha * (target - previous)
    thrust = _clamp(rotor_speed * 0.82, -0.9, 0.9)
    return {"outputs": {"rotor_thrust": thrust}, "state": {"rotor_speed": rotor_speed}, "middleVars": {"rotor_speed_state": rotor_speed}}
`
  }, 'rotor_motor'),
  aero_moment: moduleEntry({
    moduleName: 'aero_moment',
    description: 'Aggregate rotor thrust into aerodynamic force and moment',
    inputs: Array.from({ length: 8 }, (_, index) => ({
      name: `rotor_${index + 1}_thrust`,
      type: 'float',
      default: 0,
      comment: `${index + 1}号旋翼推力`
    })),
    outputs: [
      { name: 'total_force', type: 'float', comment: '合力' },
      { name: 'total_moment', type: 'float', comment: '合力矩' }
    ],
    middleVars: [{ name: 'aero_balance', type: 'float', comment: '气动平衡量' }],
    source: `"""Module: aero_moment
Description: Aggregate rotor thrust into aerodynamic force and moment
"""

def process(rotor_1_thrust=0.0, rotor_2_thrust=0.0, rotor_3_thrust=0.0, rotor_4_thrust=0.0, rotor_5_thrust=0.0, rotor_6_thrust=0.0, rotor_7_thrust=0.0, rotor_8_thrust=0.0):
    values = [float(item) for item in [rotor_1_thrust, rotor_2_thrust, rotor_3_thrust, rotor_4_thrust, rotor_5_thrust, rotor_6_thrust, rotor_7_thrust, rotor_8_thrust]]
    total_force = sum(values)
    total_moment = sum((index - 3.5) * value for index, value in enumerate(values)) / 8.0
    return {"total_force": total_force, "total_moment": total_moment}, {"aero_balance": total_moment}
`
  }, 'aerodynamics'),
  six_dof: moduleEntry({
    moduleName: 'six_dof',
    description: '6DOF vehicle body response abstraction',
    inputs: [
      { name: 'total_force', type: 'float', default: 0, comment: '合力' },
      { name: 'total_moment', type: 'float', default: 0, comment: '合力矩' }
    ],
    outputs: [
      { name: 'attitude', type: 'float', comment: '姿态角' },
      { name: 'body_rate', type: 'float', comment: '机体角速度' },
      { name: 'altitude', type: 'float', comment: '高度' }
    ],
    middleVars: [{ name: 'vehicle_energy', type: 'float', comment: '机体能量状态' }],
    source: `"""Module: six_dof
Description: 6DOF vehicle body response abstraction
"""

def _clamp(value, minimum, maximum):
    value = float(value)
    return max(minimum, min(maximum, value))

def process(total_force=0.0, total_moment=0.0, dt=0.02, state=None):
    state = state or {}
    rate = _clamp(float(state.get("body_rate", 0.0)) + float(dt) * (0.55 * float(total_moment) - 0.22 * float(state.get("body_rate", 0.0))), -1.2, 1.2)
    attitude = _clamp(float(state.get("attitude", 0.0)) + rate * float(dt), -1.0, 1.0)
    altitude = _clamp(float(state.get("altitude", 0.0)) + 0.04 * float(total_force) * float(dt), -50.0, 50.0)
    return {"outputs": {"attitude": attitude, "body_rate": rate, "altitude": altitude}, "state": {"attitude": attitude, "body_rate": rate, "altitude": altitude}, "middleVars": {"vehicle_energy": abs(rate) + abs(altitude) * 0.01}}
`
  }, 'dynamics'),
  sensor_fault_injection: moduleEntry({
    moduleName: 'sensor_fault_injection',
    description: 'Sensor feedback and fault injection abstraction',
    inputs: [
      { name: 'attitude', type: 'float', default: 0, comment: '姿态角' },
      { name: 'body_rate', type: 'float', default: 0, comment: '机体角速度' },
      { name: 'altitude', type: 'float', default: 0, comment: '高度' }
    ],
    outputs: [
      { name: 'attitude_feedback', type: 'float', comment: '姿态反馈' },
      { name: 'rate_feedback', type: 'float', comment: '角速度反馈' },
      { name: 'altitude_feedback', type: 'float', comment: '高度反馈' }
    ],
    middleVars: [{ name: 'sensor_residual', type: 'float', comment: '传感器残差' }],
    source: `"""Module: sensor_fault_injection
Description: Sensor feedback and fault injection abstraction
"""

def process(attitude=0.0, body_rate=0.0, altitude=0.0):
    residual = abs(float(attitude)) * 0.04 + abs(float(body_rate)) * 0.08
    return {"attitude_feedback": float(attitude), "rate_feedback": float(body_rate), "altitude_feedback": float(altitude)}, {"sensor_residual": residual}
`
  }, 'sensor_fault_injection')
};

const faultTypeCatalog = [
  { id: 'physical_parameter_bias', name: '物理层参数偏置', layer: 'physical', modelClass: '偏差故障', defaultParameters: { bias: 0.1, start: 0 } },
  { id: 'physical_parameter_drift', name: '物理层参数渐变', layer: 'physical', modelClass: '渐变故障', defaultParameters: { rate: 0.01, start: 0 } },
  { id: 'physical_parameter_step', name: '物理层参数突变', layer: 'physical', modelClass: '突变故障', defaultParameters: { value: 1.2, start: 5 } },
  { id: 'actuator_lock_or_failure', name: '执行器卡死或失效', layer: 'physical', modelClass: '卡位/失效', defaultParameters: { lockValue: 0, start: 6 } },
  { id: 'sensor_additive_bias', name: '传感器加性偏置', layer: 'electrical', modelClass: '偏置故障', defaultParameters: { bias: 0.05, start: 4 } },
  { id: 'fault_noise_injection', name: '噪声注入故障', layer: 'electrical', modelClass: '噪声注入', defaultParameters: { sigma: 0.02, start: 3 } },
  { id: 'signal_freeze', name: '信号冻结', layer: 'electrical', modelClass: '冻结故障', defaultParameters: { start: 8, duration: 4 } },
  { id: 'fixed_delay', name: '固定延迟传输', layer: 'protocol', modelClass: '延迟传输故障', defaultParameters: { delayMs: 60, start: 4 } },
  { id: 'random_packet_loss', name: '随机丢包', layer: 'protocol', modelClass: '丢包故障', defaultParameters: { dropRate: 0.08, start: 0 } },
  { id: 'data_tamper', name: '数据篡改', layer: 'protocol', modelClass: '篡改故障', defaultParameters: { scale: 1, bias: 0.1, start: 5 } }
];

const commonPhysicalFaultIds = ['physical_parameter_bias', 'physical_parameter_drift', 'physical_parameter_step'];
const commonElectricalFaultIds = ['sensor_additive_bias', 'fault_noise_injection', 'signal_freeze'];
const commonProtocolFaultIds = ['fixed_delay', 'random_packet_loss', 'data_tamper'];

const pidPhysicalSlots = [
  physicalSlot('physical:controller_gain', '姿态控制增益', 'params.kp', 'gain'),
  physicalSlot('physical:integrator_limit', '积分限幅', 'params.integratorLimit', 'ratio')
];
const voltageSlots = [
  physicalSlot('physical:bus_voltage_drop', '母线电压跌落', 'params.busVoltage', 'ratio', ['step', 'degradation', 'freeze'])
];
const sixDofSlots = [
  physicalSlot('physical:airframe_inertia', '机体惯量', 'params.inertia', 'kg*m^2'),
  physicalSlot('physical:aero_drag_coefficient', '气动阻力系数', 'params.dragCoefficient', 'ratio')
];
const sensorFaultSlots = [
  {
    ...electricalSlot('imu_gyro_bias', 'IMU 陀螺仪偏置', 'outputs.attitude_feedback', 'sensor.attitude'),
    allowedFaultIds: commonElectricalFaultIds
  },
  {
    ...electricalSlot('imu_noise', 'IMU 噪声', 'outputs.rate_feedback', 'sensor.rate'),
    allowedFaultIds: commonElectricalFaultIds
  },
  {
    ...electricalSlot('sensor_freeze', '传感器冻结', 'outputs.altitude_feedback', 'sensor.altitude'),
    allowedFaultIds: commonElectricalFaultIds
  }
];

const nodes = [
  sourceNode('node-attitude-command', 60, 180, '姿态指令源', 'sine', '0.08', '0.35'),
  sourceNode('node-speed-command', 60, 310, '速度指令源', 'step', '0.12', '0.10'),
  sourceNode('node-altitude-command', 60, 440, '高度指令源', 'ramp', '0.10', '0.08'),
  simNode({
    id: 'node-pid-controller',
    x: 310,
    y: 175,
    name: 'PID—AttHighControlLaw / PID控制器',
    moduleType: 'control',
    moduleId: 'pid_controller',
    inputs: [{ name: '姿态指令', type: 'scalar' }, { name: '姿态反馈', type: 'scalar' }],
    outputs: [{ name: '力矩指令', type: 'scalar' }],
    middleVars: [{ name: '姿态误差', type: 'scalar' }, { name: '积分状态', type: 'scalar' }],
    modelParameters: [
      { key: 'controller_gain', name: '姿态控制增益', targetField: 'params.kp', unit: 'gain', allowedModels: ['bias', 'drift', 'step'] },
      { key: 'integrator_limit', name: '积分限幅', targetField: 'params.integratorLimit', unit: 'ratio', allowedModels: ['step', 'freeze'] }
    ],
    note: '对应 Simulink 顶层 PID 控制器，用于姿态误差闭环调节。',
    faultSlots: [
      ...pidPhysicalSlots,
      electricalSlot('姿态指令', 'input', 'inputs.姿态指令', 'cmd.attitude'),
      electricalSlot('姿态反馈', 'input', 'inputs.姿态反馈', 'sensor.attitude'),
      electricalSlot('力矩指令', 'output', 'outputs.力矩指令', 'ctrl.moment')
    ]
  }),
  simNode({
    id: 'node-control-allocation',
    x: 565,
    y: 220,
    name: 'ControlAllocation / 控制分配',
    moduleType: 'control_allocation',
    moduleId: 'control_allocation',
    inputs: [{ name: '力矩指令', type: 'scalar' }, { name: '速度指令', type: 'scalar' }, { name: '高度指令', type: 'scalar' }],
    outputs: [{ name: '执行器总指令', type: 'scalar' }],
    middleVars: [{ name: '分配裕度', type: 'scalar' }],
    modelParameters: [{ key: 'allocation_gain', name: '控制分配增益', targetField: 'params.allocationGain', unit: 'gain', allowedModels: ['bias', 'drift', 'step'] }],
    note: '对应 Simulink 控制分配子系统，将控制需求转换成执行机构指令。',
    faultSlots: [
      physicalSlot('physical:allocation_gain', '控制分配增益', 'params.allocationGain', 'gain'),
      electricalSlot('执行器总指令', 'output', 'outputs.执行器总指令', 'actuator.total')
    ]
  }),
  simNode({
    id: 'node-voltage-drop',
    x: 820,
    y: 220,
    name: 'Voltage_drop / 电压跌落',
    moduleType: 'power',
    moduleId: 'voltage_drop',
    inputs: [{ name: '执行器总指令', type: 'scalar' }, { name: '母线电压', type: 'scalar' }],
    outputs: [{ name: '电压限幅后指令', type: 'scalar' }],
    middleVars: [{ name: '电压裕度', type: 'scalar' }],
    modelParameters: [{ key: 'bus_voltage_drop', name: '母线电压跌落', targetField: 'params.busVoltage', unit: 'ratio', allowedModels: ['step', 'degradation', 'freeze'] }],
    note: '对应 Simulink 顶层 Voltage_drop 模块，用于展示供电故障影响。',
    faultSlots: voltageSlots
  }),
  simNode({
    id: 'node-motor-actuator',
    x: 1075,
    y: 215,
    w: 200,
    h: 118,
    name: 'ControlAllocation / 电机执行器',
    moduleType: 'motor_actuator',
    moduleId: 'motor_actuator',
    inputs: [{ name: '电压限幅后指令', type: 'scalar' }],
    outputs: Array.from({ length: 8 }, (_, index) => ({ name: `${index + 1}号旋翼指令`, type: 'scalar' })),
    middleVars: [{ name: '执行器状态', type: 'scalar' }],
    modelParameters: [{ key: 'actuator_response_time', name: '执行器响应时间', targetField: 'params.responseTime', unit: 's', allowedModels: ['bias', 'drift', 'step'] }],
    note: '将控制分配结果展开为 8 路旋翼/电机指令。',
    faultSlots: [
      physicalSlot('physical:actuator_response_time', '执行器响应时间', 'params.responseTime', 's'),
      electricalSlot('电压限幅后指令', 'input', 'inputs.电压限幅后指令', 'actuator.total')
    ]
  })
];

for (let index = 1; index <= 8; index += 1) {
  nodes.push(simNode({
    id: `node-rotor-${index}`,
    x: 1360,
    y: 35 + (index - 1) * 92,
    w: 190,
    h: 82,
    name: `${index}号电机与旋翼`,
    moduleType: 'rotor_motor',
    moduleId: 'rotor_motor',
    inputs: [{ name: `M${index} 指令`, type: 'scalar' }],
    outputs: [{ name: `M${index} 推力`, type: 'scalar' }],
    middleVars: [{ name: `${index}号转速状态`, type: 'scalar' }],
    modelParameters: [
      { key: `rotor_${index}_efficiency`, name: `${index}号旋翼效率`, targetField: 'params.efficiency', unit: 'ratio', allowedModels: ['degradation', 'step'] },
      { key: `rotor_${index}_lock`, name: `${index}号电机锁死`, targetField: 'params.lock', unit: 'bool', allowedModels: ['freeze', 'step'] }
    ],
    note: '对应 Simulink 旋翼组油门到转速/推力链路。',
    faultSlots: [
      physicalSlot(`physical:rotor_${index}_efficiency`, `${index}号旋翼效率`, 'params.efficiency', 'ratio', ['degradation', 'step', 'drift']),
      physicalSlot(`physical:rotor_${index}_lock`, `${index}号电机锁死`, 'params.lock', 'bool', ['freeze', 'step']),
      electricalSlot(`M${index}_指令`, 'input', `inputs.M${index}_指令`, `motor.command.m${index}`),
      electricalSlot(`M${index}_推力`, 'output', `outputs.M${index}_推力`, `motor.thrust.m${index}`)
    ]
  }));
}

nodes.push(
  simNode({
    id: 'node-aero-moment',
    x: 1645,
    y: 245,
    w: 205,
    h: 118,
    name: '各部件气动力和力矩',
    moduleType: 'aerodynamics',
    moduleId: 'aero_moment',
    inputs: Array.from({ length: 8 }, (_, index) => ({ name: `M${index + 1} 推力`, type: 'scalar' })),
    outputs: [{ name: '合力', type: 'scalar' }, { name: '合力矩', type: 'scalar' }],
    middleVars: [{ name: '气动平衡量', type: 'scalar' }],
    modelParameters: [{ key: 'aero_coefficient', name: '气动系数', targetField: 'params.aeroCoefficient', unit: 'ratio', allowedModels: ['bias', 'drift', 'step'] }],
    note: '对应 Simulink 气动力和力矩子系统。',
    faultSlots: [physicalSlot('physical:aero_coefficient', '气动系数', 'params.aeroCoefficient', 'ratio')]
  }),
  simNode({
    id: 'node-six-dof',
    x: 1905,
    y: 245,
    w: 205,
    h: 118,
    name: '6DOF (Euler Angles) / 机体动力学',
    moduleType: 'six_dof',
    moduleId: 'six_dof',
    inputs: [{ name: '合力', type: 'scalar' }, { name: '合力矩', type: 'scalar' }],
    outputs: [{ name: '姿态角', type: 'scalar' }, { name: '机体角速度', type: 'scalar' }, { name: '高度', type: 'scalar' }],
    middleVars: [{ name: '机体能量状态', type: 'scalar' }],
    modelParameters: [
      { key: 'airframe_inertia', name: '机体惯量', targetField: 'params.inertia', unit: 'kg*m^2', allowedModels: ['bias', 'drift', 'step'] },
      { key: 'aero_drag_coefficient', name: '气动阻力系数', targetField: 'params.dragCoefficient', unit: 'ratio', allowedModels: ['bias', 'drift', 'step'] }
    ],
    note: '对应 Simulink 6DOF 欧拉角机体模型。',
    faultSlots: sixDofSlots
  }),
  simNode({
    id: 'node-sensor-fault-injection',
    x: 1765,
    y: 520,
    w: 220,
    h: 116,
    name: '传感器故障注入',
    moduleType: 'sensor_fault_injection',
    moduleId: 'sensor_fault_injection',
    inputs: [{ name: '姿态角', type: 'scalar' }, { name: '机体角速度', type: 'scalar' }, { name: '高度', type: 'scalar' }],
    outputs: [{ name: '姿态反馈', type: 'scalar' }, { name: '角速度反馈', type: 'scalar' }, { name: '高度反馈', type: 'scalar' }],
    middleVars: [{ name: '传感器残差', type: 'scalar' }],
    modelParameters: [],
    note: '对应 Simulink 顶层传感器故障注入子系统。',
    faultSlots: sensorFaultSlots
  }),
  instrumentNode('node-scope', 'instrument_scope', 560, 455, '故障前后对比示波器', ['cmd.attitude', 'sensor.attitude', 'vehicle.attitude']),
  instrumentNode('node-residual-logger', 'instrument_logger', 820, 455, '残差诊断记录仪', ['sensor.residual', 'err.attitude']),
  instrumentNode('node-spectrum', 'instrument_spectrum', 1080, 455, '频谱分析仪', ['vehicle.body_rate', 'sensor.rate'])
);

const edges = [
  edge({ id: 'edge-attitude-command-pid', sourceNodeId: 'node-attitude-command', targetNodeId: 'node-pid-controller', label: '姿态指令', signalId: 'cmd.attitude', signalUnit: 'rad' }),
  edge({ id: 'edge-speed-command-allocation', sourceNodeId: 'node-speed-command', targetNodeId: 'node-control-allocation', targetPortIndex: 1, label: '速度指令', signalId: 'cmd.speed', signalUnit: 'm/s' }),
  edge({ id: 'edge-altitude-command-allocation', sourceNodeId: 'node-altitude-command', targetNodeId: 'node-control-allocation', targetPortIndex: 2, label: '高度指令', signalId: 'cmd.altitude', signalUnit: 'm' }),
  edge({ id: 'edge-pid-allocation', sourceNodeId: 'node-pid-controller', targetNodeId: 'node-control-allocation', label: '力矩指令', signalId: 'ctrl.moment', signalUnit: 'N*m' }),
  edge({ id: 'edge-allocation-voltage', sourceNodeId: 'node-control-allocation', targetNodeId: 'node-voltage-drop', label: '执行器总指令', signalId: 'actuator.total', signalUnit: 'norm' }),
  edge({ id: 'edge-voltage-actuator', sourceNodeId: 'node-voltage-drop', targetNodeId: 'node-motor-actuator', label: '电压限幅后指令', signalId: 'actuator.voltage_limited', signalUnit: 'norm' })
];

for (let index = 1; index <= 8; index += 1) {
  edges.push(edge({
    id: `edge-actuator-rotor-${index}`,
    sourceNodeId: 'node-motor-actuator',
    targetNodeId: `node-rotor-${index}`,
    sourcePortIndex: index - 1,
    lineType: 'can',
    label: `${index}号电机 CAN 指令`,
    signalId: `motor.command.m${index}`,
    signalUnit: 'norm',
    channelId: `CAN-FC-M${index}`,
    messageId: `0x21${index}`,
    faultSlots: [protocolSlot(`protocol:motor_${index}_can_command`, `${index}号电机 CAN 指令`, `motor.command.m${index}`, `CAN-FC-M${index}`, `0x21${index}`)]
  }));
  edges.push(edge({
    id: `edge-rotor-${index}-aero`,
    sourceNodeId: `node-rotor-${index}`,
    targetNodeId: 'node-aero-moment',
    targetPortIndex: index - 1,
    label: `M${index} 推力`,
    signalId: `motor.thrust.m${index}`,
    signalUnit: 'N'
  }));
}

edges.push(
  edge({ id: 'edge-aero-force-six-dof', sourceNodeId: 'node-aero-moment', targetNodeId: 'node-six-dof', sourcePortIndex: 0, targetPortIndex: 0, label: '合力', signalId: 'aero.force', signalUnit: 'N' }),
  edge({ id: 'edge-aero-moment-six-dof', sourceNodeId: 'node-aero-moment', targetNodeId: 'node-six-dof', sourcePortIndex: 1, targetPortIndex: 1, label: '合力矩', signalId: 'aero.moment', signalUnit: 'N*m' }),
  edge({ id: 'edge-six-dof-attitude-sensor', sourceNodeId: 'node-six-dof', targetNodeId: 'node-sensor-fault-injection', sourcePortIndex: 0, targetPortIndex: 0, label: '姿态角', signalId: 'vehicle.attitude', signalUnit: 'rad' }),
  edge({ id: 'edge-six-dof-rate-sensor', sourceNodeId: 'node-six-dof', targetNodeId: 'node-sensor-fault-injection', sourcePortIndex: 1, targetPortIndex: 1, label: '机体角速度', signalId: 'vehicle.body_rate', signalUnit: 'rad/s' }),
  edge({ id: 'edge-six-dof-altitude-sensor', sourceNodeId: 'node-six-dof', targetNodeId: 'node-sensor-fault-injection', sourcePortIndex: 2, targetPortIndex: 2, label: '高度', signalId: 'vehicle.altitude', signalUnit: 'm' }),
  edge({
    id: 'edge-sensor-feedback-can',
    sourceNodeId: 'node-sensor-fault-injection',
    targetNodeId: 'node-pid-controller',
    sourcePortIndex: 0,
    targetPortIndex: 1,
    lineType: 'can',
    label: '传感器反馈 CAN',
    signalId: 'sensor.attitude',
    signalUnit: 'rad',
    channelId: 'CAN-SENSOR-FC',
    messageId: '0x184',
    faultSlots: [protocolSlot('protocol:sensor_feedback_can', '传感器反馈 CAN 报文', 'sensor.attitude', 'CAN-SENSOR-FC', '0x184')]
  }),
  edge({ id: 'edge-command-scope', sourceNodeId: 'node-attitude-command', targetNodeId: 'node-scope', targetPortIndex: 0, label: '指令观测', signalId: 'scope.command', signalUnit: 'rad' }),
  edge({ id: 'edge-sensor-scope', sourceNodeId: 'node-sensor-fault-injection', targetNodeId: 'node-scope', sourcePortIndex: 0, targetPortIndex: 1, label: '反馈观测', signalId: 'scope.sensor', signalUnit: 'rad' }),
  edge({ id: 'edge-six-dof-scope', sourceNodeId: 'node-six-dof', targetNodeId: 'node-scope', sourcePortIndex: 0, targetPortIndex: 2, label: '机体观测', signalId: 'scope.vehicle', signalUnit: 'rad' }),
  edge({ id: 'edge-sensor-logger', sourceNodeId: 'node-sensor-fault-injection', targetNodeId: 'node-residual-logger', sourcePortIndex: 0, label: '残差诊断', signalId: 'sensor.residual' }),
  edge({ id: 'edge-rate-spectrum', sourceNodeId: 'node-six-dof', targetNodeId: 'node-spectrum', sourcePortIndex: 1, label: '角速度频谱', signalId: 'diag.spectrum', signalUnit: 'rad/s' })
);

const snapshot = {
  version: 1,
  modelNodes: nodes,
  modelEdges: edges,
  nodeSeq: nodes.length,
  edgeSeq: edges.length,
  activeLineType: 'normal',
  faultedBlks: [],
  importedFaultModels: []
};

const faultCapabilityMap = [
  capability('node-pid-controller', 'node', 'PID 控制器', [
    ...pidPhysicalSlots.map((slot) => ({ ...slot, allowedFaultIds: commonPhysicalFaultIds })),
    ...nodes.find((node) => node.id === 'node-pid-controller').faultSlots.filter((slot) => slot.layer === 'electrical').map((slot) => ({ ...slot, allowedFaultIds: commonElectricalFaultIds }))
  ]),
  capability('node-control-allocation', 'node', '控制分配', nodes.find((node) => node.id === 'node-control-allocation').faultSlots.map((slot) => ({ ...slot, allowedFaultIds: slot.layer === 'physical' ? commonPhysicalFaultIds : commonElectricalFaultIds }))),
  capability('node-voltage-drop', 'node', '电压跌落', voltageSlots.map((slot) => ({ ...slot, allowedFaultIds: ['physical_parameter_step', 'physical_parameter_drift'] }))),
  capability('node-motor-actuator', 'node', '电机执行器', nodes.find((node) => node.id === 'node-motor-actuator').faultSlots.map((slot) => ({ ...slot, allowedFaultIds: slot.layer === 'physical' ? ['physical_parameter_drift', 'physical_parameter_step'] : commonElectricalFaultIds }))),
  ...Array.from({ length: 8 }, (_, index) => {
    const rotorIndex = index + 1;
    return capability(`node-rotor-${rotorIndex}`, 'node', `${rotorIndex}号电机与旋翼`, nodes.find((node) => node.id === `node-rotor-${rotorIndex}`).faultSlots.map((slot) => ({
      ...slot,
      allowedFaultIds: slot.layer === 'physical' ? ['actuator_lock_or_failure', 'physical_parameter_drift', 'physical_parameter_step'] : commonElectricalFaultIds
    })));
  }),
  capability('node-aero-moment', 'node', '各部件气动力和力矩', nodes.find((node) => node.id === 'node-aero-moment').faultSlots.map((slot) => ({ ...slot, allowedFaultIds: commonPhysicalFaultIds }))),
  capability('node-six-dof', 'node', '6DOF 机体动力学', sixDofSlots.map((slot) => ({ ...slot, allowedFaultIds: commonPhysicalFaultIds }))),
  capability('node-sensor-fault-injection', 'node', '传感器故障注入', sensorFaultSlots),
  capability('edge-sensor-feedback-can', 'edge', '传感器反馈 CAN', edges.find((item) => item.id === 'edge-sensor-feedback-can').faultSlots.filter((slot) => slot.layer === 'protocol').map((slot) => ({ ...slot, allowedFaultIds: commonProtocolFaultIds }))),
  ...Array.from({ length: 8 }, (_, index) => {
    const rotorIndex = index + 1;
    const targetEdge = edges.find((item) => item.id === `edge-actuator-rotor-${rotorIndex}`);
    return capability(targetEdge.id, 'edge', `${rotorIndex}号电机 CAN 指令`, targetEdge.faultSlots.filter((slot) => slot.layer === 'protocol').map((slot) => ({ ...slot, allowedFaultIds: commonProtocolFaultIds })));
  })
];

const diagnosticModel = {
  modelId: packageMeta.modelId,
  locale: 'zh-CN',
  systemFamily: packageMeta.systemFamily,
  title: 'eVTOL 飞控系统故障注入测点',
  description: '围绕姿态闭环、8 路旋翼、传感器反馈和机体动力学建立的展示型测点集合。',
  faultCases: [],
  testPoints: [
    { id: 'M1', name: '姿态指令测点', targetId: 'edge-attitude-command-pid', signalId: 'cmd.attitude', pointType: 'physical' },
    { id: 'M2', name: '控制力矩测点', targetId: 'edge-pid-allocation', signalId: 'ctrl.moment', pointType: 'virtual' },
    { id: 'M3', name: '执行器总指令测点', targetId: 'edge-allocation-voltage', signalId: 'actuator.total', pointType: 'virtual' },
    { id: 'M4', name: '电压限幅测点', targetId: 'edge-voltage-actuator', signalId: 'actuator.voltage_limited', pointType: 'virtual' },
    { id: 'M5', name: '1号电机 CAN 测点', targetId: 'edge-actuator-rotor-1', signalId: 'motor.command.m1', pointType: 'physical' },
    { id: 'M6', name: '4号电机推力测点', targetId: 'edge-rotor-4-aero', signalId: 'motor.thrust.m4', pointType: 'virtual' },
    { id: 'M7', name: '合力矩测点', targetId: 'edge-aero-moment-six-dof', signalId: 'aero.moment', pointType: 'virtual' },
    { id: 'M8', name: '机体姿态测点', targetId: 'edge-six-dof-attitude-sensor', signalId: 'vehicle.attitude', pointType: 'virtual' },
    { id: 'M9', name: '传感器反馈 CAN 测点', targetId: 'edge-sensor-feedback-can', signalId: 'sensor.attitude', pointType: 'physical' },
    { id: 'M10', name: '残差诊断测点', targetId: 'edge-sensor-logger', signalId: 'sensor.residual', pointType: 'virtual' },
    { id: 'M11', name: '角速度频谱测点', targetId: 'edge-rate-spectrum', signalId: 'diag.spectrum', pointType: 'virtual' },
    { id: 'M12', name: '高度反馈测点', targetId: 'edge-six-dof-altitude-sensor', signalId: 'vehicle.altitude', pointType: 'virtual' }
  ],
  dMatrix: {
    columns: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'],
    rows: []
  },
  contrastExamples: []
};

const pkg = buildFlightModelPackage({
  meta: {
    ...packageMeta,
    faultCapabilityMap
  },
  snapshot,
  faultLibrary: faultTypeCatalog
});

const outputPackage = {
  ...pkg,
  schemaVersion: '2.0',
  pythonModules: pkg.pythonModules.map(stripPythonModuleDuplicateSource),
  workbenchSnapshot: stripSnapshotPythonBindings(pkg.workbenchSnapshot),
  faultTypeCatalog,
  faultCapabilityMap,
  diagnosticModel,
  faultInstances: []
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(outputPackage)}\n`, 'utf8');
console.log(`wrote ${outputFile}`);
