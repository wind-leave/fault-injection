import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readWorkspaceFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('diagnostic testpoint workbench contract', () => {
  it('keeps diagnostic installs globally while returning only the active scoped points', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');
    const functionStart = runtime.indexOf('function ensureDiagnosticTestPointState(points=null)');
    const guardIndex = runtime.indexOf('diagnosticTestPointModelSignature', functionStart);
    const preserveIndex = runtime.indexOf('S.installedDiagnosticTestPointIds=Array.from(new Set(S.installedDiagnosticTestPointIds.filter(Boolean)))', functionStart);
    const scopedIndex = runtime.indexOf('scopedInstalledDiagnosticPointIds=S.installedDiagnosticTestPointIds.filter', functionStart);
    const defaultIndex = runtime.indexOf('getDiagnosticPointDefaults(semanticPointsForState)', functionStart);
    const returnIndex = runtime.indexOf('return scopedInstalledDiagnosticPointIds;', functionStart);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(functionStart);
    expect(preserveIndex).toBeGreaterThan(guardIndex);
    expect(scopedIndex).toBeGreaterThan(preserveIndex);
    expect(defaultIndex).toBeGreaterThan(scopedIndex);
    expect(returnIndex).toBeGreaterThan(defaultIndex);
  });

  it('renders installed diagnostic points back onto the canvas edge layer', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');

    expect(runtime).toContain('function renderCanvasDiagnosticTestPointMarkers()');
    expect(runtime).toContain("document.getElementById('edge-layer')");
    expect(runtime).toContain("data-canvas-testpoint-marker");
    expect(runtime).toContain('renderCanvasDiagnosticTestPointMarkers();');
  });

  it('keeps the diagnosis workbench compact and removes long instructional copy', () => {
    const css = readWorkspaceFile('src/styles/components.css');

    expect(css).toContain('.dataflow-workspace--diagnosis .dataflow-diagnosis-header h3');
    expect(css).toContain('display: none');
    expect(css).toContain('.dataflow-workspace--diagnosis .testpoint-card h3');
    expect(css).toContain('font-size: 17px;');
  });

  it('exposes demo fault injection and removal hooks', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');
    const demo = JSON.parse(readWorkspaceFile('public/demo/uav_fault_diagnostic_demo.json'));

    expect(runtime).toContain('window.loadUavFaultDiagnosticDemo');
    expect(runtime).toContain('window.injectAllDemoFaults');
    expect(runtime).toContain('function renderUavDemoControls()');
    expect(runtime).toContain('window.removeInjectedFault=removeInjectedFault');
    expect(runtime).toContain('window.clearInjectedFaults');
    expect(demo.faultLibrary.length).toBeGreaterThanOrEqual(8);
    expect(demo.testPoints.length).toBeGreaterThanOrEqual(8);
    demo.faultLibrary.forEach((fault) => {
      const detectable = demo.testPoints.some((point) => point.detects.includes(fault.id));
      expect(detectable).toBe(true);
    });
  });

  it('installs the compact diagnosis console and fault selection cancel controls', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');
    const css = readWorkspaceFile('src/styles/components.css');

    expect(runtime).toContain('installCompactFaultDiagnosisConsole');
    expect(runtime).toContain('data-clear-selected-fault-catalog');
    expect(runtime).toContain('window.addDiagnosticTestPoint=function');
    expect(runtime).toContain('window.detectDiagnosticTestPoint=function');
    expect(runtime).toContain('window.clearDiagnosticTestPoints=function');
    expect(css).toContain('.tp-console');
    expect(css).toContain('.compact-clear-fault-selection');
  });

  it('distinguishes multiple Gyro fault forms at the diagnostic matrix level', () => {
    const demo = JSON.parse(readWorkspaceFile('public/model-packages/evtol_closed_loop_fault_demo.json'));
    const rows = demo.diagnosticModel.dMatrix.rows;
    const byFault = new Map(rows.map((row) => [row.faultId, row]));

    const fixed = byFault.get('gyro_zero_bias_offset');
    const drift = byFault.get('gyro_zero_bias_drift');
    const intermittent = byFault.get('gyro_zero_bias_intermittent');

    expect(fixed.targetId).toBe('node-imu');
    expect(drift.targetId).toBe('node-imu');
    expect(intermittent.targetId).toBe('node-imu');

    expect(fixed.points.M3.detectable).toBe(true);
    expect(drift.points.M3.detectable).toBe(true);
    expect(intermittent.points.M3.detectable).toBe(true);
    expect(fixed.points.M10.detectable).toBe(false);
    expect(drift.points.M10.detectable).toBe(true);
    expect(intermittent.points.M10.detectable).toBe(true);
    expect(fixed.points.M11.detectable).toBe(false);
    expect(intermittent.points.M11.detectable).toBe(true);
    expect(intermittent.points.M11.signature).toContain('间歇');
  });
});
