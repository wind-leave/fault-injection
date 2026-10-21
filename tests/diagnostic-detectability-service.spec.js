import { describe, expect, it } from 'vitest';
import {
  affectedEdgeIds,
  detectabilityOverrides,
  effectiveDetects
} from '../src/services/diagnosticDetectabilityService.js';

const edges = [
  { id: 'upstream', sourceNodeId: 'input', targetNodeId: 'source' },
  { id: 'source-output', sourceNodeId: 'source', targetNodeId: 'middle' },
  { id: 'middle-output', sourceNodeId: 'middle', targetNodeId: 'observer' },
  { id: 'unrelated', sourceNodeId: 'other', targetNodeId: 'sink' }
];

describe('diagnostic detectability defaults', () => {
  it('follows the directed fault path without marking upstream or unrelated edges', () => {
    expect([...affectedEdgeIds({ id: 'node-fault', targetNodeId: 'source' }, edges)])
      .toEqual(['source-output', 'middle-output']);
    expect([...affectedEdgeIds({ id: 'edge-fault', targetEdgeId: 'source-output' }, edges)])
      .toEqual(['source-output', 'middle-output']);
    expect([...affectedEdgeIds({ id: 'local-fault', targetEdgeId: 'source-output', canPropagate: false }, edges)])
      .toEqual(['source-output']);
    expect([...affectedEdgeIds({ id: 'parameter-fault', targetNodeId: 'source', layer: 'physical', propagationMode: 'localParameter', canPropagate: false }, edges)])
      .toEqual(['source-output', 'middle-output']);
  });

  it('keeps manual yes/no changes while assigning defaults to faults added later', () => {
    const point = { edgeId: 'middle-output', detectabilityMode: 'auto' };
    const firstFault = { id: 'first', targetNodeId: 'source' };
    const unrelatedFault = { id: 'unrelated-fault', targetNodeId: 'other' };
    expect(effectiveDetects(point, [firstFault, unrelatedFault], edges)).toEqual(['first']);

    point.detectabilityOverrides = detectabilityOverrides(point, ['unrelated-fault'], [firstFault, unrelatedFault], edges);
    expect(point.detectabilityOverrides).toEqual({ first: false, 'unrelated-fault': true });
    const newFault = { id: 'later', targetNodeId: 'middle' };
    expect(effectiveDetects(point, [firstFault, unrelatedFault, newFault], edges))
      .toEqual(['unrelated-fault', 'later']);
  });

  it('carries detectability across a subsystem boundary in both directions', () => {
    const subsystemEdges = [
      { id: 'outside-input', sourceNodeId: 'source', targetNodeId: 'subsystem', targetPortIndex: 0 },
      { id: 'inside-input', sourceNodeId: 'boundary-in', targetNodeId: 'internal-a', subsystemBoundaryMapping: true, subsystemBoundaryRole: 'input', linkedExternalEdgeId: 'outside-input' },
      { id: 'inside-wire', sourceNodeId: 'internal-a', targetNodeId: 'internal-b' },
      { id: 'inside-output', sourceNodeId: 'internal-b', targetNodeId: 'boundary-out', subsystemBoundaryMapping: true, subsystemBoundaryRole: 'output', linkedExternalEdgeId: 'outside-output' },
      { id: 'outside-output', sourceNodeId: 'subsystem', targetNodeId: 'scope', sourcePortIndex: 0 },
      { id: 'unrelated', sourceNodeId: 'other', targetNodeId: 'other-scope' }
    ];
    expect([...affectedEdgeIds({ id: 'internal-fault', targetNodeId: 'internal-a' }, subsystemEdges)])
      .toEqual(expect.arrayContaining(['inside-wire', 'inside-output', 'outside-output']));
    expect(effectiveDetects({ edgeId: 'outside-output', detectabilityMode: 'auto' }, [
      { id: 'internal-fault', targetNodeId: 'internal-a' }
    ], subsystemEdges)).toEqual(['internal-fault']);
    expect(effectiveDetects({ edgeId: 'inside-wire', detectabilityMode: 'auto' }, [
      { id: 'outside-fault', targetEdgeId: 'outside-input' }
    ], subsystemEdges)).toEqual(['outside-fault']);
    expect(effectiveDetects({ edgeId: 'unrelated', detectabilityMode: 'auto' }, [
      { id: 'internal-fault', targetNodeId: 'internal-a' }
    ], subsystemEdges)).toEqual([]);
    expect([...affectedEdgeIds({ id: 'declared-fault', affectedEdges: ['inside-output'] }, subsystemEdges)])
      .toEqual(['inside-output', 'outside-output']);
  });
});
