import { describe, expect, it } from 'vitest';
import {
  createKnowledgeGraphLayout,
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
});
