const EXPORT_STYLES = `
  .knowledge-graph-export-background { fill: #f7f9fb; }
  .knowledge-graph-relations path { fill: none; stroke: #8d9aaa; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .knowledge-graph-relations path.is-detectability { stroke: #198754; }
  .knowledge-graph-relations path.is-detectability.is-negative { stroke: #7a8796; stroke-dasharray: 5 4; }
  .knowledge-graph-relations path.is-resolved_by_replacing { stroke: #d23c3c; }
  .knowledge-graph-relations path.is-dimmed, .knowledge-graph-relations text.is-dimmed { opacity: .13; }
  .knowledge-graph-relations text { paint-order: stroke; stroke: #f7f9fb; stroke-width: 4px; fill: #44556a; font-family: "Microsoft YaHei", sans-serif; font-size: 9px; }
  #knowledge-graph-arrow path { fill: #66778a; }
  .knowledge-graph-nodes > g.is-dimmed { opacity: .18; }
  .knowledge-graph-nodes rect { fill: #fff; stroke: #aeb8c4; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .knowledge-graph-nodes circle { fill: #e8f2ff; stroke: #1d6fbf; stroke-width: 1.3; vector-effect: non-scaling-stroke; }
  .knowledge-graph-nodes .is-fault rect { stroke: #e0a2a2; }
  .knowledge-graph-nodes .is-fault circle { fill: #fdecec; stroke: #d23c3c; }
  .knowledge-graph-nodes .is-fault.is-disabled rect { fill: #f4f6f8; stroke: #66778a; stroke-dasharray: 5 4; }
  .knowledge-graph-nodes .is-fault.is-disabled circle { fill: #f4f6f8; stroke: #66778a; }
  .knowledge-graph-nodes .is-signalEdge rect { stroke: #f2c795; }
  .knowledge-graph-nodes .is-signalEdge circle { fill: #fff1dd; stroke: #d77b16; }
  .knowledge-graph-nodes .is-measurementPoint rect { stroke: #9ed4ae; }
  .knowledge-graph-nodes .is-measurementPoint circle { fill: #e8f6ed; stroke: #198754; }
  .knowledge-graph-nodes .is-selected rect { stroke: #1d6fbf; stroke-width: 2.5; }
  .knowledge-graph-node__glyph { fill: #172536; font-family: Consolas, monospace; font-size: 9px; font-weight: 600; }
  .knowledge-graph-node__label { fill: #172536; font-family: "Microsoft YaHei", sans-serif; font-size: 10px; font-weight: 600; }
`;

function safeFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function setAttributes(element, attributes) {
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
}

function inlineExportStyles(svg) {
  svg.querySelectorAll('.knowledge-graph-relations path').forEach((path) => {
    let stroke = '#8d9aaa';
    if (path.classList.contains('is-detectability')) stroke = path.classList.contains('is-negative') ? '#7a8796' : '#198754';
    if (path.classList.contains('is-resolved_by_replacing')) stroke = '#d23c3c';
    setAttributes(path, {
      fill: 'none',
      stroke,
      'stroke-width': '1.5',
      'vector-effect': 'non-scaling-stroke'
    });
    if (path.classList.contains('is-negative')) path.setAttribute('stroke-dasharray', '5 4');
    if (path.classList.contains('is-dimmed')) path.setAttribute('opacity', '.13');
  });

  svg.querySelectorAll('.knowledge-graph-relations text').forEach((label) => {
    setAttributes(label, {
      fill: '#44556a',
      stroke: '#f7f9fb',
      'stroke-width': '4',
      'paint-order': 'stroke',
      'font-family': 'Microsoft YaHei, sans-serif',
      'font-size': '9'
    });
    if (label.classList.contains('is-dimmed')) label.setAttribute('opacity', '.13');
  });

  svg.querySelectorAll('.knowledge-graph-nodes > g').forEach((node) => {
    const rect = node.querySelector('rect');
    const circle = node.querySelector('circle');
    let rectFill = '#ffffff';
    let rectStroke = '#aeb8c4';
    let circleFill = '#e8f2ff';
    let circleStroke = '#1d6fbf';

    if (node.classList.contains('is-fault')) {
      rectStroke = '#e0a2a2';
      circleFill = '#fdecec';
      circleStroke = '#d23c3c';
    } else if (node.classList.contains('is-signalEdge')) {
      rectStroke = '#f2c795';
      circleFill = '#fff1dd';
      circleStroke = '#d77b16';
    } else if (node.classList.contains('is-measurementPoint')) {
      rectStroke = '#9ed4ae';
      circleFill = '#e8f6ed';
      circleStroke = '#198754';
    }

    if (node.classList.contains('is-disabled')) {
      rectFill = '#f4f6f8';
      rectStroke = '#66778a';
      circleFill = '#f4f6f8';
      circleStroke = '#66778a';
      rect?.setAttribute('stroke-dasharray', '5 4');
    }
    if (node.classList.contains('is-selected')) rectStroke = '#1d6fbf';
    if (node.classList.contains('is-dimmed')) node.setAttribute('opacity', '.18');

    if (rect) setAttributes(rect, {
      fill: rectFill,
      stroke: rectStroke,
      'stroke-width': node.classList.contains('is-selected') ? '2.5' : '1.5',
      'vector-effect': 'non-scaling-stroke'
    });
    if (circle) setAttributes(circle, {
      fill: circleFill,
      stroke: circleStroke,
      'stroke-width': '1.3',
      'vector-effect': 'non-scaling-stroke'
    });
  });

  svg.querySelectorAll('.knowledge-graph-node__glyph').forEach((text) => setAttributes(text, {
    fill: '#172536',
    'font-family': 'Consolas, monospace',
    'font-size': '9',
    'font-weight': '600'
  }));
  svg.querySelectorAll('.knowledge-graph-node__label').forEach((text) => setAttributes(text, {
    fill: '#172536',
    'font-family': 'Microsoft YaHei, sans-serif',
    'font-size': '10',
    'font-weight': '600'
  }));
  svg.querySelectorAll('#knowledge-graph-arrow path').forEach((path) => path.setAttribute('fill', '#66778a'));
}

export function buildKnowledgeGraphSvg(svg, options = {}) {
  if (!svg || typeof svg.cloneNode !== 'function') {
    return { ok: false, reason: 'missing-svg', content: '' };
  }

  const clone = svg.cloneNode(true);
  const viewBox = clone.getAttribute('viewBox') || '0 0 1200 620';
  const [, , width = '1200', height = '620'] = viewBox.trim().split(/\s+/);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('role', 'img');
  clone.setAttribute('aria-label', options.title || '诊断知识图谱当前视图');

  const documentRef = clone.ownerDocument;
  const namespace = 'http://www.w3.org/2000/svg';
  const title = documentRef.createElementNS(namespace, 'title');
  title.textContent = options.title || '诊断知识图谱当前视图';
  clone.insertBefore(title, clone.firstChild);

  const style = documentRef.createElementNS(namespace, 'style');
  style.textContent = EXPORT_STYLES;
  clone.insertBefore(style, title.nextSibling);

  const background = documentRef.createElementNS(namespace, 'rect');
  background.setAttribute('class', 'knowledge-graph-export-background');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', width);
  background.setAttribute('height', height);
  background.setAttribute('fill', '#f7f9fb');
  const defs = clone.querySelector('defs');
  if (defs) defs.after(background);
  else style.after(background);

  // Presentation attributes are deliberately inlined. Some desktop SVG viewers
  // ignore class-based styles and otherwise render every shape with black defaults.
  inlineExportStyles(clone);

  const serializer = new XMLSerializer();
  return {
    ok: true,
    content: `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`
  };
}

export function exportKnowledgeGraphSvg(svg, options = {}) {
  const result = buildKnowledgeGraphSvg(svg, options);
  if (!result.ok || options.download === false) return result;

  const documentRef = svg.ownerDocument;
  const urlApi = documentRef.defaultView?.URL;
  if (typeof Blob === 'undefined' || typeof urlApi?.createObjectURL !== 'function') {
    return { ...result, ok: false, reason: 'download-unavailable' };
  }

  const blob = new Blob([result.content], { type: 'image/svg+xml;charset=utf-8' });
  const href = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.href = href;
  link.download = options.fileName || `诊断知识图谱-当前视图-${safeFileTimestamp(options.date)}.svg`;
  link.style.display = 'none';
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  documentRef.defaultView?.setTimeout(() => urlApi.revokeObjectURL(href), 0);
  return { ...result, fileName: link.download };
}
