# Simulation Property Panel Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `simulation_block` property field rendering from `legacy-runtime.txt` while leaving save logic and panel actions in place.

**Architecture:** Add a focused `simulationPropertyPanelSchema.js` service that renders simulation block parameter fields from node state and helper callbacks. `legacy-runtime.txt` delegates only `simulation_block` field HTML to the service through `window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__`; existing save logic, Python binding buttons, fault buttons, and panel tabs remain unchanged.

**Tech Stack:** Vue/Vite app, Vitest, jsdom, legacy browser runtime loaded through `legacyRuntimeBootstrap.js`.

---

### Task 1: Add Simulation Property Schema Unit Tests

**Files:**
- Create: `tests/simulation-property-panel-schema.spec.js`
- Create: `src/services/simulationPropertyPanelSchema.js`

- [ ] **Step 1: Write the failing test**

Create tests that import `renderSimulationBlockFieldsFromSchema` and verify:
- unbound simulation blocks render `prop-name`, `prop-moduleType`, `sim-input-count`, `sim-output-count`, `sim-middle-count`, and `prop-ffunctionNote`
- Python-bound simulation blocks render binding metadata and hidden legacy fields, while not rendering editable interface count controls
- HTML values are escaped

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- --run tests\simulation-property-panel-schema.spec.js`
Expected: FAIL because `src/services/simulationPropertyPanelSchema.js` does not exist.

- [ ] **Step 3: Implement the rendering service**

Create `src/services/simulationPropertyPanelSchema.js` with:
- `renderSimulationBlockFieldsFromSchema(node, helpers = {})`
- internal row renderers for editable and readonly interface rows
- no DOM reads and no save logic

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npm.cmd test -- --run tests\simulation-property-panel-schema.spec.js`
Expected: PASS.

### Task 2: Wire Service Into Legacy Runtime

**Files:**
- Modify: `src/services/legacyRuntimeBootstrap.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Write the failing app test**

Add a property panel test that selects a `simulation_block`, opens the parameters tab, and verifies `window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__` exists and the expected simulation fields render. Include a Python-bound case if the current app helpers expose binding setup in tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- --run tests\property-panel-app.spec.js`
Expected: FAIL because the bootstrap has not exposed the simulation schema bridge.

- [ ] **Step 3: Expose and delegate**

Import the service in `legacyRuntimeBootstrap.js`, assign it to `window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__`, and delete it in `__resetLegacyRuntimeForTests()`. In `legacy-runtime.txt`, update `buildSimulationBlockFields` or the final clean override to delegate field HTML to the bridge when available.

- [ ] **Step 4: Verify integration**

Run:
- `npm.cmd test -- --run tests\simulation-property-panel-schema.spec.js tests\property-panel-app.spec.js`
- `npm.cmd test -- --run tests\python-binding-app.spec.js`
- `npm.cmd run build`

Expected: all tests pass; build passes with only the existing Vite large chunk warning.

### Task 3: Commit

**Files:**
- Commit all modified files.

- [ ] **Step 1: Inspect status**

Run: `git status --short`
Expected: only the planned files are modified.

- [ ] **Step 2: Commit**

Run:
```bash
git add docs/superpowers/plans/2026-06-08-simulation-property-panel-schema.md src/services/simulationPropertyPanelSchema.js tests/simulation-property-panel-schema.spec.js src/services/legacyRuntimeBootstrap.js src/services/legacy-runtime.txt tests/property-panel-app.spec.js
git commit -m "Extract simulation property panel fields"
```

Expected: a new local commit.
