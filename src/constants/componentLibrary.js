export const systemModelingComponents = [
  { type: 'signal_source', label: '信号源' },
  { type: 'flow_block', label: '信号适配块' },
  { type: 'gain_block', label: '增益块' },
  { type: 'sum_block', label: '求和块' },
  { type: 'mux_block', label: 'Mux 块' },
  { type: 'simulation_block', label: '仿真块' },
  { type: 'subsystem_block', label: '子系统块' }
];

export const faultInjectionComponents = [
  { type: 'physical_fault_injector', label: '物理层注入' },
  { type: 'electrical_fault_injector', label: '电气层注入' },
  { type: 'protocol_fault_injector', label: '协议层注入' }
];

export const instrumentComponents = [
  { type: 'instrument_scope', label: '示波器' },
  { type: 'instrument_spectrum', label: '频谱分析仪' },
  { type: 'instrument_logger', label: '数据记录仪' }
];

export const edgeComponents = [
  { type: 'normal', label: '普通连接线' },
  { type: 'can', label: 'CAN 总线' }
];
