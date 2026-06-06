# Blank Workspace And Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit `新建空白模型` and always-confirmed `重置画布` flows so users can build from a clean workspace without importing a model package first.

**Architecture:** Keep the existing import workflow, but decouple “workspace is active” from “workspace came from an imported package” by introducing `workspaceSource`. Reuse a single runtime reset helper for both blank-workspace creation and confirmed reset so root canvas, child canvases, package status, simulation state, and injected-fault state stay consistent.

**Tech Stack:** Vue 3, Vitest, legacy runtime overrides in `src/services/legacy-runtime.txt`, HTML fragments, CSS toolbar styling, localStorage snapshot persistence

---

## File Structure

- Modify: `src/services/legacy-runtime.txt`
  - Add `workspaceSource`
  - Add blank-workspace/reset helpers
  - Wire toolbar handlers, confirmation flow, status copy, and reset cleanup
- Modify: `src/fragments/header.html`
  - Add `新建空白模型` and `重置画布` buttons
- Modify: `src/fragments/canvas.html`
  - Update empty-state copy to present both entry paths
- Modify: `src/styles/components.css`
  - Style the new toolbar buttons
- Modify: `tests/python-binding-app.spec.js`
  - Add blank-workspace authoring/save flow tests
- Modify: `tests/flight-model-package-app.spec.js`
  - Add reset confirmation and imported-to-blank reset tests

### Task 1: Add blank-workspace and reset regression tests

**Files:**
- Modify: `tests/python-binding-app.spec.js`
- Modify: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing blank-workspace tests**

Add to `tests/python-binding-app.spec.js`:

```js
it('creates a blank workspace that allows direct modeling and saving', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

  window.doCreateBlankWorkspace();
  await flushRuntime();

  expect(window.__GZ_STATE__.sysLoaded).toBe(true);
  expect(window.__GZ_STATE__.workspaceSource).toBe('blank');

  window.createNode('simulation_block', 420, 320);
  await flushRuntime();

  expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);

  window.doSaveSys();
  await flushRuntime();

  expect(setItemSpy).toHaveBeenCalled();
  expect(document.getElementById('stxt')?.textContent).toContain('空白模型工作区');

  wrapper.unmount();
});

it('shows both import and blank-workspace actions in the empty state', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  expect(document.getElementById('empty')?.textContent).toContain('导入系统模型');
  expect(document.getElementById('empty')?.textContent).toContain('新建空白模型');

  wrapper.unmount();
});
```

- [ ] **Step 2: Write the failing reset-flow tests**

Add to `tests/flight-model-package-app.spec.js`:

```js
it('always confirms before resetting and leaves the workspace untouched when cancelled', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  window.doCreateBlankWorkspace();
  window.createNode('simulation_block', 420, 320);
  await flushRuntime();

  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

  window.doResetWorkspace();
  await flushRuntime();

  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(window.__GZ_STATE__.workspaceSource).toBe('blank');
  expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);

  wrapper.unmount();
});

it('resets an imported package workspace back to a clean blank workspace', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
  await flushRuntime();
  expect(importResult).toMatchObject({ ok: true });

  vi.spyOn(window, 'confirm').mockReturnValue(true);

  window.doResetWorkspace();
  await flushRuntime();

  expect(window.__GZ_STATE__.workspaceSource).toBe('blank');
  expect(window.__GZ_STATE__.activeModelPackage).toBeNull();
  expect(window.__GZ_STATE__.modelNodes).toHaveLength(0);
  expect(window.__GZ_STATE__.canvasTrail).toEqual(['canvas-root']);

  wrapper.unmount();
});
```

- [ ] **Step 3: Run the new tests to verify failure**

Run:

```bash
npm test -- --run tests/python-binding-app.spec.js tests/flight-model-package-app.spec.js
```

Expected:
- FAIL because `doCreateBlankWorkspace`, `doResetWorkspace`, `workspaceSource`, and the new empty-state copy do not exist yet

- [ ] **Step 4: Commit**

```bash
git add tests/python-binding-app.spec.js tests/flight-model-package-app.spec.js
git commit -m "test: cover blank workspace and reset flows"
```

### Task 2: Implement toolbar actions, workspace source, and reset cleanup

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/fragments/header.html`
- Modify: `src/fragments/canvas.html`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Add toolbar buttons and empty-state copy**

Patch `src/fragments/header.html` to add:

```html
<button class="tbtn tbtn-new-sys" onclick="doCreateBlankWorkspace()" id="btn-new-sys">新建空白模型</button>
<button class="tbtn tbtn-reset-sys" onclick="doResetWorkspace()" id="btn-reset-sys">重置画布</button>
```

Patch `src/fragments/canvas.html` empty-state content to:

```html
<div class="empty-txt">可导入系统模型，也可新建空白模型后开始建模</div>
<div class="empty-sub">点击右上角“导入系统模型”或“新建空白模型”开始。</div>
```

- [ ] **Step 2: Add minimal runtime state and blank-workspace helpers**

In `src/services/legacy-runtime.txt`, extend the root state:

```js
workspaceSource:'',
```

Add helpers:

```js
function createFreshBlankWorkspaceState() {
  return {
    rootCanvasId: 'canvas-root',
    activeCanvasId: 'canvas-root',
    canvasTrail: ['canvas-root'],
    canvases: {
      'canvas-root': {
        id: 'canvas-root',
        name: '顶层',
        parentSubsystemNodeId: null,
        viewport: { scale: 1, offsetX: 0, offsetY: 0 },
        nodes: [],
        edges: []
      }
    }
  };
}

function applyFreshBlankWorkspace(options = {}) {
  const fresh = createFreshBlankWorkspaceState();
  S.rootCanvasId = fresh.rootCanvasId;
  S.activeCanvasId = fresh.activeCanvasId;
  S.canvasTrail = fresh.canvasTrail;
  S.canvases = fresh.canvases;
  S.modelNodes = [];
  S.modelEdges = [];
  S.nodeSeq = 0;
  S.edgeSeq = 0;
  S.selBlk = null;
  S.selBlks = [];
  S.selEdge = null;
  S.pendingConnection = null;
  S.activeModelPackage = null;
  S.availableFaultModels = [];
  S.importedFaultModels = [];
  S.faultedBlks = [];
  S.scopeWindows = [];
  S.scopeWindowSeq = 0;
  S.sysLoaded = true;
  S.systemSaved = false;
  S.workspaceSource = 'blank';
  S.step = 1;
  if(options.toastMessage){toast(options.toastMessage,'s');}
  renderCanvasBreadcrumbs?.();
  renderModelNodes();
  renderScopeWindows?.();
  renderPropertyPanel(null);
  updateUI();
}
```

- [ ] **Step 3: Add create/reset handlers and status copy**

Still in `src/services/legacy-runtime.txt`, add:

```js
function doCreateBlankWorkspace() {
  applyFreshBlankWorkspace({ toastMessage: '空白模型工作区已创建' });
}

function doResetWorkspace() {
  const ok = window.confirm('确认重置当前画布吗？此操作会清空当前系统及其子系统内容。');
  if (!ok) { return; }
  applyFreshBlankWorkspace({ toastMessage: '画布已重置为空白模型工作区' });
}
```

Update `updateUI()` status branch to prefer:

```js
let statusText='就绪 · 等待导入系统模型';
if (!S.sysLoaded) {
  statusText = '就绪 · 可导入系统模型或新建空白模型';
} else if (S.workspaceSource === 'blank') {
  statusText = '就绪 · 空白模型工作区';
} else if (S.workspaceSource === 'legacy') {
  statusText = '就绪 · 已恢复本地系统模型';
}
```

Also replace import-only warnings where modeling is the real prerequisite:

```js
toast('请先新建空白模型或导入系统模型','w');
```

- [ ] **Step 4: Add toolbar styling**

In `src/styles/components.css`, add:

```css
.tbtn-new-sys{border-color:var(--amber);color:var(--amber);background:var(--amber-bg);}
.tbtn-new-sys:hover{background:#fdf1cf!important;}
.tbtn-reset-sys{border-color:#ef4444;color:#ef4444;background:#fff5f5;}
.tbtn-reset-sys:hover{background:#ffe4e6!important;}
```

- [ ] **Step 5: Run targeted verification**

Run:

```bash
npm test -- --run tests/python-binding-app.spec.js tests/flight-model-package-app.spec.js
```

Expected:
- PASS with the new blank/reset tests green

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test -- --run
npm run build
```

Expected:
- full Vitest suite PASS
- build PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/legacy-runtime.txt src/fragments/header.html src/fragments/canvas.html src/styles/components.css tests/python-binding-app.spec.js tests/flight-model-package-app.spec.js
git commit -m "feat: add blank workspace and reset flow"
```
