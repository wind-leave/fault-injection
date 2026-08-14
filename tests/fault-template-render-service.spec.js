import { describe, expect, it, vi } from 'vitest';
import {
  renderFaultTemplateDetail,
  renderFaultTemplateGrid
} from '../src/services/faultTemplateRenderService.js';

describe('fault template render service', () => {
  it('renders template cards, selection state, tags, and click callbacks', () => {
    const host = document.createElement('div');
    const onToggle = vi.fn();
    const templates = [
      {
        id: 'open-circuit',
        name: 'Open <Circuit>',
        desc: 'Line & sensor fault',
        tags: ['electrical', 'intermittent'],
        c: '#2563eb'
      },
      {
        id: 'noise',
        name: 'Noise',
        desc: 'Signal noise',
        tags: ['signal'],
        c: '#16a34a'
      }
    ];

    renderFaultTemplateGrid(host, {
      category: 'electrical',
      templates,
      selectedTemplates: [{ id: 'noise' }],
      onToggle
    });

    const cards = [...host.querySelectorAll('.tcard')];
    expect(cards).toHaveLength(2);
    expect(cards[0].classList.contains('on')).toBe(false);
    expect(cards[1].classList.contains('on')).toBe(true);
    expect(cards[0].querySelector('.tcard-name')?.textContent).toBe('Open <Circuit>');
    expect(host.innerHTML).toContain('Open &lt;Circuit&gt;');
    expect(host.innerHTML).toContain('Line &amp; sensor fault');
    expect(cards[0].querySelectorAll('.ttag')).toHaveLength(2);

    cards[0].click();

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'open-circuit', layer: 'electrical' }),
      cards[0]
    );
  });

  it('renders empty and populated template details', () => {
    const host = document.createElement('div');

    renderFaultTemplateDetail(host, null, {
      getLayerLabel: () => 'Electrical Layer'
    });

    expect(host.querySelector('.tdph')?.textContent).toContain('选择模板');

    renderFaultTemplateDetail(host, {
      id: 'open-circuit',
      name: 'Open <Circuit>',
      desc: 'Line & sensor fault',
      layer: 'electrical',
      tags: ['line', 'persistent']
    }, {
      getLayerLabel: () => 'Electrical Layer'
    });

    expect(host.querySelector('.tdtitle')?.textContent).toBe('Open <Circuit>');
    expect(host.innerHTML).toContain('Open &lt;Circuit&gt;');
    expect(host.innerHTML).toContain('Line &amp; sensor fault');
    expect(host.textContent).toContain('Electrical Layer');
    expect(host.textContent).toContain('persistent');
  });
});
