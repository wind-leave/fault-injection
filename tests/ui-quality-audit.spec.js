import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runAuditJson() {
  const raw = execFileSync('node', ['tools/ui_quality_audit.mjs', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return JSON.parse(raw);
}

describe('UI quality audit loop', () => {
  it('codifies a self-proposal, self-review, and self-strengthening UI loop', () => {
    const audit = runAuditJson();

    expect(audit.mechanism).toMatchObject({
      selfProposal: expect.any(Array),
      selfReview: expect.any(Array),
      selfStrengthening: expect.any(Array)
    });
    expect(audit.mechanism.selfProposal.length).toBeGreaterThanOrEqual(3);
    expect(audit.mechanism.selfReview.length).toBeGreaterThanOrEqual(3);
    expect(audit.mechanism.selfStrengthening.length).toBeGreaterThanOrEqual(3);

    expect(audit.blocking).toEqual([]);
    expect(audit.passed.length).toBeGreaterThanOrEqual(15);
    expect(audit.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(audit.passed.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'left-palette-spans-status-depth',
        'status-layer-under-canvas-only',
        'status-actions-have-runtime',
        'status-runtime-accepts-events',
        'simulation-summary-feeds-result-performance-views',
        'technical-typography-tokens',
        'status-metrics-structured-typography',
        'model-check-feeds-status-stream',
        'canvas-toolbar-command-contract',
        'canvas-command-history-wraps-edits',
        'canvas-command-listeners-clean-up',
        'right-inspector-removes-improvement-guide',
        'critical-fragments-have-clean-chinese-copy'
      ])
    );
  });

  it('documents how to run the repeatable UI review process', () => {
    const doc = readFileSync(path.join(repoRoot, 'docs', 'ui-quality-improvement-loop.md'), 'utf8');

    expect(doc).toContain('npm run audit:ui');
    expect(doc).toContain('自提意见');
    expect(doc).toContain('自审核');
    expect(doc).toContain('自强化');
    expect(doc).toContain('底部状态层');
  });
});
