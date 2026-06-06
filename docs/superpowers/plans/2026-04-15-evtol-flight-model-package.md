# eVTOL Flight Model Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable platform subproject that imports, exports, reloads, and runs a self-contained eVTOL flight-control model package from a single JSON file.

**Architecture:** Keep package parsing, validation, and package assembly in a dedicated JavaScript service so the legacy runtime only performs UI orchestration. Add a lightweight local Python backend that executes embedded module source from the package, then author the first eVTOL reference package on top of that reusable mechanism.

**Tech Stack:** Vue 3, Vitest, native browser File/Blob APIs, JavaScript ESM services, Python standard library HTTP server, embedded Python source strings in JSON

---

## File Structure

- Create: `src/services/flightModelPackageService.js`
  - Validate package schema
  - Normalize embedded module registry
  - Build exportable package JSON from current snapshot state
- Modify: `src/composables/useWorkbenchState.js`
  - Extend `pythonBinding` metadata with package-aware fields
- Modify: `src/services/workbenchSnapshotService.js`
  - Persist and restore new package-aware binding fields
- Modify: `src/services/legacyRuntimeBootstrap.js`
  - Expose model-package service functions to the legacy runtime
- Modify: `src/services/legacy-runtime.txt`
  - Replace localStorage-only import/save behavior with real JSON file import/export
  - Track active model-package metadata and package fault library state
- Create: `tests/flight-model-package.spec.js`
  - Unit tests for package validation and export assembly
- Create: `tests/flight-model-package-app.spec.js`
  - App-level import/export integration tests through the window bridge
- Modify: `tests/python-binding.spec.js`
  - Cover backend-mode handoff through the execution adapter
- Create: `tools/python_model_runner/__init__.py`
- Create: `tools/python_model_runner/runtime.py`
  - Execute embedded package source in a constrained namespace
- Create: `tools/python_model_runner/server.py`
  - Local `/api/python-flow/execute` endpoint
- Create: `tools/python_model_runner/test_runtime.py`
  - Unit tests for payload execution and failure cases
- Create: `model-authoring/evtol_small_nonlinear/modules/imu_gyro.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/imu_accel.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/barometer.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/gps_velocity.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/attitude_pid.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/control_allocation.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/motor_model.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/vehicle_dynamics.py`
- Create: `model-authoring/evtol_small_nonlinear/package-meta.json`
- Create: `model-authoring/evtol_small_nonlinear/fault-library.json`
- Create: `model-authoring/evtol_small_nonlinear/workbench-snapshot.json`
- Create: `tools/flight_model_package/build_evtol_package.mjs`
  - Generate `public/model-packages/evtol_small_nonlinear.json`
- Create: `public/model-packages/evtol_small_nonlinear.json`
- Modify: `README.md`
  - Document model-package workflow and Python runner startup

### Task 1: Add package-aware binding metadata and package service

**Files:**
- Create: `src/services/flightModelPackageService.js`
- Modify: `src/composables/useWorkbenchState.js`
- Modify: `src/services/workbenchSnapshotService.js`
- Create: `tests/flight-model-package.spec.js`

- [ ] **Step 1: Write the failing package-service test**

Create `tests/flight-model-package.spec.js` with a schema-validation test and an export-assembly test:

```js
import { describe, expect, it } from 'vitest';
import {
  validateFlightModelPackage,
  buildFlightModelPackage
} from '../src/services/flightModelPackageService.js';

const VALID_PACKAGE = {
  schemaVersion: 1,
  packageType: 'flight-control-model',
  modelId: 'evtol-small-nonlinear',
  modelName: 'eVTOL Small Nonlinear Flight Control',
  description: 'eVTOL flight-control model',
  source: {
    origin: 'manual-from-slx',
    slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
    notesDoc: '常见飞控模型故障梳理(1).docx'
  },
  pythonModules: [
    {
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      category: 'controllers',
      source: 'def process(error, dt=0.01):\\n    return error',
      parsedInterface: { inputs: [], outputs: [], middleVars: [] }
    }
  ],
  faultLibrary: [],
  workbenchSnapshot: {
    version: 1,
    modelNodes: [],
    modelEdges: [],
    nodeSeq: 0,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  }
};

describe('flightModelPackageService', () => {
  it('validates a self-contained flight model package', () => {
    expect(validateFlightModelPackage(VALID_PACKAGE)).toEqual({ ok: true, errors: [] });
    expect(validateFlightModelPackage({ packageType: 'wrong' }).ok).toBe(false);
  });

  it('builds an export package from snapshot state and embedded bindings', () => {
    const pkg = buildFlightModelPackage({
      meta: {
        modelId: 'evtol-small-nonlinear',
        modelName: 'eVTOL Small Nonlinear Flight Control',
        description: 'eVTOL flight-control model',
        source: VALID_PACKAGE.source
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            props: { name: 'Attitude PID' },
            pythonBinding: {
              bound: true,
              moduleId: 'attitude_pid',
              fileName: 'attitude_pid.py',
              moduleName: 'attitude_pid',
              sourcePackageId: 'evtol-small-nonlinear',
              entryFunction: 'process',
              rawSource: 'def process(error, dt=0.01):\\n    return error',
              parsedInterface: { inputs: [], outputs: [], middleVars: [] },
              portMapping: { inputs: [], outputs: [], middleVars: [] }
            }
          }
        ],
        modelEdges: [],
        nodeSeq: 1,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(pkg.pythonModules).toHaveLength(1);
    expect(pkg.pythonModules[0]).toMatchObject({
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process'
    });
  });
});
```

- [ ] **Step 2: Run the new service test to verify failure**

Run: `npm test -- --run tests/flight-model-package.spec.js`

Expected: FAIL with `Cannot find module '../src/services/flightModelPackageService.js'` or missing exports.

- [ ] **Step 3: Implement the package service and package-aware binding defaults**

Create `src/services/flightModelPackageService.js` and extend `src/composables/useWorkbenchState.js` plus `src/services/workbenchSnapshotService.js`:

```js
// src/services/flightModelPackageService.js
const FLIGHT_MODEL_SCHEMA_VERSION = 1;
const FLIGHT_MODEL_PACKAGE_TYPE = 'flight-control-model';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeModule(module) {
  return {
    moduleId: String(module?.moduleId ?? '').trim(),
    fileName: String(module?.fileName ?? '').trim(),
    entryFunction: String(module?.entryFunction ?? 'process').trim() || 'process',
    category: String(module?.category ?? 'uncategorized').trim() || 'uncategorized',
    source: String(module?.source ?? ''),
    parsedInterface: clone(module?.parsedInterface ?? { inputs: [], outputs: [], middleVars: [] })
  };
}

export function validateFlightModelPackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') errors.push('package must be an object');
  if (pkg?.schemaVersion !== FLIGHT_MODEL_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (pkg?.packageType !== FLIGHT_MODEL_PACKAGE_TYPE) errors.push('unsupported packageType');
  if (!Array.isArray(pkg?.pythonModules)) errors.push('pythonModules must be an array');
  if (!pkg?.workbenchSnapshot || typeof pkg.workbenchSnapshot !== 'object') errors.push('workbenchSnapshot is required');
  for (const mod of pkg?.pythonModules ?? []) {
    const normalized = normalizeModule(mod);
    if (!normalized.moduleId) errors.push('pythonModules[].moduleId is required');
    if (!normalized.fileName) errors.push('pythonModules[].fileName is required');
    if (!normalized.source) errors.push(`pythonModules[${normalized.moduleId || 'unknown'}].source is required`);
  }
  return { ok: errors.length === 0, errors };
}

export function buildFlightModelPackage({ meta, snapshot, faultLibrary }) {
  const moduleMap = new Map();
  for (const node of snapshot.modelNodes ?? []) {
    if (node.type !== 'simulation_block' || !node.pythonBinding?.bound) continue;
    const binding = node.pythonBinding;
    moduleMap.set(binding.moduleId, normalizeModule({
      moduleId: binding.moduleId,
      fileName: binding.fileName,
      entryFunction: binding.entryFunction,
      category: binding.moduleCategory ?? 'uncategorized',
      source: binding.rawSource,
      parsedInterface: binding.parsedInterface
    }));
  }
  return {
    schemaVersion: FLIGHT_MODEL_SCHEMA_VERSION,
    packageType: FLIGHT_MODEL_PACKAGE_TYPE,
    modelId: meta.modelId,
    modelName: meta.modelName,
    description: meta.description,
    source: clone(meta.source),
    pythonModules: [...moduleMap.values()],
    faultLibrary: clone(faultLibrary ?? []),
    workbenchSnapshot: clone(snapshot)
  };
}
```

```js
// src/composables/useWorkbenchState.js
export function createDefaultPythonBinding() {
  return {
    bound: false,
    moduleId: null,
    moduleCategory: null,
    sourcePackageId: null,
    sourcePackageName: null,
    fileName: null,
    moduleName: null,
    description: '',
    entryFunction: null,
    parsedInterface: null,
    rawSource: '',
    executionMode: 'mock',
    executionConfig: {
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 3000
    },
    portMapping: {
      inputs: [],
      outputs: [],
      middleVars: []
    }
  };
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npm test -- --run tests/flight-model-package.spec.js`

Expected: PASS

- [ ] **Step 5: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 2: Bridge real JSON package import and export into the legacy runtime

**Files:**
- Modify: `src/services/flightModelPackageService.js`
- Modify: `src/services/legacyRuntimeBootstrap.js`
- Modify: `src/services/legacy-runtime.txt`
- Create: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing app integration test for package import and export**

Create `tests/flight-model-package-app.spec.js`:

```js
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

const PACKAGE_FIXTURE = {
  schemaVersion: 1,
  packageType: 'flight-control-model',
  modelId: 'evtol-small-nonlinear',
  modelName: 'eVTOL Small Nonlinear Flight Control',
  description: 'authoring fixture',
  source: { origin: 'test' },
  pythonModules: [
    {
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      category: 'controllers',
      source: 'def process(error, dt=0.01):\\n    return error',
      parsedInterface: {
        fileName: 'attitude_pid.py',
        moduleName: 'attitude_pid',
        description: 'attitude pid',
        entryFunction: 'process',
        inputs: [
          { name: 'error', type: 'float', default: null, comment: 'error' },
          { name: 'dt', type: 'float', default: '0.01', comment: 'step' }
        ],
        outputs: [{ name: 'output_0', type: 'float', comment: 'command' }],
        middleVars: []
      }
    }
  ],
  faultLibrary: [
    {
      id: 'gyro_bias',
      name: 'Gyro Bias',
      blockTypes: ['simulation_block'],
      moduleTargets: ['attitude_pid']
    }
  ],
  workbenchSnapshot: {
    version: 1,
    modelNodes: [
      {
        id: 'node-1',
        type: 'simulation_block',
        x: 420,
        y: 280,
        props: { name: 'Attitude PID' },
        pythonBinding: {
          bound: true,
          moduleId: 'attitude_pid',
          moduleCategory: 'controllers',
          sourcePackageId: 'evtol-small-nonlinear',
          sourcePackageName: 'eVTOL Small Nonlinear Flight Control',
          fileName: 'attitude_pid.py',
          moduleName: 'attitude_pid',
          description: 'attitude pid',
          entryFunction: 'process',
          rawSource: 'def process(error, dt=0.01):\\n    return error',
          parsedInterface: {
            fileName: 'attitude_pid.py',
            moduleName: 'attitude_pid',
            description: 'attitude pid',
            entryFunction: 'process',
            inputs: [
              { name: 'error', type: 'float', default: null, comment: 'error' },
              { name: 'dt', type: 'float', default: '0.01', comment: 'step' }
            ],
            outputs: [{ name: 'output_0', type: 'float', comment: 'command' }],
            middleVars: [],
            rawSource: 'def process(error, dt=0.01):\\n    return error'
          },
          executionMode: 'backend',
          executionConfig: {
            endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
            timeoutMs: 3000
          },
          portMapping: {
            inputs: [
              { portId: 'input-0', varName: 'error', displayName: 'error', type: 'float', default: null, connected: false },
              { portId: 'input-1', varName: 'dt', displayName: 'dt', type: 'float', default: '0.01', connected: false }
            ],
            outputs: [
              { portId: 'output-0', varName: 'output_0', displayName: 'output_0', type: 'float', connected: false }
            ],
            middleVars: []
          }
        }
      }
    ],
    modelEdges: [],
    nodeSeq: 1,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  }
};

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

describe('flight model package app integration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('imports a package object through the bootstrap bridge and exports the same model family', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_FLIGHT_MODEL_PACKAGE__?.importObject).toBe('function');
    expect(typeof window.__GZ_FLIGHT_MODEL_PACKAGE__?.exportCurrent).toBe('function');

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
    await flushRuntime();

    expect(importResult.ok).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: 'evtol-small-nonlinear',
      modelName: 'eVTOL Small Nonlinear Flight Control'
    });
    expect(window.__GZ_STATE__.availableFaultModels).toHaveLength(1);

    const exported = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(exported.modelId).toBe('evtol-small-nonlinear');
    expect(exported.pythonModules[0].moduleId).toBe('attitude_pid');
    expect(exported.workbenchSnapshot.modelNodes[0].pythonBinding.sourcePackageId).toBe('evtol-small-nonlinear');

    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run the new app test to verify failure**

Run: `npm test -- --run tests/flight-model-package-app.spec.js`

Expected: FAIL because `window.__GZ_FLIGHT_MODEL_PACKAGE__` does not exist and no package import/export bridge is mounted.

- [ ] **Step 3: Extend the package service with import/export helpers**

Update `src/services/flightModelPackageService.js`:

```js
import { restoreWorkbenchSnapshot } from './workbenchSnapshotService.js';

export function createFlightModelPackageDescriptor(pkg) {
  return {
    modelId: pkg.modelId,
    modelName: pkg.modelName,
    description: pkg.description ?? '',
    schemaVersion: pkg.schemaVersion,
    packageType: pkg.packageType,
    moduleCount: pkg.pythonModules.length,
    faultCount: (pkg.faultLibrary ?? []).length
  };
}

export function applyFlightModelPackage(pkg) {
  const validation = validateFlightModelPackage(pkg);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const snapshot = restoreWorkbenchSnapshot(pkg.workbenchSnapshot);
  return {
    ok: true,
    snapshot,
    descriptor: createFlightModelPackageDescriptor(pkg),
    faultLibrary: clone(pkg.faultLibrary ?? []),
    pythonModules: clone(pkg.pythonModules ?? [])
  };
}

export function exportFlightModelPackage({ meta, state, faultLibrary }) {
  return buildFlightModelPackage({
    meta,
    snapshot: state,
    faultLibrary
  });
}
```

- [ ] **Step 4: Expose the package bridge from the bootstrap layer**

Update `src/services/legacyRuntimeBootstrap.js`:

```js
import runtimeSource from './legacy-runtime.txt?raw';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from './workbenchSnapshotService.js';
import {
  applyFlightModelPackage,
  exportFlightModelPackage,
  validateFlightModelPackage
} from './flightModelPackageService.js';

let mounted = false;

function getPackageMetaFromState(state) {
  const active = state?.activeModelPackage ?? {};
  return {
    modelId: active.modelId ?? 'workbench-ad-hoc-model',
    modelName: active.modelName ?? 'Workbench Ad Hoc Model',
    description: active.description ?? 'Exported from current workbench state',
    source: active.source ?? { origin: 'workbench-export' }
  };
}

export function mountLegacyRuntime() {
  if (mounted || window.__GZ_LEGACY_RUNTIME_BOOTED__) {
    return;
  }

  window.__GZ_WORKBENCH_SNAPSHOT__ = {
    createWorkbenchSnapshot,
    restoreWorkbenchSnapshot
  };

  window.__GZ_FLIGHT_MODEL_PACKAGE__ = {
    validate: validateFlightModelPackage,
    importObject(pkg) {
      const result = applyFlightModelPackage(pkg);
      if (!result.ok) {
        return result;
      }
      if (typeof window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__ === 'function') {
        window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg, result);
      }
      return result;
    },
    exportCurrent() {
      return exportFlightModelPackage({
        meta: getPackageMetaFromState(window.__GZ_STATE__),
        state: createWorkbenchSnapshot(window.__GZ_STATE__),
        faultLibrary: window.__GZ_STATE__?.availableFaultModels ?? []
      });
    }
  };

  window.eval(`${runtimeSource}\n//# sourceURL=gz-legacy-runtime.js`);
  window.__GZ_LEGACY_RUNTIME_BOOTED__ = true;
  mounted = true;
}

export function __resetLegacyRuntimeForTests() {
  mounted = false;
  delete window.__GZ_LEGACY_RUNTIME_BOOTED__;
  delete window.__GZ_WORKBENCH_SNAPSHOT__;
  delete window.__GZ_FLIGHT_MODEL_PACKAGE__;
  delete window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__;
}
```

- [ ] **Step 5: Make the legacy runtime consume package import/export instead of localStorage-only snapshots**

Patch `src/services/legacy-runtime.txt` where the runtime is initialized and where `doImportSys` / `doSaveSys` are overridden:

```js
S.activeModelPackage = null;
S.availableFaultModels = S.availableFaultModels || [];

window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__ = function applyFlightModelPackageToLegacyState(pkg, prepared) {
  const restored = prepared?.snapshot || window.__GZ_WORKBENCH_SNAPSHOT__.restoreWorkbenchSnapshot(pkg.workbenchSnapshot);
  S.modelNodes = restored.modelNodes;
  S.modelEdges = restored.modelEdges;
  S.nodeSeq = restored.nodeSeq;
  S.edgeSeq = restored.edgeSeq;
  S.activeLineType = restored.activeLineType;
  S.faultedBlks = restored.faultedBlks;
  S.importedFaultModels = restored.importedFaultModels;
  S.availableFaultModels = prepared?.faultLibrary || pkg.faultLibrary || [];
  S.activeModelPackage = {
    modelId: pkg.modelId,
    modelName: pkg.modelName,
    description: pkg.description || '',
    source: pkg.source || null
  };
  renderAll();
  toast('已导入飞控模型包', '成功');
};

const __legacyDoImportSys = doImportSys;
doImportSys = async function doImportSysPackageAware() {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const result = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
      if (!result.ok) {
        toast(`模型包校验失败：${result.errors.join('；')}`, '错误');
      }
    } catch (error) {
      toast(`模型包导入失败：${error.message}`, '错误');
    }
  });
  picker.click();
};

doSaveSys = function doSaveSysPackageAware() {
  const pkg = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${pkg.modelId || 'flight-model'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast('系统模型已导出为 JSON 模型包', '成功');
};
```

- [ ] **Step 6: Run the app integration test to verify it passes**

Run: `npm test -- --run tests/flight-model-package-app.spec.js`

Expected: PASS

- [ ] **Step 7: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 4: Author the first eVTOL reference package and generate the importable JSON

**Files:**
- Modify: `tests/flight-model-package.spec.js`
- Create: `model-authoring/evtol_small_nonlinear/modules/imu_gyro.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/imu_accel.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/barometer.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/gps_velocity.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/attitude_pid.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/control_allocation.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/motor_model.py`
- Create: `model-authoring/evtol_small_nonlinear/modules/vehicle_dynamics.py`
- Create: `model-authoring/evtol_small_nonlinear/package-meta.json`
- Create: `model-authoring/evtol_small_nonlinear/fault-library.json`
- Create: `model-authoring/evtol_small_nonlinear/workbench-snapshot.json`
- Create: `tools/flight_model_package/build_evtol_package.mjs`
- Create: `public/model-packages/evtol_small_nonlinear.json`

- [ ] **Step 1: Extend the package-service test with a real reference-package assertion**

Append to `tests/flight-model-package.spec.js`:

```js
import evtolReferencePackage from '../public/model-packages/evtol_small_nonlinear.json';

it('ships a reusable eVTOL reference package', () => {
  const validation = validateFlightModelPackage(evtolReferencePackage);

  expect(validation).toEqual({ ok: true, errors: [] });
  expect(evtolReferencePackage.pythonModules.map((item) => item.moduleId)).toEqual([
    'imu_gyro',
    'imu_accel',
    'barometer',
    'gps_velocity',
    'attitude_pid',
    'control_allocation',
    'motor_model',
    'vehicle_dynamics'
  ]);
  expect(evtolReferencePackage.faultLibrary.length).toBeGreaterThanOrEqual(5);
  expect(evtolReferencePackage.workbenchSnapshot.modelNodes.length).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: Run the package test to verify failure**

Run: `npm test -- --run tests/flight-model-package.spec.js`

Expected: FAIL because `public/model-packages/evtol_small_nonlinear.json` does not exist yet.

- [ ] **Step 3: Create the four sensor-side authoring modules**

Create these files:

```python
# model-authoring/evtol_small_nonlinear/modules/imu_gyro.py
"""
Module: imu_gyro
Description: Gyro sensing with optional bias injection
"""

def process(body_rate: float, bias: float = 0.0, scale: float = 1.0):
    # @observable
    measured_rate = (body_rate + bias) * scale  # 中间变量：gyro measurement
    return measured_rate
```

```python
# model-authoring/evtol_small_nonlinear/modules/imu_accel.py
"""
Module: imu_accel
Description: Accelerometer sensing with scale distortion
"""

def process(vertical_accel: float, scale: float = 1.0, offset: float = 0.0):
    # @observable
    measured_accel = vertical_accel * scale + offset  # 中间变量：accel measurement
    return measured_accel
```

```python
# model-authoring/evtol_small_nonlinear/modules/barometer.py
"""
Module: barometer
Description: Barometric altitude channel with drift
"""

def process(altitude: float, drift: float = 0.0):
    # @observable
    estimated_altitude = altitude + drift  # 中间变量：baro estimate
    return estimated_altitude
```

```python
# model-authoring/evtol_small_nonlinear/modules/gps_velocity.py
"""
Module: gps_velocity
Description: GPS velocity channel with freeze latch
"""

def process(true_velocity: float, frozen_value: float = 0.0, freeze: float = 0.0):
    # @observable
    reported_velocity = frozen_value if freeze >= 1.0 else true_velocity  # 中间变量：gps report
    return reported_velocity
```

- [ ] **Step 4: Create the controller, allocator, actuator, and dynamics authoring modules**

Create these files:

```python
# model-authoring/evtol_small_nonlinear/modules/attitude_pid.py
"""
Module: attitude_pid
Description: Simplified attitude PID control block
"""

def process(attitude_error: float, rate_feedback: float, dt: float = 0.01, kp: float = 1.2, ki: float = 0.25, kd: float = 0.08):
    # @observable
    integral_state = attitude_error * dt  # 中间变量：integral state
    # @observable
    derivative_state = -rate_feedback * kd  # 中间变量：derivative term
    command = kp * attitude_error + ki * integral_state + derivative_state
    return command
```

```python
# model-authoring/evtol_small_nonlinear/modules/control_allocation.py
"""
Module: control_allocation
Description: Convert total thrust and roll command into left and right motor references
"""

def process(total_thrust: float, roll_command: float):
    # @observable
    left_cmd = total_thrust * 0.5 - roll_command * 0.5  # 中间变量：left motor command
    # @observable
    right_cmd = total_thrust * 0.5 + roll_command * 0.5  # 中间变量：right motor command
    return left_cmd, right_cmd
```

```python
# model-authoring/evtol_small_nonlinear/modules/motor_model.py
"""
Module: motor_model
Description: Motor efficiency and saturation model
"""

def process(left_cmd: float, right_cmd: float, efficiency: float = 1.0, saturation: float = 20.0):
    # @observable
    left_thrust = min(max(left_cmd * efficiency, 0.0), saturation)  # 中间变量：left thrust
    # @observable
    right_thrust = min(max(right_cmd * efficiency, 0.0), saturation)  # 中间变量：right thrust
    return left_thrust, right_thrust
```

```python
# model-authoring/evtol_small_nonlinear/modules/vehicle_dynamics.py
"""
Module: vehicle_dynamics
Description: Reduced-order vertical and roll dynamics
"""

def process(left_thrust: float, right_thrust: float, mass: float = 8.0, drag: float = 0.12):
    total_thrust = left_thrust + right_thrust
    # @observable
    roll_moment = right_thrust - left_thrust  # 中间变量：roll moment
    vertical_accel = total_thrust / max(mass, 0.1) - drag
    return vertical_accel, roll_moment
```

- [ ] **Step 5: Create package metadata, fault library, and the authoring snapshot**

Create `model-authoring/evtol_small_nonlinear/package-meta.json`:

```json
{
  "schemaVersion": 1,
  "packageType": "flight-control-model",
  "modelId": "evtol-small-nonlinear",
  "modelName": "eVTOL Small Nonlinear Flight Control",
  "description": "Manually decomposed eVTOL flight-control reference package derived from the Simulink validation model",
  "source": {
    "origin": "manual-from-slx",
    "slxFile": "eVTOL_Small_nonandlin_algorithm_validation.slx",
    "notesDoc": "常见飞控模型故障梳理(1).docx"
  }
}
```

Create `model-authoring/evtol_small_nonlinear/fault-library.json`:

```json
[
  { "id": "gyro_bias", "name": "陀螺偏置", "moduleTargets": ["imu_gyro"], "parameter": "bias", "defaultValue": 0.15 },
  { "id": "accel_scale", "name": "加速度计比例失真", "moduleTargets": ["imu_accel"], "parameter": "scale", "defaultValue": 1.25 },
  { "id": "baro_drift", "name": "气压计漂移", "moduleTargets": ["barometer"], "parameter": "drift", "defaultValue": 2.0 },
  { "id": "gps_freeze", "name": "GPS 冻结", "moduleTargets": ["gps_velocity"], "parameter": "freeze", "defaultValue": 1.0 },
  { "id": "attitude_kp_anomaly", "name": "姿态控制比例增益异常", "moduleTargets": ["attitude_pid"], "parameter": "kp", "defaultValue": 2.4 },
  { "id": "motor_efficiency_loss", "name": "电机效率下降", "moduleTargets": ["motor_model"], "parameter": "efficiency", "defaultValue": 0.55 },
  { "id": "motor_lock", "name": "电机卡死", "moduleTargets": ["motor_model"], "parameter": "efficiency", "defaultValue": 0.0 },
  { "id": "motor_thrust_saturation", "name": "推力饱和收缩", "moduleTargets": ["motor_model"], "parameter": "saturation", "defaultValue": 8.0 },
  { "id": "uav_mass_shift", "name": "质量参数偏差", "moduleTargets": ["vehicle_dynamics"], "parameter": "mass", "defaultValue": 11.0 },
  { "id": "drag_coefficient_jump", "name": "阻力系数突变", "moduleTargets": ["vehicle_dynamics"], "parameter": "drag", "defaultValue": 0.35 }
]
```

Create `model-authoring/evtol_small_nonlinear/workbench-snapshot.json`:

```json
{
  "version": 1,
  "modelNodes": [
    { "id": "node-1", "type": "signal_source", "x": 80, "y": 120, "props": { "name": "Attitude Error", "equation": "0.6" } },
    { "id": "node-2", "type": "signal_source", "x": 80, "y": 260, "props": { "name": "True Velocity", "equation": "1.2" } },
    { "id": "node-3", "type": "simulation_block", "x": 280, "y": 80, "props": { "name": "IMU Gyro" }, "pythonBinding": { "bound": true, "moduleId": "imu_gyro", "moduleCategory": "sensors", "fileName": "imu_gyro.py" } },
    { "id": "node-4", "type": "simulation_block", "x": 280, "y": 200, "props": { "name": "Barometer" }, "pythonBinding": { "bound": true, "moduleId": "barometer", "moduleCategory": "sensors", "fileName": "barometer.py" } },
    { "id": "node-5", "type": "simulation_block", "x": 280, "y": 320, "props": { "name": "GPS Velocity" }, "pythonBinding": { "bound": true, "moduleId": "gps_velocity", "moduleCategory": "sensors", "fileName": "gps_velocity.py" } },
    { "id": "node-6", "type": "simulation_block", "x": 520, "y": 120, "props": { "name": "Attitude PID" }, "pythonBinding": { "bound": true, "moduleId": "attitude_pid", "moduleCategory": "controllers", "fileName": "attitude_pid.py" } },
    { "id": "node-7", "type": "simulation_block", "x": 760, "y": 120, "props": { "name": "Control Allocation" }, "pythonBinding": { "bound": true, "moduleId": "control_allocation", "moduleCategory": "allocation", "fileName": "control_allocation.py" } },
    { "id": "node-8", "type": "simulation_block", "x": 1000, "y": 120, "props": { "name": "Motor Model" }, "pythonBinding": { "bound": true, "moduleId": "motor_model", "moduleCategory": "actuators", "fileName": "motor_model.py" } },
    { "id": "node-9", "type": "simulation_block", "x": 1240, "y": 120, "props": { "name": "Vehicle Dynamics" }, "pythonBinding": { "bound": true, "moduleId": "vehicle_dynamics", "moduleCategory": "dynamics", "fileName": "vehicle_dynamics.py" } },
    { "id": "node-10", "type": "instrument_scope", "x": 1480, "y": 80, "props": { "name": "Dynamics Scope" } },
    { "id": "node-11", "type": "instrument_scope", "x": 1480, "y": 240, "props": { "name": "Sensor Scope" } },
    { "id": "node-12", "type": "simulation_block", "x": 280, "y": 440, "props": { "name": "IMU Accel" }, "pythonBinding": { "bound": true, "moduleId": "imu_accel", "moduleCategory": "sensors", "fileName": "imu_accel.py" } }
  ],
  "modelEdges": [
    { "id": "edge-1", "from": "node-1", "to": "node-6", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-2", "from": "node-3", "to": "node-6", "fromPortId": "output-0", "toPortId": "input-1", "lineType": "normal" },
    { "id": "edge-3", "from": "node-6", "to": "node-7", "fromPortId": "output-0", "toPortId": "input-1", "lineType": "normal" },
    { "id": "edge-4", "from": "node-4", "to": "node-7", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-5", "from": "node-7", "to": "node-8", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-6", "from": "node-7", "to": "node-8", "fromPortId": "output-1", "toPortId": "input-1", "lineType": "normal" },
    { "id": "edge-7", "from": "node-8", "to": "node-9", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-8", "from": "node-8", "to": "node-9", "fromPortId": "output-1", "toPortId": "input-1", "lineType": "normal" },
    { "id": "edge-9", "from": "node-9", "to": "node-10", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-10", "from": "node-9", "to": "node-10", "fromPortId": "output-1", "toPortId": "input-1", "lineType": "normal" },
    { "id": "edge-11", "from": "node-12", "to": "node-11", "fromPortId": "output-0", "toPortId": "input-0", "lineType": "normal" },
    { "id": "edge-12", "from": "node-5", "to": "node-11", "fromPortId": "output-0", "toPortId": "input-1", "lineType": "normal" }
  ],
  "nodeSeq": 12,
  "edgeSeq": 12,
  "activeLineType": "normal",
  "faultedBlks": [],
  "importedFaultModels": []
}
```

- [ ] **Step 6: Add the package builder and generate the runtime JSON artifact**

Create `tools/flight_model_package/build_evtol_package.mjs`:

```js
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePythonBindingSource } from '../../src/services/pythonParserService.js';
import { buildFlightModelPackage } from '../../src/services/flightModelPackageService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const authoringDir = path.join(rootDir, 'model-authoring', 'evtol_small_nonlinear');
const modulesDir = path.join(authoringDir, 'modules');
const outputDir = path.join(rootDir, 'public', 'model-packages');
const outputFile = path.join(outputDir, 'evtol_small_nonlinear.json');

function createPortItems(items, prefix) {
  return items.map((item, index) => ({
    portId: `${prefix}-${index}`,
    varName: item.name,
    displayName: item.name,
    type: item.type,
    default: item.default ?? null,
    connected: false
  }));
}

function createBinding(moduleId, category, parsed) {
  return {
    bound: true,
    moduleId,
    moduleCategory: category,
    sourcePackageId: 'evtol-small-nonlinear',
    sourcePackageName: 'eVTOL Small Nonlinear Flight Control',
    fileName: parsed.fileName,
    moduleName: parsed.moduleName,
    description: parsed.description,
    entryFunction: parsed.entryFunction,
    parsedInterface: parsed,
    rawSource: parsed.rawSource,
    executionMode: 'backend',
    executionConfig: {
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 3000
    },
    portMapping: {
      inputs: createPortItems(parsed.inputs, 'input'),
      outputs: createPortItems(parsed.outputs, 'output'),
      middleVars: createPortItems(parsed.middleVars, 'middle')
    }
  };
}

const meta = JSON.parse(await readFile(path.join(authoringDir, 'package-meta.json'), 'utf8'));
const faultLibrary = JSON.parse(await readFile(path.join(authoringDir, 'fault-library.json'), 'utf8'));
const snapshot = JSON.parse(await readFile(path.join(authoringDir, 'workbench-snapshot.json'), 'utf8'));
const files = (await readdir(modulesDir)).filter((name) => name.endsWith('.py')).sort();

const parsedModules = new Map();
for (const fileName of files) {
  const source = await readFile(path.join(modulesDir, fileName), 'utf8');
  const parsed = parsePythonBindingSource({ fileName, source });
  parsedModules.set(parsed.moduleName, parsed);
}

snapshot.modelNodes = snapshot.modelNodes.map((node) => {
  if (node.type !== 'simulation_block' || !node.pythonBinding?.moduleId) {
    return node;
  }
  const parsed = parsedModules.get(node.pythonBinding.moduleId);
  return {
    ...node,
    pythonBinding: createBinding(node.pythonBinding.moduleId, node.pythonBinding.moduleCategory, parsed)
  };
});

const pkg = buildFlightModelPackage({
  meta,
  snapshot,
  faultLibrary
});

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`wrote ${outputFile}`);
```

Run: `node tools/flight_model_package/build_evtol_package.mjs`

Expected: writes `public/model-packages/evtol_small_nonlinear.json`

- [ ] **Step 7: Run the reference-package test to verify it passes**

Run: `npm test -- --run tests/flight-model-package.spec.js`

Expected: PASS

- [ ] **Step 8: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 5: Surface package status in the UI, document the workflow, and run full verification

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `tests/flight-model-package-app.spec.js`
- Modify: `tests/python-binding-app.spec.js`
- Modify: `README.md`

- [ ] **Step 1: Extend the app tests to cover package status and imported binding metadata**

Append to `tests/flight-model-package-app.spec.js`:

```js
it('shows imported package metadata in the selected simulation-block inspector', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
  await flushRuntime();

  window.selectNode('node-1');
  await flushRuntime();

  const inspector = document.getElementById('pd');
  const status = document.getElementById('model-package-status');
  expect(inspector?.textContent).toContain('来源模型包');
  expect(inspector?.textContent).toContain('eVTOL Small Nonlinear Flight Control');
  expect(inspector?.textContent).toContain('执行模式');
  expect(inspector?.textContent).toContain('backend');
  expect(status?.textContent).toContain('eVTOL Small Nonlinear Flight Control');
  expect(status?.textContent).toContain('backend');

  wrapper.unmount();
});
```

Append to `tests/python-binding-app.spec.js`:

```js
it('keeps backend execution mode when a package-authored simulation block is imported', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
  pkg.modelId = 'package-reimport';
  pkg.modelName = 'Package Reimport';
  pkg.workbenchSnapshot.modelNodes = [
    {
      id: 'node-9',
      type: 'simulation_block',
      x: 420,
      y: 320,
      props: { name: 'Package Node' },
      pythonBinding: createSimulationBlockPythonBinding(parsedInterface, {
        executionMode: 'backend',
        moduleId: 'attitude_pid',
        moduleCategory: 'controllers',
        sourcePackageId: 'package-reimport',
        sourcePackageName: 'Package Reimport'
      })
    }
  ];
  pkg.pythonModules = [
    {
      moduleId: 'attitude_pid',
      fileName: 'pid_controller.py',
      entryFunction: 'process',
      category: 'controllers',
      source: parsedInterface.rawSource,
      parsedInterface
    }
  ];

  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
  await flushRuntime();

  expect(importResult.ok).toBe(true);
  expect(window.__GZ_STATE__.modelNodes[0].pythonBinding.executionMode).toBe('backend');
  expect(window.__GZ_STATE__.modelNodes[0].pythonBinding.sourcePackageId).toBe('package-reimport');

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the app tests to verify failure**

Run:

```bash
npm test -- --run tests/flight-model-package-app.spec.js
npm test -- --run tests/python-binding-app.spec.js
```

Expected: FAIL because the inspector does not yet render package metadata consistently after import.

- [ ] **Step 3: Surface package metadata and runtime mode in the legacy inspector**

Patch the simulation-block inspector branch inside `src/services/legacy-runtime.txt`:

```js
function ensureModelPackageStatus() {
  let status = document.getElementById('model-package-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'model-package-status';
    status.className = 'model-package-status';
    document.body.appendChild(status);
  }
  const active = S.activeModelPackage || {};
  const selected = S.modelNodes.find((item) => item.id === S.sel);
  const mode = selected?.pythonBinding?.executionMode || 'mock';
  status.textContent = `当前模型包：${active.modelName || '未加载'} · 执行模式：${mode}`;
}

function renderPythonBindingSummary(node) {
  const binding = node.pythonBinding || {};
  const packageName = binding.sourcePackageName || S.activeModelPackage?.modelName || '未关联模型包';
  const executionMode = binding.executionMode || 'mock';
  return `
    <div class="form-row">
      <label>来源模型包</label>
      <div class="value-text">${packageName}</div>
    </div>
    <div class="form-row">
      <label>模块 ID</label>
      <div class="value-text">${binding.moduleId || '未绑定'}</div>
    </div>
    <div class="form-row">
      <label>执行模式</label>
      <div class="value-text">${executionMode}</div>
    </div>
  `;
}

// inside the selected simulation_block panel branch
panelHtml += renderPythonBindingSummary(node);
ensureModelPackageStatus();
```

- [ ] **Step 4: Document the new model-package workflow in the README**

Append to `README.md`:

````md
## 飞控模型包工作流

### 1. 生成参考 eVTOL 模型包

```bash
node tools/flight_model_package/build_evtol_package.mjs
```

输出文件：

- `public/model-packages/evtol_small_nonlinear.json`

### 2. 启动本地 Python 执行服务

```bash
python tools/python_model_runner/server.py
```

默认监听：

- `http://127.0.0.1:8765/api/python-flow/execute`

### 3. 在平台中导入模型包

- 点击“导入系统模型”
- 选择 `public/model-packages/evtol_small_nonlinear.json`
- 导入后画布会恢复 eVTOL 飞控主链路、Python 绑定和故障库

### 4. 导出当前模型包

- 点击“保存系统模型”
- 平台会导出当前工作区的单文件 JSON 模型包
- 导出的 JSON 可再次导入，恢复同一套节点、连线、绑定与故障定义
````

- [ ] **Step 5: Run the full project verification suite**

Run:

```bash
python -m unittest tools.python_model_runner.test_runtime -v
npm test -- --run tests/flight-model-package.spec.js
npm test -- --run tests/flight-model-package-app.spec.js
npm test -- --run tests/python-binding.spec.js
npm test -- --run tests/python-binding-app.spec.js
npm test -- --run
npm run build
```

Expected:
- all targeted tests PASS
- full Vitest suite PASS
- build PASS

- [ ] **Step 6: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 3: Add a lightweight Python runner and backend handoff

**Files:**
- Create: `tools/python_model_runner/__init__.py`
- Create: `tools/python_model_runner/runtime.py`
- Create: `tools/python_model_runner/server.py`
- Create: `tools/python_model_runner/test_runtime.py`
- Modify: `tests/python-binding.spec.js`

- [ ] **Step 1: Write the failing Python runner tests**

Create `tools/python_model_runner/test_runtime.py`:

```python
import unittest

from tools.python_model_runner.runtime import execute_payload


class PythonModelRunnerTests(unittest.TestCase):
    def test_executes_embedded_module_source(self):
        payload = {
            "entryFunction": "process",
            "inputs": {"error": 0.5, "dt": 0.1},
            "outputNames": ["output_0"],
            "middleVarNames": ["half_error"],
            "source": "\n".join(
                [
                    "def process(error, dt=0.1):",
                    "    half_error = error * 0.5",
                    "    return error + dt, {'half_error': half_error}",
                ]
            ),
        }

        result = execute_payload(payload)

        self.assertAlmostEqual(result["outputs"]["output_0"], 0.6)
        self.assertAlmostEqual(result["middleVars"]["half_error"], 0.25)

    def test_rejects_import_statements(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": [],
            "source": "\n".join(
                [
                    "import os",
                    "def process():",
                    "    return 1",
                ]
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "import statements are not allowed"):
            execute_payload(payload)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the Python runner tests to verify failure**

Run: `python -m unittest tools.python_model_runner.test_runtime -v`

Expected: FAIL with `ModuleNotFoundError` because `tools.python_model_runner.runtime` does not exist yet.

- [ ] **Step 3: Implement the constrained in-process runner**

Create `tools/python_model_runner/runtime.py` and `tools/python_model_runner/__init__.py`:

```python
# tools/python_model_runner/runtime.py
from __future__ import annotations

import ast
from typing import Any


ALLOWED_BUILTINS = {
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "len": len,
    "range": range,
    "float": float,
    "int": int,
    "bool": bool,
    "round": round,
}


def _validate_source(source: str) -> None:
    tree = ast.parse(source, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise RuntimeError("import statements are not allowed")


def _normalize_outputs(result: Any, output_names: list[str], middle_names: list[str]) -> dict[str, Any]:
    outputs: dict[str, Any] = {}
    middle_vars: dict[str, Any] = {}

    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], dict):
        raw_outputs, raw_middle = result
    else:
        raw_outputs, raw_middle = result, {}

    if isinstance(raw_outputs, tuple):
        output_values = list(raw_outputs)
    elif isinstance(raw_outputs, list):
        output_values = raw_outputs
    else:
        output_values = [raw_outputs]

    for index, name in enumerate(output_names):
        outputs[name] = output_values[index] if index < len(output_values) else 0

    for name in middle_names:
        middle_vars[name] = raw_middle.get(name, 0)

    return {"outputs": outputs, "middleVars": middle_vars}


def execute_payload(payload: dict[str, Any]) -> dict[str, Any]:
    source = str(payload.get("source", ""))
    if not source.strip():
        raise RuntimeError("source is required")

    _validate_source(source)

    globals_dict = {"__builtins__": ALLOWED_BUILTINS.copy()}
    locals_dict: dict[str, Any] = {}
    exec(source, globals_dict, locals_dict)

    entry_name = str(payload.get("entryFunction", "process"))
    entry = locals_dict.get(entry_name) or globals_dict.get(entry_name)
    if not callable(entry):
        raise RuntimeError(f"entry function not found: {entry_name}")

    inputs = dict(payload.get("inputs", {}))
    result = entry(**inputs)
    return _normalize_outputs(
        result,
        list(payload.get("outputNames", [])),
        list(payload.get("middleVarNames", [])),
    )
```

```python
# tools/python_model_runner/__init__.py
from .runtime import execute_payload

__all__ = ["execute_payload"]
```

- [ ] **Step 4: Expose the local backend endpoint**

Create `tools/python_model_runner/server.py`:

```python
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tools.python_model_runner.runtime import execute_payload


class PythonFlowHandler(BaseHTTPRequestHandler):
    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._write_json(200, {"ok": True})

    def do_POST(self) -> None:
        if self.path != "/api/python-flow/execute":
            self.send_error(404, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
            result = execute_payload(payload)
            self._write_json(200, result)
        except Exception as error:  # noqa: BLE001
            self._write_json(400, {"error": str(error)})


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    server = ThreadingHTTPServer((host, port), PythonFlowHandler)
    print(f"Python model runner listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
```

- [ ] **Step 5: Add the failing frontend adapter test for backend mode**

Append to `tests/python-binding.spec.js`:

```js
it('posts embedded source to the backend in backend mode', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      outputs: { output_0: 0.75 },
      middleVars: { integral: 0.25 }
    })
  });

  const result = await executePythonBinding({
    adapterMode: 'backend',
    endpoint: '/api/python-flow/execute',
    payload: {
      nodeId: 'node-1',
      moduleName: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      source: 'def process(error, dt=0.01):\\n    return error',
      inputs: { error: 0.5, dt: 0.01 },
      outputNames: ['output_0'],
      middleVarNames: ['integral']
    },
    fetchImpl
  });

  expect(fetchImpl).toHaveBeenCalledWith(
    '/api/python-flow/execute',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
  );
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
    moduleName: 'attitude_pid',
    source: 'def process(error, dt=0.01):\\n    return error'
  });
  expect(result.outputs.output_0).toBe(0.75);
  expect(result.middleVars.integral).toBe(0.25);
});
```

- [ ] **Step 6: Run the runner and adapter tests to verify they pass**

Run:

```bash
python -m unittest tools.python_model_runner.test_runtime -v
npm test -- --run tests/python-binding.spec.js
```

Expected:
- Python unittest PASS
- Vitest PASS

- [ ] **Step 7: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.
