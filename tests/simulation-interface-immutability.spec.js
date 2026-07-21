import { describe, expect, it } from 'vitest';
import {
  readSimulationBlockValuesFromPanel,
  renderSimulationBlockFieldsFromSchema
} from '../src/services/simulationPropertyPanelSchema.js';

const node = {
  type: 'simulation_block',
  props: {
    name: 'controller',
    moduleType: 'integrator',
    inputs: [{ name: 'error', type: 'scalar' }],
    outputs: [{ name: 'command', type: 'vector' }],
    middleVars: [{ name: 'integral', type: 'scalar' }],
    ffunctionNote: 'old note'
  }
};

describe('simulation interface property panel', () => {
  it('renders unbound interface definitions as read-only and omits them on save', () => {
    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, {
      moduleTypes: ['integrator'],
      portFormats: ['scalar', 'vector']
    });

    expect(document.getElementById('prop-name').disabled).toBe(true);
    expect(document.getElementById('sim-input-count').disabled).toBe(true);
    expect(document.getElementById('sim-output-count').disabled).toBe(true);
    expect(document.getElementById('sim-middle-count').disabled).toBe(true);
    expect(document.querySelector('[data-sim-field="name"]').disabled).toBe(true);
    expect(document.querySelector('[data-sim-field="type"]').disabled).toBe(true);

    document.getElementById('prop-ffunctionNote').value = ' updated note ';
    expect(readSimulationBlockValuesFromPanel(node, document)).toEqual({
      values: { moduleType: 'integrator', ffunctionNote: 'updated note' },
      shouldPruneInvalidEdges: false
    });
  });

  it('renders Python-bound component and port names as read-only', () => {
    const binding = {
      bound: true,
      portMapping: {
        inputs: [{ displayName: 'error', type: 'float' }],
        outputs: [{ displayName: 'command', type: 'float' }],
        middleVars: [{ displayName: 'integral', type: 'float' }]
      }
    };
    document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, { binding });

    expect(document.getElementById('prop-name').disabled).toBe(true);
    expect(document.querySelectorAll('[data-python-port-display-name]')).toHaveLength(3);
    expect([...document.querySelectorAll('[data-python-port-display-name]')].every((element) => element.disabled)).toBe(true);
    expect(readSimulationBlockValuesFromPanel(node, document, { binding })).toEqual({
      values: {},
      shouldPruneInvalidEdges: false
    });
  });
});
