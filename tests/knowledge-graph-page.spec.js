import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  delete window.__GZ_DIAGNOSTIC_PHENOMENA__;
  delete window.__GZ_DEVICE_SPECIFICATIONS__;
});

describe('KnowledgeGraphPage', () => {
  it('keeps long Chinese names inside graph nodes while preserving their full titles', async () => {
    const componentName = '复数包络标量转四维向量';
    const requirementName = '断电并确认隔离后检查所有输入输出端口的连接状态';
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', {
      detail: {
        graph: {
          nodes: [{ kind: 'component', id: 'device-long', label: componentName, operationRequirements: [requirementName] }],
          relations: []
        }
      }
    }));
    await nextTick();
    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    page.querySelector('[data-knowledge-graph-mode="specification"]').click();
    await nextTick();

    const component = page.querySelector('[data-kg-node-key="component:device-long"]');
    const requirement = page.querySelector('.knowledge-graph-nodes .is-operationRequirement');
    for (const [node, fullName] of [[component, componentName], [requirement, requirementName]]) {
      const label = node.querySelector('.knowledge-graph-node__label');
      const box = node.querySelector('rect');
      const clipId = label.getAttribute('clip-path').match(/^url\(#(.+)\)$/)?.[1];
      const clip = page.querySelector(`clipPath[id="${clipId}"] rect`);
      expect(node.querySelector('title').textContent).toBe(fullName);
      expect(label.textContent.endsWith('…')).toBe(true);
      expect(label.textContent.length).toBeLessThan(fullName.length);
      expect(clip).not.toBeNull();
      expect(Number(clip.getAttribute('x'))).toBe(Number(label.getAttribute('x')));
      expect(Number(clip.getAttribute('x')) + Number(clip.getAttribute('width')))
        .toBeLessThan(Number(box.getAttribute('x')) + Number(box.getAttribute('width')));
    }
  });

  it('saves operation requirements and instruments when the legacy save API is unavailable', async () => {
    const previousState = window.__GZ_STATE__;
    window.__GZ_STATE__ = { diagnosticModel: {} };
    try {
      wrapper = mount(KnowledgeGraphPage);
      window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', {
        detail: { graph: { nodes: [{ kind: 'component', id: 'device-a', label: '设备 A' }], relations: [] } }
      }));
      await nextTick();
      const page = document.querySelector('[data-testid="knowledge-graph-page"]');
      page.querySelector('[data-knowledge-graph-mode="specification"]').click();
      await nextTick();
      page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();

      for (const [field, value] of [['operationRequirements', '断电检查'], ['allowedInstruments', '数字万用表']]) {
        const input = page.querySelector(`[data-specification-field="${field}"]`);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
        page.querySelector(`[data-save-specification="${field}"]`).click();
        await nextTick();
        expect(page.querySelector(`[data-save-specification="${field}"]`).parentElement.textContent).toContain('已保存到模型');
      }

      expect(window.__GZ_STATE__.diagnosticModel.deviceSpecifications['device-a']).toEqual({
        operationRequirements: ['断电检查'],
        allowedInstruments: ['数字万用表']
      });
      expect(JSON.parse(localStorage.getItem('gz-workbench-system-model')).diagnosticModel.deviceSpecifications['device-a'])
        .toEqual(window.__GZ_STATE__.diagnosticModel.deviceSpecifications['device-a']);
      expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(1);
      expect(page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument')).toHaveLength(1);

      window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', {
        detail: { graph: { nodes: [{ kind: 'component', id: 'device-a', label: '设备 A' }], relations: [] } }
      }));
      await nextTick();
      expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(1);
      expect(page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument')).toHaveLength(1);
    } finally {
      window.__GZ_STATE__ = previousState;
      localStorage.removeItem('gz-workbench-system-model');
    }
  });

  it('edits device-specific requirements and instruments as separate graph nodes', async () => {
    const specificationGraph = {
      nodes: [
        { kind: 'component', id: 'device-a', label: '设备 A', operationRequirements: ['断电检查'], allowedInstruments: ['数字万用表'] },
        { kind: 'component', id: 'device-b', label: '设备 B', operationRequirements: ['佩戴防护手套'], allowedInstruments: ['示波器'] },
        { kind: 'signalEdge', id: 'wire-a', label: '连接线' }
      ],
      relations: []
    };
    const save = vi.fn((_deviceId, _field, entries) => ({ ok: true, entries, persisted: true }));
    window.__GZ_DEVICE_SPECIFICATIONS__ = { save };
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph: specificationGraph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    page.querySelector('[data-knowledge-graph-mode="specification"]').click();
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(6);
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(4);
    expect(page.querySelector('[data-kg-node-key="signalEdge:wire-a"]')).toBeNull();
    expect(page.querySelector('.knowledge-graph-specification-detail')).toBeNull();
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement title')].map((node) => node.textContent).sort())
      .toEqual(['佩戴防护手套', '断电检查'].sort());
    expect([...page.querySelectorAll('[data-knowledge-graph-node-filter] option')].map((option) => option.value))
      .toEqual(['all', 'component', 'operationRequirement', 'measurementInstrument']);

    page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(4);
    expect(page.querySelector('[data-specification-field="operationRequirements"]').value).toBe('断电检查');
    expect(page.querySelector('[data-specification-field="allowedInstruments"]').value).toBe('数字万用表');
    expect(page.querySelector('.knowledge-graph-specification-detail .knowledge-graph-detail__properties')).toBeNull();
    expect(page.querySelector('.knowledge-graph-specification-detail .knowledge-graph-detail__relations')).toBeNull();
    expect(page.querySelector('[data-kg-node-key="component:device-b"]').classList.contains('is-dimmed')).toBe(true);

    const requirements = page.querySelector('[data-specification-field="operationRequirements"]');
    requirements.value = '断电检查\n记录设备参数';
    requirements.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    page.querySelector('[data-save-specification="operationRequirements"]').click();
    expect(save).toHaveBeenCalledWith('device-a', 'operationRequirements', ['断电检查', '记录设备参数']);
    window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', {
      detail: {
        graph: {
          ...specificationGraph,
          nodes: specificationGraph.nodes.map((node) => node.id === 'device-a'
            ? { ...node, operationRequirements: ['断电检查', '记录设备参数'] } : node)
        }
      }
    }));
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(3);

    page.querySelector('[data-kg-node-key="component:device-b"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('[data-specification-field="allowedInstruments"]').value).toBe('示波器');
    expect(page.querySelector('[data-kg-node-key="component:device-a"]').classList.contains('is-dimmed')).toBe(true);
    page.querySelector('[aria-label="关闭规范细则"]').click();
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(7);
    expect(page.querySelector('.knowledge-graph-specification-detail')).toBeNull();

    page.querySelector('[data-knowledge-graph-mode="propagation"]').click();
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(0);
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument')).toHaveLength(0);

    page.querySelector('[data-kg-node-key="component:device-b"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement title')].map((node) => node.textContent))
      .toEqual(['佩戴防护手套']);
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument title')].map((node) => node.textContent))
      .toEqual(['示波器']);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-requires_operation')).toHaveLength(1);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-allows_instrument')).toHaveLength(1);
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('设备 B');
    expect(page.querySelector('.knowledge-graph-detail > code').textContent).toBe('device-b');
    expect(page.querySelector('.knowledge-graph-detail__relations').textContent).toContain('示波器');

    page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement title')].map((node) => node.textContent).sort())
      .toEqual(['断电检查', '记录设备参数'].sort());
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument title')].map((node) => node.textContent))
      .toEqual(['数字万用表']);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-requires_operation')).toHaveLength(2);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-allows_instrument')).toHaveLength(1);
    const requirementNode = [...page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')]
      .find((node) => node.querySelector('title').textContent === '记录设备参数');
    requirementNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('记录设备参数');
    expect(page.querySelector('.knowledge-graph-detail__relations').textContent).toContain('设备 A');
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(2);
    window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', {
      detail: {
        graph: {
          ...specificationGraph,
          nodes: specificationGraph.nodes.map((node) => node.id === 'device-a'
            ? { ...node, operationRequirements: ['断电检查', '记录设备参数'] } : node)
        }
      }
    }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('记录设备参数');

    page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('设备 A');
    page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-operationRequirement')).toHaveLength(0);
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-measurementInstrument')).toHaveLength(0);
  });

  it('shows editable phenomena only for the selected fault and point in the maintenance view', async () => {
    const maintenanceGraph = {
      nodes: [
        { kind: 'fault', id: 'fault-a', label: '故障 A' },
        { kind: 'fault', id: 'fault-b', label: '故障 B' },
        { kind: 'measurementPoint', id: 'tp-1', label: '共享测点', pointCode: 'M1' },
        { kind: 'measurementPoint', id: 'tp-2', label: '不可检测测点', pointCode: 'M2' },
        { kind: 'component', id: 'device-a', label: '设备 A' },
        { kind: 'signalEdge', id: 'wire-b', label: '故障连线 B' },
        { kind: 'component', id: 'unrelated-device', label: '无关设备' }
      ],
      relations: [
        { type: 'DETECTABILITY', source: { kind: 'fault', id: 'fault-a' }, target: { kind: 'measurementPoint', id: 'tp-1' }, detectable: true, phenomena: ['幅值下降'] },
        { type: 'DETECTABILITY', source: { kind: 'fault', id: 'fault-b' }, target: { kind: 'measurementPoint', id: 'tp-1' }, detectable: true, phenomena: ['频率异常'] },
        { type: 'DETECTABILITY', source: { kind: 'fault', id: 'fault-a' }, target: { kind: 'measurementPoint', id: 'tp-2' }, detectable: false, phenomena: ['不应展示'] },
        { type: 'OCCURS_ON', source: { kind: 'fault', id: 'fault-a' }, target: { kind: 'component', id: 'device-a' } },
        { type: 'OCCURS_ON', source: { kind: 'fault', id: 'fault-b' }, target: { kind: 'signalEdge', id: 'wire-b' } },
        { type: 'OUTPUTS_TO', source: { kind: 'component', id: 'device-a' }, target: { kind: 'signalEdge', id: 'wire-b' } },
        { type: 'OUTPUTS_TO', source: { kind: 'component', id: 'unrelated-device' }, target: { kind: 'signalEdge', id: 'wire-b' } }
      ]
    };
    const save = vi.fn((_faultId, _pointId, entries) => ({ ok: true, phenomena: entries, persisted: true }));
    window.__GZ_DIAGNOSTIC_PHENOMENA__ = { save };
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph: maintenanceGraph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    page.querySelector('[data-knowledge-graph-mode="maintenance"]').click();
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(6);
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(5);
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon')).toHaveLength(0);
    expect(page.querySelector('[data-kg-node-key="component:device-a"]')).not.toBeNull();
    expect(page.querySelector('[data-kg-node-key="signalEdge:wire-b"]')).not.toBeNull();
    expect(page.querySelector('[data-kg-node-key="component:unrelated-device"]')).toBeNull();
    expect([...page.querySelectorAll('[data-knowledge-graph-node-filter] option')].map((option) => option.value))
      .toEqual(['all', 'fault', 'component', 'signalEdge', 'measurementPoint', 'phenomenon']);
    expect(page.querySelector('.knowledge-graph-maintenance-detail')).toBeNull();
    expect(page.textContent).not.toContain('幅值下降');
    expect(page.textContent).not.toContain('频率异常');

    page.querySelector('[data-kg-node-key="component:device-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('设备 A');
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon')).toHaveLength(0);

    page.querySelector('[data-kg-node-key="fault:fault-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon')).toHaveLength(1);
    expect(page.querySelector('.knowledge-graph-maintenance-detail > code').textContent).toBe('fault-a');
    expect(page.querySelector('.knowledge-graph-maintenance-detail .knowledge-graph-detail__properties').textContent).toContain('关联度');
    expect(page.querySelector('.knowledge-graph-maintenance-detail .knowledge-graph-detail__relations').textContent).toContain('设备 A');
    expect(page.querySelector('.knowledge-graph-nodes .is-phenomenon title').textContent).toBe('幅值下降');
    const nodeY = (node) => Number(node.getAttribute('transform').match(/translate\([^ ]+ ([^)]+)\)/)?.[1]);
    expect(nodeY(page.querySelector('.knowledge-graph-nodes .is-phenomenon')))
      .toBe(nodeY(page.querySelector('[data-kg-node-key="measurementPoint:tp-1"]')));
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(6);
    expect(page.querySelector('.knowledge-graph-legend .is-phenomenon')).not.toBeNull();
    page.querySelector('.knowledge-graph-nodes .is-phenomenon').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('幅值下降');
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon')).toHaveLength(1);
    page.querySelector('[data-kg-node-key="fault:fault-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    const firstDraft = page.querySelector('[data-knowledge-graph-phenomena="tp-1"]');
    expect(firstDraft.value).toBe('幅值下降');
    expect(page.querySelector('[data-knowledge-graph-phenomena="tp-2"]')).toBeNull();
    firstDraft.value = '幅值下降\n输出不稳定';
    firstDraft.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    page.querySelector('[data-save-knowledge-graph-phenomena="tp-1"]').click();
    expect(save).toHaveBeenCalledWith('fault-a', 'tp-1', ['幅值下降', '输出不稳定']);
    window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', {
      detail: {
        graph: {
          ...maintenanceGraph,
          relations: maintenanceGraph.relations.map((relation) => relation.source?.id === 'fault-a' && relation.target?.id === 'tp-1'
            ? { ...relation, phenomena: ['幅值下降', '输出不稳定'] } : relation)
        }
      }
    }));
    await nextTick();
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon title')].map((node) => node.textContent)).toEqual(['幅值下降', '输出不稳定']);

    page.querySelector('[data-kg-node-key="fault:fault-b"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect([...page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon title')].map((node) => node.textContent)).toEqual(['频率异常']);
    expect(page.querySelector('[data-knowledge-graph-phenomena="tp-1"]').value).toBe('频率异常');
    expect(page.querySelector('.knowledge-graph-maintenance-detail h2').textContent).toBe('故障 B');
    page.querySelector('[aria-label="关闭故障现象"]').click();
    await nextTick();
    expect(page.querySelector('.knowledge-graph-maintenance-detail')).toBeNull();
    expect(page.querySelectorAll('.knowledge-graph-nodes .is-phenomenon')).toHaveLength(0);
    page.querySelector('[data-kg-node-key="measurementPoint:tp-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('共享测点');
    expect(page.querySelector('.knowledge-graph-detail > code').textContent).toBe('tp-1');
    expect(page.querySelector('.knowledge-graph-maintenance-detail')).toBeNull();
  });

  it('shows only equipment, wires, and their input/output relations in the entity view', async () => {
    const entityGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { kind: 'component', id: 'device-b', label: '设备 B' },
        { kind: 'component', id: 'device-isolated', label: '未连接设备' },
        { kind: 'signalEdge', id: 'wire-ab', label: 'A 到 B 连线' }
      ],
      relations: [
        ...graph.relations,
        { type: 'OUTPUTS_TO', source: { kind: 'component', id: 'device-a' }, target: { kind: 'signalEdge', id: 'wire-ab' } },
        { type: 'INPUTS_TO', source: { kind: 'signalEdge', id: 'wire-ab' }, target: { kind: 'component', id: 'device-b' } },
        { type: 'OBSERVES', source: { kind: 'measurementPoint', id: 'tp-1' }, target: { kind: 'signalEdge', id: 'wire-ab' } }
      ]
    };
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph: entityGraph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    page.querySelector('[data-knowledge-graph-mode="entity"]').click();
    await nextTick();

    expect(page.querySelector('[data-knowledge-graph-mode="entity"]').classList.contains('is-active')).toBe(true);
    expect(page.querySelector('[data-knowledge-graph-visible-nodes]').textContent).toBe('4');
    expect(page.querySelector('[data-knowledge-graph-visible-relations]').textContent).toBe('2');
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(4);
    expect(page.querySelector('[data-kg-node-key="component:device-isolated"]')).not.toBeNull();
    expect(page.querySelector('[data-kg-node-key="fault:fault-a"]')).toBeNull();
    expect(page.querySelector('[data-kg-node-key="measurementPoint:tp-1"]')).toBeNull();
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(2);
    expect([...page.querySelectorAll('[data-knowledge-graph-node-filter] option')].map((option) => option.value)).toEqual(['all', 'component', 'signalEdge']);
    expect(page.querySelector('[data-knowledge-graph-negative-toggle]')).toBeNull();
    expect(page.querySelector('.knowledge-graph-legend .is-detectable')).toBeNull();
    expect(page.textContent).toContain('设备与连线的输入/输出关系');

    page.querySelector('[data-knowledge-graph-mode="maintenance"]').click();
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(3);
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(2);
    expect(page.querySelector('[data-kg-node-key="component:device-isolated"]')).toBeNull();

    page.querySelector('[data-knowledge-graph-mode="propagation"]').click();
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(6);
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(5);
    expect(page.textContent).toContain('故障传播图谱 · 全部节点与关系');
  });

  it('coalesces pointer moves into one SVG pan update per frame', async () => {
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph } }));
    await nextTick();

    const svg = document.querySelector('.knowledge-graph-svg');
    const group = svg.querySelector('g[transform]');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 1200, height: 620, left: 0, top: 0 });
    let drawFrame;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      drawFrame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const pointer = (type, clientX, clientY) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 7, button: 0, clientX, clientY });
      svg.dispatchEvent(event);
    };

    pointer('pointerdown', 100, 100);
    expect(svg.classList.contains('is-panning')).toBe(true);
    pointer('pointermove', 120, 110);
    pointer('pointermove', 140, 120);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(group.getAttribute('transform')).toBe('translate(0 0) scale(1)');
    drawFrame();
    expect(group.getAttribute('transform')).toBe('translate(40 20) scale(1)');

    pointer('pointerup', 140, 120);
    await nextTick();
    expect(group.getAttribute('transform')).toBe('translate(40 20) scale(1)');
    expect(svg.classList.contains('is-panning')).toBe(false);
    document.querySelector('.knowledge-graph-page__reset').click();
    await nextTick();
    expect(group.getAttribute('transform')).toBe('translate(0 0) scale(1)');
  });

  it('lets every graph view zoom large layouts to readable node size', async () => {
    const nodes = [];
    const relations = [];
    for (let index = 0; index < 80; index += 1) {
      const id = `device-${index}`;
      nodes.push({ kind: 'component', id, label: `设备 ${index}`, operationRequirements: [`检查 ${index}`], allowedInstruments: [`仪器 ${index}`] });
      nodes.push({ kind: 'fault', id: `fault-${index}`, label: `故障 ${index}` });
      nodes.push({ kind: 'measurementPoint', id: `point-${index}`, label: `测点 ${index}` });
      relations.push({ type: 'OCCURS_ON', source: { kind: 'fault', id: `fault-${index}` }, target: { kind: 'component', id } });
    }
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph: { nodes, relations } } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    const svg = page.querySelector('.knowledge-graph-svg');
    const group = svg.querySelector('g[transform]');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600, left: 0, top: 0 });

    for (const mode of ['entity', 'maintenance', 'specification', 'propagation']) {
      page.querySelector(`[data-knowledge-graph-mode="${mode}"]`).click();
      await nextTick();
      const graphHeight = Number(svg.getAttribute('viewBox').split(' ')[3]);
      const fitScale = Math.min(1000 / 1200, 600 / graphHeight);
      for (let step = 0; step < 40; step += 1) {
        svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, clientX: 500, clientY: 300 }));
      }
      await nextTick();
      const scale = Number(group.getAttribute('transform').match(/scale\(([^)]+)\)/)?.[1]);
      expect(scale * fitScale * 144).toBeGreaterThanOrEqual(489);
    }
  });

  it('opens from the runtime event and exposes graph exploration controls', async () => {
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    expect(page?.textContent).toContain('诊断知识图谱');
    expect([...page.querySelectorAll('[data-knowledge-graph-mode]')].map((button) => button.dataset.knowledgeGraphMode))
      .toEqual(['entity', 'maintenance', 'specification', 'propagation']);
    expect(page.querySelector('[data-knowledge-graph-mode="entity"]').classList.contains('is-active')).toBe(true);
    expect(page?.querySelector('[data-knowledge-graph-visible-nodes]')?.textContent).toBe('1');
    expect(page?.querySelectorAll('[data-kg-node-key]')).toHaveLength(1);
    expect(page?.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(0);
    expect(page.querySelector('[data-kg-node-key="fault:fault-a"]')).toBeNull();
    expect(page?.querySelector('[data-knowledge-graph-export]')?.textContent).toBe('导出当前视图');

    page.querySelector('[data-knowledge-graph-mode="maintenance"]').click();
    await nextTick();
    expect(page?.querySelectorAll('[data-kg-node-key]')).toHaveLength(3);
    expect(page?.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(2);
    expect(page?.querySelector('.knowledge-graph-legend .is-fault.is-enabled')?.textContent).toContain('故障（已启用）');
    expect(page?.querySelector('.knowledge-graph-legend .is-fault.is-disabled')?.textContent).toContain('故障（未启用）');

    page.querySelector('[data-kg-node-key="fault:fault-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    const detail = page.querySelector('.knowledge-graph-maintenance-detail');
    expect(detail?.querySelector('h2')?.textContent).toBe('设备 A 偏置');
    expect(detail?.textContent).toContain('输出测点');

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
    page.querySelector('[data-knowledge-graph-mode="entity"]').click();
    await nextTick();
    expect(page.querySelector('[data-knowledge-graph-visible-nodes]')?.textContent).toBe('2');
    expect(page.textContent).toContain('实时新增连线');

    page.querySelector('[data-knowledge-graph-mode="maintenance"]').click();
    await nextTick();

    const search = page.querySelector('[data-knowledge-graph-search]');
    search.value = '输出测点';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(1);

    page.querySelector('[data-knowledge-graph-close]').click();
    await nextTick();
    expect(document.querySelector('[data-testid="knowledge-graph-page"]')).toBeNull();
  });

  it('shows the restored fault propagation graph with optional zero-valued relations', async () => {
    wrapper = mount(KnowledgeGraphPage);
    window.dispatchEvent(new CustomEvent('gz:open-knowledge-graph', { detail: { graph } }));
    await nextTick();

    const page = document.querySelector('[data-testid="knowledge-graph-page"]');
    page.querySelector('[data-knowledge-graph-mode="propagation"]').click();
    await nextTick();
    expect(page.querySelector('[data-knowledge-graph-mode="propagation"]').classList.contains('is-active')).toBe(true);
    expect(page.querySelectorAll('[data-kg-node-key]')).toHaveLength(3);
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(2);
    const toggle = page.querySelector('[data-knowledge-graph-negative-toggle]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(page.querySelectorAll('.knowledge-graph-relations path')).toHaveLength(3);
    expect(page.querySelectorAll('.knowledge-graph-relations path.is-negative')).toHaveLength(1);
    expect(page.querySelector('.knowledge-graph-legend .is-undetectable')).not.toBeNull();

    page.querySelector('[data-kg-node-key="fault:fault-a"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('设备 A 偏置');
    expect(page.querySelector('.knowledge-graph-detail > code').textContent).toBe('fault-a');
    expect(page.querySelector('.knowledge-graph-detail__relations').textContent).toContain('设备 A');

    page.querySelector('[data-kg-node-key="measurementPoint:tp-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail h2').textContent).toBe('输出测点');
    expect(page.querySelector('.knowledge-graph-detail > code').textContent).toBe('tp-1');
    page.querySelector('[aria-label="关闭节点详情"]').click();
    await nextTick();
    expect(page.querySelector('.knowledge-graph-detail')).toBeNull();
  });

});
