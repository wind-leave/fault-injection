import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('IBM design-md workbench refresh', () => {
  it('keeps the selected design document and applies the final visual override layer', () => {
    const designDocPath = path.join(repoRoot, 'docs', 'design-md', 'ibm', 'DESIGN.md');
    const cssPath = path.join(repoRoot, 'src', 'styles', 'ibm-workbench.css');
    const mainJs = readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');

    expect(existsSync(designDocPath)).toBe(true);
    expect(existsSync(cssPath)).toBe(true);
    const legacyIndex = mainJs.indexOf("import './styles/console-redesign.css';");
    const ibmIndex = mainJs.indexOf("import './styles/ibm-workbench.css';");
    expect(legacyIndex).toBeGreaterThan(-1);
    expect(ibmIndex).toBeGreaterThan(legacyIndex);

    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('--blue:#0f62fe');
    expect(css).toContain('--text:#161616');
    expect(css).toContain('IBM Plex Sans');
    expect(css).toContain('border-radius:0');
  });
});
