import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';
import { COMPONENT_REGISTRY, getPaletteGroups } from '../src/services/componentRegistry.js';
import { getComponentPropertySchema } from '../src/services/propertyPanelSchema.js';

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  __resetLegacyRuntimeForTests();
});

describe('XHFSQ signal generator', () => {
  it('appears under measurement instruments with a fixed complex-envelope output port', () => {
    const generator = COMPONENT_REGISTRY.XHFSQ;
    expect(getPaletteGroups().find((group) => group.id === 'instruments').components)
      .toContainEqual(expect.objectContaining({ type: 'XHFSQ', label: '信号发生器' }));
    expect(generator).toMatchObject({
      nodeType: 'signal_source',
      templateId: 'XHFSQ',
      defaults: {
        signalDomain: 'rf',
        outputFormat: '复数包络',
        outputPortId: 'XHFSQ_X1'
      }
    });
    const schema = getComponentPropertySchema('signal_source', 'XHFSQ');
    const fields = schema.groups.flatMap((group) => group.fields);
    expect(fields.some((field) => field.key === 'name')).toBe(true);
    expect(fields.filter((field) => ['signalName', 'signalId', 'unit', 'description'].includes(field.key)))
      .toHaveLength(0);
    expect(getComponentPropertySchema('signal_source').groups.flatMap((group) => group.fields)
      .some((field) => field.key === 'signalName')).toBe(true);
    expect(fields.find((field) => field.key === 'outputFormat').type).toBe('readonly');
    expect(fields.find((field) => field.key === 'outputPortId').type).toBe('readonly');
    expect(fields.some((field) => ['rfComplexEnvelopeMode', 'rfVectorLength'].includes(field.key)))
      .toBe(false);
  });

  it('infers scalar and vector output shapes from the connected input port', () => {
    const defaults = COMPONENT_REGISTRY.XHFSQ.defaults;
    for (const length of [0, 1, 2, 3, 4, 32, 65]) {
      const pkg = buildBackendExecutablePackage({
        modelNodes: [{
          id: 'generator',
          type: 'signal_source',
          templateId: 'XHFSQ',
          props: { ...defaults, rfComplexEnvelopeMode: 'vector', rfVectorLength: 99 }
        }, {
          id: 'receiver', type: 'simulation_block',
          props: { requiresPower: false },
          inputs: [{ name: 'input', dataType: 'rf_complex_envelope',
            ...(length ? { collectionKind: 'vector', vectorLength: length } : {}) }]
        }],
        modelEdges: [{ id: 'edge', sourceNodeId: 'generator', sourcePortIndex: 0,
          targetNodeId: 'receiver', targetPortIndex: 0 }]
      });
      expect(pkg.nodes[0].outputs[0]).toMatchObject({
        id: 'XHFSQ_X1',
        dataType: 'rf_complex_envelope'
      });
      expect(pkg.nodes[0].outputs[0].vectorLength).toBe(length || undefined);
      expect(pkg.nodes[0].outputs[0].collectionKind).toBe(length ? 'vector' : undefined);
      expect(pkg.nodes[0].parameters.rfComplexEnvelopeVectorLength)
        .toBe(length || undefined);
    }
  });

  it('infers the internal two-element port through a subsystem boundary', () => {
    const port = { name: '复数包络输入', dataType: 'rf_complex_envelope',
      collectionKind: 'vector', vectorLength: 2 };
    const state = {
      rootCanvasId: 'root',
      canvases: {
        root: {
          id: 'root', nodes: [
            { id: 'generator', type: 'signal_source', templateId: 'XHFSQ',
              props: { ...COMPONENT_REGISTRY.XHFSQ.defaults, rfVectorLength: 99 } },
            { id: 'subsystem', type: 'subsystem_block', targetCanvasId: 'child',
              props: { interface: { inputs: [{ id: 'input-1', ...port, order: 0 }], outputs: [] } } }
          ],
          edges: [{ id: 'generator-subsystem', sourceNodeId: 'generator', sourcePortIndex: 0,
            targetNodeId: 'subsystem', targetPortIndex: 0 }]
        },
        child: {
          id: 'child', parentSubsystemNodeId: 'subsystem', nodes: [
            { id: 'boundary-in', type: 'subsystem_in_port',
              props: { interfacePortId: 'input-1', order: 0, ...port } },
            { id: 'receiver', type: 'simulation_block', props: { requiresPower: false },
              inputs: [{ ...port }] }
          ],
          edges: [{ id: 'boundary-receiver', sourceNodeId: 'boundary-in', sourcePortIndex: 0,
            targetNodeId: 'receiver', targetPortIndex: 0, subsystemBoundaryMapping: true }]
        }
      }
    };

    for (const includeSubsystemNodes of [false, true]) {
      const pkg = buildBackendExecutablePackage({ ...state, includeSubsystemNodes });
      if (!includeSubsystemNodes) {
        expect(pkg.edges).toEqual(expect.arrayContaining([
          expect.objectContaining({ sourceNodeId: 'generator', targetNodeId: 'receiver' })
        ]));
      }
      expect(pkg.nodes.find((node) => node.id === 'generator').outputs[0]).toMatchObject({
        collectionKind: 'vector', vectorLength: 2
      });
      expect(pkg.nodes.find((node) => node.id === 'generator').parameters.rfComplexEnvelopeVectorLength)
        .toBe(2);
    }
  });

  it('allows one generator per canvas and another in a different canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();
    window.doCreateBlankWorkspace();

    window.createNode('XHFSQ', 320, 240);
    window.createNode('XHFSQ', 520, 240);
    const state = window.__GZ_STATE__;
    expect(state.modelNodes.filter((node) => node.templateId === 'XHFSQ')).toHaveLength(1);
    expect(document.querySelectorAll('#node-layer .b-inst')).toHaveLength(1);
    const generator = state.modelNodes.find((node) => node.templateId === 'XHFSQ');
    expect(window.getNodePorts(generator).outputs[0]).toMatchObject({
      portId: 'XHFSQ_X1',
      dataType: 'rf_complex_envelope'
    });
    window.renderPropertyPanel(generator);
    expect(document.querySelector('.props-panel-hero__meta')?.textContent).toContain('信号发生器');
    expect(document.querySelector('.props-target-card .props-title')?.textContent)
      .toBe('信号发生器');
    expect(document.getElementById('prop-name')).not.toBeNull();
    for (const key of ['signalName', 'signalId', 'unit', 'description']) {
      expect(document.getElementById(`prop-${key}`)).toBeNull();
    }
    document.querySelector('[data-props-tab="parameters"]').click();
    expect(document.getElementById('prop-rfComplexEnvelopeMode')).toBeNull();
    expect(document.getElementById('prop-rfVectorLength')).toBeNull();
    expect(window.getNodePorts(generator).outputs[0].vectorLength).toBeUndefined();
    expect(generator.props.outputFormat).toBe('复数包络');
    expect(generator.props.outputPortId).toBe('XHFSQ_X1');
    window.saveSelectedNode();
    expect(generator.props.outputPortId).toBe('XHFSQ_X1');

    state.canvases['canvas-second'] = window.__GZ_CANVAS_STATE__.createEmptyCanvasRecord(
      'canvas-second', '第二画布'
    );
    window.__GZ_CANVAS_STATE__.openCanvasRecord(state, 'canvas-second');
    window.createNode('XHFSQ', 320, 240);
    expect(state.canvases['canvas-second'].nodes.filter((node) => node.templateId === 'XHFSQ'))
      .toHaveLength(1);
    expect(state.canvases[state.rootCanvasId].nodes.filter((node) => node.templateId === 'XHFSQ'))
      .toHaveLength(1);
    expect(state.canvases['canvas-second'].nodes[0].id)
      .not.toBe(state.canvases[state.rootCanvasId].nodes[0].id);
    wrapper.unmount();
  });

  it('saves XHFSQ as the public device ID and connection source', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();
    window.doCreateBlankWorkspace();

    const generator = window.createNode('XHFSQ', 180, 220);
    const filter = window.createNode('rf_complex_envelope_gain', 480, 220);
    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-generator-filter',
      lineType: 'normal',
      sourceNodeId: generator.id,
      sourcePortIndex: 0,
      targetNodeId: filter.id,
      targetPortIndex: 0
    });

    const result = await window.buildSimulationResultSnapshot();
    expect(result.publicData.renderData.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'XHFSQ', type: 'signal_source' })
    ]));
    expect(result.publicData.renderData.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'edge-generator-filter',
        sourceDeviceId: 'XHFSQ',
        sourcePort: 'XHFSQ_X1',
        targetDeviceId: 'rf_complex_envelope_gain'
      })
    ]));
    expect(result.privateData.executableModel.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generator.id, componentId: 'XHFSQ', type: 'signal_source' })
    ]));
    wrapper.unmount();
  });
});
