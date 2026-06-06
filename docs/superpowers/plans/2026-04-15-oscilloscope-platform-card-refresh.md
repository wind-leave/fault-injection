# Oscilloscope Platform Card Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the oscilloscope popup and Python-binding node ports so they match the platform's light theme while preserving dual-channel scope behavior and wiring usability.

**Architecture:** Keep the active runtime and DOM source of truth inside `src/services/legacy-runtime.txt`, with visual styling in `src/styles/dialogs.css` and `src/styles/components.css`. Use targeted regression tests in `tests/oscilloscope-app.spec.js` and `tests/python-binding-app.spec.js` to pin the new light-card structure, compact readout strips, and hidden Python port labels before updating markup and styles.

**Tech Stack:** Vue 3, Vitest, legacy DOM runtime bridge, CSS

---

## File Structure

- Modify: `src/services/legacy-runtime.txt`
  - Update active scope window markup and channel tag rendering
  - Keep window drag/close/focus behavior intact
  - Hide inline Python port labels while preserving `title` tooltips
  - Adjust runtime-injected Python port styles to match the smaller port markers
- Modify: `src/styles/dialogs.css`
  - Replace dark oscilloscope palette with platform-card light styling
  - Rebalance scope header, plot, toolbar, and compact statistics strip layout
- Modify: `src/styles/components.css`
  - Shrink visible port marker styling while retaining larger click target
- Modify: `tests/oscilloscope-app.spec.js`
  - Add assertions for header tags, button order, compact readout rows, and light-theme classes
- Modify: `tests/python-binding-app.spec.js`
  - Replace old text-content assertions for Python ports with DOM/tooltip assertions that match hidden inline labels

### Task 1: Lock the new light-scope UI in tests

**Files:**
- Modify: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Write the failing scope-window structure assertions**

Add a new assertion block to the existing dual-channel scope test so it verifies:

- the toolbar button order is `叠加`, `CH1`, `CH2`, `关闭 ×`
- the header renders `data-scope-tag="ch1"` and `data-scope-tag="ch2"` tags
- the statistics area renders `.scope-readout.scope-readout--strip` rows rather than two card-like columns

```js
const toolbarLabels = [
  ...document.querySelectorAll(`[data-scope-id="${scopeId}"] .scope-window__toolbar button`)
].map((button) => button.textContent?.trim());

expect(toolbarLabels).toEqual(['叠加', 'CH1', 'CH2', '关闭 ×']);
expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch1"]`)).not.toBeNull();
expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch2"]`)).not.toBeNull();
expect(document.querySelectorAll(`[data-scope-id="${scopeId}"] .scope-readout.scope-readout--strip`)).toHaveLength(2);
```

- [ ] **Step 2: Add a failing assertion for the light-card layout hooks**

Extend the close/drag test or add a dedicated test that verifies the scope window now exposes the light-theme DOM hooks:

```js
const scopeWindow = document.querySelector('.scope-window');
const titleBar = scopeWindow.querySelector('.scope-window__header');
const stats = scopeWindow.querySelector('.scope-window__stats');

expect(titleBar?.querySelector('.scope-window__signals')).not.toBeNull();
expect(stats?.classList.contains('scope-window__stats--strip')).toBe(true);
```

- [ ] **Step 3: Run the targeted oscilloscope spec to confirm failure**

Run: `npm test -- --run tests/oscilloscope-app.spec.js`

Expected: FAIL with missing toolbar order, missing `data-scope-tag` elements, or missing strip-readout classes.

- [ ] **Step 4: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; note this in the execution log and do not attempt a commit for this workspace.

### Task 2: Lock Python-port decluttering in tests

**Files:**
- Modify: `tests/python-binding-app.spec.js`

- [ ] **Step 1: Replace visible-label assertions with hidden-label expectations**

Update the Python-binding node test so it stops expecting inline port names in the card text and instead checks that:

- the node title still includes `pid_controller.py`
- Python port buttons keep `title` tooltip text
- `.node-port__label` is not rendered inside the Python-bound simulation block

```js
const reboundBlock = document.getElementById(`b-${simId}`);
const inputPorts = [...reboundBlock.querySelectorAll('.node-port--input')];

expect(reboundBlock?.textContent).toContain('pid_controller.py');
expect(reboundBlock?.querySelectorAll('.node-port__label')).toHaveLength(0);
expect(inputPorts[0]?.getAttribute('title')).toContain('error');
expect(inputPorts[1]?.getAttribute('title')).toContain('dt');
```

- [ ] **Step 2: Add a failing size/style guard for the compact Python ports**

Add a DOM-level assertion that the rendered Python-bound node still has the expected number of ports and that each port retains the button wrapper used for click/drag wiring:

```js
expect(reboundBlock?.querySelectorAll('button.node-port').length).toBe(4);
expect(reboundBlock?.querySelector('.node-port .node-port__inner')).not.toBeNull();
```

- [ ] **Step 3: Run the targeted Python-binding spec to confirm failure**

Run: `npm test -- --run tests/python-binding-app.spec.js`

Expected: FAIL because `.node-port__label` elements are still present and the test still sees inline labels.

- [ ] **Step 4: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 3: Implement the light-card oscilloscope markup and theme

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/dialogs.css`
- Test: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Update the active scope-window markup in `legacy-runtime.txt`**

Replace the current header/meta/readout structure with:

- a left title + signal-tag block
- a right toolbar ordered as `叠加`, `CH1`, `CH2`, `关闭 ×`
- a stats container marked with `scope-window__stats scope-window__stats--strip`
- two `.scope-readout.scope-readout--strip` rows

```js
<header class="scope-window__header" data-scope-drag-handle="${scopeWindow.scopeId}">
  <div class="scope-window__identity">
    <div class="scope-window__title">${escapeHtml(node?.props?.name || node?.name || '示波器')}</div>
    <div class="scope-window__signals">
      <span class="scope-window__tag" data-scope-tag="ch1">CH1: ${escapeHtml(getScopeChannelSignalName(node, 'ch1'))}</span>
      <span class="scope-window__tag" data-scope-tag="ch2">CH2: ${escapeHtml(getScopeChannelSignalName(node, 'ch2'))}</span>
    </div>
  </div>
  <div class="scope-window__toolbar">
    <button type="button" class="scope-window__mode${mode==='overlay' ? ' is-active' : ''}" data-scope-mode="overlay" data-scope-id="${scopeWindow.scopeId}">叠加</button>
    <button type="button" class="scope-window__mode${mode==='ch1' ? ' is-active' : ''}" data-scope-mode="ch1" data-scope-id="${scopeWindow.scopeId}">CH1</button>
    <button type="button" class="scope-window__mode${mode==='ch2' ? ' is-active' : ''}" data-scope-mode="ch2" data-scope-id="${scopeWindow.scopeId}">CH2</button>
    <button type="button" class="scope-window__close" data-scope-close="${scopeWindow.scopeId}">关闭 ×</button>
  </div>
</header>
```

- [ ] **Step 2: Rework the scope styles in `dialogs.css` to the approved light palette**

Replace the dark palette rules with light-card styling and grow the plot area while flattening the readouts into strips:

```css
.scope-window{position:absolute;width:448px;min-height:328px;padding:12px;border:1.5px solid #d6e4f0;border-radius:18px;background:#fff;box-shadow:0 18px 36px rgba(30,58,95,0.16);pointer-events:auto;}
.scope-window__header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;padding:12px 14px;border:1px solid #e2eef8;border-radius:14px;background:#f0f5fb;color:#1e3a5f;cursor:move;touch-action:none;}
.scope-window__signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.scope-window__tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px solid #d6e4f0;border-radius:999px;background:#fff;color:#58789b;font-size:10px;}
.scope-window__plot{height:214px;border-radius:14px;background:#f9fbfe;border:1px solid #d6e4f0;overflow:hidden;}
.scope-window__stats--strip{margin-top:10px;display:flex;flex-direction:column;gap:8px;}
.scope-readout--strip{display:grid;grid-template-columns:56px repeat(4,minmax(0,1fr));gap:8px;align-items:center;padding:8px 10px;border:1px solid #e2eef8;border-radius:12px;background:#f7fafd;}
```

- [ ] **Step 3: Keep the existing behavior hooks intact while wiring the new markup**

After changing the DOM shape, make sure the existing event listeners still target:

- `[data-scope-drag-handle]`
- `[data-scope-close]`
- `[data-scope-mode]`

Do not reintroduce any `innerHTML` redraw pattern inside the focus handler.

```js
host.querySelectorAll('.scope-window').forEach((el) => {
  el.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-scope-close],[data-scope-mode],[data-scope-drag-handle]')) {
      return;
    }
    const scopeWindow = focusScopeWindow(el.dataset.scopeId || '');
    el.style.zIndex = scopeWindow.z;
  });
});
```

- [ ] **Step 4: Run the oscilloscope spec and fix until it passes**

Run: `npm test -- --run tests/oscilloscope-app.spec.js`

Expected: PASS

- [ ] **Step 5: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 4: Implement Python-port decluttering without breaking wiring

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Test: `tests/python-binding-app.spec.js`

- [ ] **Step 1: Gate inline port labels for Python-bound nodes**

Adjust the node renderer so `appendPortLabel(portEl, port)` is skipped when rendering ports for a Python-bound simulation block, but keep the `title` tooltip assignment exactly as it is now.

```js
const showInlinePortLabel = !(pythonBound && node.type === 'simulation_block');

if (showInlinePortLabel) {
  appendPortLabel(portEl, port);
}
```

- [ ] **Step 2: Shrink the visible port styling while preserving the click target**

Update `components.css` and the runtime-injected Python styles so the button wrapper stays at `16px`, while the visible dot becomes a compact `6px` marker with a lighter fill and darker stroke.

```css
.node-port{width:16px;height:16px;border-radius:50%;border:none;background:transparent;box-shadow:none;}
.node-port__inner{width:6px;height:6px;border-radius:50%;border:1.5px solid currentColor;background:color-mix(in srgb,currentColor 18%,#ffffff);}
.node-port--active .node-port__inner{box-shadow:0 0 0 4px color-mix(in srgb,currentColor 18%,transparent);}
```

- [ ] **Step 3: Remove runtime label-only rules that are no longer needed for Python nodes**

Keep the shared `.node-port__label` CSS for non-Python nodes if still in use, but do not leave Python-only assumptions in the runtime style block.

```js
style.textContent = `
  .blk.python-bound{border-color:rgba(49,114,222,0.92);box-shadow:0 16px 28px rgba(40,102,196,0.18);}
  .node-card__python-chip{position:absolute;left:10px;top:8px;z-index:2;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:linear-gradient(135deg,#387dff 0%,#63a7ff 100%);color:#fff;font:700 10px/1 "JetBrains Mono","Consolas",monospace;box-shadow:0 8px 18px rgba(56,125,255,0.22);}
  .node-port.is-connected .node-port__inner{background:currentColor;box-shadow:0 0 0 2px rgba(255,255,255,0.9),0 0 0 4px rgba(56,125,255,0.18);}
  .node-port__label{position:absolute;font:600 10px/1.15 "JetBrains Mono","Consolas",monospace;color:#365a84;white-space:nowrap;pointer-events:none;}
`;
```

- [ ] **Step 4: Run the Python-binding spec and fix until it passes**

Run: `npm test -- --run tests/python-binding-app.spec.js`

Expected: PASS

- [ ] **Step 5: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.

### Task 5: Full verification and manual sanity check

**Files:**
- Modify: `tests/oscilloscope-app.spec.js`
- Modify: `tests/python-binding-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/dialogs.css`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test -- --run`

Expected: PASS with all oscilloscope and Python-binding integration tests green.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: PASS and emit the production bundle without CSS/runtime regressions.

- [ ] **Step 3: Manual browser sanity check for the approved verification path**

Run the app locally and confirm:

- one scope window can be opened for a scope node
- the window is light-themed and visually consistent with the platform
- `叠加` mode clearly shows the half-amplitude relationship between `CH1` and `CH2`
- the compact statistics strips make `CH2` peak-to-peak easier to compare with `CH1`
- Python-binding nodes no longer show long inline port labels, but still reveal port meaning through hover tooltips

- [ ] **Step 4: Record the no-git limitation instead of committing**

Run: `git status`

Expected: FAIL with `not a git repository`; do not attempt a commit.
