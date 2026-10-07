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
});
