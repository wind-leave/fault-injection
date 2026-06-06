# Oscilloscope Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-overlay oscilloscope with sharp dual-channel floating instrument windows so users can compare CH1 and CH2 directly on the canvas and verify half-amplitude scaling visually and numerically.

**Architecture:** Keep the Vue shell unchanged and implement the upgrade inside the existing `src/services/legacy-runtime.txt` bridge. Add a dedicated scope-window host inside the canvas, retire the old modal-only scope markup, and move scope state to explicit per-scope window and per-channel sample structures so multiple windows can stay open without fighting over one global active scope.

**Tech Stack:** Vue 3, Vite, Vitest, jsdom, legacy runtime bridge, static HTML fragments, CSS.

---

## File Structure

- `tests/oscilloscope-app.spec.js`
  Responsibility: focused integration regression coverage for scope ports, floating window lifecycle, mode toggles, numeric readouts, and device-pixel-ratio-aware canvas sizing.
- `src/fragments/canvas.html`
  Responsibility: add the dedicated scope window layer inside the existing canvas stack so windows float above the diagram instead of hijacking the page layer.
- `src/fragments/dialogs/scope-dialog.html`
  Responsibility: remove the old global `ov-scope` instrument markup and replace it with a harmless stub so `ScopeDialog.vue` does not inject duplicate scope UI.
- `src/styles/dialogs.css`
  Responsibility: style floating scope windows, header controls, mode buttons, stat cards, and the sharper plot container.
- `src/services/legacy-runtime.txt`
  Responsibility: upgrade `instrument_scope` to two input ports, maintain per-scope window registry, collect channel-separated samples, render live readouts, and draw sharp waveforms.

### Task 1: Lock The New Scope Window Lifecycle With Failing Tests

**Files:**
- Create: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Write shared mount and interaction helpers**

```js
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

async function mountWorkbench() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  return wrapper;
}

function dispatchDoubleClick(target) {
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

function getScopeWindows() {
  return [...document.querySelectorAll('.scope-window')];
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = '';
  __resetLegacyRuntimeForTests();
});
```

- [ ] **Step 2: Write the failing port and multi-window test**

```js
it('opens one floating window per scope node and exposes CH1/CH2 ports', async () => {
  const wrapper = await mountWorkbench();

  window.createNode('instrument_scope', 320, 220);
  window.createNode('instrument_scope', 620, 260);
  await flushRuntime();

  const scopeNodes = [...document.querySelectorAll('.blk.b-inst')];
  expect(scopeNodes).toHaveLength(2);
  expect(scopeNodes[0].querySelectorAll('.node-port--input')).toHaveLength(2);

  dispatchDoubleClick(scopeNodes[0]);
  await flushRuntime();
  dispatchDoubleClick(scopeNodes[1]);
  await flushRuntime();

  const windows = getScopeWindows();
  expect(windows).toHaveLength(2);
  expect(windows[0].dataset.scopeId).not.toBe(windows[1].dataset.scopeId);

  wrapper.unmount();
});
```

- [ ] **Step 3: Write the failing focus-without-duplicate test**

```js
it('focuses an existing scope window when the same node is reopened', async () => {
  const wrapper = await mountWorkbench();

  window.createNode('instrument_scope', 420, 240);
  await flushRuntime();

  const scopeNode = document.querySelector('.blk.b-inst');
  const scopeId = scopeNode.id.replace('b-', '');

  dispatchDoubleClick(scopeNode);
  await flushRuntime();
  const firstWindow = document.querySelector(`.scope-window[data-scope-id="${scopeId}"]`);
  const originalZ = Number(firstWindow.style.zIndex || 0);

  dispatchDoubleClick(scopeNode);
  await flushRuntime();

  const reopenedWindows = document.querySelectorAll(`.scope-window[data-scope-id="${scopeId}"]`);
  expect(reopenedWindows).toHaveLength(1);
  expect(Number(reopenedWindows[0].style.zIndex || 0)).toBeGreaterThanOrEqual(originalZ);

  wrapper.unmount();
});
```

- [ ] **Step 4: Run the targeted test file and confirm it fails for the right reasons**

Run: `npm test -- --run tests/oscilloscope-app.spec.js`

Expected: FAIL because the scope node still has one input, no `.scope-window` elements exist, and re-opening the node still routes through the old single-overlay path.

- [ ] **Step 5: Create a task checkpoint**

```powershell
if (Test-Path .git) {
  git add tests/oscilloscope-app.spec.js
  git commit -m "test: cover oscilloscope window lifecycle"
} else {
  Write-Host "No git metadata in this workspace; keep the new test file in place and continue."
}
```

### Task 2: Implement The Canvas-Local Floating Window Shell

**Files:**
- Modify: `src/fragments/canvas.html`
- Modify: `src/fragments/dialogs/scope-dialog.html`
- Modify: `src/styles/dialogs.css`
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Add a dedicated scope window layer to the canvas**

```html
<div class="canvas-viewport" id="canvas-viewport">
  <div class="canvas-stage" id="canvas-stage">
    <div class="canvas-stage-grid"></div>
    <svg class="edge-layer" id="edge-layer" viewBox="0 0 1600 980" preserveAspectRatio="none">
      ...
    </svg>
    <div class="node-layer" id="node-layer"></div>
    <div class="scope-window-layer" id="scope-window-layer" aria-live="polite"></div>
  </div>
</div>
```

- [ ] **Step 2: Replace the old modal scope fragment with a harmless stub**

```html
<div class="scope-dialog-stub" id="ov-scope" hidden data-scope-dialog-stub="true"></div>
```

- [ ] **Step 3: Add floating instrument window styles**

```css
.scope-window-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.scope-window {
  position: absolute;
  width: 420px;
  min-height: 308px;
  border: 1px solid rgba(120, 146, 179, 0.4);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(9, 16, 28, 0.98), rgba(15, 24, 40, 0.96));
  box-shadow: 0 20px 45px rgba(2, 8, 20, 0.35);
  pointer-events: auto;
}

.scope-window__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: move;
}

.scope-window__plot {
  height: 188px;
  border-radius: 14px;
  background: #09101c;
  overflow: hidden;
}
```

- [ ] **Step 4: Replace the single-active-scope logic with a reusable window registry**

```js
function ensureScopeWindowStore() {
  SIM.scopeWindows = SIM.scopeWindows || {};
  SIM.scopeWindowZ = SIM.scopeWindowZ || 20;
}

function ensureScopeWindow(scopeId) {
  ensureScopeWindowStore();
  const existing = SIM.scopeWindows[scopeId];
  if (existing) {
    existing.open = true;
    return existing;
  }
  const index = Object.keys(SIM.scopeWindows).length;
  const created = {
    scopeId,
    open: true,
    mode: 'overlay',
    x: 56 + index * 28,
    y: 72 + index * 24,
    z: ++SIM.scopeWindowZ
  };
  SIM.scopeWindows[scopeId] = created;
  return created;
}

function focusScopeWindow(scopeId) {
  const scopeWindow = ensureScopeWindow(scopeId);
  scopeWindow.z = ++SIM.scopeWindowZ;
}

function openScope(scopeId = '') {
  const resolvedScopeId = scopeId || getScopeNodes()[0]?.id || '';
  if (!resolvedScopeId) return;
  ensureScopeWindow(resolvedScopeId);
  focusScopeWindow(resolvedScopeId);
  renderScopeWindows();
}
```

- [ ] **Step 5: Upgrade scope node ports and render the window shells**

```js
case 'instrument_scope':
  return {
    inputs: [
      { name: 'CH1', type: 'signal' },
      { name: 'CH2', type: 'signal' }
    ],
    outputs: []
  };
```

```js
function renderScopeWindows() {
  const host = document.getElementById('scope-window-layer');
  if (!host) return;
  host.innerHTML = Object.values(SIM.scopeWindows || {})
    .filter((scopeWindow) => scopeWindow.open && getNode(scopeWindow.scopeId))
    .sort((a, b) => a.z - b.z)
    .map((scopeWindow) => `
      <section class="scope-window" data-scope-id="${scopeWindow.scopeId}"
        style="left:${scopeWindow.x}px;top:${scopeWindow.y}px;z-index:${scopeWindow.z}">
        <header class="scope-window__header" data-scope-drag-handle="true">
          <strong>${getNode(scopeWindow.scopeId)?.name || '示波器'}</strong>
          <button type="button" data-scope-close="${scopeWindow.scopeId}">关闭</button>
        </header>
        <div class="scope-window__plot">
          <canvas data-scope-role="wave-canvas"></canvas>
        </div>
      </section>
    `)
    .join('');
}
```

- [ ] **Step 6: Run the lifecycle test file and verify it passes**

Run: `npm test -- --run tests/oscilloscope-app.spec.js -t "opens one floating window per scope node and exposes CH1/CH2 ports|focuses an existing scope window when the same node is reopened"`

Expected: PASS. Two input ports render on each scope node, two different scope windows can stay open, and reopening one scope does not create a duplicate window.

- [ ] **Step 7: Create a task checkpoint**

```powershell
if (Test-Path .git) {
  git add src/fragments/canvas.html src/fragments/dialogs/scope-dialog.html src/styles/dialogs.css src/services/legacy-runtime.txt tests/oscilloscope-app.spec.js
  git commit -m "feat: add floating oscilloscope windows"
} else {
  Write-Host "No git metadata in this workspace; keep the floating-window changes staged mentally and continue."
}
```

### Task 3: Lock Readouts, Mode Toggles, And DPR Sizing With Failing Tests

**Files:**
- Modify: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Add a deterministic canvas-size mock for jsdom**

```js
const plotRect = {
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  top: 0,
  left: 0,
  right: 320,
  bottom: 180,
  toJSON() { return this; }
};

const rectSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(plotRect);
Object.defineProperty(window, 'devicePixelRatio', {
  value: 2,
  configurable: true
});
```

- [ ] **Step 2: Add the failing mode-toggle and readout regression test**

```js
it('toggles CH1, CH2, and overlay views while showing per-channel readouts', async () => {
  const wrapper = await mountWorkbench();

  window.createNode('instrument_scope', 460, 260);
  await flushRuntime();

  const scopeNode = document.querySelector('.blk.b-inst');
  const scopeId = scopeNode.id.replace('b-', '');
  window.__GZ_SIM__.actual.scopeSamples[scopeId] = {
    ch1: [{ t: 0, actual: -1 }, { t: 1, actual: 1 }],
    ch2: [{ t: 0, actual: -0.5 }, { t: 1, actual: 0.5 }]
  };

  dispatchDoubleClick(scopeNode);
  await flushRuntime();

  document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-mode="ch2"]`)?.click();
  await flushRuntime();
  document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-mode="overlay"]`)?.click();
  await flushRuntime();

  expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-channel="ch1"] [data-field="pp"]`)?.textContent).toContain('2.00');
  expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-channel="ch2"] [data-field="pp"]`)?.textContent).toContain('1.00');

  wrapper.unmount();
});
```

- [ ] **Step 3: Add the failing DPR-aware canvas sizing test**

```js
it('sizes the waveform canvas with device-pixel-ratio awareness', async () => {
  const wrapper = await mountWorkbench();

  window.createNode('instrument_scope', 420, 240);
  await flushRuntime();

  const scopeNode = document.querySelector('.blk.b-inst');
  dispatchDoubleClick(scopeNode);
  await flushRuntime();

  const waveCanvas = document.querySelector('.scope-window [data-scope-role="wave-canvas"]');
  expect(waveCanvas.width).toBe(640);
  expect(waveCanvas.height).toBe(360);

  wrapper.unmount();
});
```

- [ ] **Step 4: Run the targeted test file and confirm the new assertions fail**

Run: `npm test -- --run tests/oscilloscope-app.spec.js -t "toggles CH1, CH2, and overlay views while showing per-channel readouts|sizes the waveform canvas with device-pixel-ratio awareness"`

Expected: FAIL because the current window shell has no mode buttons, no readout fields, and the canvas still uses 1x backing resolution.

- [ ] **Step 5: Create a task checkpoint**

```powershell
if (Test-Path .git) {
  git add tests/oscilloscope-app.spec.js
  git commit -m "test: cover oscilloscope readouts and dpr sizing"
} else {
  Write-Host "No git metadata in this workspace; keep the failing readout tests and continue."
}
```

### Task 4: Implement Dual-Channel Sampling, Readouts, And Sharp Rendering

**Files:**
- Modify: `src/styles/dialogs.css`
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Store scope samples per channel instead of as one mixed array**

```js
function ensureScopeSampleBucket(scopeId) {
  SIM.actual.scopeSamples = SIM.actual.scopeSamples || {};
  SIM.actual.scopeSamples[scopeId] = SIM.actual.scopeSamples[scopeId] || {
    ch1: [],
    ch2: []
  };
  return SIM.actual.scopeSamples[scopeId];
}

function getScopeChannelKey(portIndex) {
  return portIndex === 1 ? 'ch2' : 'ch1';
}

function pushScopeChannelSample(scopeId, channelKey, sample) {
  const bucket = ensureScopeSampleBucket(scopeId);
  const channelSamples = bucket[channelKey];
  channelSamples.push(sample);
  if (channelSamples.length > 600) channelSamples.shift();
}
```

- [ ] **Step 2: Rewrite `recordScopeSamples` to populate `ch1` and `ch2` explicitly**

```js
recordScopeSamples = function(time, dt) {
  getScopeNodes().forEach((scopeNode) => {
    const incomingEdges = getIncomingEdgesForNode(scopeNode.id);
    incomingEdges.forEach((incomingEdge) => {
      const sourceNode = getNode(incomingEdge.sourceNodeId);
      const outputValue = getNodeOutputValue(sourceNode, incomingEdge.sourcePortIndex || 0);
      const channelKey = getScopeChannelKey(incomingEdge.targetPortIndex || 0);
      pushScopeChannelSample(scopeNode.id, channelKey, {
        t: time,
        actual: Number(outputValue) || 0
      });
    });
  });
};
```

- [ ] **Step 3: Add summary helpers and renderable mode state**

```js
function formatScopeMetric(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function summarizeScopeChannel(samples) {
  if (!samples.length) {
    return { current: '--', min: '--', max: '--', pp: '--', connected: false };
  }
  const values = samples.map((sample) => sample.actual);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    current: formatScopeMetric(values.at(-1)),
    min: formatScopeMetric(min),
    max: formatScopeMetric(max),
    pp: formatScopeMetric(max - min),
    connected: true
  };
}

function setScopeDisplayMode(scopeId, mode) {
  const scopeWindow = ensureScopeWindow(scopeId);
  scopeWindow.mode = mode;
  renderScopeWindows();
  drawScopeWindow(scopeId);
}
```

- [ ] **Step 4: Render the new instrument controls and readout cards**

```js
function renderScopeWindows() {
  const host = document.getElementById('scope-window-layer');
  if (!host) return;
  host.innerHTML = Object.values(SIM.scopeWindows || {})
    .filter((scopeWindow) => scopeWindow.open && getNode(scopeWindow.scopeId))
    .sort((a, b) => a.z - b.z)
    .map((scopeWindow) => {
      const bucket = ensureScopeSampleBucket(scopeWindow.scopeId);
      const ch1 = summarizeScopeChannel(bucket.ch1);
      const ch2 = summarizeScopeChannel(bucket.ch2);
      return `
        <section class="scope-window" data-scope-id="${scopeWindow.scopeId}" style="left:${scopeWindow.x}px;top:${scopeWindow.y}px;z-index:${scopeWindow.z}">
          <header class="scope-window__header" data-scope-drag-handle="true">
            <strong>${getNode(scopeWindow.scopeId)?.name || '示波器'}</strong>
            <div class="scope-window__modes">
              <button type="button" data-scope-mode="ch1">CH1</button>
              <button type="button" data-scope-mode="ch2">CH2</button>
              <button type="button" data-scope-mode="overlay">叠加</button>
            </div>
          </header>
          <div class="scope-window__plot"><canvas data-scope-role="wave-canvas"></canvas></div>
          <div class="scope-window__stats">
            <article data-scope-channel="ch1" data-connected="${ch1.connected}">
              <span data-field="current">${ch1.current}</span>
              <span data-field="min">${ch1.min}</span>
              <span data-field="max">${ch1.max}</span>
              <span data-field="pp">${ch1.pp}</span>
            </article>
            <article data-scope-channel="ch2" data-connected="${ch2.connected}">
              <span data-field="current">${ch2.current}</span>
              <span data-field="min">${ch2.min}</span>
              <span data-field="max">${ch2.max}</span>
              <span data-field="pp">${ch2.pp}</span>
            </article>
          </div>
        </section>
      `;
    })
    .join('');
}
```

- [ ] **Step 5: Draw waveforms with device-pixel-ratio-aware canvas sizing**

```js
function prepareScopeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.round(rect.width), 1);
  const height = Math.max(Math.round(rect.height), 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawScopeWindow(scopeId) {
  const scopeWindow = document.querySelector(`.scope-window[data-scope-id="${scopeId}"]`);
  if (!scopeWindow) return;
  const canvas = scopeWindow.querySelector('[data-scope-role="wave-canvas"]');
  const { ctx, width, height } = prepareScopeCanvas(canvas);
  const bucket = ensureScopeSampleBucket(scopeId);
  drawScopeGrid(ctx, width, height);
  drawScopeSeries(ctx, width, height, bucket.ch1, '#f4b740');
  if ((SIM.scopeWindows[scopeId]?.mode || 'overlay') === 'overlay') {
    drawScopeSeries(ctx, width, height, bucket.ch2, '#5dd6ff');
  }
}
```

- [ ] **Step 6: Run the targeted test file and verify the readout and DPR tests pass**

Run: `npm test -- --run tests/oscilloscope-app.spec.js`

Expected: PASS. Mode buttons exist, CH1 and CH2 peak-to-peak values render separately, and the waveform canvas uses `width = 640`, `height = 360` under `devicePixelRatio = 2`.

- [ ] **Step 7: Create a task checkpoint**

```powershell
if (Test-Path .git) {
  git add src/styles/dialogs.css src/services/legacy-runtime.txt tests/oscilloscope-app.spec.js
  git commit -m "feat: render dual-channel oscilloscope readouts"
} else {
  Write-Host "No git metadata in this workspace; keep the readout and canvas-render changes in place and continue."
}
```

### Task 5: Run Full Verification And Manual Half-Amplitude Comparison

**Files:**
- Verify: `tests/oscilloscope-app.spec.js`
- Verify: `src/services/legacy-runtime.txt`
- Verify: project build output

- [ ] **Step 1: Run the focused oscilloscope regression suite**

Run: `npm test -- --run tests/oscilloscope-app.spec.js`

Expected: PASS. Scope nodes show two inputs, multiple windows stay open, window reuse works, readouts render, and the waveform canvas uses DPR-aware backing dimensions.

- [ ] **Step 2: Run the full test suite**

Run: `npm test -- --run`

Expected: PASS. Existing Python binding, flow runtime, and snapshot tests still succeed after the scope runtime rewrite.

- [ ] **Step 3: Run a production build**

Run: `npm run build`

Expected: PASS. Vite emits the production bundle without runtime-reference or fragment-import errors.

- [ ] **Step 4: Perform the manual half-amplitude smoke test on the canvas**

1. Start the dev server with `npm run dev`.
2. Place one signal source, one simulation block that scales by `0.5`, and one oscilloscope.
3. Connect the pre-block signal to `CH1` and the scaled output to `CH2`.
4. Run the simulation and open the scope window.
5. Switch the scope to `叠加`.
6. Confirm that the `CH2` trace is visually half the amplitude of `CH1`.
7. Confirm that the `CH2` peak-to-peak readout is half of the `CH1` peak-to-peak readout.

- [ ] **Step 5: Record the verification checkpoint**

```powershell
if (Test-Path .git) {
  git add docs/superpowers/plans/2026-04-15-oscilloscope-upgrade.md
  git commit -m "docs: record oscilloscope upgrade verification"
} else {
  Write-Host "No git metadata in this workspace; verification is complete once the commands above pass."
}
```
