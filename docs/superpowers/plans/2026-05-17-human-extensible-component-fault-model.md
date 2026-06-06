# Human Extensible Component Fault Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice for human-authored components and human-authored component faults, using component fault slots as the source of truth for injection compatibility.

**Architecture:** Add focused authoring services for package normalization, component templates, fault definitions, fault capabilities, and diagnostic detectability. Then bridge those services into the existing legacy canvas runtime so the current demo can still run while new authoring data becomes the canonical model.

**Tech Stack:** Vue 3, Vite, Vitest, Vue Test Utils, existing legacy runtime bridge in `src/services/legacy-runtime.txt`, JSON model packages in `public/model-packages`.

---

## Scope Check

The design includes schema, Python binding, component authoring, fault authoring, runtime injection, and diagnostics. This plan implements them as one vertical slice because the features depend on a shared data contract: a component declares `faultSlots`, a fault type is attached to a slot, and injection creates a `faultInstance`. The plan avoids a broad visual redesign and focuses on data correctness plus minimal UI entry points.

## File Structure

- Create `src/services/authoringModelService.js`: schema 3.0 package normalization and immutable upsert helpers.
- Create `src/services/componentAuthoringService.js`: create component templates and canvas nodes from parsed Python interfaces.
- Create `src/services/faultAuthoringService.js`: create fault types, attach them to target slots, create and remove fault instances.
- Create `src/services/diagnosticAuthoringService.js`: create detectability rows and D-matrix rows from authored faults and measurement points.
- Modify `src/services/legacy-runtime.txt`: consume the authoring services through a small bridge, keep canvas behavior compatible with current state shape.
- Modify `src/components/dialogs/PythonBindingDialog.vue`: expose parsed interface payload in a form that component authoring can reuse.
- Create `src/components/dialogs/ComponentAuthoringDialog.vue`: minimal dialog for naming a component and confirming parsed Python interfaces.
- Create `src/components/dialogs/FaultAuthoringDialog.vue`: minimal dialog for adding a fault type to a selected target slot.
- Modify `src/App.vue` and `src/composables/useDialogsState.js`: mount the new dialogs and manage dialog state.
- Add tests:
  - `tests/authoring-model-service.spec.js`
  - `tests/component-authoring-service.spec.js`
  - `tests/fault-authoring-service.spec.js`
  - `tests/diagnostic-authoring-service.spec.js`
  - extend `tests/flight-model-package-app.spec.js`
  - extend `tests/property-panel-app.spec.js`

---

### Task 1: Authoring Package Schema Service

**Files:**
- Create: `src/services/authoringModelService.js`
- Test: `tests/authoring-model-service.spec.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/authoring-model-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  createEmptyAuthoringPackage,
  normalizeAuthoringPackage,
  upsertById
} from '../src/services/authoringModelService.js';

describe('authoringModelService', () => {
  it('creates an empty schema 3 authoring package with separated model layers', () => {
    const pkg = createEmptyAuthoringPackage({
      modelId: 'demo-authoring-model',
      modelName: '人工建模 Demo'
    });

    expect(pkg.schemaVersion).toBe('3.0');
    expect(pkg.modelInfo.modelId).toBe('demo-authoring-model');
    expect(pkg.modelInfo.modelName).toBe('人工建模 Demo');
    expect(pkg.componentTemplates).toEqual([]);
    expect(pkg.systemModel.nodes).toEqual([]);
    expect(pkg.systemModel.edges).toEqual([]);
    expect(pkg.faultTypeCatalog).toEqual([]);
    expect(pkg.faultCapabilityMap).toEqual([]);
    expect(pkg.faultInstances).toEqual([]);
    expect(pkg.diagnosticModel.testPoints).toEqual([]);
    expect(pkg.diagnosticModel.detectabilityMatrix).toEqual([]);
    expect(pkg.pythonModules).toEqual([]);
  });

  it('normalizes legacy flat package fields into schema 3 sections', () => {
    const legacy = {
      schemaVersion: 2,
      modelId: 'legacy-demo',
      modelName: '旧模型',
      nodes: [{ id: 'node-a', displayName: '节点 A' }],
      edges: [{ id: 'edge-a-b', sourceNodeId: 'node-a', targetNodeId: 'node-b' }],
      faultLibrary: [{ id: 'bias_fault', displayName: '偏差故障' }],
      faultCapabilityMap: [{ targetId: 'node-a', targetKind: 'node', faultSlots: [] }],
      faultInstances: [{ instanceId: 'fault-inst-1', active: true }],
      testPoints: [{ testPointId: 'M1', displayName: '测点 M1' }],
      detectabilityMatrix: [{ faultTypeId: 'bias_fault', testPointId: 'M1', detectable: true }],
      pythonModules: [{ moduleId: 'controller' }]
    };

    const pkg = normalizeAuthoringPackage(legacy);

    expect(pkg.schemaVersion).toBe('3.0');
    expect(pkg.modelInfo.modelId).toBe('legacy-demo');
    expect(pkg.systemModel.nodes).toHaveLength(1);
    expect(pkg.systemModel.edges).toHaveLength(1);
    expect(pkg.faultTypeCatalog[0].id).toBe('bias_fault');
    expect(pkg.faultCapabilityMap[0].targetId).toBe('node-a');
    expect(pkg.faultInstances[0].instanceId).toBe('fault-inst-1');
    expect(pkg.diagnosticModel.testPoints[0].testPointId).toBe('M1');
    expect(pkg.diagnosticModel.detectabilityMatrix[0].detectable).toBe(true);
    expect(pkg.pythonModules[0].moduleId).toBe('controller');
  });

  it('upserts records by id without mutating the original list', () => {
    const original = [{ id: 'a', value: 1 }];
    const next = upsertById(original, { id: 'a', value: 2 });
    const appended = upsertById(next, { id: 'b', value: 3 });

    expect(original).toEqual([{ id: 'a', value: 1 }]);
    expect(next).toEqual([{ id: 'a', value: 2 }]);
    expect(appended).toEqual([
      { id: 'a', value: 2 },
      { id: 'b', value: 3 }
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm test -- tests\authoring-model-service.spec.js --run
```

Expected: fail because `src/services/authoringModelService.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/services/authoringModelService.js`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function createEmptyAuthoringPackage({ modelId = 'untitled-model', modelName = '未命名模型' } = {}) {
  return {
    schemaVersion: '3.0',
    packageType: 'flight-control-model',
    modelInfo: {
      modelId: text(modelId, 'untitled-model'),
      modelName: text(modelName, '未命名模型')
    },
    componentTemplates: [],
    systemModel: {
      nodes: [],
      edges: []
    },
    faultTypeCatalog: [],
    faultCapabilityMap: [],
    faultInstances: [],
    diagnosticModel: {
      testPoints: [],
      detectabilityMatrix: []
    },
    pythonModules: []
  };
}

export function normalizeAuthoringPackage(rawPackage = {}) {
  const base = createEmptyAuthoringPackage({
    modelId: rawPackage.modelInfo?.modelId ?? rawPackage.modelId,
    modelName: rawPackage.modelInfo?.modelName ?? rawPackage.modelName
  });

  return {
    ...base,
    ...clone(rawPackage),
    schemaVersion: '3.0',
    modelInfo: {
      ...base.modelInfo,
      ...(clone(rawPackage.modelInfo) ?? {}),
      modelId: text(rawPackage.modelInfo?.modelId ?? rawPackage.modelId, base.modelInfo.modelId),
      modelName: text(rawPackage.modelInfo?.modelName ?? rawPackage.modelName, base.modelInfo.modelName)
    },
    componentTemplates: array(rawPackage.componentTemplates).map(clone),
    systemModel: {
      nodes: array(rawPackage.systemModel?.nodes ?? rawPackage.nodes ?? rawPackage.workbenchSnapshot?.modelNodes).map(clone),
      edges: array(rawPackage.systemModel?.edges ?? rawPackage.edges ?? rawPackage.workbenchSnapshot?.modelEdges).map(clone)
    },
    faultTypeCatalog: array(rawPackage.faultTypeCatalog ?? rawPackage.faultLibrary ?? rawPackage.faultTypes).map(clone),
    faultCapabilityMap: array(rawPackage.faultCapabilityMap).map(clone),
    faultInstances: array(rawPackage.faultInstances).map(clone),
    diagnosticModel: {
      testPoints: array(rawPackage.diagnosticModel?.testPoints ?? rawPackage.testPoints).map(clone),
      detectabilityMatrix: array(rawPackage.diagnosticModel?.detectabilityMatrix ?? rawPackage.detectabilityMatrix).map(clone)
    },
    pythonModules: array(rawPackage.pythonModules).map(clone)
  };
}

export function upsertById(list, record, idKey = 'id') {
  const next = array(list).map(clone);
  const recordId = record?.[idKey];
  if (!recordId) {
    throw new Error(`Missing ${idKey}`);
  }
  const index = next.findIndex((item) => item?.[idKey] === recordId);
  if (index >= 0) {
    next[index] = clone(record);
    return next;
  }
  return [...next, clone(record)];
}
```

- [ ] **Step 4: Verify Task 1 passes**

Run:

```powershell
npm test -- tests\authoring-model-service.spec.js --run
```

Expected: all tests in `authoring-model-service.spec.js` pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src\services\authoringModelService.js tests\authoring-model-service.spec.js
git commit -m "feat: add authoring package schema service"
```

---

### Task 2: Component Template Authoring Service

**Files:**
- Create: `src/services/componentAuthoringService.js`
- Test: `tests/component-authoring-service.spec.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/component-authoring-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  addFaultSlotToComponentTemplate,
  createComponentTemplateFromPython,
  createNodeFromComponentTemplate
} from '../src/services/componentAuthoringService.js';

const parsedInterface = {
  fileName: 'attitude_controller.py',
  moduleName: 'attitude_controller',
  description: '姿态控制器',
  entryFunction: 'process',
  inputs: [
    { name: 'attitude_error', displayName: '姿态误差', type: 'float', comment: '姿态误差' },
    { name: 'rate_feedback', displayName: '角速度反馈', type: 'float', comment: '角速度反馈' }
  ],
  outputs: [
    { name: 'output_0', displayName: '力矩指令', type: 'float', comment: '力矩指令' }
  ],
  middleVars: [
    { name: 'control_error', displayName: '控制误差', type: 'float', comment: '控制误差' }
  ],
  rawSource: 'def process(attitude_error, rate_feedback): return attitude_error'
};

describe('componentAuthoringService', () => {
  it('creates a reusable component template from parsed Python', () => {
    const template = createComponentTemplateFromPython({
      templateId: 'attitude-controller',
      displayName: '姿态控制器',
      category: '控制模块',
      geometry: 'rect',
      parsedInterface
    });

    expect(template.templateId).toBe('attitude-controller');
    expect(template.displayName).toBe('姿态控制器');
    expect(template.pythonBinding.fileName).toBe('attitude_controller.py');
    expect(template.ports.inputs.map((item) => item.displayName)).toEqual(['姿态误差', '角速度反馈']);
    expect(template.ports.outputs[0].signalId).toBe('attitude_controller.output_0');
    expect(template.stateVariables[0].displayName).toBe('控制误差');
    expect(template.faultSlots).toEqual([]);
  });

  it('adds a fault slot without mutating the original template', () => {
    const template = createComponentTemplateFromPython({
      templateId: 'attitude-controller',
      displayName: '姿态控制器',
      parsedInterface
    });

    const next = addFaultSlotToComponentTemplate(template, {
      slotId: 'controller-output',
      displayName: '控制输出',
      kind: 'output_signal',
      signalId: 'attitude_controller.output_0',
      allowedFaultTypeIds: ['output_bias']
    });

    expect(template.faultSlots).toEqual([]);
    expect(next.faultSlots).toHaveLength(1);
    expect(next.faultSlots[0].displayName).toBe('控制输出');
  });

  it('creates a canvas node instance from a component template', () => {
    const template = addFaultSlotToComponentTemplate(createComponentTemplateFromPython({
      templateId: 'attitude-controller',
      displayName: '姿态控制器',
      category: '控制模块',
      parsedInterface
    }), {
      slotId: 'controller-output',
      displayName: '控制输出',
      kind: 'output_signal',
      signalId: 'attitude_controller.output_0',
      allowedFaultTypeIds: ['output_bias']
    });

    const node = createNodeFromComponentTemplate(template, {
      id: 'node-attitude-controller',
      x: 320,
      y: 240
    });

    expect(node.id).toBe('node-attitude-controller');
    expect(node.props.name).toBe('姿态控制器');
    expect(node.props.outputs[0].name).toBe('力矩指令');
    expect(node.faultSlots[0].slotId).toBe('controller-output');
    expect(node.pythonBinding.bound).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
npm test -- tests\component-authoring-service.spec.js --run
```

Expected: fail because `componentAuthoringService.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/services/componentAuthoringService.js`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toSignalId(moduleName, item, index) {
  return text(item.signalId, `${moduleName}.${item.name || `signal_${index}`}`);
}

function mapPort(moduleName, item, index) {
  return {
    id: item.id || `${item.name || `port_${index}`}`,
    name: text(item.displayName ?? item.comment ?? item.name, item.name || `端口 ${index + 1}`),
    displayName: text(item.displayName ?? item.comment ?? item.name, item.name || `端口 ${index + 1}`),
    signalId: toSignalId(moduleName, item, index),
    type: item.type || 'float',
    unit: item.unit || ''
  };
}

export function createComponentTemplateFromPython({
  templateId,
  displayName,
  category = '仿真模块',
  geometry = 'rect',
  parsedInterface
}) {
  if (!templateId) {
    throw new Error('Missing templateId');
  }
  if (!parsedInterface?.entryFunction) {
    throw new Error('Missing parsed Python entry function');
  }

  const moduleName = text(parsedInterface.moduleName, templateId);
  return {
    templateId,
    type: 'simulation_block',
    displayName: text(displayName, parsedInterface.description || templateId),
    category,
    geometry,
    pythonBinding: {
      bound: true,
      moduleId: moduleName,
      moduleName,
      fileName: parsedInterface.fileName,
      entryFunction: parsedInterface.entryFunction,
      parsedInterface: clone(parsedInterface)
    },
    ports: {
      inputs: array(parsedInterface.inputs).map((item, index) => mapPort(moduleName, item, index)),
      outputs: array(parsedInterface.outputs).map((item, index) => mapPort(moduleName, item, index))
    },
    parameters: array(parsedInterface.inputs)
      .filter((item) => item.default !== null && item.default !== undefined)
      .map((item) => ({
        id: item.name,
        displayName: text(item.displayName ?? item.comment ?? item.name, item.name),
        type: item.type || 'float',
        default: item.default
      })),
    stateVariables: array(parsedInterface.middleVars).map((item, index) => ({
      id: item.name || `state_${index}`,
      displayName: text(item.displayName ?? item.comment ?? item.name, item.name || `状态 ${index + 1}`),
      type: item.type || 'float',
      unit: item.unit || ''
    })),
    faultSlots: []
  };
}

export function addFaultSlotToComponentTemplate(template, slot) {
  if (!slot?.slotId) {
    throw new Error('Missing slotId');
  }
  const slots = array(template.faultSlots).filter((item) => item.slotId !== slot.slotId);
  return {
    ...clone(template),
    faultSlots: [...slots, clone({
      slotId: slot.slotId,
      displayName: slot.displayName || slot.slotName || slot.slotId,
      slotName: slot.slotName || slot.displayName || slot.slotId,
      kind: slot.kind || 'output_signal',
      bindVariable: slot.bindVariable || '',
      signalId: slot.signalId || '',
      allowedFaultTypeIds: array(slot.allowedFaultTypeIds)
    })]
  };
}

export function createNodeFromComponentTemplate(template, { id, x = 0, y = 0 } = {}) {
  if (!id) {
    throw new Error('Missing node id');
  }
  return {
    id,
    templateId: template.templateId,
    type: template.type || 'simulation_block',
    x,
    y,
    w: template.w || 180,
    h: template.h || 92,
    props: {
      name: template.displayName,
      moduleType: template.category,
      inputs: array(template.ports?.inputs).map((port) => ({ name: port.displayName, type: port.type || 'scalar' })),
      outputs: array(template.ports?.outputs).map((port) => ({ name: port.displayName, type: port.type || 'scalar' })),
      middleVars: array(template.stateVariables).map((item) => ({ name: item.displayName, type: item.type || 'scalar' }))
    },
    ports: clone(template.ports),
    parameters: clone(template.parameters),
    stateVariables: clone(template.stateVariables),
    faultSlots: clone(template.faultSlots),
    pythonBinding: clone(template.pythonBinding)
  };
}
```

- [ ] **Step 4: Verify Task 2 passes**

```powershell
npm test -- tests\component-authoring-service.spec.js --run
```

Expected: all component authoring tests pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src\services\componentAuthoringService.js tests\component-authoring-service.spec.js
git commit -m "feat: add component authoring service"
```

---

### Task 3: Fault Authoring Service

**Files:**
- Create: `src/services/faultAuthoringService.js`
- Test: `tests/fault-authoring-service.spec.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/fault-authoring-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import { createEmptyAuthoringPackage } from '../src/services/authoringModelService.js';
import {
  attachFaultTypeToTargetSlot,
  createFaultInstance,
  createFaultType,
  removeFaultInstance
} from '../src/services/faultAuthoringService.js';

function createPackage() {
  return {
    ...createEmptyAuthoringPackage({ modelId: 'fault-authoring', modelName: '故障建模' }),
    systemModel: {
      nodes: [{ id: 'node-imu', displayName: 'IMU 陀螺仪反馈' }],
      edges: [{ id: 'edge-motor-motor1', sourceNodeId: 'node-motor', targetNodeId: 'node-motor-1', displayName: '1号电机 CAN 指令' }]
    },
    faultCapabilityMap: [
      {
        targetId: 'node-imu',
        targetKind: 'node',
        targetName: 'IMU 陀螺仪反馈',
        faultSlots: [
          {
            slotId: 'gyro-feedback',
            slotName: '陀螺仪反馈信号',
            kind: 'output_signal',
            signalId: 'imu.pitch_rate',
            allowedFaultTypeIds: []
          }
        ]
      }
    ]
  };
}

describe('faultAuthoringService', () => {
  it('creates a fault type with editable parameter schema', () => {
    const faultType = createFaultType({
      id: 'gyro_zero_bias_drift',
      displayName: 'Gyro 零偏 - 缓慢漂移',
      layer: 'electrical',
      faultClass: '漂移故障',
      runtimeBehavior: 'drift',
      parameters: {
        rate: { label: '漂移速率', type: 'number', unit: 'rad/s²', default: 0.006 },
        start: { label: '开始时间', type: 'number', unit: 's', default: 3 }
      }
    });

    expect(faultType.id).toBe('gyro_zero_bias_drift');
    expect(faultType.parameters.rate.default).toBe(0.006);
    expect(faultType.defaultParameters).toEqual({ rate: 0.006, start: 3 });
  });

  it('attaches a new fault type to an existing target slot', () => {
    const pkg = createPackage();
    const next = attachFaultTypeToTargetSlot(pkg, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });

    expect(pkg.faultCapabilityMap[0].faultSlots[0].allowedFaultTypeIds).toEqual([]);
    expect(next.faultCapabilityMap[0].faultSlots[0].allowedFaultTypeIds).toEqual(['gyro_zero_bias_drift']);
  });

  it('creates an active fault instance and rejects a duplicate on the same target slot', () => {
    const pkg = attachFaultTypeToTargetSlot({
      ...createPackage(),
      faultTypeCatalog: [
        createFaultType({
          id: 'gyro_zero_bias_drift',
          displayName: 'Gyro 零偏 - 缓慢漂移',
          runtimeBehavior: 'drift',
          parameters: { rate: { label: '漂移速率', type: 'number', default: 0.006 } }
        })
      ]
    }, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });

    const created = createFaultInstance(pkg, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift',
      parameters: { rate: 0.01 }
    });
    const duplicate = createFaultInstance(created.package, {
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'gyro-feedback',
      faultTypeId: 'gyro_zero_bias_drift'
    });

    expect(created.ok).toBe(true);
    expect(created.instance.parameters.rate).toBe(0.01);
    expect(created.package.faultInstances).toHaveLength(1);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toBe('duplicate-fault-instance');
  });

  it('removes a fault instance by marking it inactive', () => {
    const pkg = {
      ...createPackage(),
      faultInstances: [
        {
          instanceId: 'fault-inst-1',
          faultTypeId: 'gyro_zero_bias_drift',
          targetKind: 'node',
          targetId: 'node-imu',
          slotId: 'gyro-feedback',
          active: true
        }
      ]
    };

    const next = removeFaultInstance(pkg, 'fault-inst-1');

    expect(next.faultInstances[0].active).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
npm test -- tests\fault-authoring-service.spec.js --run
```

Expected: fail because `faultAuthoringService.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/services/faultAuthoringService.js`:

```js
import { normalizeAuthoringPackage } from './authoringModelService.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function defaultsFromParameters(parameters = {}) {
  return Object.fromEntries(Object.entries(parameters).map(([key, schema]) => [
    key,
    schema && typeof schema === 'object' && Object.prototype.hasOwnProperty.call(schema, 'default') ? schema.default : ''
  ]));
}

export function createFaultType({
  id,
  displayName,
  layer = 'electrical',
  faultClass = '故障',
  runtimeBehavior,
  formula = '',
  parameters = {}
}) {
  if (!id) {
    throw new Error('Missing fault type id');
  }
  if (!runtimeBehavior) {
    throw new Error('Missing runtime behavior');
  }
  return {
    id,
    displayName: text(displayName, id),
    name: text(displayName, id),
    layer,
    faultClass,
    modelClass: faultClass,
    runtimeBehavior,
    formula,
    parameters: clone(parameters),
    defaultParameters: defaultsFromParameters(parameters)
  };
}

export function attachFaultTypeToTargetSlot(modelPackage, { targetKind, targetId, slotId, faultTypeId }) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const faultCapabilityMap = pkg.faultCapabilityMap.map((capability) => {
    if (capability.targetId !== targetId || capability.targetKind !== targetKind) {
      return capability;
    }
    return {
      ...capability,
      faultSlots: array(capability.faultSlots).map((slot) => {
        if (slot.slotId !== slotId) {
          return slot;
        }
        const allowed = Array.from(new Set([...array(slot.allowedFaultTypeIds), faultTypeId]));
        return { ...slot, allowedFaultTypeIds: allowed };
      })
    };
  });
  return { ...pkg, faultCapabilityMap };
}

function findCapabilitySlot(pkg, { targetKind, targetId, slotId, faultTypeId }) {
  const capability = pkg.faultCapabilityMap.find((item) => item.targetKind === targetKind && item.targetId === targetId);
  const slot = array(capability?.faultSlots).find((item) => item.slotId === slotId);
  if (!slot || !array(slot.allowedFaultTypeIds).includes(faultTypeId)) {
    return null;
  }
  return slot;
}

function findFaultType(pkg, faultTypeId) {
  return pkg.faultTypeCatalog.find((item) => item.id === faultTypeId) ?? null;
}

export function createFaultInstance(modelPackage, { targetKind, targetId, slotId, faultTypeId, parameters = {} }) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const slot = findCapabilitySlot(pkg, { targetKind, targetId, slotId, faultTypeId });
  const faultType = findFaultType(pkg, faultTypeId);
  if (!slot || !faultType) {
    return { ok: false, error: 'incompatible-target', package: pkg };
  }
  const duplicate = pkg.faultInstances.find((instance) => (
    instance.active !== false
    && instance.targetKind === targetKind
    && instance.targetId === targetId
    && instance.slotId === slotId
    && instance.faultTypeId === faultTypeId
  ));
  if (duplicate) {
    return { ok: false, error: 'duplicate-fault-instance', instance: duplicate, package: pkg };
  }
  const instance = {
    instanceId: `fault-inst-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    faultTypeId,
    targetKind,
    targetId,
    slotId,
    displayName: faultType.displayName || faultType.name || faultTypeId,
    parameters: {
      ...(faultType.defaultParameters ?? {}),
      ...clone(parameters)
    },
    active: true,
    visual: {
      expanded: false
    }
  };
  return {
    ok: true,
    instance,
    package: {
      ...pkg,
      faultInstances: [...pkg.faultInstances, instance]
    }
  };
}

export function removeFaultInstance(modelPackage, instanceId) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  return {
    ...pkg,
    faultInstances: pkg.faultInstances.map((instance) => (
      instance.instanceId === instanceId ? { ...instance, active: false } : instance
    ))
  };
}
```

- [ ] **Step 4: Verify Task 3 passes**

```powershell
npm test -- tests\fault-authoring-service.spec.js --run
```

Expected: all fault authoring tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src\services\faultAuthoringService.js tests\fault-authoring-service.spec.js
git commit -m "feat: add fault authoring service"
```

---

### Task 4: Diagnostic Authoring Service

**Files:**
- Create: `src/services/diagnosticAuthoringService.js`
- Test: `tests/diagnostic-authoring-service.spec.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/diagnostic-authoring-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  buildDMatrixRows,
  upsertDetectability
} from '../src/services/diagnosticAuthoringService.js';

const pkg = {
  faultTypeCatalog: [
    { id: 'gyro_zero_bias_drift', displayName: 'Gyro 零偏 - 缓慢漂移' },
    { id: 'motor1_stuck', displayName: '1号电机卡死' }
  ],
  diagnosticModel: {
    testPoints: [
      { testPointId: 'M1', displayName: '指令测点' },
      { testPointId: 'M3', displayName: 'IMU 反馈测点' }
    ],
    detectabilityMatrix: [
      { faultTypeId: 'gyro_zero_bias_drift', targetId: 'node-imu', slotId: 'gyro-feedback', testPointId: 'M3', detectable: true, signature: '均值漂移', confidence: 0.9 },
      { faultTypeId: 'motor1_stuck', targetId: 'node-motor-1', slotId: 'motor-state', testPointId: 'M1', detectable: false, signature: '指令端无明显异常', confidence: 0.2 }
    ]
  }
};

describe('diagnosticAuthoringService', () => {
  it('upserts detectability for a fault and test point', () => {
    const next = upsertDetectability(pkg, {
      faultTypeId: 'motor1_stuck',
      targetId: 'node-motor-1',
      slotId: 'motor-state',
      testPointId: 'M3',
      detectable: true,
      signature: '推力响应异常',
      confidence: 0.8
    });

    expect(next.diagnosticModel.detectabilityMatrix).toContainEqual({
      faultTypeId: 'motor1_stuck',
      targetId: 'node-motor-1',
      slotId: 'motor-state',
      testPointId: 'M3',
      detectable: true,
      signature: '推力响应异常',
      confidence: 0.8
    });
  });

  it('builds D-matrix rows with Chinese fault names and test point columns', () => {
    const rows = buildDMatrixRows(pkg);

    expect(rows).toEqual([
      {
        faultTypeId: 'gyro_zero_bias_drift',
        faultName: 'Gyro 零偏 - 缓慢漂移',
        targetId: 'node-imu',
        slotId: 'gyro-feedback',
        M1: 0,
        M3: 1
      },
      {
        faultTypeId: 'motor1_stuck',
        faultName: '1号电机卡死',
        targetId: 'node-motor-1',
        slotId: 'motor-state',
        M1: 0,
        M3: 0
      }
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```powershell
npm test -- tests\diagnostic-authoring-service.spec.js --run
```

Expected: fail because `diagnosticAuthoringService.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/services/diagnosticAuthoringService.js`:

```js
import { normalizeAuthoringPackage } from './authoringModelService.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function keyOf(row) {
  return [
    row.faultTypeId,
    row.targetId || '',
    row.slotId || '',
    row.testPointId
  ].join('::');
}

export function upsertDetectability(modelPackage, row) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const nextRow = {
    faultTypeId: row.faultTypeId,
    targetId: row.targetId || '',
    slotId: row.slotId || '',
    testPointId: row.testPointId,
    detectable: Boolean(row.detectable),
    signature: row.signature || '',
    confidence: Number.isFinite(row.confidence) ? row.confidence : 0
  };
  const current = pkg.diagnosticModel.detectabilityMatrix.filter((item) => keyOf(item) !== keyOf(nextRow));
  return {
    ...pkg,
    diagnosticModel: {
      ...pkg.diagnosticModel,
      detectabilityMatrix: [...current, nextRow]
    }
  };
}

export function buildDMatrixRows(modelPackage) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const faultNameById = new Map(pkg.faultTypeCatalog.map((fault) => [fault.id, fault.displayName || fault.name || fault.id]));
  const testPointIds = pkg.diagnosticModel.testPoints.map((point) => point.testPointId);
  const grouped = new Map();

  pkg.diagnosticModel.detectabilityMatrix.forEach((row) => {
    const groupKey = [row.faultTypeId, row.targetId || '', row.slotId || ''].join('::');
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        faultTypeId: row.faultTypeId,
        faultName: faultNameById.get(row.faultTypeId) || row.faultTypeId,
        targetId: row.targetId || '',
        slotId: row.slotId || ''
      });
    }
    grouped.get(groupKey)[row.testPointId] = row.detectable ? 1 : 0;
  });

  return Array.from(grouped.values()).map((item) => {
    const row = clone(item);
    testPointIds.forEach((testPointId) => {
      if (!Object.prototype.hasOwnProperty.call(row, testPointId)) {
        row[testPointId] = 0;
      }
    });
    return row;
  });
}
```

- [ ] **Step 4: Verify Task 4 passes**

```powershell
npm test -- tests\diagnostic-authoring-service.spec.js --run
```

Expected: all diagnostic authoring tests pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src\services\diagnosticAuthoringService.js tests\diagnostic-authoring-service.spec.js
git commit -m "feat: add diagnostic authoring service"
```

---

### Task 5: Runtime Bridge for Authored Faults

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: extend `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Add failing app-level tests**

Append these tests to `tests/flight-model-package-app.spec.js` near the existing fault capability tests:

```js
it('uses authored fault slots to offer only target-compatible faults', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = {
    schemaVersion: '3.0',
    packageType: 'flight-control-model',
    modelInfo: { modelId: 'authoring-runtime', modelName: '人工扩展运行模型' },
    systemModel: {
      nodes: [
        {
          id: 'node-imu',
          type: 'simulation_block',
          x: 280,
          y: 220,
          props: { name: 'IMU 陀螺仪反馈', inputs: [], outputs: [{ name: '角速度反馈', type: 'scalar' }], middleVars: [] },
          faultSlots: [
            {
              slotId: 'gyro-feedback',
              displayName: '陀螺仪反馈信号',
              kind: 'output_signal',
              signalId: 'imu.pitch_rate',
              allowedFaultTypeIds: ['gyro_zero_bias_drift']
            }
          ]
        },
        {
          id: 'node-controller',
          type: 'simulation_block',
          x: 540,
          y: 220,
          props: { name: '姿态控制器', inputs: [{ name: '姿态误差', type: 'scalar' }], outputs: [], middleVars: [] }
        }
      ],
      edges: []
    },
    faultTypeCatalog: [
      { id: 'gyro_zero_bias_drift', displayName: 'Gyro 零偏 - 缓慢漂移', layer: 'electrical', runtimeBehavior: 'parameter_drift', defaultParameters: { rate: 0.006 } },
      { id: 'motor1_stuck', displayName: '1号电机卡死', layer: 'physical', runtimeBehavior: 'lock', defaultParameters: { lock_value: 0 } }
    ],
    faultCapabilityMap: [
      {
        targetId: 'node-imu',
        targetKind: 'node',
        targetName: 'IMU 陀螺仪反馈',
        faultSlots: [
          {
            slotId: 'gyro-feedback',
            slotName: '陀螺仪反馈信号',
            kind: 'output_signal',
            signalId: 'imu.pitch_rate',
            allowedFaultTypeIds: ['gyro_zero_bias_drift']
          }
        ]
      }
    ],
    faultInstances: [],
    diagnosticModel: { testPoints: [], detectabilityMatrix: [] },
    componentTemplates: [],
    pythonModules: []
  };

  const result = window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg);
  await flushRuntime();
  expect(result.ok).not.toBe(false);

  window.selectNode('node-imu');
  window.openTargetFaultActivationDialog();
  await flushRuntime();

  const choices = Array.from(document.querySelectorAll('[data-activate-compatible-fault]'));
  expect(choices.map((button) => button.textContent)).toEqual([
    expect.stringContaining('Gyro 零偏 - 缓慢漂移')
  ]);
  expect(choices[0].textContent).not.toContain('1号电机卡死');

  wrapper.unmount();
});

it('creates edge-targeted authored fault instances from compatible edge slots', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = {
    schemaVersion: '3.0',
    packageType: 'flight-control-model',
    modelInfo: { modelId: 'edge-authoring-runtime', modelName: '连线故障模型' },
    systemModel: {
      nodes: [
        { id: 'node-motor', type: 'simulation_block', x: 300, y: 220, props: { name: '电机指令', inputs: [], outputs: [{ name: 'CAN 指令', type: 'scalar' }], middleVars: [] } },
        { id: 'node-motor-1', type: 'simulation_block', x: 560, y: 220, props: { name: '1号电机', inputs: [{ name: 'CAN 指令', type: 'scalar' }], outputs: [], middleVars: [] } }
      ],
      edges: [
        { id: 'edge-motor-motor1', sourceNodeId: 'node-motor', targetNodeId: 'node-motor-1', sourcePortIndex: 0, targetPortIndex: 0, lineType: 'can', signalId: 'motor1.command' }
      ]
    },
    faultTypeCatalog: [
      { id: 'motor1_can_command_tamper', displayName: '1号电机 CAN 指令篡改', layer: 'protocol', runtimeBehavior: 'tamper', defaultParameters: { scale: 0.5 } }
    ],
    faultCapabilityMap: [
      {
        targetId: 'edge-motor-motor1',
        targetKind: 'edge',
        targetName: '1号电机 CAN 指令',
        faultSlots: [
          {
            slotId: 'motor1-can-command',
            slotName: '1号电机控制指令',
            kind: 'protocol_payload',
            signalId: 'motor1.command',
            allowedFaultTypeIds: ['motor1_can_command_tamper']
          }
        ]
      }
    ],
    faultInstances: [],
    diagnosticModel: { testPoints: [], detectabilityMatrix: [] },
    componentTemplates: [],
    pythonModules: []
  };

  window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg);
  await flushRuntime();

  const edge = window.__GZ_STATE__.modelEdges.find((item) => item.id === 'edge-motor-motor1');
  const result = window.handleFaultComponentDrop({ target: edge });
  await flushRuntime();
  expect(result.ok).toBe(true);

  document.querySelector('[data-activate-compatible-fault="motor1_can_command_tamper"]').click();
  await flushRuntime();

  expect(window.__GZ_STATE__.faultInstances).toEqual([
    expect.objectContaining({
      faultTypeId: 'motor1_can_command_tamper',
      targetKind: 'edge',
      targetId: 'edge-motor-motor1',
      slotId: 'motor1-can-command'
    })
  ]);

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the app tests and verify they fail**

```powershell
npm test -- tests\flight-model-package-app.spec.js -t "authored fault slots|edge-targeted authored fault" --run
```

Expected: fail because the legacy runtime still primarily reads older package shapes in some paths.

- [ ] **Step 3: Modify the runtime package import bridge**

In `src/services/legacy-runtime.txt`, locate the existing `window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__` override around the fault capability installer. Extend it so schema 3 packages map `systemModel.nodes` and `systemModel.edges` into the runtime state:

```js
const importedNodes=arr(pkg?.systemModel?.nodes).length?arr(pkg.systemModel.nodes):arr(pkg?.nodes);
const importedEdges=arr(pkg?.systemModel?.edges).length?arr(pkg.systemModel.edges):arr(pkg?.edges);
if(importedNodes.length){
  state.modelNodes=cloneCapabilityValue(importedNodes);
  state.nodes=state.modelNodes;
}
if(importedEdges.length){
  state.modelEdges=cloneCapabilityValue(importedEdges);
  state.edges=state.modelEdges;
}
```

In the same override, keep this canonical authoring payload on the active package:

```js
state.activeModelPackage={
  ...state.activeModelPackage,
  schemaVersion:String(pkg?.schemaVersion||state.activeModelPackage?.schemaVersion||''),
  modelInfo:cloneCapabilityValue(pkg?.modelInfo||{}),
  componentTemplates:cloneCapabilityValue(arr(pkg?.componentTemplates)),
  systemModel:{
    nodes:cloneCapabilityValue(importedNodes),
    edges:cloneCapabilityValue(importedEdges)
  },
  faultTypeCatalog:cloneCapabilityValue(arr(pkg?.faultTypeCatalog)),
  faultCapabilityMap:cloneCapabilityValue(arr(pkg?.faultCapabilityMap)),
  faultInstances:cloneCapabilityValue(arr(pkg?.faultInstances)),
  diagnosticModel:cloneCapabilityValue(pkg?.diagnosticModel||{testPoints:[],detectabilityMatrix:[]}),
  pythonModules:cloneCapabilityValue(arr(pkg?.pythonModules))
};
state.faultInstances=cloneCapabilityValue(arr(pkg?.faultInstances));
```

- [ ] **Step 4: Verify Task 5 passes**

```powershell
npm test -- tests\flight-model-package-app.spec.js -t "authored fault slots|edge-targeted authored fault" --run
```

Expected: both new runtime bridge tests pass.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src\services\legacy-runtime.txt tests\flight-model-package-app.spec.js
git commit -m "feat: bridge authored fault packages into runtime"
```

---

### Task 6: Minimal Component and Fault Authoring Dialogs

**Files:**
- Create: `src/components/dialogs/ComponentAuthoringDialog.vue`
- Create: `src/components/dialogs/FaultAuthoringDialog.vue`
- Modify: `src/composables/useDialogsState.js`
- Modify: `src/App.vue`
- Test: extend `tests/property-panel-app.spec.js`

- [ ] **Step 1: Add failing dialog tests**

Append to `tests/property-panel-app.spec.js`:

```js
it('opens component authoring dialog from a custom event and emits a component template', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await nextTick();

  window.dispatchEvent(new CustomEvent('gz:open-component-authoring', {
    detail: {
      parsedInterface: {
        fileName: 'attitude_controller.py',
        moduleName: 'attitude_controller',
        description: '姿态控制器',
        entryFunction: 'process',
        inputs: [{ name: 'attitude_error', displayName: '姿态误差', type: 'float' }],
        outputs: [{ name: 'output_0', displayName: '力矩指令', type: 'float' }],
        middleVars: [],
        rawSource: 'def process(attitude_error): return attitude_error'
      }
    }
  }));
  await nextTick();

  const dialog = document.querySelector('[data-testid="component-authoring-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('姿态控制器');
  expect(dialog.textContent).toContain('姿态误差');
  expect(dialog.textContent).toContain('力矩指令');

  wrapper.unmount();
});

it('opens fault authoring dialog for a selected target slot', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await nextTick();

  window.dispatchEvent(new CustomEvent('gz:open-fault-authoring', {
    detail: {
      target: {
        targetKind: 'node',
        targetId: 'node-imu',
        targetName: 'IMU 陀螺仪反馈',
        slotId: 'gyro-feedback',
        slotName: '陀螺仪反馈信号'
      }
    }
  }));
  await nextTick();

  const dialog = document.querySelector('[data-testid="fault-authoring-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('IMU 陀螺仪反馈');
  expect(dialog.textContent).toContain('陀螺仪反馈信号');
  expect(dialog.textContent).toContain('故障名称');

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the dialog tests and verify they fail**

```powershell
npm test -- tests\property-panel-app.spec.js -t "component authoring dialog|fault authoring dialog" --run
```

Expected: fail because the dialogs are not mounted.

- [ ] **Step 3: Extend dialog state**

Modify `src/composables/useDialogsState.js` to include:

```js
componentAuthoring: {
  open: false,
  parsedInterface: null
},
faultAuthoring: {
  open: false,
  target: null
}
```

Export functions:

```js
export function openComponentAuthoringDialog(payload = {}) {
  dialogsState.componentAuthoring.open = true;
  dialogsState.componentAuthoring.parsedInterface = payload.parsedInterface ?? null;
}

export function closeComponentAuthoringDialog() {
  dialogsState.componentAuthoring.open = false;
  dialogsState.componentAuthoring.parsedInterface = null;
}

export function openFaultAuthoringDialog(payload = {}) {
  dialogsState.faultAuthoring.open = true;
  dialogsState.faultAuthoring.target = payload.target ?? null;
}

export function closeFaultAuthoringDialog() {
  dialogsState.faultAuthoring.open = false;
  dialogsState.faultAuthoring.target = null;
}
```

- [ ] **Step 4: Create `ComponentAuthoringDialog.vue`**

```vue
<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import {
  closeComponentAuthoringDialog,
  dialogsState,
  openComponentAuthoringDialog
} from '../../composables/useDialogsState.js';

const parsedInterface = computed(() => dialogsState.componentAuthoring.parsedInterface);

function handleOpen(event) {
  openComponentAuthoringDialog(event.detail ?? {});
}

function close() {
  closeComponentAuthoringDialog();
}

onMounted(() => window.addEventListener('gz:open-component-authoring', handleOpen));
onUnmounted(() => window.removeEventListener('gz:open-component-authoring', handleOpen));
</script>

<template>
  <div v-if="dialogsState.componentAuthoring.open" class="overlay overlay--vue open" data-testid="component-authoring-dialog">
    <div class="modal authoring-modal">
      <div class="mhead">
        <div>
          <div class="eyebrow">组件建模</div>
          <div class="mtitle">新增仿真组件</div>
        </div>
        <button class="x" type="button" @click="close">×</button>
      </div>
      <div class="mbody authoring-modal__body">
        <section class="authoring-card">
          <h3>{{ parsedInterface?.description || parsedInterface?.moduleName || '未命名组件' }}</h3>
          <p>{{ parsedInterface?.fileName }}</p>
        </section>
        <section class="authoring-card">
          <h4>输入接口</h4>
          <div v-for="item in parsedInterface?.inputs || []" :key="item.name">{{ item.displayName || item.comment || item.name }}</div>
        </section>
        <section class="authoring-card">
          <h4>输出接口</h4>
          <div v-for="item in parsedInterface?.outputs || []" :key="item.name">{{ item.displayName || item.comment || item.name }}</div>
        </section>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Create `FaultAuthoringDialog.vue`**

```vue
<script setup>
import { computed, onMounted, onUnmounted, reactive } from 'vue';
import {
  closeFaultAuthoringDialog,
  dialogsState,
  openFaultAuthoringDialog
} from '../../composables/useDialogsState.js';

const target = computed(() => dialogsState.faultAuthoring.target);
const form = reactive({
  displayName: '',
  runtimeBehavior: 'bias'
});

function handleOpen(event) {
  openFaultAuthoringDialog(event.detail ?? {});
}

function close() {
  closeFaultAuthoringDialog();
}

onMounted(() => window.addEventListener('gz:open-fault-authoring', handleOpen));
onUnmounted(() => window.removeEventListener('gz:open-fault-authoring', handleOpen));
</script>

<template>
  <div v-if="dialogsState.faultAuthoring.open" class="overlay overlay--vue open" data-testid="fault-authoring-dialog">
    <div class="modal authoring-modal">
      <div class="mhead">
        <div>
          <div class="eyebrow">故障建模</div>
          <div class="mtitle">新增目标故障</div>
        </div>
        <button class="x" type="button" @click="close">×</button>
      </div>
      <div class="mbody authoring-modal__body">
        <section class="authoring-card">
          <h3>{{ target?.targetName || target?.targetId }}</h3>
          <p>{{ target?.slotName || target?.slotId }}</p>
        </section>
        <label class="field">
          <span>故障名称</span>
          <input v-model="form.displayName" type="text" aria-label="例如：Gyro 零偏 - 固定偏差">
        </label>
        <label class="field">
          <span>运行行为</span>
          <select v-model="form.runtimeBehavior">
            <option value="bias">固定偏差</option>
            <option value="drift">缓慢漂移</option>
            <option value="intermittent">间歇故障</option>
            <option value="noise">噪声增强</option>
            <option value="lock">卡死</option>
            <option value="tamper">指令篡改</option>
          </select>
        </label>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Mount dialogs in `src/App.vue`**

Import:

```js
import ComponentAuthoringDialog from './components/dialogs/ComponentAuthoringDialog.vue';
import FaultAuthoringDialog from './components/dialogs/FaultAuthoringDialog.vue';
```

Render them next to the existing dialogs:

```vue
<ComponentAuthoringDialog />
<FaultAuthoringDialog />
```

- [ ] **Step 7: Add minimal IBM-aligned styles**

Use existing modal/card variables in `src/styles/components.css`:

```css
.authoring-modal{width:min(860px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 32px));}
.authoring-modal__body{display:grid;gap:16px;padding:18px;overflow:auto;}
.authoring-card{border:1px solid var(--border);background:var(--bg-card);padding:14px 16px;}
.authoring-card h3,.authoring-card h4{margin:0 0 8px;color:var(--text);}
.authoring-card p{margin:0;color:var(--textm);}
```

- [ ] **Step 8: Verify Task 6 passes**

```powershell
npm test -- tests\property-panel-app.spec.js -t "component authoring dialog|fault authoring dialog" --run
```

Expected: both dialog tests pass.

- [ ] **Step 9: Commit Task 6**

```powershell
git add src\components\dialogs\ComponentAuthoringDialog.vue src\components\dialogs\FaultAuthoringDialog.vue src\composables\useDialogsState.js src\App.vue src\styles\components.css tests\property-panel-app.spec.js
git commit -m "feat: add component and fault authoring dialogs"
```

---

### Task 7: End-to-End Verification and Cleanup

**Files:**
- Modify only files touched by prior tasks if verification exposes failures.

- [ ] **Step 1: Run focused service tests**

```powershell
npm test -- tests\authoring-model-service.spec.js tests\component-authoring-service.spec.js tests\fault-authoring-service.spec.js tests\diagnostic-authoring-service.spec.js --run
```

Expected: all service tests pass.

- [ ] **Step 2: Run focused app tests**

```powershell
npm test -- tests\flight-model-package-app.spec.js tests\property-panel-app.spec.js --run
```

Expected: all app tests pass. Existing jsdom navigation warnings may appear; they do not fail the run.

- [ ] **Step 3: Run full test suite**

```powershell
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Build production bundle**

```powershell
npm run build
```

Expected: Vite build succeeds. Existing large chunk warning is acceptable if no build errors occur.

- [ ] **Step 5: Check git diff hygiene**

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exits with code 0. `git status --short` shows only intended tracked changes, plus the existing untracked `Jigui_demo/` if it is still present.

- [ ] **Step 6: Commit verification fixes if any were required**

If verification required code changes:

```powershell
git add src tests
git commit -m "fix: stabilize authored fault model integration"
```

If no code changes were required, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- New component authoring is covered by Tasks 1, 2, and 6.
- Python binding interface reuse is covered by Task 2 and Task 6.
- Fault type creation, parameter schema, duplicate prevention, and removal are covered by Task 3.
- Target-specific fault compatibility for nodes and edges is covered by Task 5.
- Measurement-point and D-matrix data generation are covered by Task 4.
- Verification and build checks are covered by Task 7.

Type consistency:

- The plan consistently uses `faultTypeCatalog`, `faultCapabilityMap`, `faultInstances`, `faultSlots`, `slotId`, `targetKind`, and `targetId`.
- Dialog state names are `componentAuthoring` and `faultAuthoring`.
- Runtime bridge tests use the same schema 3.0 package shape defined by the design document.
