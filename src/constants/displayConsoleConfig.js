// 显控台字段配置。
// 直接修改 DISPLAY_CONSOLE_PRESETS 中对应显控台的 inputs / fields 即可。
// fields 中：label 修改表头，value 修改静态数据；前四个 source: 'input' 字段读取画布输入。

export const DISPLAY_CONSOLE_INPUTS = [
  { key: 'centerFrequency', label: '中心频率', type: 'scalar' },
  { key: 'repetitionPeriod', label: '重复周期', type: 'scalar' },
  { key: 'pulseWidth', label: '脉宽', type: 'scalar' },
  { key: 'amplitude', label: '幅度', type: 'scalar' }
];

export const DISPLAY_CONSOLE_COLUMNS = [
  { key: 'serialNumber', label: '序号', value: '1' },
  { key: 'centerFrequency', label: '中心频率', source: 'input', inputIndex: 0 },
  { key: 'repetitionPeriod', label: '重复周期', source: 'input', inputIndex: 1 },
  { key: 'pulseWidth', label: '脉宽', source: 'input', inputIndex: 2 },
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
      centerFrequency: '中心频率',
      repetitionPeriod: '重复周期',
      pulseWidth: '脉宽',
      amplitude: '幅度'
    },
    fields: {
      band: { label: '频段', value: 'X 波段' },
      waveform: { label: '波形', value: '脉冲' },
      modulation: { label: '调制方式', value: 'LFM' },
      remark: { label: '备注', value: '显控台 1' }
    }
  },
  display_console_2: {
    name: '显控台 2',
    inputs: {
      centerFrequency: '中心频率',
      repetitionPeriod: '重复周期',
      pulseWidth: '脉宽',
      amplitude: '幅度'
    },
    fields: {
      band: { label: '频段', value: 'Ku 波段' },
      waveform: { label: '波形', value: '脉冲' },
      modulation: { label: '调制方式', value: 'CW' },
      remark: { label: '备注', value: '显控台 2' }
    }
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
    }))
  };
}
