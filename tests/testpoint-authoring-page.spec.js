import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import TestPointAuthoringPage from '../src/components/TestPointAuthoringPage.vue';

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  delete window.__GZ_TEST_POINT_AUTHORING__;
  delete window.__GZ_DIAGNOSTIC_CONDITIONS__;
  delete window.__GZ_STATE__;
});

describe('TestPointAuthoringPage', () => {
  it('opens whenever the authoring event is dispatched, including before the legacy bridge is ready', async () => {
    wrapper = mount(TestPointAuthoringPage);

    window.dispatchEvent(new CustomEvent('gz:open-testpoint-authoring', {
      detail: { edgeId: 'edge-pending-runtime', pointId: '' }
    }));
    await nextTick();

    const page = document.querySelector('[data-testid="testpoint-authoring-page"]');
    expect(page).not.toBeNull();
    expect(page?.textContent).toContain('测点设置');
  });

  it('only creates a draft after the user explicitly chooses to add a point', async () => {
    window.__GZ_TEST_POINT_AUTHORING__ = {
      getContext: () => ({ edge: { id: 'edge-a' }, points: [], faultGroups: [], conditions: [] }),
      createDraft: () => ({ pointId: 'M-new', name: '新测点', pointType: 'virtual', detects: [] })
    };
    wrapper = mount(TestPointAuthoringPage);

    window.dispatchEvent(new CustomEvent('gz:open-testpoint-authoring', {
      detail: { edgeId: 'edge-a', pointId: '' }
    }));
    await nextTick();

    expect(document.querySelector('[data-testpoint-authoring-name]')).toBeNull();
    expect(document.querySelector('[data-testid="testpoint-authoring-page"]')?.textContent).toContain('当前连线尚未配置测点');

    document.querySelector('[data-testpoint-authoring-add]').click();
    await nextTick();

    expect(document.querySelector('[data-testpoint-authoring-name]')?.value).toBe('新测点');
    expect(document.querySelector('[data-testid="testpoint-authoring-page"]')).not.toBeNull();
  });

  it('opens the requested test point with runtime-backed data', async () => {
    window.__GZ_TEST_POINT_AUTHORING__ = {
      getContext: () => ({
        edge: { id: 'edge-a', label: '指令通道', sourceName: '指令源', targetName: '控制器' },
        // Existing model packages may predate condition rules, so the page
        // must remain renderable when those optional fields are absent.
        points: [{ pointId: 'M1', shortName: 'M1', name: '控制器输入', pointType: 'virtual' }],
        faultGroups: [],
        conditions: []
      })
    };
    wrapper = mount(TestPointAuthoringPage);

    window.dispatchEvent(new CustomEvent('gz:open-testpoint-authoring', {
      detail: { edgeId: 'edge-a', pointId: 'M1' }
    }));
    await nextTick();

    expect(document.querySelector('[data-testpoint-authoring-name]')?.value).toBe('控制器输入');
    expect(document.querySelector('[data-testpoint-authoring-select]')?.value).toBe('M1');
  });

  it('batch-edits selected conditions inside the fault box without rendering separate scenario cards', async () => {
    let savedPoint;
    window.__GZ_DIAGNOSTIC_CONDITIONS__ = {
      getScenarios: (keys) => keys.includes('mode') ? [
        { label: '模式：输入一', when: { mode: 'input-1' } },
        { label: '模式：输入二', when: { mode: 'input-2' } }
      ] : []
    };
    window.__GZ_TEST_POINT_AUTHORING__ = {
      getContext: () => ({
        edge: { id: 'edge-a' },
        points: [{ pointId: 'M1', name: '测点一', pointType: 'virtual', detects: ['fault-a'], conditionKeys: ['mode'] }],
        faultGroups: [{ componentId: 'component-a', componentName: '控制分配', faults: [{ id: 'fault-a', label: '故障 A' }] }],
        conditions: [{ key: 'mode', label: '输入选择模式', options: ['输入一', '输入二'] }]
      }),
      save: (_edgeId, point) => {
        savedPoint = point;
        return { ok: true, pointId: 'M1' };
      }
    };
    wrapper = mount(TestPointAuthoringPage);

    window.dispatchEvent(new CustomEvent('gz:open-testpoint-authoring', { detail: { edgeId: 'edge-a', pointId: 'M1' } }));
    await nextTick();

    const scenarioPicker = document.querySelector('[data-testpoint-authoring-scenario-select]');
    expect(scenarioPicker).not.toBeNull();
    expect(document.querySelector('[data-testpoint-authoring-scenarios]')).toBeNull();

    document.querySelectorAll('[data-testpoint-authoring-scenario-option]')[0].click();
    await nextTick();
    document.querySelectorAll('[data-testpoint-authoring-scenario-option]')[1].click();
    await nextTick();

    expect(document.querySelector('[data-testpoint-authoring-faults]')?.textContent).toContain('正在同时设置 2 个工况下可检测的故障');
    const faultCheckbox = document.querySelector('[data-testpoint-authoring-faults] .testpoint-authoring-page__fault-list input[type="checkbox"]');
    faultCheckbox.click();
    await nextTick();
    document.querySelector('[data-testpoint-authoring-save]').click();

    expect(savedPoint.detectabilityRules).toEqual(expect.arrayContaining([
      { faultId: 'fault-a', when: { mode: 'input-1' }, detectable: false },
      { faultId: 'fault-a', when: { mode: 'input-2' }, detectable: false }
    ]));
  });
});
