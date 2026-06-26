# Layered Fault Binding Slot Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show friendly slot names in the layered fault binding dialog without changing saved binding payloads.

**Architecture:** Keep the existing binding-object helper for data writes. Add a small display-label helper near the layered fault dialog renderer and use it only for dropdown option labels.

**Tech Stack:** Vue app, legacy runtime script, Vitest component tests.

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Write the failing test**

Add a test near the existing layered binding dialog tests. It should import `evtol_closed_loop_fault_demo.json`, create a `physical_fault_injector`, start binding, click the `node-attitude-controller` target, and inspect the slot dropdown options:

```js
it('shows friendly slot names in the layered binding dialog while keeping internal binding keys', async () => {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
  await flushRuntime();

  expect(importResult).toMatchObject({ ok: true });

  const state = window.__GZ_STATE__;
  const target = state.modelNodes.find((node) => node.id === 'node-attitude-controller');
  expect(target).toBeTruthy();

  const injector = window.createNode('physical_fault_injector', 420, 260);
  await flushRuntime();

  document.querySelector(`[data-layered-fault-bind="${injector.id}"]`)?.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true
  }));
  await flushRuntime();

  document.getElementById(`b-${target.id}`)?.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true
  }));
  await flushRuntime();

  const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
  expect(dialog).not.toBeNull();

  const slotOptions = Array.from(dialog?.querySelectorAll('[data-layered-fault-option="slot"]') || [])
    .map((option) => option.textContent?.trim());
  expect(slotOptions).toContain('姿态控制增益');
  expect(slotOptions).not.toContain('controller_gain');

  document.querySelector('[data-layered-fault-confirm]')?.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true
  }));
  await flushRuntime();

  expect(state.faultInstances).toContainEqual(expect.objectContaining({
    targetId: target.id,
    layer: 'physical',
    bindingObject: 'controller_gain',
    targetVariable: 'controller_gain'
  }));

  wrapper.unmount();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/canvas-layout-app.spec.js --run -t "shows friendly slot names in the layered binding dialog while keeping internal binding keys"`

Expected: FAIL because the slot dropdown still shows `controller_gain`.

### Task 2: Implement Display Label Helper

**Files:**
- Modify: `src/services/legacy-runtime.txt`

- [ ] **Step 1: Add helper**

Add this helper near `getLayeredOptionLabel`:

```js
function getLayeredFaultSlotOptionLabel(slot){
  return plainText(slot?.slotName||slot?.displayName||slot?.name||slot?.label,'')
    ||getFaultSlotBindingObject(slot)
    ||slot?.id
    ||slot?.slotId
    ||'';
}
```

- [ ] **Step 2: Use helper for slot dropdown options**

Replace both `slots.map(slot=>({value:slot.id,label:getFaultSlotBindingObject(slot)||slot.name||slot.id}))` expressions in `openLayeredFaultBindingDialog` with:

```js
slots.map(slot=>({value:slot.id,label:getLayeredFaultSlotOptionLabel(slot)}))
```

- [ ] **Step 3: Run focused test**

Run: `npm.cmd test -- tests/canvas-layout-app.spec.js --run -t "shows friendly slot names in the layered binding dialog while keeping internal binding keys"`

Expected: PASS.

### Task 3: Verify Existing Behavior

**Files:**
- No source changes unless a verification failure points to a regression.

- [ ] **Step 1: Run adjacent layered binding test**

Run: `npm.cmd test -- tests/canvas-layout-app.spec.js --run -t "binds a layered injector only after explicit bind and confirmation"`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm.cmd run build`

Expected: exit code 0. Existing chunk-size warnings are acceptable.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-26-layered-fault-binding-slot-display-design.md docs/superpowers/plans/2026-06-26-layered-fault-binding-slot-display.md tests/canvas-layout-app.spec.js src/services/legacy-runtime.txt
git commit -m "fix: show layered fault slot display names"
```
