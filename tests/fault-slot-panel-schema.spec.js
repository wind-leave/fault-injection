import { describe, expect, it } from 'vitest';
import {
  filterFaultSlotDeclarationByVariableRoles,
  readFaultSlotDeclarationFromPanel,
  renderFaultSlotEditorFromSchema
} from '../src/services/faultSlotPanelSchema.js';

describe('fault slot panel schema service', () => {
  const layers = ['physical', 'electrical', 'protocol'];
  const layerLabels = {
    physical: 'Physical',
    electrical: 'Electrical',
    protocol: 'Protocol'
  };
  const roleLabels = {
    parameter: 'Parameter',
    input: 'Input'
  };

  it('renders fault slot checkboxes for variables and selected layers', () => {
    const html = renderFaultSlotEditorFromSchema({
      variables: [
        { key: 'gain', name: 'Gain <K>', role: 'parameter' },
        { key: 'input_1', name: 'Input 1', role: 'input' }
      ],
      declaration: {
        physical: ['gain'],
        electrical: [],
        protocol: ['input_1']
      },
      layers,
      layerLabels,
      roleLabels
    });

    expect(html).toContain('data-fault-slot-editor');
    expect(html).toContain('data-fault-slot-variable="gain"');
    expect(html).toContain('data-fault-slot-layer="physical" data-fault-slot-var="gain" checked');
    expect(html).toContain('data-fault-slot-layer="protocol" data-fault-slot-var="input_1" checked');
    expect(html).toContain('Gain &lt;K&gt;');
    expect(html).toContain('Parameter');
    expect(html).toContain('2 / 2');
  });

  it('filters visible fault layers by variable role and counts configured variables', () => {
    const html = renderFaultSlotEditorFromSchema({
      variables: [
        { key: 'gain', name: 'Gain', role: 'parameter' },
        { key: 'command', name: 'Command input', role: 'input' },
        { key: 'torque', name: 'Torque output', role: 'output' },
        { key: 'integral', name: 'Integrator', role: 'middle' }
      ],
      declaration: {
        physical: ['gain', 'command', 'integral'],
        electrical: ['gain', 'command', 'torque'],
        protocol: ['torque', 'integral']
      },
      layers,
      layerLabels,
      roleLabels: {
        ...roleLabels,
        output: 'Output',
        middle: 'Middle'
      }
    });

    expect(html).toContain('data-fault-slot-layer="physical" data-fault-slot-var="gain" checked');
    expect(html).not.toContain('data-fault-slot-layer="electrical" data-fault-slot-var="gain"');
    expect(html).not.toContain('data-fault-slot-layer="protocol" data-fault-slot-var="gain"');
    expect(html).not.toContain('data-fault-slot-layer="physical" data-fault-slot-var="command"');
    expect(html).toContain('data-fault-slot-layer="electrical" data-fault-slot-var="command" checked');
    expect(html).toContain('data-fault-slot-layer="protocol" data-fault-slot-var="command"');
    expect(html).not.toContain('data-fault-slot-layer="physical" data-fault-slot-var="torque"');
    expect(html).toContain('data-fault-slot-layer="electrical" data-fault-slot-var="torque" checked');
    expect(html).toContain('data-fault-slot-layer="protocol" data-fault-slot-var="torque" checked');
    expect(html).toContain('data-fault-slot-layer="physical" data-fault-slot-var="integral" checked');
    expect(html).toContain('4 / 4');
  });

  it('renders an empty state when no fault variables are available', () => {
    const html = renderFaultSlotEditorFromSchema({
      variables: [],
      declaration: {},
      layers,
      layerLabels,
      roleLabels
    });

    expect(html).toContain('data-fault-slot-editor');
    expect(html).toContain('No fault slot variables available');
    expect(html).toContain('0 / 0');
  });

  it('reads checked fault slot declarations from the panel', () => {
    document.body.innerHTML = `
      <div data-fault-slot-editor>
        <input type="checkbox" data-fault-slot-layer="physical" data-fault-slot-var="gain" checked>
        <input type="checkbox" data-fault-slot-layer="physical" data-fault-slot-var="gain" checked>
        <input type="checkbox" data-fault-slot-layer="electrical" data-fault-slot-var="gain">
        <input type="checkbox" data-fault-slot-layer="protocol" data-fault-slot-var="input_1" checked>
        <input type="checkbox" data-fault-slot-layer="unknown" data-fault-slot-var="ignored" checked>
      </div>
    `;

    expect(readFaultSlotDeclarationFromPanel(document.body, layers)).toEqual({
      physical: ['gain'],
      electrical: [],
      protocol: ['input_1']
    });
  });

  it('filters saved declarations by parameter input and output role rules while leaving middle variables unchanged', () => {
    expect(filterFaultSlotDeclarationByVariableRoles({
      physical: ['gain', 'command', 'torque', 'integral'],
      electrical: ['gain', 'command', 'torque', 'integral'],
      protocol: ['gain', 'command', 'torque', 'integral']
    }, [
      { key: 'gain', role: 'parameter' },
      { key: 'command', role: 'input' },
      { key: 'torque', role: 'output' },
      { key: 'integral', role: 'middle' }
    ], layers)).toEqual({
      physical: ['gain', 'integral'],
      electrical: ['command', 'torque', 'integral'],
      protocol: ['command', 'torque', 'integral']
    });
  });
});
