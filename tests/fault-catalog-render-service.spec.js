import { describe, expect, it, vi } from 'vitest';
import { renderFaultCatalogList } from '../src/services/faultCatalogRenderService.js';

describe('fault catalog render service', () => {
  it('renders empty state and unselected hint', () => {
    const host = document.createElement('div');
    const hint = document.createElement('div');

    renderFaultCatalogList(host, hint, {
      models: [],
      importedModels: [],
      selectedId: '',
      getLayerLabel: () => 'Layer'
    });

    expect(host.querySelector('.ifm-empty')?.textContent).toContain('故障模型');
    expect(hint.textContent).toBe('已选：未选择故障模型');
  });

  it('renders catalog items with selected and imported states', () => {
    const host = document.createElement('div');
    const hint = document.createElement('div');
    const onSelect = vi.fn();

    renderFaultCatalogList(host, hint, {
      models: [
        {
          id: 'fault-physical',
          name: 'Physical <Fault>',
          layer: 'physical',
          tags: ['mechanical'],
          createdAt: '2026-06-14'
        },
        {
          id: 'fault-electrical',
          name: 'Electrical Fault',
          layer: 'electrical',
          tags: ['short'],
          createdAt: '2026-06-15'
        }
      ],
      importedModels: [{ id: 'fault-electrical' }],
      selectedId: 'fault-electrical',
      buildMeta(model) {
        return `${model.tags[0]} / ${model.layer} / ${model.createdAt}`;
      },
      getLayerLabel(layer) {
        return layer === 'electrical' ? 'Electrical Layer' : 'Physical Layer';
      },
      onSelect
    });

    const items = [...host.querySelectorAll('.ifm-item')];
    expect(items).toHaveLength(2);
    expect(items[0].dataset.faultId).toBe('fault-physical');
    expect(items[0].classList.contains('on')).toBe(false);
    expect(items[0].classList.contains('is-imported')).toBe(false);
    expect(items[0].querySelector('.ifm-name')?.textContent).toBe('Physical <Fault>');
    expect(host.innerHTML).toContain('Physical &lt;Fault&gt;');
    expect(items[1].classList.contains('on')).toBe(true);
    expect(items[1].classList.contains('is-imported')).toBe(true);
    expect(items[1].querySelector('.ifm-state')?.textContent).toBe('已导入');
    expect(hint.textContent).toBe('已选：Electrical Fault · Electrical Layer');

    items[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fault-physical', expect.any(MouseEvent));
  });

  it('supports custom item markup, empty text, and ignored action clicks', () => {
    const host = document.createElement('div');
    const hint = document.createElement('div');
    const onSelect = vi.fn();

    renderFaultCatalogList(host, hint, {
      models: [{
        id: 'fault-runtime',
        name: 'Runtime Fault',
        layer: 'protocol',
        tags: ['runtime']
      }],
      importedModels: [{ id: 'fault-runtime' }],
      selectedId: 'fault-runtime',
      getLayerLabel: () => 'Protocol Layer',
      renderItem(model, imported) {
        return `<strong>${model.name}</strong>${imported ? '<button type="button" data-clear-selected-fault-catalog="fault-runtime">remove</button>' : ''}`;
      },
      selectIgnoreSelector: '[data-clear-selected-fault-catalog]',
      onSelect
    });

    expect(host.querySelector('.ifm-item')?.innerHTML).toContain('<strong>Runtime Fault</strong>');

    host.querySelector('[data-clear-selected-fault-catalog]').click();
    expect(onSelect).not.toHaveBeenCalled();

    host.querySelector('.ifm-item').click();
    expect(onSelect).toHaveBeenCalledWith('fault-runtime', expect.any(MouseEvent));

    renderFaultCatalogList(host, hint, {
      models: [],
      selectedId: '',
      emptyMessage: 'No matching faults'
    });

    expect(host.querySelector('.ifm-empty')?.textContent).toBe('No matching faults');
  });
});
