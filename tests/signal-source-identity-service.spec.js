import { describe, expect, it } from 'vitest';
import { updateRfSignalSourceIdentity } from '../src/services/signalSourceIdentityService.js';

function makeState() {
  const source = { id: 'node-1', type: 'signal_source', props: { signalDomain: 'rf' } };
  const meter = { id: 'node-2', props: { positiveLead: { nodeId: 'node-1' } } };
  const edge = {
    id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2',
    sourcePortIndex: 0, sourcePortMeta: { portId: 'signal' }
  };
  return {
    source, edge,
    state: {
      canvases: { root: { nodes: [source, meter], edges: [edge] } },
      selBlk: 'node-1', selectedNodeIds: ['node-1'],
      faultTags: [{ targetNodeId: 'node-1', componentId: 'node-1' }], nodeSeq: 2
    }
  };
}

describe('RF signal source identifiers', () => {
  it('renames the component and port while retaining existing references', () => {
    const { state, source, edge } = makeState();
    expect(updateRfSignalSourceIdentity(state, source, {
      componentId: 'node-48', outputPortId: 'rf.out'
    }).ok).toBe(true);
    expect(source.id).toBe('node-48');
    expect(source.props.outputPortId).toBe('rf.out');
    expect(edge.sourceNodeId).toBe('node-48');
    expect(edge.sourcePortMeta.portId).toBe('rf.out');
    expect(edge.sourcePort.portId).toBe('rf.out');
    expect(state.canvases.root.nodes[1].props.positiveLead.nodeId).toBe('node-48');
    expect(state.selBlk).toBe('node-48');
    expect(state.selectedNodeIds).toEqual(['node-48']);
    expect(state.faultTags[0].targetNodeId).toBe('node-48');
    expect(state.faultTags[0].componentId).toBe('node-48');
    expect(state.nodeSeq).toBe(48);
  });

  it('rejects duplicate and invalid IDs before changing the model', () => {
    const { state, source, edge } = makeState();
    expect(updateRfSignalSourceIdentity(state, source, {
      componentId: 'node-2', outputPortId: 'rf.out'
    }).ok).toBe(false);
    expect(updateRfSignalSourceIdentity(state, source, {
      componentId: 'bad id', outputPortId: 'rf.out'
    }).ok).toBe(false);
    expect(updateRfSignalSourceIdentity(state, source, {
      componentId: 'rf-source', outputPortId: ''
    }).ok).toBe(false);
    expect(source.id).toBe('node-1');
    expect(source.props.outputPortId).toBeUndefined();
    expect(edge.sourcePortMeta.portId).toBe('signal');
  });
});
