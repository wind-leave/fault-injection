# Signal Component Runtime Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure signal component runtime behavior from `legacy-runtime.txt`.

**Architecture:** A new `signalComponentRuntime.js` service owns pure signal calculations. `legacyRuntimeBootstrap.js` exposes the service to the raw legacy runtime through `window.__GZ_SIGNAL_COMPONENT_RUNTIME__`.

**Tech Stack:** JavaScript ES modules, Vitest, existing legacy runtime bridge.

---

### Task 1: Unit Tests For Signal Runtime Service

**Files:**
- Create: `tests/signal-component-runtime.spec.js`

- [ ] Add tests for `sanitizeSignalValue`, `parseSignalScalar`, `evaluateFlowBlockOutputs`, `evaluateSignalUtilityOutputs`, and `normalizeSignalUtilityNode`.
- [ ] Run `npm.cmd test -- --run tests\signal-component-runtime.spec.js`.
- [ ] Expected before implementation: fail because `src/services/signalComponentRuntime.js` does not exist.

### Task 2: Implement Signal Runtime Service

**Files:**
- Create: `src/services/signalComponentRuntime.js`

- [ ] Implement pure helpers for flow pass-through and signal utility evaluation.
- [ ] Keep behavior compatible with current legacy logic: missing inputs default to `0`; invalid gain defaults to `1`; sum signs default to `+`; mux output is an array.
- [ ] Run `npm.cmd test -- --run tests\signal-component-runtime.spec.js`.

### Task 3: Wire Service Into Legacy Runtime

**Files:**
- Modify: `src/services/legacyRuntimeBootstrap.js`
- Modify: `src/services/legacy-runtime.txt`

- [ ] Import the new service namespace in `legacyRuntimeBootstrap.js`.
- [ ] Assign it to `window.__GZ_SIGNAL_COMPONENT_RUNTIME__` before `window.eval(runtimeSource)`.
- [ ] Replace legacy `flow_block` pass-through calculation with `evaluateFlowBlockOutputs()`.
- [ ] Replace legacy `evaluateSignalUtilityOutputs()` math body with delegation to the service.

### Task 4: Regression Verification

**Files:**
- No production edits expected.

- [ ] Run `npm.cmd test -- --run tests\signal-component-runtime.spec.js`.
- [ ] Run `npm.cmd test -- --run tests\signal-routing-app.spec.js`.
- [ ] Run `npm.cmd test -- --run tests\flight-model-package-app.spec.js -t "imports a branched signal-routing package|enables the run button"`.
- [ ] Run `npm.cmd run build`.
- [ ] Commit with message `Extract signal component runtime helpers`.
