import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraphSvg } from '../src/services/knowledgeGraphExportService.js';

describe('knowledge graph export service', () => {
  it('serializes exactly the nodes, relations and viewport transform in the current SVG', () => {
    document.body.innerHTML = `
      <svg viewBox="0 0 900 600" aria-label="screen graph">
        <defs><marker id="knowledge-graph-arrow"><path d="M0 0"></path></marker></defs>
        <g transform="translate(32 18) scale(1.4)">
          <g class="knowledge-graph-relations"><path class="is-detectability" d="M 1 2 L 3 4"></path></g>
          <g class="knowledge-graph-nodes"><g class="is-fault is-selected"><rect></rect><text class="knowledge-graph-node__label">电源偏置</text></g></g>
        </g>
      </svg>`;

    const result = buildKnowledgeGraphSvg(document.querySelector('svg'));

    expect(result.ok).toBe(true);
    expect(result.content).toContain('width="900"');
    expect(result.content).toContain('height="600"');
    expect(result.content).toContain('translate(32 18) scale(1.4)');
    expect(result.content).toContain('电源偏置');
    expect(result.content).toContain('knowledge-graph-export-background');
    expect(result.content).toContain('.knowledge-graph-nodes .is-selected rect');
    expect(result.content).toContain('fill="#f7f9fb"');
    expect(result.content).toContain('stroke="#198754"');
    expect(result.content).toContain('fill="#ffffff"');
    expect(result.content).toContain('fill="#172536"');
  });

  it('reports a missing SVG without throwing', () => {
    expect(buildKnowledgeGraphSvg(null)).toEqual({ ok: false, reason: 'missing-svg', content: '' });
  });
});
