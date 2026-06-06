# eVTOL Hierarchical Example Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and ship two new layered eVTOL example packages, one normal and one pre-fault, while keeping the current flat examples unchanged.

**Architecture:** Extend the existing `build_evtol_package.mjs` pipeline so it hydrates one shared module set and one shared flat authoring snapshot, then derives two additional hierarchical snapshots from that data. Keep validation and app import coverage in the current model-package test files so the new examples are treated as first-class shipped artifacts rather than one-off fixtures.

**Tech Stack:** Node.js ESM build script, Vue 3 runtime bridge, Vitest, JSON model packages, hierarchical `workbenchSnapshot` serialization

---

## File Structure

- Modify: `tools/flight_model_package/build_evtol_package.mjs`
  - Add hierarchical snapshot derivation helpers
  - Emit four package files instead of two
- Modify: `tests/flight-model-package.spec.js`
  - Add validation coverage for the new hierarchical package files
- Modify: `tests/flight-model-package-app.spec.js`
  - Add app import coverage for the new hierarchical package files
- Modify: `README.md`
  - Document the four example package files and when to use each
- Create: `public/model-packages/evtol_small_nonlinear_hierarchical.json`
  - Generated artifact
- Create: `public/model-packages/evtol_small_nonlinear_hierarchical_fault_injected.json`
  - Generated artifact

### Task 1: Lock hierarchical example-package behavior with failing tests

**Files:**
- Modify: `tests/flight-model-package.spec.js`
- Modify: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing package-validation tests**

Append to `tests/flight-model-package.spec.js`:

```js
import evtolHierarchicalPackage from '../public/model-packages/evtol_small_nonlinear_hierarchical.json';
import evtolHierarchicalFaultPackage from '../public/model-packages/evtol_small_nonlinear_hierarchical_fault_injected.json';

it('ships a reusable hierarchical eVTOL reference package', () => {
  const validation = validateFlightModelPackage(evtolHierarchicalPackage);

  expect(validation).toEqual({ ok: true, errors: [] });
  expect(evtolHierarchicalPackage.workbenchSnapshot.canvases).toBeTruthy();
  expect(Object.keys(evtolHierarchicalPackage.workbenchSnapshot.canvases).length).toBeGreaterThan(1);
  expect(evtolHierarchicalPackage.workbenchSnapshot.canvases['canvas-root'].nodes.filter((node) => node.type === 'subsystem_block')).toHaveLength(4);
});

it('ships a reusable hierarchical fault-injected eVTOL package with a faulted child-canvas node', () => {
  const validation = validateFlightModelPackage(evtolHierarchicalFaultPackage);
  const childCanvases = Object.values(evtolHierarchicalFaultPackage.workbenchSnapshot.canvases)
    .filter((canvas) => canvas.id !== 'canvas-root');
  const faultedChildNode = childCanvases
    .flatMap((canvas) => canvas.nodes)
    .find((node) => node.injectedFault?.modelId);

  expect(validation).toEqual({ ok: true, errors: [] });
  expect(evtolHierarchicalFaultPackage.workbenchSnapshot.faultedBlks.length).toBeGreaterThan(0);
  expect(faultedChildNode).toBeTruthy();
  expect(faultedChildNode.injectedFault).toMatchObject({
    modelId: 'fm-electrical-motor-efficiency-loss'
  });
});
```

- [ ] **Step 2: Write the failing app-import tests**

Append to `tests/flight-model-package-app.spec.js`:

```js
it('imports the hierarchical reference package and restores layered canvases', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = loadPublicPackage('evtol_small_nonlinear_hierarchical.json');
  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
  await flushRuntime();

  expect(importResult).toMatchObject({ ok: true });
  expect(window.__GZ_STATE__.canvases['canvas-root'].nodes.filter((node) => node.type === 'subsystem_block')).toHaveLength(4);
  expect(Object.keys(window.__GZ_STATE__.canvases).length).toBeGreaterThan(1);

  wrapper.unmount();
});

it('imports the hierarchical fault package and restores a fault inside a child canvas', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = loadPublicPackage('evtol_small_nonlinear_hierarchical_fault_injected.json');
  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
  await flushRuntime();

  const childCanvases = Object.values(window.__GZ_STATE__.canvases).filter((canvas) => canvas.id !== 'canvas-root');
  const faultedChildNode = childCanvases.flatMap((canvas) => canvas.nodes).find((node) => node.injectedFault?.modelId);

  expect(importResult).toMatchObject({ ok: true });
  expect(window.__GZ_STATE__.faultedBlks.length).toBeGreaterThan(0);
  expect(faultedChildNode?.injectedFault).toMatchObject({
    modelId: 'fm-electrical-motor-efficiency-loss',
    layer: 'electrical'
  });

  wrapper.unmount();
});
```

- [ ] **Step 3: Run the targeted tests to verify failure**

Run:

```bash
npm test -- --run tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js
```

Expected:
- FAIL because the two hierarchical package files do not exist yet and the build script still writes only the flat pair

- [ ] **Step 4: Commit**

```bash
git add tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js
git commit -m "test: cover hierarchical eVTOL example packages"
```

### Task 2: Generate the hierarchical normal and fault-injected packages

**Files:**
- Modify: `tools/flight_model_package/build_evtol_package.mjs`

- [ ] **Step 1: Add output-file constants for the hierarchical pair**

In `tools/flight_model_package/build_evtol_package.mjs`, add:

```js
const hierarchicalOutputFile = path.join(outputDir, 'evtol_small_nonlinear_hierarchical.json');
const hierarchicalFaultInjectedOutputFile = path.join(outputDir, 'evtol_small_nonlinear_hierarchical_fault_injected.json');
```

- [ ] **Step 2: Add snapshot-derivation helpers**

Introduce these helpers in the same file:

```js
function createCanvas(id, name, parentSubsystemNodeId = null) {
  return {
    id,
    name,
    parentSubsystemNodeId,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    nodes: [],
    edges: []
  };
}

function createSubsystemShell(id, name, targetCanvasId, x, y, interfaceDef) {
  return {
    id,
    type: 'subsystem_block',
    x,
    y,
    w: 180,
    h: 92,
    targetCanvasId,
    props: {
      name,
      description: '',
      interface: interfaceDef
    }
  };
}

function pickNodes(snapshot, ids) {
  const idSet = new Set(ids);
  return snapshot.modelNodes.filter((node) => idSet.has(node.id)).map((node) => clone(node));
}

function pickEdges(snapshot, ids) {
  const idSet = new Set(ids);
  return snapshot.modelEdges.filter((edge) => idSet.has(edge.id)).map((edge) => clone(edge));
}
```

- [ ] **Step 3: Build the hierarchical normal snapshot**

Derive a layered snapshot with exactly four root subsystems:

```js
function createHierarchicalSnapshot(flatSnapshot) {
  const rootCanvas = createCanvas('canvas-root', '顶层');
  const sensorCanvasId = 'canvas-subsystem-sensors';
  const controlCanvasId = 'canvas-subsystem-control';
  const actuationCanvasId = 'canvas-subsystem-actuation';
  const dynamicsCanvasId = 'canvas-subsystem-dynamics';

  rootCanvas.nodes = [
    clone(flatSnapshot.modelNodes.find((node) => node.id === 'node-1')),
    clone(flatSnapshot.modelNodes.find((node) => node.id === 'node-2')),
    clone(flatSnapshot.modelNodes.find((node) => node.id === 'node-13')),
    createSubsystemShell('node-subsystem-sensors', '传感器', sensorCanvasId, 300, 250, {
      inputs: [
        { id: 'in-1', name: 'True Velocity', type: 'scalar', order: 0 },
        { id: 'in-2', name: 'Held Velocity', type: 'scalar', order: 1 }
      ],
      outputs: [
        { id: 'out-1', name: 'Measured Rate', type: 'scalar', order: 0 },
        { id: 'out-2', name: 'Measured Accel', type: 'scalar', order: 1 },
        { id: 'out-3', name: 'Estimated Altitude', type: 'scalar', order: 2 },
        { id: 'out-4', name: 'Reported Velocity', type: 'scalar', order: 3 }
      ]
    }),
    createSubsystemShell('node-subsystem-control', '控制律', controlCanvasId, 620, 180, {
      inputs: [
        { id: 'in-1', name: 'Attitude Error', type: 'scalar', order: 0 },
        { id: 'in-2', name: 'Rate Feedback', type: 'scalar', order: 1 }
      ],
      outputs: [
        { id: 'out-1', name: 'Command', type: 'scalar', order: 0 }
      ]
    }),
    createSubsystemShell('node-subsystem-actuation', '执行分配与电机', actuationCanvasId, 930, 180, {
      inputs: [
        { id: 'in-1', name: 'Total Thrust', type: 'scalar', order: 0 },
        { id: 'in-2', name: 'Roll Command', type: 'scalar', order: 1 }
      ],
      outputs: [
        { id: 'out-1', name: 'Left Thrust', type: 'scalar', order: 0 },
        { id: 'out-2', name: 'Right Thrust', type: 'scalar', order: 1 }
      ]
    }),
    createSubsystemShell('node-subsystem-dynamics', '动力学与观测', dynamicsCanvasId, 1250, 180, {
      inputs: [
        { id: 'in-1', name: 'Left Thrust', type: 'scalar', order: 0 },
        { id: 'in-2', name: 'Right Thrust', type: 'scalar', order: 1 }
      ],
      outputs: [
        { id: 'out-1', name: 'Vertical Accel', type: 'scalar', order: 0 },
        { id: 'out-2', name: 'Roll Moment', type: 'scalar', order: 1 }
      ]
    }),
    clone(flatSnapshot.modelNodes.find((node) => node.id === 'node-11')),
    clone(flatSnapshot.modelNodes.find((node) => node.id === 'node-12'))
  ];

  rootCanvas.edges = [
    { id: 'edge-h-1', lineType: 'normal', sourceNodeId: 'node-2', targetNodeId: 'node-subsystem-sensors', sourcePortIndex: 0, targetPortIndex: 0 },
    { id: 'edge-h-2', lineType: 'normal', sourceNodeId: 'node-13', targetNodeId: 'node-subsystem-sensors', sourcePortIndex: 0, targetPortIndex: 1 },
    { id: 'edge-h-3', lineType: 'normal', sourceNodeId: 'node-1', targetNodeId: 'node-subsystem-control', sourcePortIndex: 0, targetPortIndex: 0 },
    { id: 'edge-h-4', lineType: 'normal', sourceNodeId: 'node-subsystem-sensors', targetNodeId: 'node-subsystem-control', sourcePortIndex: 0, targetPortIndex: 1 },
    { id: 'edge-h-5', lineType: 'normal', sourceNodeId: 'node-subsystem-sensors', targetNodeId: 'node-subsystem-actuation', sourcePortIndex: 2, targetPortIndex: 0 },
    { id: 'edge-h-6', lineType: 'normal', sourceNodeId: 'node-subsystem-control', targetNodeId: 'node-subsystem-actuation', sourcePortIndex: 0, targetPortIndex: 1 },
    { id: 'edge-h-7', lineType: 'normal', sourceNodeId: 'node-subsystem-actuation', targetNodeId: 'node-subsystem-dynamics', sourcePortIndex: 0, targetPortIndex: 0 },
    { id: 'edge-h-8', lineType: 'normal', sourceNodeId: 'node-subsystem-actuation', targetNodeId: 'node-subsystem-dynamics', sourcePortIndex: 1, targetPortIndex: 1 },
    { id: 'edge-h-9', lineType: 'normal', sourceNodeId: 'node-subsystem-dynamics', targetNodeId: 'node-11', sourcePortIndex: 0, targetPortIndex: 0 },
    { id: 'edge-h-10', lineType: 'normal', sourceNodeId: 'node-subsystem-dynamics', targetNodeId: 'node-11', sourcePortIndex: 1, targetPortIndex: 1 },
    { id: 'edge-h-11', lineType: 'normal', sourceNodeId: 'node-subsystem-sensors', targetNodeId: 'node-12', sourcePortIndex: 1, targetPortIndex: 0 },
    { id: 'edge-h-12', lineType: 'normal', sourceNodeId: 'node-subsystem-sensors', targetNodeId: 'node-12', sourcePortIndex: 3, targetPortIndex: 1 }
  ];

  return {
    version: 1,
    rootCanvasId: 'canvas-root',
    activeCanvasId: 'canvas-root',
    canvasTrail: ['canvas-root'],
    canvases: {
      'canvas-root': rootCanvas,
      [sensorCanvasId]: { ...createCanvas(sensorCanvasId, '传感器', 'node-subsystem-sensors'), nodes: pickNodes(flatSnapshot, ['node-3', 'node-4', 'node-5', 'node-6']), edges: pickEdges(flatSnapshot, ['edge-12', 'edge-14', 'edge-13', 'edge-15']) },
      [controlCanvasId]: { ...createCanvas(controlCanvasId, '控制律', 'node-subsystem-control'), nodes: pickNodes(flatSnapshot, ['node-7']), edges: [] },
      [actuationCanvasId]: { ...createCanvas(actuationCanvasId, '执行分配与电机', 'node-subsystem-actuation'), nodes: pickNodes(flatSnapshot, ['node-8', 'node-9']), edges: pickEdges(flatSnapshot, ['edge-5', 'edge-6']) },
      [dynamicsCanvasId]: { ...createCanvas(dynamicsCanvasId, '动力学与观测', 'node-subsystem-dynamics'), nodes: pickNodes(flatSnapshot, ['node-10']), edges: [] }
    },
    nodeSeq: flatSnapshot.nodeSeq,
    edgeSeq: flatSnapshot.edgeSeq,
    activeLineType: flatSnapshot.activeLineType,
    faultedBlks: [],
    importedFaultModels: []
  };
}
```

- [ ] **Step 4: Build the hierarchical fault-injected package**

Clone the hierarchical snapshot and inject one local fault on the child-canvas `motor_model` node:

```js
const hierarchicalFaultModel = {
  id: 'fm-electrical-motor-efficiency-loss',
  name: 'Motor Efficiency Loss',
  layer: 'electrical',
  desc: 'Preloaded electrical fault that reduces motor-side actuation efficiency.',
  tags: ['motor', 'electrical', 'preloaded'],
  createdAt: '2026-04-16',
  origin: 'package'
};

const hierarchicalFaultSnapshot = clone(hierarchicalSnapshot);
const actuationCanvas = hierarchicalFaultSnapshot.canvases['canvas-subsystem-actuation'];
const faultTargetNode = actuationCanvas.nodes.find((node) => node.pythonBinding?.moduleId === 'motor_model');
faultTargetNode.injectedFault = {
  modelId: hierarchicalFaultModel.id,
  name: hierarchicalFaultModel.name,
  layer: hierarchicalFaultModel.layer,
  tags: clone(hierarchicalFaultModel.tags),
  desc: hierarchicalFaultModel.desc
};
hierarchicalFaultSnapshot.faultedBlks = [faultTargetNode.id];
hierarchicalFaultSnapshot.importedFaultModels = [hierarchicalFaultModel];
```

Write the new package files:

```js
await writeFile(hierarchicalOutputFile, `${JSON.stringify(hierarchicalPkg, null, 2)}\n`, 'utf8');
await writeFile(hierarchicalFaultInjectedOutputFile, `${JSON.stringify(hierarchicalFaultPkg, null, 2)}\n`, 'utf8');
```

- [ ] **Step 5: Run the targeted tests to verify the new files and behavior**

Run:

```bash
npm test -- --run tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js
```

Expected:
- PASS

- [ ] **Step 6: Rebuild the package artifacts**

Run:

```bash
node tools/flight_model_package/build_evtol_package.mjs
```

Expected output:

```text
wrote ...\public\model-packages\evtol_small_nonlinear.json
wrote ...\public\model-packages\evtol_small_nonlinear_fault_injected.json
wrote ...\public\model-packages\evtol_small_nonlinear_hierarchical.json
wrote ...\public\model-packages\evtol_small_nonlinear_hierarchical_fault_injected.json
```

- [ ] **Step 7: Commit**

```bash
git add tools/flight_model_package/build_evtol_package.mjs public/model-packages/evtol_small_nonlinear_hierarchical.json public/model-packages/evtol_small_nonlinear_hierarchical_fault_injected.json
git commit -m "feat: add hierarchical eVTOL example packages"
```

### Task 3: Document the four example packages and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README example-package section**

Replace the current example import section with an explicit four-file list:

```md
### 3. 导入模型包
在工作台中点击“导入系统模型”，可选择以下四个示例：

```text
public/model-packages/evtol_small_nonlinear.json
public/model-packages/evtol_small_nonlinear_fault_injected.json
public/model-packages/evtol_small_nonlinear_hierarchical.json
public/model-packages/evtol_small_nonlinear_hierarchical_fault_injected.json
```

- 前两者是平铺基线样例
- 后两者用于演示子系统分层、层级导入导出与局部故障恢复
```

- [ ] **Step 2: Run the full verification suite**

Run:

```bash
npm test -- --run
npm run build
```

Expected:
- full Vitest suite PASS
- build PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe hierarchical eVTOL example packages"
```
