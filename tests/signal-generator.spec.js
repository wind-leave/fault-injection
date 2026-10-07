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
    expect(fields.find((field) => field.key === 'rfComplexEnvelopeMode').options)
      .toEqual(expect.arrayContaining([{ value: 'scalar', label: '单路' }, { value: 'vector', label: '向量' }]));
  });

  it('exports scalar and vector envelopes through XHFSQ_X1', () => {
    const defaults = COMPONENT_REGISTRY.XHFSQ.defaults;
    for (const mode of ['scalar', 'vector']) {
      const pkg = buildBackendExecutablePackage({
        modelNodes: [{
          id: `generator-${mode}`,
          type: 'signal_source',
          templateId: 'XHFSQ',
          props: { ...defaults, rfComplexEnvelopeMode: mode, rfVectorLength: 4 }
        }],
        modelEdges: []
      });
      expect(pkg.nodes[0].outputs[0]).toMatchObject({
        id: 'XHFSQ_X1',
        dataType: 'rf_complex_envelope'
      });
      expect(pkg.nodes[0].outputs[0].vectorLength).toBe(mode === 'vector' ? 4 : undefined);
      expect(pkg.nodes[0].outputs[0].collectionKind).toBe(mode === 'vector' ? 'vector' : undefined);
      expect(pkg.nodes[0].parameters.rfComplexEnvelopeVectorLength)
        .toBe(mode === 'vector' ? 4 : undefined);
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
    const modeField = document.getElementById('prop-rfComplexEnvelopeMode');
    expect(modeField).not.toBeNull();
    modeField.value = 'vector';
    modeField.dispatchEvent(new Event('change', { bubbles: true }));
    expect(generator.props.rfComplexEnvelopeMode).toBe('vector');
    expect(window.getNodePorts(generator).outputs[0].vectorLength).toBe(4);
    expect(generator.props.outputFormat).toBe('复数包络');
    expect(generator.props.outputPortId).toBe('XHFSQ_X1');
    window.saveSelectedNode();
    expect(generator.props.rfComplexEnvelopeMode).toBe('vector');
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
    const filter = window.createNode('DZDK_A', 480, 220);
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
        targetDeviceId: 'DZDK_A'
      })
    ]));
    expect(result.privateData.executableModel.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generator.id, componentId: 'XHFSQ', type: 'signal_source' })
    ]));
    wrapper.unmount();
  });
});
