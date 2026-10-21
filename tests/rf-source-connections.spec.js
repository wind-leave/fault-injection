import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  __resetLegacyRuntimeForTests();
});

function clickPort(node, direction) {
  window.handlePortClick({ stopPropagation() {} }, node.id, direction, 0);
}

describe('RF complex-envelope canvas connections', () => {
  it('connects the RF source and signal generator to matching scalar and vector ports', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();

    for (const sourceType of ['signal_source_rf', 'XHFSQ']) {
      for (const mode of ['scalar', 'vector']) {
        window.doCreateBlankWorkspace();
        const source = window.createNode(sourceType, 180, 220);
        const target = window.createNode(
          mode === 'vector' ? 'rf_complex_envelope_limiter' : 'rf_complex_envelope_gain',
          480, 220
        );
        source.props.outputFormat = '复数包络';
        source.props.rfComplexEnvelopeMode = mode;
        source.props.rfVectorLength = 4;

        clickPort(source, 'output');
        clickPort(target, 'input');
        expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);
        expect(window.__GZ_STATE__.modelEdges[0]).toMatchObject({
          sourcePortMeta: { type: 'rf_complex_envelope' },
          targetPortMeta: { type: 'rf_complex_envelope' }
        });
      }
    }

    wrapper.unmount();
  });

  it('rejects scalar-to-vector and unequal vector lengths', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();
    window.doCreateBlankWorkspace();

    const source = window.createNode('signal_source_rf', 180, 220);
    const target = window.createNode('rf_complex_envelope_limiter', 480, 220);
    source.props.outputFormat = '复数包络';

    clickPort(source, 'output');
    clickPort(target, 'input');
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(0);
    expect(document.getElementById('tm')?.textContent).toContain('复数包络形式不匹配');

    source.props.rfComplexEnvelopeMode = 'vector';
    source.props.rfVectorLength = 3;
    clickPort(source, 'output');
    clickPort(target, 'input');
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(0);
    expect(document.getElementById('tm')?.textContent).toContain('向量长度不匹配');

    source.props.rfVectorLength = 4;
    clickPort(source, 'output');
    clickPort(target, 'input');
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);

    wrapper.unmount();
  });

  it('derives the generator shape from a two-element input and updates after disconnecting', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();
    window.doCreateBlankWorkspace();

    const source = window.createNode('XHFSQ', 180, 220);
    const target = window.createNode('rf_complex_envelope_limiter', 480, 220);
    target.props.inputs[0].vectorLength = 2;
    target.pythonBinding.portMapping.inputs[0].vectorLength = 2;
    target.ports.inputs[0].vectorLength = 2;
    source.props.rfComplexEnvelopeMode = 'scalar';
    source.props.rfVectorLength = 99;

    clickPort(source, 'output');
    clickPort(target, 'input');
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);
    expect(window.__GZ_STATE__.modelEdges[0].sourcePortMeta).toMatchObject({
      collectionKind: 'vector', vectorLength: 2
    });
    expect(window.getNodePorts(source).outputs[0]).toMatchObject({
      collectionKind: 'vector', vectorLength: 2
    });

    const incompatibleTarget = window.createNode('rf_complex_envelope_limiter', 720, 220);
    clickPort(source, 'output');
    clickPort(incompatibleTarget, 'input');
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);

    window.__GZ_STATE__.modelEdges.pop();
    expect(window.getNodePorts(source).outputs[0].collectionKind).toBeUndefined();
    expect(window.getNodePorts(source).outputs[0].vectorLength).toBeUndefined();

    wrapper.unmount();
  });

  it('uses the port length for one, three, and sixty-five envelope outputs', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();

    for (const length of [1, 3, 65]) {
      window.doCreateBlankWorkspace();
      const source = window.createNode('XHFSQ', 180, 220);
      const target = window.createNode('rf_complex_envelope_limiter', 480, 220);
      target.props.inputs[0].vectorLength = length;
      target.pythonBinding.portMapping.inputs[0].vectorLength = length;
      target.ports.inputs[0].vectorLength = length;

      clickPort(source, 'output');
      clickPort(target, 'input');
      expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);
      expect(window.getNodePorts(source).outputs[0].vectorLength).toBe(length);
      expect(window.resolveNodeOutput(source.id, 0, 'actual', 0, 0.01, new Map(), new Set()))
        .toHaveLength(length);
    }

    wrapper.unmount();
  });

  it('uses a subsystem external input contract for the generator line', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await nextTick();
    await Promise.resolve();
    window.doCreateBlankWorkspace();

    const source = window.createNode('XHFSQ', 180, 220);
    const subsystem = {
      id: 'subsystem-vector-2', type: 'subsystem_block', x: 480, y: 220,
      w: 190, h: 110, props: { name: '子系统', interface: {
        inputs: [{ id: 'input-1', name: '复数包络输入', type: '复数包络',
          dataType: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 2 }],
        outputs: []
      } }
    };
    window.__GZ_STATE__.modelNodes.push(subsystem);
    clickPort(source, 'output');
    clickPort(subsystem, 'input');

    expect(window.__GZ_STATE__.modelEdges).toHaveLength(1);
    expect(window.__GZ_STATE__.modelEdges[0].targetPortMeta).toMatchObject({
      type: 'rf_complex_envelope', collectionKind: 'vector', vectorLength: 2
    });
    expect(window.getNodePorts(source).outputs[0]).toMatchObject({
      collectionKind: 'vector', vectorLength: 2
    });
    wrapper.unmount();
  });
});
