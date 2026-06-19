import { describe, expect, it } from 'vitest';
import {
  createEmptyCanvasRecord,
  createSubsystemCanvas,
  ensureWorkbenchCanvasState,
  getActiveCanvasRecord,
  getCanvasRecord,
  getSubsystemCanvasId,
  openCanvasRecord,
  setActiveCanvasRecord
} from '../src/services/canvasStateService.js';

describe('canvas state service', () => {
  it('initializes missing layered canvas state with a root canvas', () => {
    const state = {};

    ensureWorkbenchCanvasState(state);

    expect(state.rootCanvasId).toBe('canvas-root');
    expect(state.activeCanvasId).toBe('canvas-root');
    expect(state.canvasTrail).toEqual(['canvas-root']);
    expect(state.canvases['canvas-root']).toEqual(createEmptyCanvasRecord('canvas-root', '顶层', null));
    expect(getCanvasRecord(state, 'canvas-root')).toBe(state.canvases['canvas-root']);
    expect(getActiveCanvasRecord(state)).toBe(state.canvases['canvas-root']);
  });

  it('normalizes invalid active canvas and preserves a root-first trail', () => {
    const state = {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'missing-canvas',
      canvasTrail: ['canvas-child'],
      canvases: {
        'canvas-root': createEmptyCanvasRecord('canvas-root', '顶层', null)
      }
    };

    ensureWorkbenchCanvasState(state);

    expect(state.activeCanvasId).toBe('canvas-root');
    expect(state.canvasTrail).toEqual(['canvas-root']);
  });

  it('switches active canvas while saving and restoring viewport state', () => {
    const state = {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-root',
      canvasTrail: ['canvas-root'],
      canvasScale: 1.4,
      canvasOffsetX: -120,
      canvasOffsetY: 36,
      canvases: {
        'canvas-root': createEmptyCanvasRecord('canvas-root', '顶层', null),
        'canvas-child': {
          ...createEmptyCanvasRecord('canvas-child', '子系统', 'node-subsystem'),
          viewport: { scale: 0.75, offsetX: 42, offsetY: -18 }
        }
      }
    };

    expect(setActiveCanvasRecord(state, 'canvas-child', ['canvas-root', 'canvas-child'])).toBe(true);

    expect(state.canvases['canvas-root'].viewport).toEqual({ scale: 1.4, offsetX: -120, offsetY: 36 });
    expect(state.activeCanvasId).toBe('canvas-child');
    expect(state.canvasTrail).toEqual(['canvas-root', 'canvas-child']);
    expect(state.canvasScale).toBe(0.75);
    expect(state.canvasOffsetX).toBe(42);
    expect(state.canvasOffsetY).toBe(-18);
    expect(setActiveCanvasRecord(state, 'missing')).toBe(false);
    expect(state.activeCanvasId).toBe('canvas-child');
  });

  it('creates subsystem canvases and records the target canvas id on the node', () => {
    const state = {};
    const node = {
      id: 'node-7',
      type: 'subsystem_block',
      props: { name: '姿态控制子系统' }
    };

    const canvas = createSubsystemCanvas(state, node);

    expect(getSubsystemCanvasId('node-7')).toBe('canvas-node-7');
    expect(node.targetCanvasId).toBe('canvas-node-7');
    expect(canvas).toMatchObject({
      id: 'canvas-node-7',
      name: '姿态控制子系统',
      parentSubsystemNodeId: 'node-7',
      nodes: [],
      edges: []
    });
    expect(state.canvases['canvas-node-7']).toBe(canvas);
  });

  it('opens an existing canvas and clears transient selection state', () => {
    const state = {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-root',
      canvasTrail: ['canvas-root'],
      canvasScale: 1,
      canvasOffsetX: 0,
      canvasOffsetY: 0,
      selBlk: 'node-1',
      selEdge: 'edge-1',
      pendingConnection: { sourceNodeId: 'node-1' },
      canvases: {
        'canvas-root': createEmptyCanvasRecord('canvas-root', '顶层', null),
        'canvas-child': createEmptyCanvasRecord('canvas-child', '子系统', 'node-subsystem')
      }
    };

    expect(openCanvasRecord(state, 'canvas-child', ['canvas-root', 'canvas-child'])).toBe(true);

    expect(state.activeCanvasId).toBe('canvas-child');
    expect(state.selBlk).toBeNull();
    expect(state.selEdge).toBeNull();
    expect(state.pendingConnection).toBeNull();
  });
});
