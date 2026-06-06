import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = ['components.css', 'dialogs.css', 'console-redesign.css', 'ibm-workbench.css']
  .map((fileName) => readFileSync(path.join(repoRoot, 'src', 'styles', fileName), 'utf8'))
  .join('\n');

function cssBlock(selector) {
  const start = css.indexOf(`${selector}{`);
  if (start === -1) return '';
  const bodyStart = css.indexOf('{', start) + 1;
  const bodyEnd = css.indexOf('}', bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

describe('authoring dialog layout contract', () => {
  it('keeps long authoring forms scrollable between a fixed header and footer', () => {
    expect(cssBlock('.authoring-modal')).toMatch(/height\s*:/);
    expect(cssBlock('.authoring-modal .authoring-modal__body')).toMatch(/flex\s*:\s*1\s+1\s+auto/);
    expect(cssBlock('.authoring-modal .authoring-modal__body')).toMatch(/min-height\s*:\s*0/);
    expect(cssBlock('.authoring-modal .authoring-modal__body')).toMatch(/overflow-y\s*:\s*auto/);
  });

  it('overrides the shared modal body overflow rule with a more specific authoring selector', () => {
    expect(cssBlock('.mbody')).toMatch(/overflow\s*:\s*hidden/);
    expect(cssBlock('.authoring-modal .authoring-modal__body')).toMatch(/overflow-y\s*:\s*auto/);
  });
});
