import { describe, expect, it, vi } from 'vitest';
import {
  createEdgeDomElements,
  renderCanvasBreadcrumbs
} from '../src/services/canvasRenderService.js';

describe('canvas render service', () => {
  it('renders canvas breadcrumbs and wires navigation callbacks', () => {
    const host = document.createElement('div');
    const navigateToCanvas = vi.fn();

    renderCanvasBreadcrumbs(host, {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      trail: ['canvas-root', 'canvas-child'],
      getCanvasRecord(canvasId) {
        return {
          'canvas-root': { name: 'Root Name' },
          'canvas-child': { name: '姿态 <控制>' }
        }[canvasId];
      },
      navigateToCanvas
    });

    const buttons = [...host.querySelectorAll('[data-canvas-id]')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent.trim()).toBe('顶层');
    expect(buttons[0].dataset.breadcrumbRoot).toBe('true');
    expect(buttons[1].textContent.trim()).toBe('姿态 <控制>');
    expect(buttons[1].classList.contains('is-active')).toBe(true);
    expect(buttons[1].getAttribute('aria-current')).toBe('page');
    expect(host.innerHTML).toContain('姿态 &lt;控制&gt;');

    buttons[0].click();
    buttons[1].click();

    expect(navigateToCanvas).toHaveBeenCalledTimes(1);
    expect(navigateToCanvas).toHaveBeenCalledWith('canvas-root');
  });

  it('creates SVG edge hit path, visible path, and label elements', () => {
    const onSelect = vi.fn();
    const result = createEdgeDomElements(document, {
      edge: { id: 'edge-1', lineType: 'can', injectedFault: { modelId: 'fault' } },
      edgePath: 'M 10 20 C 70 20, 90 40, 120 40',
      selected: true,
      sourcePort: { x: 10, y: 20 },
      targetPort: { x: 120, y: 40 },
      labelText: 'CAN 总线',
      onSelect
    });

    expect(result.hit.getAttribute('class')).toBe('edge-hit');
    expect(result.hit.dataset.edgeId).toBe('edge-1');
    expect(result.path.getAttribute('class')).toBe('edge-path edge-path--can is-selected is-faulted');
    expect(result.path.getAttribute('marker-end')).toBe('url(#edge-arrow-fault)');
    expect(result.label.getAttribute('class')).toBe('edge-label is-selected is-faulted');
    expect(result.label.getAttribute('x')).toBe('65');
    expect(result.label.getAttribute('y')).toBe('20');
    expect(result.label.textContent).toBe('CAN 总线');

    result.path.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('edge-1', expect.any(MouseEvent));
  });
});
