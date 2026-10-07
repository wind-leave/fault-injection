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
});
