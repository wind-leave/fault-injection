# Multi-Signal Flow Deep Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the multi-signal flow view and edge property inspector so complex flight-control models show readable signal routes, CAN channels, fault propagation, and runtime diagnostics.

**Architecture:** Keep the existing canvas and right-panel tabs, but introduce a clearer presentation layer around the existing runtime data. The dataflow view becomes a three-part workspace: topology map, grouped signal/fault/diagnostic side rail, and selected-detail handoff to the property inspector. Edge property tabs use normalized channel helpers so overview, parameters, faults, and outputs are consistent.

**Tech Stack:** Vue shell with legacy runtime script, Vitest + jsdom tests, existing CSS fragments in `src/styles/components.css`.

---

## File Map

- Modify `src/services/legacy-runtime.txt`: dataflow metrics helpers, dataflow panel rendering, topology filtering, edge property panel rendering, edge channel normalization.
- Modify `src/styles/components.css`: dataflow layout, readable cards, responsive rail, edge channel and diagnostics styles.
- Modify `tests/canvas-layout-app.spec.js`: multi-signal flow view behavior, grouped sections, no missing edges, long text readability, responsive layout contracts.
- Modify `tests/property-panel-app.spec.js`: edge overview/parameters/faults/outputs behavior for multi-channel CAN and diagnostics.

## Task 1: Dataflow View Information Architecture

**Files:**
- Modify: `tests/canvas-layout-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Write failing tests for grouped dataflow sections**

Add tests near the existing `"renders the alternate canvas view as a multi-signal flow graph"` case:

```js
it('groups multi-signal flow details into signal, fault, and diagnostic sections', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
  expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
  await flushRuntime();

  window.setCanvasView('dataflow');
  await flushRuntime();

  const panel = document.getElementById('dataflow-panel');
  expect(panel?.querySelector('[data-dataflow-section="signals"]')).not.toBeNull();
  expect(panel?.querySelector('[data-dataflow-section="faults"]')).not.toBeNull();
  expect(panel?.querySelector('[data-dataflow-section="diagnostics"]')).not.toBeNull();
  expect(panel?.querySelectorAll('[data-dataflow-edge-card]').length).toBe(window.__GZ_STATE__.modelEdges.length);
  expect(panel?.textContent).toContain('edge-imu-error');
  expect(panel?.textContent).toContain('CAN-FC-IMU');

  wrapper.unmount();
});
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js
```

Expected: FAIL because `data-dataflow-section` and `data-dataflow-edge-card` are not present.

- [ ] **Step 3: Implement grouped rendering**

In `src/services/legacy-runtime.txt`, update `renderDataflowPanel()` so `dataflow-side` contains:

- `.dataflow-section[data-dataflow-section="signals"]` with all edge cards.
- `.dataflow-section[data-dataflow-section="faults"]` with cards for metrics where `faultActive || protocolActive`.
- `.dataflow-section[data-dataflow-section="diagnostics"]` with cards for metrics where `residualActive || status !== 'normal'`.

Each edge card must include:

- `data-dataflow-edge-card`
- `data-dataflow-edge="<edge id>"`
- signal name or signal id
- route `sourceName -> targetName`
- line type / CAN channel / message id
- status badges split into short tokens, not long combined strings

- [ ] **Step 4: Implement topology filtering and richer nodes**

In `buildSignalFlowTopology(rows)`, use only connected nodes derived from dataflow rows by default. Add an unconnected count to `getDataflowSummary()` if useful, but do not render unconnected nodes in the topology map.

In `renderSignalFlowNodes()`, show:

- node kind
- node name
- in/out counts
- status summary such as `故障 N`, `CAN N`, `诊断 N` when nonzero

- [ ] **Step 5: Update CSS for readable layout**

In `src/styles/components.css`:

- Change `.dataflow-body` right rail from fixed `318px` to `clamp(360px, 32vw, 520px)`.
- Make `.dataflow-edge-name` and `.dataflow-edge-route` wrap to two lines.
- Add `.dataflow-section`, `.dataflow-section__head`, `.dataflow-section__empty`.
- Add selected/expanded styles for `.dataflow-edge-card.is-selected`.
- Add responsive rule so narrow screens stack topology above side rail.

- [ ] **Step 6: Verify Task 1**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js
```

Expected: PASS.

## Task 2: Edge Property Inspector Information Architecture

**Files:**
- Modify: `tests/property-panel-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Write failing tests for edge overview and channels**

Add tests that create a CAN edge with two `signalChannels`, select it, and assert:

- overview shows route, line type, channel count, status, primary signal, secondary signal summary
- parameters tab shows a primary editable card and secondary read-only card
- saving primary metadata preserves the secondary channel

Use stable selectors:

- `[data-edge-overview]`
- `[data-edge-channel-list]`
- `[data-edge-channel-card="primary"]`
- `[data-edge-channel-card="secondary"]`

- [ ] **Step 2: Run red test**

Run:

```powershell
npm test -- --run tests\property-panel-app.spec.js
```

Expected: FAIL because the new selectors are not present.

- [ ] **Step 3: Implement normalized edge channel helpers**

In `src/services/legacy-runtime.txt`, add helpers near `edgePrimarySignal(edge)`:

- `edgeSignals(edge)` returns a non-empty normalized array.
- Preserve backwards compatibility with top-level `signalId`, `channelId`, `messageId`, `signalRole`, `signalUnit`, `payloadKind`, `sampleRate`, `faultPropagationPolicy`.
- Normalize channel fields to expose both legacy `role/unit` and explicit `signalRole/signalUnit` for rendering.

- [ ] **Step 4: Rework edge overview**

Update `renderEdgeOverview(edge)` to show:

- route card with source/target node and ports
- line type, CAN status, channel count
- primary channel summary
- secondary channel compact list if present
- dataflow status summary from `collectDataflowEdges()`
- fault source summary: edge fault, upstream propagated fault, or none

- [ ] **Step 5: Rework edge parameters**

Update `renderEdgeParameters(edge)`:

- Keep existing field ids for primary channel edits so current tests keep working.
- Wrap editable fields in `[data-edge-channel-card="primary"]`.
- Render secondary channels inside `[data-edge-channel-list]` using read-only cards for this phase.
- Keep save/delete/protocol injection actions.

- [ ] **Step 6: Rework edge outputs**

Update `renderEdgeOutputs(edge)`:

- Show diagnostics grid with current value, residual, latency, drop rate, burst length, status, fault name, runtime behavior.
- Show channel payload list for every normalized channel.
- Do not duplicate the overview route rows except a compact route identity.

- [ ] **Step 7: Rework fault cards for protocol details**

Update `renderFaultBinding(binding, targetKind, targetId, index)` so protocol/CAN faults include parameter chips for:

- latency
- delaySteps
- dropRate
- burstLength
- affectedChannels
- runtimeBehavior

Keep existing cancel behavior and selectors.

- [ ] **Step 8: Verify Task 2**

Run:

```powershell
npm test -- --run tests\property-panel-app.spec.js
```

Expected: PASS.

## Task 3: Cross-View Selection and Regression Hardening

**Files:**
- Modify: `tests/canvas-layout-app.spec.js`
- Modify: `tests/property-panel-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Write failing test for dataflow card selection**

Add a test that switches to dataflow view, clicks the `edge-imu-error` card, and asserts:

- `window.__GZ_STATE__.selEdge === 'edge-imu-error'`
- the right panel subheader says edge/dataflow selection
- the clicked card has `.is-selected`
- the edge overview includes `CAN-FC-IMU` and `0x184`

- [ ] **Step 2: Run red test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js tests\property-panel-app.spec.js
```

Expected: FAIL because selected styling and synchronized detail may be incomplete.

- [ ] **Step 3: Implement selected card state**

In `renderDataflowPanel()` and edge card rendering:

- Compare each edge id to `S.selEdge`.
- Add `.is-selected`.
- Keep `onclick="selectEdge(...)"`.
- After `selectEdge`, ensure dataflow panel re-renders if current canvas view is dataflow.

- [ ] **Step 4: Ensure no regression for existing view tabs**

Verify `setCanvasView('canvas')`, `setCanvasView('components')`, and `setCanvasView('dataflow')` still keep active tab state and correct panel visibility.

- [ ] **Step 5: Verify Task 3**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js tests\property-panel-app.spec.js
```

Expected: PASS.

## Final Verification

- [ ] Run targeted tests:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js tests\property-panel-app.spec.js tests\flight-model-package.spec.js tests\fault-injection-service.spec.js
```

- [ ] Run full test suite:

```powershell
npm test -- --run
```

- [ ] Run UI audit:

```powershell
npm run audit:ui
```

- [ ] Run production build:

```powershell
npm run build
```

- [ ] Check local server:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:5175/' -UseBasicParsing -TimeoutSec 5
```

Expected: HTTP 200.

## Self Review

- Spec coverage: Tasks cover dataflow readability, grouped information architecture, edge property panel completeness, multi-channel CAN display, fault propagation details, and selection handoff.
- Placeholder scan: No placeholders remain.
- Type consistency: Selectors use stable `data-*` attributes across tests and implementation. Existing field ids for primary edge metadata are preserved.
