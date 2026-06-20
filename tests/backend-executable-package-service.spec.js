import { describe, expect, it } from 'vitest';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';

describe('backendExecutablePackageService', () => {
  it('exports only backend executable canvas state', () => {
    const state = {
      packageId: 'pkg-1',
      simulationConfig: { duration: 1, stepSize: 0.1 },
      selectedNodeId: 'sim-1',
      viewport: { scale: 1.5 },
      modelNodes: [
        {
          id: 'source-1',
          type: 'signal_source',
          x: 100,
          y: 200,
          props: { value: 1 },
          outputs: [{ name: 'out' }]
        },
        {
          id: 'sim-1',
          type: 'simulation_block',
          props: { kp: 4.5 },
          pythonBinding: { moduleId: 'passthrough', entryFunction: 'process', rawSource: 'def process(): pass' },
          inputs: [{ name: 'input' }],
          outputs: [{ name: 'output' }]
        },
        {
          id: 'scope-1',
          type: 'instrument_scope',
          props: {},
          inputs: [{ name: 'CH1' }]
        }
      ],
      modelEdges: [
        { id: 'edge-1', sourceNodeId: 'source-1', sourcePortIndex: 0, targetNodeId: 'sim-1', targetPortIndex: 0 },
        { id: 'edge-2', sourceNodeId: 'sim-1', sourcePortIndex: 0, targetNodeId: 'scope-1', targetPortIndex: 0 }
      ],
      faultInstances: [],
      measurementPoints: [{ id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' }]
    };

    const pkg = buildBackendExecutablePackage(state);

    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.nodes[0]).toEqual({
      id: 'source-1',
      type: 'signal_source',
      parameters: { value: 1 },
      inputs: [],
      outputs: [{ name: 'out' }]
    });
    expect(pkg.nodes[1].pythonBinding).toEqual({ moduleId: 'passthrough', entryFunction: 'process' });
    expect(JSON.stringify(pkg)).not.toContain('rawSource');
    expect(JSON.stringify(pkg)).not.toContain('selectedNodeId');
    expect(JSON.stringify(pkg)).not.toContain('viewport');
    expect(JSON.stringify(pkg)).not.toContain('"x"');
  });

  it('uses default simulation config when state omits it', () => {
    const pkg = buildBackendExecutablePackage({ modelNodes: [], modelEdges: [] });

    expect(pkg.simulationConfig).toEqual({ duration: 10, stepSize: 0.1 });
  });

  it('drops edges and measurement points that reference unsupported nodes', () => {
    const pkg = buildBackendExecutablePackage({
      modelNodes: [
        { id: 'source-1', type: 'signal_source', props: { value: 1 } },
        {
          id: 'sim-1',
          type: 'simulation_block',
          pythonBinding: { moduleId: 'passthrough' },
          props: {}
        },
        { id: 'logger-1', type: 'instrument_logger', props: {} },
        { id: 'scope-1', type: 'instrument_scope', props: {} }
      ],
      modelEdges: [
        { id: 'edge-kept', sourceNodeId: 'source-1', targetNodeId: 'sim-1' },
        { id: 'edge-dropped', sourceNodeId: 'sim-1', targetNodeId: 'logger-1' }
      ],
      measurementPoints: [
        { id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' },
        { id: 'logger-1.value', scopeNodeId: 'logger-1', channel: 'value' }
      ]
    });

    expect(pkg.nodes.map((node) => node.id)).toEqual(['source-1', 'sim-1', 'scope-1']);
    expect(pkg.edges.map((edge) => edge.id)).toEqual(['edge-kept']);
    expect(pkg.measurementPoints.map((point) => point.id)).toEqual(['scope-1.ch1']);
  });
});
