import { describe, expect, it } from 'vitest';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from '../src/services/workbenchSnapshotService.js';

describe('subsystem hierarchy snapshot compatibility', () => {
  it('restores a flat graph into canvas-root with compatibility fields', () => {
    const restored = restoreWorkbenchSnapshot({
      version: 1,
      modelNodes: [
        {
          id: 'node-1',
          type: 'simulation_block',
          props: { name: 'Signal 1' }
        }
      ],
      modelEdges: [
        {
          id: 'edge-1',
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2'
        }
      ]
    });

    expect(restored.rootCanvasId).toBe('canvas-root');
    expect(restored.activeCanvasId).toBe('canvas-root');
    expect(restored.canvasTrail).toEqual(['canvas-root']);
    expect(restored.canvases['canvas-root'].nodes).toHaveLength(1);
    expect(restored.canvases['canvas-root'].edges).toHaveLength(1);
    expect(restored.modelNodes).toEqual(restored.canvases['canvas-root'].nodes);
    expect(restored.modelEdges).toEqual(restored.canvases['canvas-root'].edges);
    expect(restored.canvases['canvas-root'].nodes[0].pythonBinding).toMatchObject({
      bound: false,
      fileName: null
    });
  });

  it('preserves hierarchical canvases in createWorkbenchSnapshot while exposing the active flat view', () => {
    const snapshot = createWorkbenchSnapshot({
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          name: 'Top',
          nodes: [],
          edges: [],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        },
        'canvas-child': {
          id: 'canvas-child',
          name: 'Child',
          parentSubsystemNodeId: 'node-subsystem',
          nodes: [
            {
              id: 'node-1',
              type: 'subsystem_in_port',
              props: { interfacePortId: 'in-1' }
            },
            {
              id: 'node-2',
              type: 'simulation_block',
              pythonBinding: {
                bound: true,
                executionConfig: { timeoutMs: 1234 }
              }
            }
          ],
          edges: [],
          viewport: { scale: 1, offsetX: 8, offsetY: 12 }
        }
      }
    });

    expect(snapshot.canvases['canvas-child'].nodes[0].type).toBe('subsystem_in_port');
    expect(snapshot.canvasTrail).toEqual(['canvas-root', 'canvas-child']);
    expect(snapshot.modelNodes).toEqual(snapshot.canvases['canvas-child'].nodes);
    expect(snapshot.modelEdges).toEqual(snapshot.canvases['canvas-child'].edges);
    expect(snapshot.canvases['canvas-child'].nodes[1].pythonBinding.executionConfig).toMatchObject({
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 1234
    });
  });

  it('falls back to empty layered defaults when canvases are missing', () => {
    const restored = restoreWorkbenchSnapshot({});

    expect(restored.rootCanvasId).toBe('canvas-root');
    expect(restored.activeCanvasId).toBe('canvas-root');
    expect(restored.canvasTrail).toEqual(['canvas-root']);
    expect(restored.canvases['canvas-root']).toMatchObject({
      id: 'canvas-root',
      parentSubsystemNodeId: null
    });
    expect(restored.canvases['canvas-root'].nodes).toEqual([]);
    expect(restored.canvases['canvas-root'].edges).toEqual([]);
    expect(restored.modelNodes).toEqual([]);
    expect(restored.modelEdges).toEqual([]);
  });

  it('infers nodeSeq and edgeSeq across all canvases instead of only the active canvas', () => {
    const restored = restoreWorkbenchSnapshot({
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          nodes: [{ id: 'node-100', type: 'signal_source' }],
          edges: [{ id: 'edge-200', sourceNodeId: 'node-100', targetNodeId: 'node-2' }],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        },
        'canvas-child': {
          id: 'canvas-child',
          nodes: [{ id: 'node-2', type: 'signal_source' }],
          edges: [{ id: 'edge-3', sourceNodeId: 'node-2', targetNodeId: 'node-4' }],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        }
      }
    });

    const created = createWorkbenchSnapshot({
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          nodes: [{ id: 'node-100', type: 'signal_source' }],
          edges: [{ id: 'edge-200', sourceNodeId: 'node-100', targetNodeId: 'node-2' }],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        },
        'canvas-child': {
          id: 'canvas-child',
          nodes: [{ id: 'node-2', type: 'signal_source' }],
          edges: [{ id: 'edge-3', sourceNodeId: 'node-2', targetNodeId: 'node-4' }],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        }
      }
    });

    expect(restored.nodeSeq).toBe(100);
    expect(restored.edgeSeq).toBe(200);
    expect(created.nodeSeq).toBe(100);
    expect(created.edgeSeq).toBe(200);
  });

  it('exposes compatibility modelNodes and modelEdges as detached copies in both create and restore', () => {
    const baseSnapshot = {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          nodes: [],
          edges: [],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        },
        'canvas-child': {
          id: 'canvas-child',
          nodes: [{ id: 'node-2', type: 'signal_source', props: { name: 'Child Node' } }],
          edges: [{ id: 'edge-3', sourceNodeId: 'node-2', targetNodeId: 'node-4' }],
          viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        }
      }
    };

    const created = createWorkbenchSnapshot(baseSnapshot);
    const restored = restoreWorkbenchSnapshot(baseSnapshot);

    created.modelNodes[0].props.name = 'mutated create';
    created.modelEdges[0].sourceNodeId = 'mutated-create';
    restored.modelNodes[0].props.name = 'mutated restore';
    restored.modelEdges[0].sourceNodeId = 'mutated-restore';

    expect(created.canvases['canvas-child'].nodes[0].props.name).toBe('Child Node');
    expect(created.canvases['canvas-child'].edges[0].sourceNodeId).toBe('node-2');
    expect(restored.canvases['canvas-child'].nodes[0].props.name).toBe('Child Node');
    expect(restored.canvases['canvas-child'].edges[0].sourceNodeId).toBe('node-2');
  });
});
