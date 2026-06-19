import { describe, expect, it } from 'vitest';
import {
  applyNodeSelection,
  clearCanvasSelectionState,
  getEdge,
  getNode,
  markTopologyDirty,
  normalizeSelectedNodeIds
} from '../src/services/canvasSelectionService.js';

describe('canvas selection service', () => {
  function createState() {
    return {
      step: 3,
      systemSaved: true,
      simDone: true,
      selBlk: 'node-1',
      selEdge: 'edge-1',
      selFaultTag: 'fault-tag-1',
      selectedNodeIds: ['node-1', 'node-1', 'missing', 42],
      selectionAnchorId: 'missing',
      modelNodes: [
        { id: 'node-1', type: 'signal_source' },
        { id: 'node-2', type: 'simulation_block' }
      ],
      modelEdges: [
        { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }
      ]
    };
  }

  it('finds nodes and edges from the active flat canvas view', () => {
    const state = createState();

    expect(getNode(state, 'node-2')).toMatchObject({ type: 'simulation_block' });
    expect(getNode(state, 'missing')).toBeUndefined();
    expect(getEdge(state, 'edge-1')).toMatchObject({ sourceNodeId: 'node-1' });
    expect(getEdge(state, 'missing')).toBeUndefined();
  });

  it('clears single and multi-selection state without touching graph data', () => {
    const state = createState();

    clearCanvasSelectionState(state);

    expect(state.selBlk).toBeNull();
    expect(state.selEdge).toBeNull();
    expect(state.selFaultTag).toBeNull();
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.selectionAnchorId).toBe('');
    expect(state.modelNodes).toHaveLength(2);
    expect(state.modelEdges).toHaveLength(1);
  });

  it('normalizes multi-selected node ids against live nodes', () => {
    const state = createState();

    expect(normalizeSelectedNodeIds(state)).toEqual(['node-1']);
    expect(state.selectedNodeIds).toEqual(['node-1']);
    expect(state.selectionAnchorId).toBe('node-1');
    expect(state.selBlk).toBe('node-1');

    state.selectedNodeIds = ['missing'];
    expect(normalizeSelectedNodeIds(state)).toEqual([]);
    expect(state.selBlk).toBeNull();
    expect(state.selectionAnchorId).toBe('');
  });

  it('applies node selection and clears edge selection', () => {
    const state = createState();

    expect(applyNodeSelection(state, ['node-2', 'node-1', 'node-2'], 'node-2')).toEqual(['node-2', 'node-1']);
    expect(state.selectedNodeIds).toEqual(['node-2', 'node-1']);
    expect(state.selectionAnchorId).toBe('node-2');
    expect(state.selBlk).toBe('node-2');
    expect(state.selEdge).toBeNull();
  });

  it('marks topology dirty and resets simulation state by scope', () => {
    const state = createState();
    const simulation = {
      inited: true,
      running: true,
      paused: true,
      hasSamples: true,
      time: 12,
      stepIndex: 7
    };

    markTopologyDirty(state, simulation, 'fault');

    expect(state.systemSaved).toBe(true);
    expect(state.simDone).toBe(false);
    expect(state.step).toBe(2);
    expect(simulation).toMatchObject({
      inited: false,
      running: false,
      paused: false,
      hasSamples: false,
      time: 0,
      stepIndex: 0
    });

    markTopologyDirty(state, simulation, 'system');
    expect(state.systemSaved).toBe(false);
    expect(state.step).toBe(1);
  });
});
