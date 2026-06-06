import { describe, expect, it } from 'vitest';
import {
  createEmptyAuthoringPackage,
  normalizeAuthoringPackage,
  upsertById
} from '../src/services/authoringModelService.js';

describe('authoringModelService', () => {
  it('creates an empty schema 3 authoring package with separated model layers', () => {
    const pkg = createEmptyAuthoringPackage({
      modelId: 'demo-authoring-model',
      modelName: '人工建模 Demo'
    });

    expect(pkg.schemaVersion).toBe('3.0');
    expect(pkg.packageType).toBe('flight-control-model');
    expect(pkg.modelInfo.modelId).toBe('demo-authoring-model');
    expect(pkg.modelInfo.modelName).toBe('人工建模 Demo');
    expect(pkg.componentTemplates).toEqual([]);
    expect(pkg.systemModel.nodes).toEqual([]);
    expect(pkg.systemModel.edges).toEqual([]);
    expect(pkg.faultTypeCatalog).toEqual([]);
    expect(pkg.faultCapabilityMap).toEqual([]);
    expect(pkg.faultInstances).toEqual([]);
    expect(pkg.diagnosticModel.testPoints).toEqual([]);
    expect(pkg.diagnosticModel.detectabilityMatrix).toEqual([]);
    expect(pkg.pythonModules).toEqual([]);
  });

  it('normalizes legacy flat package fields into schema 3 sections', () => {
    const legacy = {
      schemaVersion: 2,
      modelId: 'legacy-demo',
      modelName: '旧模型',
      nodes: [{ id: 'node-a', displayName: '节点 A' }],
      edges: [{ id: 'edge-a-b', sourceNodeId: 'node-a', targetNodeId: 'node-b' }],
      faultLibrary: [{ id: 'bias_fault', displayName: '偏差故障' }],
      faultCapabilityMap: [{ targetId: 'node-a', targetKind: 'node', faultSlots: [] }],
      faultInstances: [{ instanceId: 'fault-inst-1', active: true }],
      testPoints: [{ testPointId: 'M1', displayName: '测点 M1' }],
      detectabilityMatrix: [{ faultTypeId: 'bias_fault', testPointId: 'M1', detectable: true }],
      pythonModules: [{ moduleId: 'controller' }]
    };

    const pkg = normalizeAuthoringPackage(legacy);

    expect(pkg.schemaVersion).toBe('3.0');
    expect(pkg.modelInfo.modelId).toBe('legacy-demo');
    expect(pkg.systemModel.nodes).toHaveLength(1);
    expect(pkg.systemModel.edges).toHaveLength(1);
    expect(pkg.faultTypeCatalog[0].id).toBe('bias_fault');
    expect(pkg.faultCapabilityMap[0].targetId).toBe('node-a');
    expect(pkg.faultInstances[0].instanceId).toBe('fault-inst-1');
    expect(pkg.diagnosticModel.testPoints[0].testPointId).toBe('M1');
    expect(pkg.diagnosticModel.detectabilityMatrix[0].detectable).toBe(true);
    expect(pkg.pythonModules[0].moduleId).toBe('controller');
  });

  it('upserts records by id without mutating the original list', () => {
    const original = [{ id: 'a', value: 1 }];
    const next = upsertById(original, { id: 'a', value: 2 });
    const appended = upsertById(next, { id: 'b', value: 3 });

    expect(original).toEqual([{ id: 'a', value: 1 }]);
    expect(next).toEqual([{ id: 'a', value: 2 }]);
    expect(appended).toEqual([
      { id: 'a', value: 2 },
      { id: 'b', value: 3 }
    ]);
  });

  it('normalizes workbench snapshots when flat nodes and edges are absent', () => {
    const pkg = normalizeAuthoringPackage({
      modelId: 'snapshot-demo',
      workbenchSnapshot: {
        modelNodes: [{ id: 'node-from-snapshot' }],
        modelEdges: [{ id: 'edge-from-snapshot' }]
      }
    });

    expect(pkg.systemModel.nodes).toEqual([{ id: 'node-from-snapshot' }]);
    expect(pkg.systemModel.edges).toEqual([{ id: 'edge-from-snapshot' }]);
  });

  it('throws when upserting a record without the configured id key', () => {
    expect(() => upsertById([], { value: 1 })).toThrow('Missing id');
    expect(() => upsertById([], { id: 'a' }, 'instanceId')).toThrow('Missing instanceId');
  });
});
