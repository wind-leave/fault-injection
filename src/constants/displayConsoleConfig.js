// 显控台字段配置。
// 直接修改 DISPLAY_CONSOLE_PRESETS 中对应显控台的 inputs / fields 即可。
// fields 中：label 修改表头，value 修改静态数据；前四个 source: 'input' 字段读取画布输入。

export const DISPLAY_CONSOLE_INPUTS = [
  { key: 'centerFrequency', label: '中心频率（MHz）', type: 'float', displayScale: 1e-6 },
  { key: 'repetitionPeriod', label: '重复周期（μs）', type: 'float', displayScale: 1e6 },
  { key: 'pulseWidth', label: '脉宽（μs）', type: 'float', displayScale: 1e6 },
  { key: 'amplitude', label: '幅度', type: 'float' }
];

export const DISPLAY_CONSOLE_COLUMNS = [
  { key: 'serialNumber', label: '序号', value: '1' },
  { key: 'centerFrequency', label: '中心频率（MHz）', source: 'input', inputIndex: 0 },
  { key: 'repetitionPeriod', label: '重复周期（μs）', source: 'input', inputIndex: 1 },
  { key: 'pulseWidth', label: '脉宽（μs）', source: 'input', inputIndex: 2 },
  { key: 'amplitude', label: '幅度', source: 'input', inputIndex: 3 },
  { key: 'band', label: '频段', value: '--' },
  { key: 'waveform', label: '波形', value: '--' },
  { key: 'modulation', label: '调制方式', value: '--' },
  { key: 'bandwidth', label: '带宽', value: '--' },
  { key: 'phase', label: '相位', value: '--' },
  { key: 'transmitPower', label: '发射功率', value: '--' },
  { key: 'gain', label: '增益', value: '--' },
  { key: 'status', label: '工作状态', source: 'status' },
  { key: 'trigger', label: '触发方式', value: '--' },
  { key: 'updatedAt', label: '更新时间', source: 'time' },
  { key: 'remark', label: '备注', value: '--' }
];

// 每个对象就是左侧一个显控台。复制一个对象并改成 display_console_3，即可新增显控台 3。
// 各显控台的字段分别写在这里，互不影响。
export const DISPLAY_CONSOLE_PRESETS = {
  display_console_1: {
    name: '显控台 1',
    inputs: {
      centerFrequency: '中心频率（MHz）',
      repetitionPeriod: '重复周期（μs）',
      pulseWidth: '脉宽（μs）',
      amplitude: '幅度'
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
    ]
  }
};

export function createDisplayConsoleConfig(preset = {}) {
  const inputLabels = preset.inputs ?? {};
  const fields = preset.fields ?? {};
  return {
    inputs: DISPLAY_CONSOLE_INPUTS.map((input) => ({
      ...input,
      label: inputLabels[input.key] ?? input.label
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
      : []
  };
}
