// 显控台内置回退配置。日常部署修改 public/config/display-console.json。
// 启动时先加载并校验外部 JSON，再导入组件注册表；加载失败时保留本文件的默认值。
// JSON 可覆盖本文件四个 DISPLAY_CONSOLE_* 数据导出，函数按加载后的数据工作。
// 默认 inputs 的键依次对应向量元素 1–7：centerFrequency、repetitionPeriod、pulseWidth、
// amplitude、band、waveform、modulation。每路的 generateMeasurementPoint 独立控制自动测点：
// true（或省略）= 连线后自动设置；false = 不自动设置。可在各显控台预设中分别修改。
// 仅修改显示名称时也可使用字符串，例如 centerFrequency: '中心频率（MHz）'。
// fields 中：label 修改表头，value 修改静态数据；前七个 source: 'input' 字段读取向量元素。

export const DISPLAY_CONSOLE_INPUTS = [
  { key: 'centerFrequency', label: '中心频率（MHz）', type: 'float', displayScale: 1e-6, generateMeasurementPoint: true },
  { key: 'repetitionPeriod', label: '重复周期（μs）', type: 'float', displayScale: 1e6, generateMeasurementPoint: true },
  { key: 'pulseWidth', label: '脉宽（μs）', type: 'float', displayScale: 1e6, generateMeasurementPoint: true },
  { key: 'amplitude', label: '幅度', type: 'float', generateMeasurementPoint: true },
  { key: 'band', label: '频段编码', type: 'float', generateMeasurementPoint: true },
  { key: 'waveform', label: '波形编码', type: 'float', generateMeasurementPoint: true },
  { key: 'modulation', label: '调制方式编码', type: 'float', generateMeasurementPoint: true }
];

export let DISPLAY_CONSOLE_VECTOR_PORT_ID = 'console-input';

export function createDisplayConsoleVectorPort(inputs = DISPLAY_CONSOLE_INPUTS, port = {}) {
  const vectorElementNames = DISPLAY_CONSOLE_INPUTS.map((input, index) =>
    String(inputs[index]?.label || input.label));
  return {
    id: String(port.id || DISPLAY_CONSOLE_VECTOR_PORT_ID),
    name: String(port.name || (DISPLAY_CONSOLE_INPUTS.length === 7 ? '七路参数输入' : `${DISPLAY_CONSOLE_INPUTS.length}路参数输入`)),
    dataType: 'vector',
    vectorLength: DISPLAY_CONSOLE_INPUTS.length,
    vectorElementNames,
    elementNames: vectorElementNames
  };
}

export const DISPLAY_CONSOLE_COLUMNS = [
  { key: 'serialNumber', label: '序号', value: '1' },
  { key: 'centerFrequency', label: '中心频率（MHz）', source: 'input', inputIndex: 0 },
  { key: 'repetitionPeriod', label: '重复周期（μs）', source: 'input', inputIndex: 1 },
  { key: 'pulseWidth', label: '脉宽（μs）', source: 'input', inputIndex: 2 },
  { key: 'amplitude', label: '幅度', source: 'input', inputIndex: 3 },
  { key: 'band', label: '频段编码', source: 'input', inputIndex: 4 },
  { key: 'waveform', label: '波形编码', source: 'input', inputIndex: 5 },
  { key: 'modulation', label: '调制方式编码', source: 'input', inputIndex: 6 },
  { key: 'bandwidth', label: '带宽', value: '--' },
  { key: 'phase', label: '相位', value: '--' },
  { key: 'transmitPower', label: '发射功率', value: '--' },
  { key: 'gain', label: '增益', value: '--' },
  { key: 'status', label: '工作状态', source: 'status' },
  { key: 'trigger', label: '触发方式', value: '--' },
  { key: 'updatedAt', label: '更新时间', source: 'time' },
  { key: 'remark', label: '备注', value: '--' }
];

// 每个对象就是左侧一个显控台。可选的 ports 数组定义多个向量输入端口；
// 每个端口对应表格一行，向量长度由 DISPLAY_CONSOLE_INPUTS 决定。
// 必须给出稳定且互不重复的 id，可用 name 和 inputs 覆盖该行名称及元素配置。
// 例如 ports: [{ id: 'console-input', name: '通道 A' }, { id: 'console-input-2', name: '通道 B' }]。
// 未配置 ports 时保持原有的单端口行为。
// 复制一个对象并改成 display_console_3，即可新增显控台 3。
// 各显控台的字段分别写在这里，互不影响。
export const DISPLAY_CONSOLE_PRESETS = {
  display_console_1: {
    name: '显控台 1',
    inputs: {
      centerFrequency: { label: '中心频率（MHz）', generateMeasurementPoint: false },
      repetitionPeriod: { label: '重复周期（μs）', generateMeasurementPoint: true },
      pulseWidth: { label: '脉宽（μs）', generateMeasurementPoint: true },
      amplitude: { label: '幅度', generateMeasurementPoint: true },
      band: { label: '频段编码', generateMeasurementPoint: true },
      waveform: { label: '波形编码', generateMeasurementPoint: true },
      modulation: { label: '调制方式编码', generateMeasurementPoint: true }
    },
    fields: {
      band: { label: '频段', value: 'X 波段' },
      waveform: { label: '波形', value: '脉冲' },
      modulation: { label: '调制方式', value: 'LFM' },
      remark: { label: '备注', value: '显控台 1' }
    },
    // 仅列出允许由该显控台修改的组件和参数。参数键必须与仿真组件的
    // parameters[].key 一致；未列出的组件或参数不会出现在显控台中。
    controls: [
      {
        componentType: 'rf_four_channel_source',
        label: '四通道射频数据源',
        parameterKeys: ['center_frequency_hz', 'pulse_width_seconds', 'pulse_period_seconds']
      },
      {
        componentType: 'rf_four_output_source',
        label: '四接口射频信号源',
        parameterKeys: ['center_frequency_hz', 'pulse_width_seconds', 'pulse_period_seconds']
      }
    ],
    // 一个共享参数只有一个编辑框；应用后会同步写入 bindings 中所有
    // 已在画布上的组件实例。每个绑定仍须同时存在于 controls 白名单中。
    sharedParameters: [
      {
        key: 'rf_center_frequency',
        label: '中心频率',
        bindings: [
          { componentType: 'rf_four_channel_source', parameterKey: 'center_frequency_hz' },
          { componentType: 'rf_limit_amplify_downconvert_split8', parameterKey: 'lo_frequency_hz' },
          { componentType: 'rf_four_output_source', parameterKey: 'center_frequency_hz' }
        ]
      },
      {
        key: 'rf_pulse_width',
        label: '脉宽',
        bindings: [
          { componentType: 'rf_four_channel_source', parameterKey: 'pulse_width_seconds' },
          { componentType: 'rf_four_output_source', parameterKey: 'pulse_width_seconds' }
        ]
      },
      {
        key: 'rf_pulse_period',
        label: '重复周期',
        bindings: [
          { componentType: 'rf_four_channel_source', parameterKey: 'pulse_period_seconds' },
          { componentType: 'rf_four_output_source', parameterKey: 'pulse_period_seconds' }
        ]
      }
    ]
  },
  display_console_2: {
    name: '显控台 2',
    inputs: {
      centerFrequency: '中心频率（MHz）',
      repetitionPeriod: '重复周期（μs）',
      pulseWidth: '脉宽（μs）',
      amplitude: '幅度'
    },
    ports: [
      {
        id: 'console-input',
        name: '通道 A',
        inputs: { centerFrequency: { generateMeasurementPoint: false } }
      },
      {
        id: 'console-input-2',
        name: '通道 B',
        inputs: { amplitude: { generateMeasurementPoint: false } }
      }
    ],
    fields: {
      band: { label: '频段', value: 'Ku 波段' },
      waveform: { label: '波形', value: '脉冲' },
      modulation: { label: '调制方式', value: 'CW' },
      remark: { label: '备注', value: '显控台 2' }
    },
    controls: [
      {
        componentType: 'rf_downconverter',
        label: '射频下变频器',
        parameterKeys: ['input_mode', 'lo_frequency_hz', 'lo_phase_deg', 'conversion_gain', 'low_pass_cutoff_hz']
      }
    ],
    sharedParameters: [
      {
        key: 'rf_downconverter_input_mode',
        label: '输入选择模式',
        bindings: [
          { componentType: 'rf_downconverter', parameterKey: 'input_mode' }
        ]
      }
    ]
  },
  display_console_3: {
    name: '显控台 3',
    inputs: {
      centerFrequency: '下变频输出 1（I）',
      repetitionPeriod: '下变频输出 2（I）',
      pulseWidth: '上变频射频输出 1',
      amplitude: '上变频射频输出 2'
    },
    fields: {
      band: { label: '处理类型', value: '上下变频' },
      waveform: { label: '受控对象', value: '四接口变频器' },
      modulation: { label: '工作模式', value: '双向变频' },
      remark: { label: '备注', value: '显控台 3 · 上下变频控制' }
    },
    controls: [
      {
        componentType: 'rf_four_port_up_down_converter',
        label: '四接口上下变频器',
        parameterKeys: [
          'downconvert_lo_frequency_hz',
          'upconvert_lo_frequency_hz',
          'lo_phase_deg',
          'downconversion_gain',
          'upconversion_gain',
          'downconvert_low_pass_cutoff_hz'
        ]
      }
    ]
  },
  display_console_4: {
    name: '显控台 4',
    inputs: {
      centerFrequency: '射频输出 1',
      repetitionPeriod: '射频输出 2',
      pulseWidth: '射频输出 3',
      amplitude: '射频输出 4'
    },
    fields: {
      band: { label: '处理类型', value: '限放/下变频/功分' },
      waveform: { label: '受控对象', value: '八路功分组件' },
      modulation: { label: '工作模式', value: '四分八' },
      remark: { label: '备注', value: '显控台 4 · 限放功分控制' }
    },
    controls: [
      {
        componentType: 'rf_limit_amplify_downconvert_split8',
        label: '射频限放下变频八路功分',
        parameterKeys: [
          'limit_amplitude',
          'gain_db',
          'lo_frequency_hz',
          'lo_phase_deg',
          'conversion_gain',
          'low_pass_cutoff_hz',
          'split_insertion_loss_db'
        ]
      }
    ]
  },
  display_console_5: {
    name: '显控台 5',
    inputs: {
      centerFrequency: '中心频率（MHz）',
      repetitionPeriod: '重复周期（μs）',
      pulseWidth: '脉宽（μs）',
      amplitude: '脉冲幅度（ADC）'
    },
    fields: {
      band: { label: '处理类型', value: '脉冲特征提取' },
      waveform: { label: '受控对象', value: 'FFT / 包络检测' },
      modulation: { label: '工作模式', value: '实时特征分析' },
      remark: { label: '备注', value: '显控台 5 · 脉冲特征控制' }
    },
    controls: [
      {
        componentType: 'rf_pulse_feature_extractor',
        label: '射频脉冲特征提取',
        parameterKeys: ['fft_size', 'adc_full_scale', 'envelope_threshold_adc']
      }
    ]
  },
  display_console_6: {
    name: '显控台 6',
    inputs: {
      centerFrequency: '通道 1',
      repetitionPeriod: '通道 2',
      pulseWidth: '通道 3',
      amplitude: '通道 4'
    },
    fields: {
      band: { label: '信号源类型', value: '四通道射频数据源' },
      waveform: { label: '输出形式', value: '四路向量' },
      modulation: { label: '工作模式', value: '同步脉冲' },
      remark: { label: '备注', value: '显控台 6 · 四通道幅相控制' }
    },
    controls: [
      {
        componentType: 'rf_four_channel_source',
        label: '四通道射频数据源',
        parameterKeys: ['sample_1', 'sample_2', 'sample_3', 'sample_4', 'phase_deg']
      }
    ]
  },
  display_console_7: {
    name: '显控台 7',
    inputs: {
      centerFrequency: '接口 1',
      repetitionPeriod: '接口 2',
      pulseWidth: '接口 3',
      amplitude: '接口 4'
    },
    fields: {
      band: { label: '信号源类型', value: '四接口射频信号源' },
      waveform: { label: '输出形式', value: '四路标量' },
      modulation: { label: '工作模式', value: '同步脉冲' },
      remark: { label: '备注', value: '显控台 7 · 四接口幅相控制' }
    },
    controls: [
      {
        componentType: 'rf_four_output_source',
        label: '四接口射频信号源',
        parameterKeys: ['sample_1', 'sample_2', 'sample_3', 'sample_4', 'phase_deg']
      }
    ]
  }
};

export function createDisplayConsoleConfig(preset = {}) {
  const inputSettings = preset.inputs ?? {};
  const fields = preset.fields ?? {};
  const resolveInputs = (settings = {}, defaults = DISPLAY_CONSOLE_INPUTS) => DISPLAY_CONSOLE_INPUTS.map((input, index) => {
    const setting = settings[input.key];
    const overrides = setting && typeof setting === 'object' ? setting : {};
    const fallback = defaults[index] || input;
    return {
      ...fallback,
      ...overrides,
      label: typeof setting === 'string' ? setting : (overrides.label ?? fallback.label),
      generateMeasurementPoint: overrides.generateMeasurementPoint ?? (fallback.generateMeasurementPoint !== false)
    };
  });
  const inputs = resolveInputs(inputSettings);
  const configuredPorts = Array.isArray(preset.ports) && preset.ports.length ? preset.ports : [{}];
  return {
    inputs,
    ports: configuredPorts.map((port, index) => ({
      id: String(port?.id || (index === 0 ? DISPLAY_CONSOLE_VECTOR_PORT_ID : `${DISPLAY_CONSOLE_VECTOR_PORT_ID}-${index + 1}`)),
      name: String(port?.name || `${DISPLAY_CONSOLE_INPUTS.length === 7 ? '七路参数输入' : `${DISPLAY_CONSOLE_INPUTS.length}路参数输入`}${index === 0 ? '' : ` ${index + 1}`}`),
      inputs: resolveInputs(port?.inputs, inputs)
    })),
    columns: DISPLAY_CONSOLE_COLUMNS.map((column) => ({
      ...column,
      ...(fields[column.key] ?? {})
    })),
    controls: Array.isArray(preset.controls)
      ? preset.controls.map((control) => ({
        ...control,
        parameterKeys: Array.isArray(control?.parameterKeys) ? [...control.parameterKeys] : []
      }))
      : [],
    sharedParameters: Array.isArray(preset.sharedParameters)
      ? preset.sharedParameters.map((parameter) => ({
        ...parameter,
        bindings: Array.isArray(parameter?.bindings)
          ? parameter.bindings.map((binding) => ({ ...binding }))
          : []
      }))
      : []
  };
}

// Called only after the complete runtime document has been validated. Preserve
// array/object identities for all existing importers and the legacy runtime.
export function applyDisplayConsoleConfiguration(configuration) {
  const next = JSON.parse(JSON.stringify(configuration));
  DISPLAY_CONSOLE_INPUTS.splice(0, DISPLAY_CONSOLE_INPUTS.length, ...next.DISPLAY_CONSOLE_INPUTS);
  DISPLAY_CONSOLE_COLUMNS.splice(0, DISPLAY_CONSOLE_COLUMNS.length, ...next.DISPLAY_CONSOLE_COLUMNS);
  DISPLAY_CONSOLE_VECTOR_PORT_ID = next.DISPLAY_CONSOLE_VECTOR_PORT_ID;
  for (const key of Object.keys(DISPLAY_CONSOLE_PRESETS)) delete DISPLAY_CONSOLE_PRESETS[key];
  Object.assign(DISPLAY_CONSOLE_PRESETS, next.DISPLAY_CONSOLE_PRESETS);
}
