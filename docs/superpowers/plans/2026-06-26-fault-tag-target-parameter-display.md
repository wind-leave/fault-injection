# Fault Tag Target Parameter Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Chinese parameter names in injected fault component properties while preserving internal variable keys such as `controller_gain`.

**Architecture:** Add a display resolver inside `src/services/legacy-runtime.txt` near `renderFaultTagPropertyPanel()`. The resolver prefers slot and parameter display names from the target component, then falls back to existing engineering keys.

**Tech Stack:** Legacy browser runtime JavaScript, Vitest/jsdom app integration tests.

---

### Task 1: Add Failing Fault Tag Display Test

**Files:**
- Modify: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Write failing test**

Add a test in `describe('property panel interaction', () => { ... })`:

```js
  it('shows target parameter display name for an injected fault tag instead of the internal variable key', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 300, 240);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const block = state.modelNodes.find((node) => node.type === 'simulation_block');
    block.props.name = '姿态控制器';
    block.props.modelParameters = [
      { key: 'controller_gain', name: '姿态控制增益', targetField: 'params.controller_gain' }
    ];
    block.faultSlots = [
      {
        slotId: 'physical:controller_gain',
        slotName: '姿态控制增益',
        layer: 'physical',
        variableKey: 'controller_gain',
        parameterKey: 'controller_gain',
        bindingObject: 'controller_gain',
        targetVariable: 'controller_gain',
        targetField: 'params.controller_gain'
      }
    ];
    state.faultTags = [
      {
        id: 'fault-tag-controller-gain',
        name: '增益偏移故障',
        layer: 'physical',
        targetKind: 'node',
        targetId: block.id,
        targetName: block.props.name,
        slotId: 'physical:controller_gain',
        bindingObject: 'controller_gain',
        targetVariable: 'controller_gain',
        targetField: 'params.controller_gain',
        parameters: { bias: 0.1 }
      }
    ];
    state.selFaultTag = 'fault-tag-controller-gain';

    window.__GZ_RENDER_FAULT_TAG_PANEL__(state.faultTags[0]);
    await flushRuntime();

    expect(document.querySelector('.fault-tag-binding-card')?.textContent).toContain('姿态控制增益');
    expect(document.querySelector('.fault-tag-binding-card')?.textContent).not.toContain('controller_gain');

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm.cmd test -- tests/property-panel-app.spec.js --run -t "shows target parameter display name for an injected fault tag instead of the internal variable key"`

Expected: FAIL because the current panel uses `bindingObject` first and displays `controller_gain`.

### Task 2: Implement Display Name Resolver

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Add helper functions near `renderFaultTagPropertyPanel`**

Add helpers that collect candidate keys from the tag, match target `faultSlots` and parameter arrays, and return display names:

```js
  function displayText(value){
    return String(value??'').trim();
  }

  function faultTagTargetParameterKeys(tag){
    return [
      tag?.slotId,
      tag?.parameterKey,
      tag?.variableKey,
      tag?.bindingObject,
      tag?.targetVariable,
      tag?.targetField,
      tag?.injectedFault?.slotId,
      tag?.injectedFault?.parameterKey,
      tag?.injectedFault?.variableKey,
      tag?.injectedFault?.bindingObject,
      tag?.injectedFault?.targetVariable,
      tag?.injectedFault?.targetField
    ].map(displayText).filter(Boolean);
  }
```

- [ ] **Step 2: Resolve friendly target parameter**

Add a `resolveFaultTagTargetParameter(tag, target)` function that:
- first checks direct friendly fields on the tag and `injectedFault`;
- finds matching target `faultSlots` by `slotId`, `parameterKey`, `variableKey`, `bindingObject`, `targetVariable`, or the suffix of `slotId`;
- returns `slotName`, `displayName`, or `name` when available;
- falls back to matching `target.props.modelParameters`, `target.props.physicalParameters`, `target.parameters`, and `target.physicalParameters` by key-like fields;
- finally falls back to the existing engineering key chain.

- [ ] **Step 3: Use resolver in panel**

Replace the current `const targetParameter = ...` chain in `renderFaultTagPropertyPanel(tag)` with:

```js
    const targetParameter=resolveFaultTagTargetParameter(tag,target);
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm.cmd test -- tests/property-panel-app.spec.js --run -t "shows target parameter display name for an injected fault tag instead of the internal variable key"`

Expected: PASS.

### Task 3: Verify and Commit

**Files:**
- Verify: `tests/property-panel-app.spec.js`
- Verify: build output

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm.cmd test -- tests/property-panel-app.spec.js --run -t "shows target parameter display name for an injected fault tag instead of the internal variable key"
npm.cmd test -- tests/property-panel-app.spec.js --run -t "edits component-owned injectable variables from the fault settings tab"
```

Expected: both pass.

- [ ] **Step 2: Run build**

Run: `npm.cmd run build`

Expected: build exits 0. Existing large chunk warning is acceptable.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/services/legacy-runtime.txt tests/property-panel-app.spec.js docs/superpowers/plans/2026-06-26-fault-tag-target-parameter-display.md
git commit -m "fix: show fault tag target parameter display name"
```
