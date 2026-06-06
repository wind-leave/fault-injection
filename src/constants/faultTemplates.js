export const protocolFaultTemplates = [
  { id: 'drop', label: '丢包', layer: 'protocol', target: 'can' },
  { id: 'delay', label: '延迟', layer: 'protocol', target: 'can' },
  { id: 'bitflip', label: '位翻转', layer: 'protocol', target: 'can' },
  { id: 'replay', label: '重放', layer: 'protocol', target: 'can' }
];
