import { describe, expect, it } from 'vitest';
import {
  readSubsystemBlockValuesFromPanel,
  renderSubsystemBlockFieldsFromSchema,
  renderSubsystemBoundaryPortFieldsFromSchema
} from '../src/services/subsystemPropertyPanelSchema.js';

const portFormats = ['标量', '向量', '矩阵'];
const interfaceLimits = {
  inputs: [0, 6],
  outputs: [0, 6]
};

function createSubsystemNode() {
  return {
    id: 'node-subsystem',
    type: 'subsystem_block',
    targetCanvasId: 'canvas-child',
    props: {
      name: '子系统 <A>',
      subsystemId: 'flight-control-main',
      description: 'desc <x>',
      interface: {
        inputs: [
          { id: 'input-1', name: '姿态误差', type: '标量', order: 0 }
        ],
        outputs: [
          { id: 'output-1', name: '控制输出', type: '向量', order: 0 }
        ]
      }
    }
  };
}

describe('subsystem property panel schema service', () => {
  it('shows automatic port ids and vector element names as read-only internal values', () => {
    const node = createSubsystemNode();
    node.props.interfaceMode = 'auto';
    node.props.interface.outputs[0].vectorLength = 2;
    node.props.interface.outputs[0].vectorElementNames = ['横滚', '俯仰'];
    document.body.innerHTML = renderSubsystemBlockFieldsFromSchema(node);

    const output = document.querySelector('.subsystem-intf-row[data-subsystem-role="output"]');
    expect(document.getElementById('prop-name').readOnly).toBe(false);
    expect(document.getElementById('prop-subsystem-id').readOnly).toBe(false);
    expect(document.getElementById('prop-description').readOnly).toBe(true);
    expect(output.querySelector('[data-subsystem-field="id"]').readOnly).toBe(true);
    expect([...output.querySelectorAll('[data-subsystem-element-index]')].map((input) => [input.value, input.readOnly]))
      .toEqual([['横滚', true], ['俯仰', true]]);
  });

  it('renders subsystem block interface fields with stable port ids', () => {
    const html = renderSubsystemBlockFieldsFromSchema(createSubsystemNode(), {
      portFormats,
      interfaceLimits,
      canvasId: 'canvas-child'
    });

    expect(html).toContain('id="prop-name"');
    expect(html).toContain('id="prop-subsystem-id"');
    expect(html).toContain('id="prop-description"');
    expect(html).toContain('id="subsystem-input-count"');
    expect(html).toContain('id="subsystem-output-count"');
    expect(html).toContain('data-subsystem-role="input"');
    expect(html).toContain('data-subsystem-role="output"');
    expect(html).toContain('data-port-id="input-1"');
    expect(html).toContain('data-port-id="output-1"');
    expect(html).toContain('子系统 &lt;A&gt;');
    expect(html).toContain('flight-control-main');
    expect(html).toContain('desc &lt;x&gt;');
    expect(html).toContain('canvas-child');
  });

  it('reads subsystem values and expands interfaces without changing existing ids', () => {
    const node = createSubsystemNode();
    document.body.innerHTML = renderSubsystemBlockFieldsFromSchema(node, {
      portFormats,
      interfaceLimits
    });

    document.getElementById('prop-name').value = ' 飞控主控 ';
    document.getElementById('prop-subsystem-id').value = ' flight-control-01 ';
    document.getElementById('prop-description').value = ' 主控制律 ';
    document.getElementById('subsystem-input-count').value = '2';
    document.getElementById('subsystem-output-count').value = '1';
    document.querySelector('.subsystem-intf-row[data-subsystem-role="input"] [data-subsystem-field="name"]').value = '';
    document.querySelector('.subsystem-intf-row[data-subsystem-role="output"] [data-subsystem-field="type"]').value = '矩阵';

    expect(readSubsystemBlockValuesFromPanel(node, document, {
      interfaceLimits
    })).toEqual({
      values: {
        name: '飞控主控',
        subsystemId: 'flight-control-01',
        description: '主控制律',
        interface: {
          inputs: [
            { id: 'input-1', name: '输入 1', type: '标量', order: 0 },
            { id: '输入-2', name: '输入 2', type: '标量', order: 1 }
          ],
          outputs: [
            { id: 'output-1', name: '控制输出', type: '矩阵', order: 0 }
          ]
        }
      },
      shouldSyncBoundaryNodes: true,
      shouldPruneInvalidEdges: true
    });
  });

  it('renders boundary port fields as read-only mapping details', () => {
    const html = renderSubsystemBoundaryPortFieldsFromSchema({
      type: 'subsystem_in_port',
      props: {
        name: '姿态误差',
        interfacePortId: 'input-1',
        portType: '标量'
      }
    });

    expect(html).toContain('姿态误差');
    expect(html).toContain('input-1');
    expect(html).toContain('标量');
    expect(html).toContain('边界端口');
  });
});
