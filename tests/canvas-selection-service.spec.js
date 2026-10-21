import { describe, expect, it } from 'vitest';
import {
  applyNodeSelection,
  chooseCanvasEdgeForClick,
  clearCanvasSelectionState,
  getEdge,
  rankCanvasEdgesByClientPoint,
  getNode,
  markTopologyDirty,
  normalizeSelectedNodeIds
} from '../src/services/canvasSelectionService.js';

describe('canvas selection service', () => {
  it('ranks nearby wires by their actual path instead of SVG stacking order', () => {
    const line = (id, y) => ({
      dataset: { edgeId: id },
      getTotalLength: () => 300,
      getPointAtLength: (length) => ({ x: length, y }),
      getBoundingClientRect: () => ({ left: 0, right: 300, top: y, bottom: y, width: 300, height: 0 })
    });

    const ranked = rankCanvasEdgesByClientPoint([
      line('topmost-but-farther', 108),
      line('nearest', 101)
    ], { clientX: 157, clientY: 102, stagePoint: { x: 157, y: 102 }, scale: 1, threshold: 14 });

    expect(ranked.map((item) => item.id)).toEqual(['nearest', 'topmost-but-farther']);
    expect(ranked[0].distance).toBeCloseTo(1);
  });

  it('keeps the hit tolerance in screen pixels when the canvas is zoomed', () => {
    const path = {
      dataset: { edgeId: 'edge-1' },
      getTotalLength: () => 200,
      getPointAtLength: (length) => ({ x: length, y: 0 })
    };

    expect(rankCanvasEdgesByClientPoint([path], {
      clientX: 50, clientY: 6,
      stagePoint: { x: 100, y: 12 }, scale: 0.5, threshold: 8
    })).toEqual([{ id: 'edge-1', distance: 6 }]);
  });

  it('cycles through nearly overlapping wires on repeated clicks', () => {
    const nearby = [{ id: 'edge-a', distance: 1 }, { id: 'edge-b', distance: 3 }];
    const first = { x: 100, y: 80, time: 1000 };
    expect(chooseCanvasEdgeForClick(nearby, {}, first)).toBe('edge-a');
    expect(chooseCanvasEdgeForClick(nearby, { ...first, id: 'edge-a' }, {
      x: 102, y: 81, time: 1300
    })).toBe('edge-b');
    expect(chooseCanvasEdgeForClick(nearby, { ...first, id: 'edge-b' }, {
      x: 102, y: 81, time: 3000
    })).toBe('edge-a');
  });
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
      stepIndex: 7,
      backendSessionId: 'session-before-edit',
      backendRunId: 'run-before-edit',
      actual: {
        scopeSamples: { 'scope-1': { ch1: [{ t: 0, actual: 1 }] } },
        instrumentSamples: { 'spectrum-1': [{ t: 0, actual: 10 }] }
      },
      reference: {
        scopeSamples: { 'scope-1': { ch1: [{ t: 0, actual: 1 }] } },
        instrumentSamples: { 'spectrum-1': [{ t: 0, actual: 10 }] }
      },
      componentOutputs: { time: [0], steps: [{ time: 0 }] },
      spectrumSampling: { 'spectrum-1': { lastTime: 0 } },
      spectrumAnalyzerTraces: { 'spectrum-1': { levels: [-20] } }
    };

    markTopologyDirty(state, simulation, 'fault');

    expect(state.systemSaved).toBe(true);
    expect(state.simDone).toBe(false);
    expect(state.step).toBe(2);
    expect(simulation).toMatchObject({
      backendSessionId: '',
      backendRunId: '',
      staleBackendSessionId: 'session-before-edit',
      inited: false,
      running: false,
      paused: false,
      hasSamples: false,
      time: 0,
      stepIndex: 0
    });
    expect(simulation.actual).toEqual({ scopeSamples: {}, instrumentSamples: {} });
    expect(simulation.reference).toEqual({ scopeSamples: {}, instrumentSamples: {} });
    expect(simulation.componentOutputs).toEqual({ time: [], steps: [] });
    expect(simulation.spectrumSampling).toEqual({});
    expect(simulation.spectrumAnalyzerTraces).toEqual({});

    markTopologyDirty(state, simulation, 'system');
    expect(state.systemSaved).toBe(false);
    expect(state.step).toBe(1);
  });
});
