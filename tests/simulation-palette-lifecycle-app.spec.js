import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function createDataTransfer() {
  const data = new Map();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      data.set(type, value);
    },
    getData(type) {
      return data.get(type) || '';
    }
  };
}

function dispatchDrag(target, type, dataTransfer, { clientX = 0, clientY = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY }
  });
  target.dispatchEvent(event);
}

describe('simulation palette lifecycle', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('hides a dropped simulation entry and restores it when its canvas instance is deleted', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    window.doCreateBlankWorkspace();

    const paletteItem = document.querySelector('[data-component="airspeed_sensor"]');
    const viewport = document.getElementById('canvas-viewport');
    const dataTransfer = createDataTransfer();
    expect(paletteItem).toBeTruthy();
    expect(viewport).toBeTruthy();

    dispatchDrag(paletteItem, 'dragstart', dataTransfer);
    dispatchDrag(viewport, 'drop', dataTransfer, { clientX: 420, clientY: 260 });
    await flushRuntime();

    expect(document.querySelector('[data-component="airspeed_sensor"]')).toBeNull();
    const node = window.__GZ_STATE__.modelNodes.find((item) => item.templateId === 'airspeed_sensor');
    expect(node).toBeTruthy();

    window.selectNode(node.id);
    window.deleteCurrentSelection();
    await flushRuntime();

    expect(document.querySelector('[data-component="airspeed_sensor"]')).toBeTruthy();
    wrapper.unmount();
  });
});
