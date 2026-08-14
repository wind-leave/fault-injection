import { describe, expect, it } from 'vitest';
import {
  initializeSimulationInterfaceLock,
  lockSimulationInterfaces
} from '../src/services/simulationInterfaceLockService.js';

function simulationNode(id, name, inputName = 'input-a') {
  return {
    id,
    type: 'simulation_block',
    props: {
      name,
      inputs: [{ name: inputName, type: 'scalar' }],
      outputs: [{ name: 'output-a', type: 'vector' }],
      middleVars: [{ name: 'state-a', type: 'scalar' }]
    },
    pythonBinding: {
      bound: true,
      portMapping: {
        inputs: [{ displayName: inputName, type: 'float' }],
        outputs: [{ displayName: 'output-a', type: 'float' }],
        middleVars: [{ displayName: 'state-a', type: 'float' }]
      }
    }
  };
}

describe('simulation interface lock service', () => {
  it('restores an immutable interface after it is modified', () => {
    const node = initializeSimulationInterfaceLock(simulationNode('node-1', 'controller'));
    node.props.name = 'renamed';
    node.props.inputs = [{ name: 'other-input', type: 'matrix' }];
    node.pythonBinding.portMapping.outputs = [];

    const locked = lockSimulationInterfaces({ modelNodes: [node], modelEdges: [] });

    expect(locked.modelNodes[0].props).toMatchObject({
      name: 'controller',
      inputs: [{ name: 'input-a', type: 'scalar' }]
    });
    expect(locked.modelNodes[0].pythonBinding.portMapping.outputs).toEqual([
      { displayName: 'output-a', type: 'float' }
    ]);
  });

  it('keeps an existing interface when an imported component reuses its id', () => {
    const current = initializeSimulationInterfaceLock(simulationNode('node-1', 'original-controller'));
    const imported = simulationNode('node-1', 'imported-controller', 'imported-input');

    const locked = lockSimulationInterfaces(
      { modelNodes: [imported], modelEdges: [] },
      { existingSnapshot: { modelNodes: [current], modelEdges: [] } }
    );

    expect(locked.modelNodes[0].props.name).toBe('original-controller');
    expect(locked.modelNodes[0].props.inputs).toEqual([{ name: 'input-a', type: 'scalar' }]);
  });
});
