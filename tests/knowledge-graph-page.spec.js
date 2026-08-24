import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import KnowledgeGraphPage from '../src/components/KnowledgeGraphPage.vue';

const graph = {
  nodes: [
    { kind: 'fault', id: 'fault-a', label: '设备 A 偏置', targetId: 'device-a' },
    { kind: 'component', id: 'device-a', label: '设备 A' },
    { kind: 'measurementPoint', id: 'tp-1', label: '输出测点' }
  ],
  relations: [
    {
      type: 'OCCURS_ON',
      source: { kind: 'fault', id: 'fault-a' },
      target: { kind: 'component', id: 'device-a' }
    },
    {
      type: 'DETECTABILITY',
      source: { kind: 'fault', id: 'fault-a' },
      target: { kind: 'measurementPoint', id: 'tp-1' },
      detectable: true,
      sourceName: 'manual-d-matrix'
    },
    {
      type: 'DETECTABILITY',
      source: { kind: 'component', id: 'device-a' },
      target: { kind: 'measurementPoint', id: 'tp-1' },
      detectable: false,
      sourceName: 'manual-d-matrix'
    }
  ],
  summary: { nodeCount: 3, relationCount: 3 }
};

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('KnowledgeGraphPage', () => {
  it('opens from the runtime event and exposes graph exploration controls', async () => {
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    expect(page?.textContent).toContain('诊断知识图谱');
    expect(page?.querySelector('[data-knowledge-graph-visible-nodes]')?.textContent).toBe('3');
    expect(page?.querySelectorAll('[data-kg-node-key]')).toHaveLength(3);
    expect(page?.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(2);
    expect(page?.querySelector('.knowledge-graph-legend .is-fault.is-enabled')?.textContent).toContain('故障（已启用）');
    expect(page?.querySelector('.knowledge-graph-legend .is-fault.is-disabled')?.textContent).toContain('故障（未启用）');

    page.querySelector('[data-kg-node-key="fault:fault-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    const detail = page.querySelector('.knowledge-graph-detail');
    expect(detail?.querySelector('h2')?.textContent).toBe('设备 A 偏置');
    expect(detail?.querySelector('code')?.textContent).toBe('fault-a');
    expect(detail?.textContent).toContain('关联度');
    expect(detail?.textContent).toContain('关联关系（2）');
    expect(detail?.textContent).toContain('设备 A 偏置 → 输出测点');

    window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', {
      detail: {
        graph: {
          ...graph,
          nodes: [...graph.nodes, { kind: 'signalEdge', id: 'edge-new', label: '实时新增连线' }],
          summary: { nodeCount: 4, relationCount: 3 }
        }
      }
    }));
    await nextTick();
    expect(page.querySelector('[data-knowledge-graph-total-nodes]')?.textContent).toBe('4');
    expect(page.querySelector('[data-knowledge-graph-visible-nodes]')?.textContent).toBe('3');
    expect(page.textContent).not.toContain('实时新增连线');
    page.querySelector('[data-knowledge-graph-mode="complete"]').click();
    await nextTick();
    expect(page.textContent).toContain('实时新增连线');

    const search = page.querySelector('[data-knowledge-graph-search]');
    search.value = '输出测点';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(1);

    page.querySelector('[data-knowledge-graph-close]').click();
    await nextTick();
    expect(document.querySelector('[data-testid="knowledge-graph-page"]')).toBeNull();
  });

  it('can show manually authored zero-valued detectability relations', async () => {
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    const toggle = page.querySelector('[data-knowledge-graph-negative-toggle]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(3);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-negative')).toHaveLength(1);
  });
});
