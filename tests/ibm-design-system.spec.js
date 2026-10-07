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

  it('uses distinct signal-port styling for inputs and outputs', () => {
    const css = readFileSync(path.join(repoRoot, 'src', 'styles', 'ibm-workbench.css'), 'utf8');

    expect(css).toContain('.node-port--input:not(.node-port--power)');
    expect(css).toContain('color:#3f73a8 !important');
    expect(css).toContain('.node-port--output:not(.node-port--power)');
    expect(css).toContain('color:#3f8864 !important');
    expect(css).toContain('transform:rotate(45deg)');
  });

  it('aligns labels by the terminal side when signal directions are reversed', () => {
    const css = readFileSync(path.join(repoRoot, 'src', 'styles', 'ibm-workbench.css'), 'utf8');

    expect(css).toContain('.node-port--output.node-port--left .node-port__label');
    expect(css).toContain('.node-port--input.node-port--right .node-port__label');
    expect(css).toContain('right:20px;');
    expect(css).toContain('left:20px;');
    expect(css).toContain('margin-right:0 !important;');
    expect(css).toContain('margin-left:0 !important;');
  });

  it('routes reversed signal ports by their physical side', () => {
    const runtime = readFileSync(path.join(repoRoot, 'src', 'services', 'legacy-runtime.txt'), 'utf8');

    expect(runtime).toContain("if(side==='left') return {x:port.x-bend,y:port.y+routeOffset};");
    expect(runtime).toContain('an output configured on the left must depart to the left');
  });
});
