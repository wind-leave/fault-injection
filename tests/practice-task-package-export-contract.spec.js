import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readWorkspaceFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('practice task package export integration contract', () => {
  it('exposes the package builder before the legacy runtime is evaluated', () => {
    const bootstrap = readWorkspaceFile('src/services/legacyRuntimeBootstrap.js');
    const exposeIndex = bootstrap.indexOf('window.__GZ_PRACTICE_TASK_PACKAGE__ = practiceTaskPackageService;');
    const evalIndex = bootstrap.indexOf('window.eval(`${runtimeSource}');

    expect(bootstrap).toContain("import * as practiceTaskPackageService from './practiceTaskPackageService.js';");
    expect(exposeIndex).toBeGreaterThanOrEqual(0);
    expect(evalIndex).toBeGreaterThan(exposeIndex);
  });

  it('builds save-result JSON through the public/private task package service', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');
    const functionStart = runtime.indexOf('async function buildSimulationResultSnapshot()');
    const functionEnd = runtime.indexOf('\nfunction downloadSimulationResultJson', functionStart);
    const implementation = runtime.slice(functionStart, functionEnd);

    expect(implementation).toContain('window.__GZ_BACKEND_SIMULATION__?.buildExecutablePackage');
    expect(implementation).toContain('window.__GZ_PRACTICE_TASK_PACKAGE__?.buildPracticeTaskPackage');
    expect(implementation).toContain('await ensureSelectedPracticeFaultPlans()');
    expect(implementation).toContain('practiceFaults');
    expect(implementation).toContain('dMatrix');
    expect(implementation).toContain('duration:SIM.duration');
    expect(implementation).toContain('stepSize:SIM.stepSize');
    expect(implementation).toContain('simulationConfig:{duration:SIM.duration,stepSize:SIM.stepSize}');
    expect(implementation).not.toContain("kind:'simulation-result'");
  });

  it('loads an uncached selected-fault plan before exporting', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');

    expect(runtime).toContain('window.ensureBackendTroubleshootingPlan=async function');
    expect(runtime).toContain('await Promise.all(selectedIds.map(faultId=>ensurePlan(faultId)))');
    expect(runtime).toContain('const result=await buildSimulationResultSnapshot();');
  });
});
