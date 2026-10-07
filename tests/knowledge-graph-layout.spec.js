import { describe, expect, it } from 'vitest';
import {
  createKnowledgeGraphLayout,
  createMaintenanceKnowledgeGraphLayout,
  createSpecificationKnowledgeGraphLayout,
  normalizeKnowledgeGraph
} from '../src/services/knowledgeGraphLayout.js';

const graph = {
  nodes: [
    { kind: 'fault', id: 'fault-a', label: '设备 A 偏置' },
    { kind: 'component', id: 'device-a', label: '设备 A' },
    { kind: 'measurementPoint', id: 'tp-1', label: '输出测点' }
  ],
  relations: [
    {
      type: 'OCCURS_ON',
      source: { kind: 'fault', id: 'fault-a' },
      target: { kind: 'component', id: 'device-a' }
    },
    {
      type: 'DETECTABILITY',
      source: { kind: 'fault', id: 'fault-a' },
      target: { kind: 'measurementPoint', id: 'tp-1' },
      detectable: false,
      sourceName: 'manual-d-matrix'
    }
  ]
};

describe('knowledge graph layout', () => {
  it('normalizes node keys, relation labels, and node degree', () => {
    const normalized = normalizeKnowledgeGraph(graph);

    expect(normalized.nodes.map((node) => node.key)).toEqual([
      'fault:fault-a',
      'component:device-a',
      'measurementPoint:tp-1'
    ]);
    expect(normalized.nodes.find((node) => node.id === 'fault-a')?.degree).toBe(2);
    expect(normalized.relations[1]).toEqual(expect.objectContaining({
      label: '不可检测（0）',
      detectable: false,
      sourceKey: 'fault:fault-a',
      targetKey: 'measurementPoint:tp-1'
    }));
  });

  it('places node kinds in stable columns without losing graph data', () => {
    const layout = createKnowledgeGraphLayout(graph, { width: 1200 });
    const fault = layout.nodes.find((node) => node.kind === 'fault');
    const component = layout.nodes.find((node) => node.kind === 'component');
    const point = layout.nodes.find((node) => node.kind === 'measurementPoint');

    expect(layout.relations).toHaveLength(2);
    expect(fault.x).toBeLessThan(component.x);
    expect(component.x).toBeLessThan(point.x);
    expect(layout.height).toBeGreaterThanOrEqual(620);
  });

  it('aligns same-named phenomena with their own points and spaces siblings', () => {
    const layout = createMaintenanceKnowledgeGraphLayout({
      nodes: [
        ...['M1', 'M2', 'M3'].map((id) => ({ kind: 'measurementPoint', id, label: id })),
        { kind: 'phenomenon', id: 'p1', label: '输出偏低', pointId: 'M1', phenomenonOrder: 0 },
        { kind: 'phenomenon', id: 'p2', label: '输出偏低', pointId: 'M2', phenomenonOrder: 0 },
        { kind: 'phenomenon', id: 'p3', label: '响应缓慢', pointId: 'M2', phenomenonOrder: 1 },
        { kind: 'phenomenon', id: 'p4', label: '输出偏低', pointId: 'M3', phenomenonOrder: 0 }
      ],
      relations: []
    });
    const node = (id) => layout.nodes.find((item) => item.id === id);
    expect(node('p1').y).toBe(node('M1').y);
    expect(node('p4').y).toBe(node('M3').y);
    expect((node('p2').y + node('p3').y) / 2).toBe(node('M2').y);
    expect(node('p3').y - node('p2').y).toBeGreaterThanOrEqual(62);
    expect([node('p1'), node('p2'), node('p3'), node('p4')].map((item) => item.y)).toEqual(
      [node('p1'), node('p2'), node('p3'), node('p4')].map((item) => item.y).sort((a, b) => a - b)
    );
  });

  it('puts associated equipment and wires in one column near their faults', () => {
    const layout = createMaintenanceKnowledgeGraphLayout({
      nodes: [
        ...['A', 'B', 'C'].map((id) => ({ kind: 'fault', id, label: id })),
        { kind: 'component', id: 'device-a', label: '设备 A' },
        { kind: 'component', id: 'device-b', label: '设备 B' },
        { kind: 'signalEdge', id: 'wire-b', label: '连线 B' },
        { kind: 'measurementPoint', id: 'M1', label: '测点 M1' },
        { kind: 'phenomenon', id: 'p1', label: '现象', pointId: 'M1' }
      ],
      relations: [
        { type: 'OCCURS_ON', source: { kind: 'fault', id: 'A' }, target: { kind: 'component', id: 'device-a' } },
        { type: 'OCCURS_ON', source: { kind: 'fault', id: 'B' }, target: { kind: 'component', id: 'device-b' } },
        { type: 'OCCURS_ON', source: { kind: 'fault', id: 'B' }, target: { kind: 'signalEdge', id: 'wire-b' } }
      ]
    });
    const node = (id) => layout.nodes.find((item) => item.id === id);
    expect(node('A').x).toBeLessThan(node('device-a').x);
    expect(node('device-a').x).toBe(node('wire-b').x);
    expect(node('wire-b').x).toBeLessThan(node('M1').x);
    expect(node('M1').x).toBeLessThan(node('p1').x);
    expect(node('device-a').y).toBe(node('A').y);
    expect((node('device-b').y + node('wire-b').y) / 2).toBe(node('B').y);
    expect(Math.abs(node('device-b').y - node('wire-b').y)).toBeGreaterThanOrEqual(62);
  });

  it('places each requirement and instrument beside its device', () => {
    const layout = createSpecificationKnowledgeGraphLayout({
      nodes: [
        { kind: 'component', id: 'device-a', label: '设备 A' },
        { kind: 'component', id: 'device-b', label: '设备 B' },
        { kind: 'operationRequirement', id: 'rule-a-1', label: '断电检查', deviceId: 'device-a', itemOrder: 0 },
        { kind: 'operationRequirement', id: 'rule-a-2', label: '记录参数', deviceId: 'device-a', itemOrder: 1 },
        { kind: 'measurementInstrument', id: 'meter-a', label: '万用表', deviceId: 'device-a', itemOrder: 0 },
        { kind: 'measurementInstrument', id: 'scope-b', label: '示波器', deviceId: 'device-b', itemOrder: 0 }
      ],
      relations: []
    });
    const node = (id) => layout.nodes.find((item) => item.id === id);
    expect(node('rule-a-1').x).toBeLessThan(node('device-a').x);
    expect(node('device-a').x).toBeLessThan(node('meter-a').x);
    expect((node('rule-a-1').y + node('rule-a-2').y) / 2).toBe(node('device-a').y);
    expect(node('meter-a').y).toBe(node('device-a').y);
    expect(node('scope-b').y).toBe(node('device-b').y);
  });
});
