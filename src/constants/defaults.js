import {
  edgeComponents,
  faultInjectionComponents,
  instrumentComponents,
  systemModelingComponents
} from './componentLibrary.js';

export function createInitialWorkbenchState() {
  return {
    title: '故障注入平台',
    tabs: ['系统建模', '故障注入', '仿真分析'],
    topActions: ['导入系统模型', '导入故障模型', '保存系统模型', '保存仿真结果'],
    palette: {
      systemModeling: systemModelingComponents,
      faultInjection: faultInjectionComponents,
      instruments: instrumentComponents,
      edges: edgeComponents
    }
  };
}
