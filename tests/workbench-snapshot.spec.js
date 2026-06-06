import { describe, expect, it } from 'vitest';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from '../src/services/workbenchSnapshotService.js';

describe('workbenchSnapshotService', () => {
  it('serializes python bindings and port metadata into a restorable snapshot', () => {
    const snapshot = createWorkbenchSnapshot({
      modelNodes: [
        {
          id: 'node-1',
          type: 'simulation_block',
          x: 120,
          y: 240,
          w: 188,
          h: 96,
          props: { name: 'PID Block' },
          pythonBinding: {
            bound: true,
            fileName: 'pid_controller.py',
            moduleName: 'pid_controller',
            description: 'PID controller',
            entryFunction: 'process',
            rawSource: 'def process(error): return error',
            executionMode: 'backend',
            executionConfig: { endpoint: '/api/python-flow/execute', timeoutMs: 5000 },
            parsedInterface: {
              fileName: 'pid_controller.py',
              inputs: [{ name: 'error', type: 'float', default: null, comment: '' }],
              outputs: [{ name: 'output_0', type: 'float', comment: '' }],
              middleVars: []
            },
            portMapping: {
              inputs: [{ portId: 'input-0', varName: 'error', displayName: '误差', type: 'float', default: null, connected: true }],
              outputs: [{ portId: 'output-0', varName: 'output_0', displayName: '控制量', type: 'float' }],
              middleVars: []
            }
          }
        }
      ],
      modelEdges: [
        {
          id: 'edge-1',
          lineType: 'normal',
          sourceNodeId: 'node-source',
          targetNodeId: 'node-1',
          sourcePortIndex: 0,
          targetPortIndex: 0,
          sourcePort: { index: 0, varName: 'out', displayName: 'out', type: 'float' },
          targetPort: { index: 0, varName: 'error', displayName: '误差', type: 'float' }
        }
      ],
      nodeSeq: 2,
      edgeSeq: 1,
      activeLineType: 'can',
      faultedBlks: ['node-1'],
      importedFaultModels: [{ id: 'fm-1', name: 'CAN delay', layer: 'protocol' }]
    });

    const restored = restoreWorkbenchSnapshot(snapshot);

    expect(restored.modelNodes[0].pythonBinding.fileName).toBe('pid_controller.py');
    expect(restored.modelNodes[0].pythonBinding.portMapping.inputs[0]).toMatchObject({
      varName: 'error',
      displayName: '误差',
      connected: true
    });
    expect(restored.modelEdges[0].targetPort).toMatchObject({
      varName: 'error',
      displayName: '误差',
      type: 'float'
    });
    expect(restored.nodeSeq).toBe(2);
    expect(restored.edgeSeq).toBe(1);
  });

  it('fills missing fields with safe defaults for older snapshots', () => {
    const restored = restoreWorkbenchSnapshot({
      modelNodes: [
        {
          id: 'node-7',
          type: 'simulation_block',
          props: { name: 'Legacy Flow' }
        }
      ],
      modelEdges: []
    });

    expect(restored.modelNodes[0].pythonBinding).toMatchObject({
      bound: false,
      fileName: null
    });
    expect(restored.nodeSeq).toBe(7);
    expect(restored.edgeSeq).toBe(0);
    expect(restored.activeLineType).toBe('normal');
  });

  it('preserves workspaceSource and layered canvas viewport data through snapshot round-trip', () => {
    const snapshot = createWorkbenchSnapshot({
      workspaceSource: 'blank',
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          name: '顶层',
          parentSubsystemNodeId: null,
          viewport: { scale: 1.15, offsetX: 24, offsetY: 12 },
          nodes: [],
          edges: []
        },
        'canvas-child': {
          id: 'canvas-child',
          name: 'Child',
          parentSubsystemNodeId: 'node-subsystem',
          viewport: { scale: 1.7, offsetX: 88, offsetY: 46 },
          nodes: [],
          edges: []
        }
      },
      nodeSeq: 0,
      edgeSeq: 0,
      activeLineType: 'normal',
      faultedBlks: [],
      importedFaultModels: []
    });

    const restored = restoreWorkbenchSnapshot(snapshot);

    expect(restored.workspaceSource).toBe('blank');
    expect(restored.activeCanvasId).toBe('canvas-child');
    expect(restored.canvases['canvas-root'].viewport).toMatchObject({
      scale: 1.15,
      offsetX: 24,
      offsetY: 12
    });
    expect(restored.canvases['canvas-child'].viewport).toMatchObject({
      scale: 1.7,
      offsetX: 88,
      offsetY: 46
    });
  });
});
