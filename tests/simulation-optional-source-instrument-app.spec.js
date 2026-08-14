import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

describe('optional signal source and measurement instrument simulation', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('initializes a source-free and instrument-free component simulation', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();
    const component = window.createNode('rf_four_channel_source', 360, 260);

    expect(component.type).toBe('simulation_block');
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.type === 'signal_source')).toBe(false);
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.type === 'instrument_scope')).toBe(false);

    window.simInit(true);
    await flushRuntime();

    expect(window.__GZ_SIM__.inited).toBe(true);
    wrapper.unmount();
  });
});
