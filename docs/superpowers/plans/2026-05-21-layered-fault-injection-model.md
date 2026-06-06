# Layered Fault Injection Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework fault injection so layer-specific fault injector blocks are placed first, then bound to compatible component or edge slots, and finally converted into editable fault tags.

**Architecture:** Component and edge compatibility is determined from local capability slots, not from the fault catalog. Physical injection binds only to model-parameter slots, electrical injection binds to continuous signal slots, and protocol injection binds to digital/CAN protocol slots.

**Tech Stack:** Vue 3, legacy canvas runtime in `src/services/legacy-runtime.txt`, Vitest/jsdom tests.

---

### Task 1: Define Runtime Contract

**Files:**
- Test: `tests/canvas-layout-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`

- [x] **Step 1: Write failing tests**

Add tests that verify:

```js
expect(window.createNode('physical_fault_injector', 320, 240)).toBeTruthy();
expect(window.getLayeredFaultSlotsForTarget(physicalTarget).some((slot) => slot.layer === 'physical')).toBe(true);
expect(window.canBindLayeredFaultInjectorToTarget(physicalFaultNode, signalOnlyNode)).toBe(false);
```

- [x] **Step 2: Implement slot extraction**

Implement `getLayeredFaultSlotsForTarget(target)`:

```js
// physical: node.props.modelParameters
// electrical: node inputs/outputs and normal signal edges
// protocol: CAN/protocol edges and protocolFields
```

- [x] **Step 3: Run tests**

Run `npm test -- --run tests/canvas-layout-app.spec.js`.

### Task 2: Implement Two-Step Binding

**Files:**
- Test: `tests/canvas-layout-app.spec.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`

- [x] **Step 1: Write failing tests**

Add tests that verify:

```js
const faultNode = window.createNode('electrical_fault_injector', 300, 200);
const result = window.bindLayeredFaultInjectorToTarget(faultNode.id, { targetKind: 'node', targetId: target.id });
expect(result.ok).toBe(true);
expect(window.__GZ_STATE__.modelNodes.some((node) => node.id === faultNode.id)).toBe(false);
expect(window.__GZ_STATE__.faultTags.some((tag) => tag.targetId === target.id)).toBe(true);
```

- [x] **Step 2: Implement binding**

Implement `bindLayeredFaultInjectorToTarget` so it:
- verifies layer compatibility
- creates a default fault instance payload
- removes the injector node
- creates a fault tag
- marks node targets as faulted
- creates a dashed visual link

- [x] **Step 3: Run tests**

Run `npm test -- --run tests/canvas-layout-app.spec.js`.

### Task 3: Update Palette and Interaction

**Files:**
- Modify: `src/fragments/left-panel.html`
- Modify: `src/constants/componentLibrary.js`
- Test: `tests/left-palette-taxonomy.spec.js`

- [x] **Step 1: Replace old fault entries**

The fault group should contain:
- `physical_fault_injector`
- `electrical_fault_injector`
- `protocol_fault_injector`
- `新增故障`

- [x] **Step 2: Update drag/drop**

Dropping these injector blocks onto empty canvas creates an unbound injector node. Binding happens later from the block.

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- --run tests/left-palette-taxonomy.spec.js tests/canvas-layout-app.spec.js
```

### Task 4: Validate

**Files:**
- No new production files

- [x] **Step 1: Run full tests**

Run `npm test -- --run`.

- [x] **Step 2: Run UI audit**

Run `npm run audit:ui`.

- [x] **Step 3: Build**

Run `npm run build`.
