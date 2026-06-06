# Subsystem Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Simulink-style nested subsystems to the workbench, including child canvases, breadcrumb navigation, stable boundary ports, recursive simulation, and a later “wrap selection into subsystem” workflow.

**Architecture:** Replace the current single flat workbench graph with a layered canvas registry keyed by `canvasId`. Introduce `subsystem_block` as the parent shell plus explicit `subsystem_in_port` and `subsystem_out_port` nodes inside child canvases. Implement the stable manual hierarchy first, then add multi-select and the wrap-into-subsystem workflow on top of the same data model.

**Tech Stack:** Vue 3, Vitest, legacy runtime overrides in `src/services/legacy-runtime.txt`, JavaScript ESM services, workbench snapshot serialization, existing simulation runtime

---

## File Structure

- Modify: `src/services/legacy-runtime.txt`
  - Add layered canvas state
  - Add subsystem node types, breadcrumb navigation, current-canvas rendering, boundary-port rendering, and wrap workflow
- Modify: `src/services/workbenchSnapshotService.js`
  - Serialize and restore hierarchical `canvases` state with backward compatibility
- Modify: `src/services/flightModelPackageService.js`
  - Accept layered `workbenchSnapshot` content
- Modify: `src/composables/useWorkbenchState.js`
  - Add subsystem defaults and selection metadata helpers if needed by snapshot/runtime bridges
- Modify: `src/constants/componentLibrary.js`
  - Add `subsystem_block` palette entry
- Modify: `src/fragments/canvas.html`
  - Add breadcrumb / layer-status mount points
- Modify: `src/styles/components.css`
  - Style subsystem shell, breadcrumb, and boundary-port nodes
- Create: `tests/subsystem-hierarchy.spec.js`
  - Unit tests for snapshot compatibility, interface normalization, and wrap algorithm helpers
- Create: `tests/subsystem-hierarchy-app.spec.js`
  - App tests for enter/exit, stable parent ports, and wrap workflow
- Modify: `README.md`
  - Document subsystem usage

### Task 1: Add hierarchical snapshot primitives with flat-graph compatibility

**Files:**
- Modify: `src/services/workbenchSnapshotService.js`
- Create: `tests/subsystem-hierarchy.spec.js`

- [ ] **Step 1: Write the failing snapshot compatibility tests**

Add tests that lock three behaviors:

```js
import { describe, expect, it } from 'vitest';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from '../src/services/workbenchSnapshotService.js';

describe('subsystem hierarchy snapshot compatibility', () => {
  it('wraps a flat graph into canvas-root during restore', () => {
    const restored = restoreWorkbenchSnapshot({
      version: 1,
      modelNodes: [{ id: 'node-1', type: 'signal_source', props: { name: 'Signal 1' } }],
      modelEdges: [{ id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }]
    });

    expect(restored.rootCanvasId).toBe('canvas-root');
    expect(restored.canvases['canvas-root'].nodes).toHaveLength(1);
    expect(restored.canvases['canvas-root'].edges).toHaveLength(1);
  });

  it('preserves hierarchical canvases during createWorkbenchSnapshot', () => {
    const snapshot = createWorkbenchSnapshot({
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      canvasTrail: ['canvas-root', 'canvas-child'],
      canvases: {
        'canvas-root': { id: 'canvas-root', name: '顶层', nodes: [], edges: [], viewport: { scale: 1, offsetX: 0, offsetY: 0 } },
        'canvas-child': { id: 'canvas-child', name: '子系统', nodes: [{ id: 'node-1', type: 'subsystem_in_port', props: { interfacePortId: 'in-1' } }], edges: [], viewport: { scale: 1, offsetX: 8, offsetY: 12 } }
      }
    });

    expect(snapshot.canvases['canvas-child'].nodes[0].type).toBe('subsystem_in_port');
    expect(snapshot.canvasTrail).toEqual(['canvas-root', 'canvas-child']);
  });

  it('falls back to empty layered defaults when canvases are missing', () => {
    const restored = restoreWorkbenchSnapshot({});
    expect(restored.rootCanvasId).toBe('canvas-root');
    expect(restored.canvases['canvas-root'].nodes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new subsystem snapshot tests to verify failure**

Run: `npm test -- --run tests/subsystem-hierarchy.spec.js`

Expected: FAIL because hierarchical snapshot fields do not exist yet.

- [ ] **Step 3: Implement layered snapshot normalization with backward compatibility**

Update `src/services/workbenchSnapshotService.js` so both create/restore support:

```js
function createEmptyCanvas(id = 'canvas-root', name = '顶层') {
  return {
    id,
    name,
    parentSubsystemNodeId: null,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    nodes: [],
    edges: []
  };
}

function normalizeCanvas(canvas, fallbackId = 'canvas-root') {
  const safeCanvas = isPlainObject(canvas) ? clone(canvas) : {};
  return {
    id: safeCanvas.id ?? fallbackId,
    name: safeCanvas.name ?? '未命名画布',
    parentSubsystemNodeId: safeCanvas.parentSubsystemNodeId ?? null,
    viewport: {
      scale: safeCanvas.viewport?.scale ?? 1,
      offsetX: safeCanvas.viewport?.offsetX ?? 0,
      offsetY: safeCanvas.viewport?.offsetY ?? 0
    },
    nodes: toSafeArray(safeCanvas.nodes).map((node) => ({ ...node })),
    edges: toSafeArray(safeCanvas.edges).map((edge) => ({ ...edge }))
  };
}
```

Also add flat-graph fallback:

```js
if (!safeSnapshot.canvases) {
  const rootCanvas = createEmptyCanvas();
  rootCanvas.nodes = toSafeArray(safeSnapshot.modelNodes).map((node) => ({ ...node }));
  rootCanvas.edges = toSafeArray(safeSnapshot.modelEdges).map((edge) => ({ ...edge }));
  return {
    version: 2,
    rootCanvasId: 'canvas-root',
    activeCanvasId: 'canvas-root',
    canvasTrail: ['canvas-root'],
    canvases: { 'canvas-root': rootCanvas },
    activeLineType: safeSnapshot.activeLineType ?? 'normal',
    faultedBlks: toSafeArray(safeSnapshot.faultedBlks),
    importedFaultModels: toSafeArray(safeSnapshot.importedFaultModels)
  };
}
```

- [ ] **Step 4: Re-run subsystem snapshot tests**

Run: `npm test -- --run tests/subsystem-hierarchy.spec.js`

Expected: PASS

### Task 2: Add subsystem node type, child canvases, and breadcrumb navigation

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/constants/componentLibrary.js`
- Modify: `src/fragments/canvas.html`
- Modify: `src/styles/components.css`
- Create: `tests/subsystem-hierarchy-app.spec.js`

- [ ] **Step 1: Write the failing app test for entering and leaving a subsystem**

Create the first app test:

```js
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

describe('subsystem hierarchy app', () => {
  it('enters a child canvas on subsystem double click and returns through breadcrumbs', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;
    window.createNode('subsystem_block', 420, 260);
    await flushRuntime();

    const subsystem = window.__GZ_STATE__.canvases['canvas-root'].nodes.find((node) => node.type === 'subsystem_block');
    window.openSubsystemCanvas(subsystem.id);
    await flushRuntime();

    expect(window.__GZ_STATE__.activeCanvasId).toBe(subsystem.props.targetCanvasId);
    expect(document.getElementById('canvas-breadcrumbs')?.textContent).toContain('顶层');
    expect(document.getElementById('canvas-breadcrumbs')?.textContent).toContain(subsystem.props.name);

    window.navigateToCanvas('canvas-root');
    await flushRuntime();

    expect(window.__GZ_STATE__.activeCanvasId).toBe('canvas-root');
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run the app test to verify failure**

Run: `npm test -- --run tests/subsystem-hierarchy-app.spec.js`

Expected: FAIL because `subsystem_block`, canvas breadcrumbs, and canvas navigation do not exist.

- [ ] **Step 3: Add subsystem palette entry and layered runtime state**

Extend `src/constants/componentLibrary.js`:

```js
export const systemModelingComponents = [
  { type: 'signal_source', label: '信号源' },
  { type: 'flow_block', label: '流程块' },
  { type: 'simulation_block', label: '仿真块' },
  { type: 'subsystem_block', label: '子系统' }
];
```

In `src/services/legacy-runtime.txt`, initialize:

```js
S.rootCanvasId = 'canvas-root';
S.activeCanvasId = 'canvas-root';
S.canvasTrail = ['canvas-root'];
S.canvases = {
  'canvas-root': {
    id: 'canvas-root',
    name: '顶层',
    parentSubsystemNodeId: null,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    nodes: [],
    edges: []
  }
};
```

Add helpers:

```js
function getActiveCanvas() { return S.canvases[S.activeCanvasId]; }
function getCanvasNodes(canvasId = S.activeCanvasId) { return S.canvases[canvasId]?.nodes || []; }
function getCanvasEdges(canvasId = S.activeCanvasId) { return S.canvases[canvasId]?.edges || []; }
function getCurrentNodes() { return getCanvasNodes(S.activeCanvasId); }
function getCurrentEdges() { return getCanvasEdges(S.activeCanvasId); }
```

- [ ] **Step 4: Add breadcrumb container and navigation actions**

Patch `src/fragments/canvas.html`:

```html
<div class="canvas-breadcrumbs" id="canvas-breadcrumbs"></div>
```

Add runtime helpers:

```js
function renderCanvasBreadcrumbs() {
  const el = document.getElementById('canvas-breadcrumbs');
  if (!el) return;
  el.innerHTML = S.canvasTrail.map((canvasId, index) => {
    const canvas = S.canvases[canvasId];
    const active = index === S.canvasTrail.length - 1;
    return `<button class="canvas-crumb${active ? ' is-active' : ''}" onclick="navigateToCanvas('${canvasId}')">${escapeHtml(canvas?.name || '未命名')}</button>`;
  }).join('<span class="canvas-crumb-sep">/</span>');
}

function openSubsystemCanvas(nodeId) {
  const node = getNode(nodeId);
  if (!node || node.type !== 'subsystem_block') return;
  S.activeCanvasId = node.props.targetCanvasId;
  S.canvasTrail = [...S.canvasTrail, node.props.targetCanvasId];
  S.selBlk = null;
  S.selEdge = null;
  renderCanvasBreadcrumbs();
  renderModelNodes();
  renderPropertyPanel(null);
}

function navigateToCanvas(canvasId) {
  const trailIndex = S.canvasTrail.indexOf(canvasId);
  if (trailIndex === -1) return;
  S.canvasTrail = S.canvasTrail.slice(0, trailIndex + 1);
  S.activeCanvasId = canvasId;
  S.selBlk = null;
  S.selEdge = null;
  renderCanvasBreadcrumbs();
  renderModelNodes();
  renderPropertyPanel(null);
}
```

- [ ] **Step 5: Re-run the subsystem navigation test**

Run: `npm test -- --run tests/subsystem-hierarchy-app.spec.js`

Expected: PASS

### Task 3: Add subsystem interface ports and internal boundary nodes

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Create: `tests/subsystem-hierarchy.spec.js`
- Modify: `tests/subsystem-hierarchy-app.spec.js`

- [ ] **Step 1: Add failing tests for stable interface ports**

Add a unit test:

```js
it('normalizes subsystem interface ports with stable ids and order', () => {
  const normalized = window.__GZ_SUBSYSTEM_HELPERS__.normalizeSubsystemInterface({
    inputs: [{ name: '输入 A' }],
    outputs: [{ name: '输出 B' }]
  });

  expect(normalized.inputs[0]).toMatchObject({ id: 'in-1', name: '输入 A', order: 0 });
  expect(normalized.outputs[0]).toMatchObject({ id: 'out-1', name: '输出 B', order: 0 });
});
```

Add an app test:

```js
it('renders subsystem shell ports from the interface definition', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  window.__GZ_STATE__.sysLoaded = true;
  window.createNode('subsystem_block', 420, 260);
  await flushRuntime();

  const subsystem = document.querySelector('.blk.b-subsystem');
  expect(subsystem?.querySelectorAll('.node-port--input').length).toBe(1);
  expect(subsystem?.querySelectorAll('.node-port--output').length).toBe(1);

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm test -- --run tests/subsystem-hierarchy.spec.js
npm test -- --run tests/subsystem-hierarchy-app.spec.js
```

Expected: FAIL because subsystem interface helpers and rendering do not exist.

- [ ] **Step 3: Implement interface normalization and boundary node factories**

Add helpers in `src/services/legacy-runtime.txt`:

```js
function normalizeSubsystemPortList(items = [], prefix = 'in') {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: item?.id || `${prefix}-${index + 1}`,
    name: item?.name || `${prefix === 'in' ? '输入' : '输出'} ${index + 1}`,
    type: item?.type || '标量',
    order: Number.isFinite(item?.order) ? item.order : index
  }));
}

function normalizeSubsystemInterface(interfaceDef = {}) {
  return {
    inputs: normalizeSubsystemPortList(interfaceDef.inputs, 'in'),
    outputs: normalizeSubsystemPortList(interfaceDef.outputs, 'out')
  };
}
```

When creating `subsystem_block`, also create its child canvas and default boundary nodes:

```js
const interfaceDef = normalizeSubsystemInterface({
  inputs: [{ name: '输入 1', type: '标量' }],
  outputs: [{ name: '输出 1', type: '标量' }]
});
```

- [ ] **Step 4: Render subsystem shell ports and child boundary nodes**

Update `getNodePorts(node)`:

```js
if (node.type === 'subsystem_block') {
  const interfaceDef = normalizeSubsystemInterface(node.props.interface);
  return {
    inputs: interfaceDef.inputs.map((item, index) => ({ ...item, kind: 'input', index, side: 'left' })),
    outputs: interfaceDef.outputs.map((item, index) => ({ ...item, kind: 'output', index, side: 'right' }))
  };
}
```

Update rendering class names so subsystem shells and boundary nodes get dedicated styling:

```js
const subsystem = node.type === 'subsystem_block';
el.className = `blk ${meta.className}${subsystem ? ' blk-subsystem-shell' : ''}`;
```

- [ ] **Step 5: Re-run subsystem interface tests**

Run:

```bash
npm test -- --run tests/subsystem-hierarchy.spec.js
npm test -- --run tests/subsystem-hierarchy-app.spec.js
```

Expected: PASS

### Task 4: Make simulation resolve subsystem inputs and outputs recursively

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `tests/subsystem-hierarchy.spec.js`
- Modify: `tests/subsystem-hierarchy-app.spec.js`

- [ ] **Step 1: Write the failing recursive-evaluation tests**

Add a unit-style runtime test:

```js
it('evaluates subsystem outputs from child canvas boundary nodes', () => {
  const result = window.__GZ_SUBSYSTEM_HELPERS__.evaluateSubsystemNode({
    subsystemNode: {
      id: 'node-sub',
      type: 'subsystem_block',
      props: {
        targetCanvasId: 'canvas-child',
        interface: {
          inputs: [{ id: 'in-1', name: '输入 1', type: '标量', order: 0 }],
          outputs: [{ id: 'out-1', name: '输出 1', type: '标量', order: 0 }]
        }
      }
    },
    inputValues: { 'in-1': { actual: 2 } },
    simulatedChildOutputs: { 'out-1': { actual: 1 } }
  });

  expect(result.outputs[0].actual).toBe(1);
});
```

Add an app test:

```js
it('propagates a signal through a subsystem boundary back to the parent shell', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  // Build a tiny graph: signal_source -> subsystem_block -> instrument_scope
  // Then enter subsystem and connect subsystem_in_port -> subsystem_out_port.
  // Initialize simulation and verify the scope receives a non-empty sample set.

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the subsystem runtime tests to verify failure**

Run:

```bash
npm test -- --run tests/subsystem-hierarchy.spec.js
npm test -- --run tests/subsystem-hierarchy-app.spec.js
```

Expected: FAIL because subsystem evaluation does not exist.

- [ ] **Step 3: Implement recursive subsystem evaluation**

Add helpers such as:

```js
function buildSubsystemBoundaryInputMap(subsystemNode, time, dt, cache, visiting) {
  const inputs = normalizeSubsystemInterface(subsystemNode.props.interface).inputs;
  const values = {};
  inputs.forEach((port, index) => {
    const incoming = getCurrentEdges().find((edge) => edge.targetNodeId === subsystemNode.id && (edge.targetPortIndex || 0) === index);
    values[port.id] = incoming ? resolveNodeOutputs(incoming.sourceNodeId, SIM.mode, time, dt, cache, visiting).outputs[incoming.sourcePortIndex || 0] : { actual: 0, reference: 0 };
  });
  return values;
}
```

Then treat `subsystem_in_port` and `subsystem_out_port` as runtime boundary nodes inside the child canvas.

- [ ] **Step 4: Re-run the subsystem runtime tests**

Run:

```bash
npm test -- --run tests/subsystem-hierarchy.spec.js
npm test -- --run tests/subsystem-hierarchy-app.spec.js
```

Expected: PASS

### Task 5: Add multi-select and wrap-into-subsystem

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/fragments/canvas.html`
- Modify: `src/styles/components.css`
- Modify: `tests/subsystem-hierarchy-app.spec.js`

- [ ] **Step 1: Write the failing wrap-workflow app test**

Add:

```js
it('wraps multiple selected nodes into a new subsystem and preserves external wiring', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  window.__GZ_STATE__.sysLoaded = true;
  // Create source -> sim -> sim -> scope graph.
  // Multi-select the two sim nodes.
  // Invoke wrapSelectionIntoSubsystem().
  // Assert parent canvas now contains one subsystem shell.
  // Assert child canvas contains the original two sim nodes plus boundary nodes.
  // Assert parent source/scope edges now terminate at the subsystem shell.

  wrapper.unmount();
});
```

- [ ] **Step 2: Run the wrap test to verify failure**

Run: `npm test -- --run tests/subsystem-hierarchy-app.spec.js`

Expected: FAIL because multi-select and wrap do not exist.

- [ ] **Step 3: Implement multi-select and wrap algorithm**

Add state:

```js
S.selBlks = [];
```

Add selection behavior:

```js
function toggleNodeSelection(id, additive = false) {
  if (!additive) {
    S.selBlks = [id];
  } else if (S.selBlks.includes(id)) {
    S.selBlks = S.selBlks.filter((item) => item !== id);
  } else {
    S.selBlks = [...S.selBlks, id];
  }
  S.selBlk = S.selBlks[S.selBlks.length - 1] || null;
}
```

Add wrap action:

```js
function wrapSelectionIntoSubsystem() {
  const selectedIds = [...S.selBlks];
  if (selectedIds.length < 2) {
    toast('请至少选中两个模块后再封装为子系统', 'w');
    return;
  }
  // Create subsystem shell, create child canvas, move internal nodes, split crossing edges,
  // generate interface ports, create subsystem_in_port / subsystem_out_port nodes.
}
```

- [ ] **Step 4: Re-run the wrap-workflow test**

Run: `npm test -- --run tests/subsystem-hierarchy-app.spec.js`

Expected: PASS

### Task 6: Persist hierarchy through model-package import/export and document the workflow

**Files:**
- Modify: `src/services/flightModelPackageService.js`
- Modify: `tests/flight-model-package.spec.js`
- Modify: `tests/flight-model-package-app.spec.js`
- Modify: `README.md`

- [ ] **Step 1: Add failing model-package hierarchy tests**

Append:

```js
it('exports layered workbench snapshots without flattening subsystem canvases', () => {
  const pkg = buildFlightModelPackage({
    meta: { modelId: 'hier-test', modelName: 'Hierarchy Test', description: '', source: { origin: 'test' } },
    state: {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-root',
      canvasTrail: ['canvas-root'],
      canvases: {
        'canvas-root': { id: 'canvas-root', name: '顶层', nodes: [{ id: 'node-sub', type: 'subsystem_block', props: { targetCanvasId: 'canvas-child', interface: { inputs: [], outputs: [] } } }], edges: [], viewport: { scale: 1, offsetX: 0, offsetY: 0 } },
        'canvas-child': { id: 'canvas-child', name: '子系统', nodes: [{ id: 'node-1', type: 'simulation_block', props: { name: 'Inner Sim' } }], edges: [], viewport: { scale: 1, offsetX: 0, offsetY: 0 } }
      }
    },
    faultLibrary: []
  });

  expect(pkg.workbenchSnapshot.canvases['canvas-child'].nodes[0].type).toBe('simulation_block');
});
```

- [ ] **Step 2: Run package tests to verify failure**

Run:

```bash
npm test -- --run tests/flight-model-package.spec.js
npm test -- --run tests/flight-model-package-app.spec.js
```

Expected: FAIL because package export/import still expects only flat snapshots.

- [ ] **Step 3: Update package export/import to preserve layered snapshots**

In `src/services/flightModelPackageService.js`, stop flattening snapshot content and accept the hierarchical fields as first-class snapshot state:

```js
const exportedSnapshot = createWorkbenchSnapshot(snapshotState);
```

Also ensure the validator accepts:

```js
if (!pkg?.workbenchSnapshot?.canvases && !Array.isArray(pkg?.workbenchSnapshot?.modelNodes)) {
  errors.push('workbenchSnapshot must provide canvases or modelNodes/modelEdges.');
}
```

- [ ] **Step 4: Document subsystem usage in README**

Append:

```md
## 子系统分层建模

### 手动创建子系统
- 在左侧组件栏拖入 `子系统`
- 双击进入内部画布
- 在右侧面板编辑输入/输出端口
- 在子系统内部使用 `子系统输入端口` / `子系统输出端口` 完成边界连线

### 封装为子系统
- 在同一层画布中多选多个模块
- 点击 `封装为子系统`
- 平台会自动生成子系统外壳、边界端口和内部边界节点
```

- [ ] **Step 5: Run integration and full verification**

Run:

```bash
npm test -- --run tests/subsystem-hierarchy.spec.js
npm test -- --run tests/subsystem-hierarchy-app.spec.js
npm test -- --run tests/flight-model-package.spec.js
npm test -- --run tests/flight-model-package-app.spec.js
npm test -- --run
npm run build
```

Expected:

- subsystem-specific tests PASS
- package tests PASS
- full Vitest suite PASS
- build PASS
