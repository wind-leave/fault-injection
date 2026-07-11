import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlightModelPackage } from '../src/services/flightModelPackageService.js';
import { mount } from '@vue/test-utils';
import { afterEach } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packagePath = path.join(rootDir, 'public', 'model-packages', 'evtol-small-flight-control-fault-display.json');

function readPackage() {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function mockNextJsonFileSelection(fileText) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
    Object.defineProperty(this, 'files', {
      configurable: true,
      value: [
        {
          name: 'evtol-small-flight-control-fault-display.json',
          text: async () => fileText
        }
      ]
    });
    this.onchange?.(new Event('change'));
  });
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

describe('eVTOL small flight-control fault display package', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    __resetLegacyRuntimeForTests();
  });

  it('is a valid flight-control package with an eVTOL display topology', () => {
    const pkg = readPackage();
    const validation = validateFlightModelPackage(pkg);

    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(pkg.modelId).toBe('evtol-small-flight-control-fault-display');
    expect(pkg.packageType).toBe('flight-control-model');

    const nodes = pkg.workbenchSnapshot.modelNodes;
    const edges = pkg.workbenchSnapshot.modelEdges;
    const nodeIds = new Set(nodes.map((node) => node.id));

    expect(nodes.filter((node) => node.type === 'signal_source')).toHaveLength(3);
    expect(nodes.filter((node) => node.type === 'instrument_scope')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'instrument_logger')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'instrument_spectrum')).toHaveLength(1);
    expect(nodes.filter((node) => node.props?.moduleType === 'rotor_motor')).toHaveLength(8);
    expect([...nodeIds]).toEqual(expect.arrayContaining([
      'node-pid-controller',
      'node-control-allocation',
      'node-motor-actuator',
      'node-aero-moment',
      'node-six-dof',
      'node-sensor-fault-injection'
    ]));

    edges.forEach((edge) => {
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
      expect(nodeIds.has(edge.targetNodeId)).toBe(true);
    });
    expect(edges.filter((edge) => edge.lineType === 'can').length).toBeGreaterThanOrEqual(9);
    expect(edges.some((edge) => edge.id === 'edge-sensor-feedback-can')).toBe(true);
  });

  it('exposes fault injection slots for sensors, controller, power, motors, and airframe dynamics', () => {
    const pkg = readPackage();
    const capabilityByTarget = new Map(pkg.faultCapabilityMap.map((entry) => [entry.targetId, entry]));

    expect(capabilityByTarget.get('node-sensor-fault-injection')?.faultSlots.map((slot) => slot.slotId)).toEqual(expect.arrayContaining([
      'electrical:imu_gyro_bias',
      'electrical:imu_noise',
      'electrical:sensor_freeze'
    ]));
    expect(capabilityByTarget.get('node-voltage-drop')?.faultSlots.map((slot) => slot.slotId)).toContain('physical:bus_voltage_drop');
    expect(capabilityByTarget.get('node-pid-controller')?.faultSlots.map((slot) => slot.slotId)).toContain('physical:controller_gain');
    expect(capabilityByTarget.get('node-six-dof')?.faultSlots.map((slot) => slot.slotId)).toContain('physical:airframe_inertia');
    expect(capabilityByTarget.get('edge-sensor-feedback-can')?.faultSlots.map((slot) => slot.slotId)).toContain('protocol:sensor_feedback_can');

    for (let index = 1; index <= 8; index += 1) {
      const slots = capabilityByTarget.get(`node-rotor-${index}`)?.faultSlots.map((slot) => slot.slotId);
      expect(slots).toEqual(expect.arrayContaining([
        `physical:rotor_${index}_efficiency`,
        `physical:rotor_${index}_lock`
      ]));
    }
  });

  it('imports through the legacy runtime bridge and renders the canvas state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = readPackage();
    const result = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(result).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: pkg.modelId,
      modelName: pkg.modelName
    });
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(pkg.workbenchSnapshot.modelNodes.length);
    expect(window.__GZ_STATE__.modelEdges).toHaveLength(pkg.workbenchSnapshot.modelEdges.length);
    expect(document.getElementById('b-node-sensor-fault-injection')).not.toBeNull();

    wrapper.unmount();
  });

  it('imports through the local JSON file picker entry point', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = readPackage();
    mockNextJsonFileSelection(JSON.stringify(pkg));
    const result = await window.doImportSys();
    await flushRuntime();

    expect(result).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: pkg.modelId,
      modelName: pkg.modelName
    });
    expect(document.getElementById('b-node-sensor-fault-injection')).not.toBeNull();

    wrapper.unmount();
  });

  it('keeps node python bindings lean and stores source only once in pythonModules', () => {
    const pkg = readPackage();
    const packageSizeBytes = fs.statSync(packagePath).size;
    const simulationNodes = pkg.workbenchSnapshot.modelNodes.filter((node) => node.type === 'simulation_block');

    expect(packageSizeBytes).toBeLessThan(300000);
    expect(pkg.pythonModules.every((module) => typeof module.source === 'string' && module.source.includes('def process'))).toBe(true);
    expect(pkg.pythonModules.every((module) => module.parsedInterface?.rawSource === undefined)).toBe(true);
    simulationNodes.forEach((node) => {
      expect(node.pythonBinding).toMatchObject({
        bound: true,
        moduleId: expect.any(String),
        fileName: expect.any(String)
      });
      expect(node.pythonBinding.rawSource).toBeUndefined();
      expect(node.pythonBinding.parsedInterface).toBeUndefined();
      expect(node.pythonBinding.portMapping).toBeUndefined();
    });
  });

  it('does not expose backend-managed dt or state as user-visible module inputs', () => {
    const pkg = readPackage();
    const moduleById = new Map(pkg.pythonModules.map((module) => [module.moduleId, module]));
    const hiddenRuntimeInputNames = ['dt', 'state'];

    ['pid_controller', 'rotor_motor', 'six_dof'].forEach((moduleId) => {
      const inputNames = moduleById.get(moduleId)?.parsedInterface?.inputs?.map((input) => input.name) ?? [];

      hiddenRuntimeInputNames.forEach((name) => {
        expect(inputNames).not.toContain(name);
      });
    });
  });

  it('does not include preset diagnostic test points', () => {
    const pkg = readPackage();

    expect(pkg.diagnosticModel?.testPoints ?? []).toEqual([]);
    expect(pkg.diagnosticModel?.dMatrix?.columns ?? []).toEqual([]);
    expect(pkg.workbenchSnapshot?.diagnosticTestPoints ?? []).toEqual([]);
    expect(pkg.workbenchSnapshot?.testPoints ?? []).toEqual([]);
    expect(pkg.workbenchSnapshot?.installedDiagnosticTestPointIds ?? []).toEqual([]);
  });
});
