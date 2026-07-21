# Three-Dimensional Practice Task Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change “保存仿真结果” to export one JSON task package containing both three-dimensional-client-visible data and backend-private data.

**Architecture:** Add a pure package builder service that accepts normalized workbench/runtime snapshots and returns the stable `publicData`/`privateData` contract. Expose it through the legacy bootstrap and keep the legacy runtime responsible only for collecting current state, downloading JSON, and user feedback.

**Tech Stack:** JavaScript ES modules, Vitest, Vite, legacy browser runtime bootstrap.

---

### Task 1: Define the package builder contract

**Files:**
- Create: `tests/practice-task-package-service.spec.js`
- Create: `src/services/practiceTaskPackageService.js`

- [ ] **Step 1: Write the failing test**

Create a test that imports `buildPracticeTaskPackage`, supplies actual/reference samples, topology, an executable model, D matrix and a practice fault, then expects `kind === '3d-practice-task-package'`, public actual data, private reference data, target fault, path, key nodes and cumulative-from-zero repair rules.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/practice-task-package-service.spec.js`

Expected: FAIL because `practiceTaskPackageService.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement `buildPracticeTaskPackage(input)` as a pure function. Clone caller-owned objects, derive the target fault and path, derive unique key nodes from path steps, and return the approved public/private structure with stable empty placeholders where source data is not yet available.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/practice-task-package-service.spec.js`

Expected: PASS with one test file and no failures.

### Task 2: Connect the builder to “保存仿真结果”

**Files:**
- Modify: `src/services/legacyRuntimeBootstrap.js`
- Modify: `src/services/legacy-runtime.txt:6865`
- Test: `tests/practice-task-package-export-contract.spec.js`

- [ ] **Step 1: Write the failing integration contract test**

Assert that the bootstrap exposes the builder and the legacy snapshot function builds the backend executable package, calls the task-package builder, and no longer returns the old `kind:'simulation-result'` structure.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/practice-task-package-export-contract.spec.js`

Expected: FAIL because the builder is not exposed or called.

- [ ] **Step 3: Implement the integration**

Import the new service namespace in `legacyRuntimeBootstrap.js` and expose it as `window.__GZ_PRACTICE_TASK_PACKAGE__`. In `buildSimulationResultSnapshot()`, collect the existing samples, D matrix, practice faults, render data and executable model, then delegate to `buildPracticeTaskPackage()`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run tests/practice-task-package-service.spec.js tests/practice-task-package-export-contract.spec.js`

Expected: both test files PASS.

### Task 3: Update documentation and verify the application

**Files:**
- Modify: `docs/simulation-result-json-format.md`

- [ ] **Step 1: Replace the old format description**

Document the new task-package envelope, public/private field meanings, current empty placeholders, filename behavior and the fact that both sections are exported together in this phase.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test -- --run`

Expected: all Vitest suites PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Vite exits with code 0 and writes the production bundle.

- [ ] **Step 4: Review requirements and diff**

Confirm the exported object contains both sections, the public section contains initial actual data, the private section contains executable/restart/reference/diagnostic data, and no permission-separation behavior was introduced.
