const SVG_NS = 'http://www.w3.org/2000/svg';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createSvgElement(documentLike, tagName) {
  return documentLike.createElementNS(SVG_NS, tagName);
}

export function renderCanvasBreadcrumbs(host, options = {}) {
  if (!host) {
    return;
  }

  const rootCanvasId = options.rootCanvasId || 'canvas-root';
  const activeCanvasId = options.activeCanvasId || rootCanvasId;
  const getCanvasRecord = typeof options.getCanvasRecord === 'function' ? options.getCanvasRecord : () => null;
  const navigateToCanvas = typeof options.navigateToCanvas === 'function' ? options.navigateToCanvas : () => {};
  const escape = options.escapeHtml || escapeHtml;
  const trail = list(options.trail).filter(Boolean);

  host.innerHTML = trail.map((canvasId, index) => {
    const canvas = getCanvasRecord(canvasId);
    const label = canvasId === rootCanvasId ? '顶层' : (canvas?.name || canvasId);
    const isLast = index === trail.length - 1;
    return `
      <button type="button" class="canvas-breadcrumbs__item${isLast ? ' is-active' : ''}" data-canvas-id="${escape(canvasId)}" ${canvasId === rootCanvasId ? 'data-breadcrumb-root="true"' : ''} ${isLast ? 'aria-current="page"' : ''}>
        ${escape(label)}
      </button>
      ${!isLast ? '<span class="canvas-breadcrumbs__sep">/</span>' : ''}`;
  }).join('');

  host.querySelectorAll('[data-canvas-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const canvasId = button.dataset.canvasId || rootCanvasId;
      if (canvasId === activeCanvasId) {
        return;
      }
      navigateToCanvas(canvasId);
    });
  });
}

export function createEdgeDomElements(documentLike, options = {}) {
  const edge = options.edge || {};
  const edgePath = options.edgePath || '';
  const selected = Boolean(options.selected);
  const faulted = Boolean(edge.injectedFault);
  const lineType = edge.lineType || 'normal';
  const sourcePort = options.sourcePort || { x: 0, y: 0 };
  const targetPort = options.targetPort || { x: 0, y: 0 };
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;

  const handleSelect = (event) => {
    event.stopPropagation();
    onSelect?.(edge.id, event);
  };

  const hit = createSvgElement(documentLike, 'path');
  hit.setAttribute('d', edgePath);
  hit.setAttribute('class', 'edge-hit');
  hit.dataset.edgeId = edge.id || '';
  hit.addEventListener('click', handleSelect);

  const path = createSvgElement(documentLike, 'path');
  path.setAttribute('d', edgePath);
  path.setAttribute('class', `edge-path edge-path--${lineType}${selected ? ' is-selected' : ''}${faulted ? ' is-faulted' : ''}`);
  path.setAttribute('marker-end', faulted ? 'url(#edge-arrow-fault)' : `url(#edge-arrow-${lineType})`);
  path.dataset.edgeId = edge.id || '';
  path.addEventListener('click', handleSelect);

  const label = createSvgElement(documentLike, 'text');
  label.setAttribute('class', `edge-label${selected ? ' is-selected' : ''}${faulted ? ' is-faulted' : ''}`);
  label.setAttribute('x', String(Math.round((sourcePort.x + targetPort.x) / 2)));
  label.setAttribute('y', String(Math.round((sourcePort.y + targetPort.y) / 2) - 10));
  label.setAttribute('text-anchor', 'middle');
  label.dataset.edgeId = edge.id || '';
  label.textContent = options.labelText || '';
  label.addEventListener('click', handleSelect);

  return { hit, path, label };
}
