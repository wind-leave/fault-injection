# Testpoint Point Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a saved `pointType` metadata field to diagnostic test points, with physical/virtual choices shown in the measurement point settings UI.

**Architecture:** Keep the field as diagnostic test point metadata in `src/services/legacy-runtime.txt`. Normalize missing or invalid values to `physical`, render a selector in the edge test point settings form, save the selected value, and show the type label in the compact diagnostic console without changing diagnosis behavior.

**Tech Stack:** Vue/Vite project with legacy browser runtime in JavaScript, Vitest for contract tests.

---

### Task 1: Add Failing Contract Coverage

**Files:**
- Modify: `tests/diagnostic-testpoint-contract.spec.js`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe('diagnostic testpoint workbench contract', () => { ... })`:

```js
  it('renders and saves physical or virtual diagnostic test point type metadata', () => {
    const runtime = readWorkspaceFile('src/services/legacy-runtime.txt');

    expect(runtime).toContain('function normalizeDiagnosticTestPointType');
    expect(runtime).toContain("return value === 'virtual' ? 'virtual' : 'physical';");
    expect(runtime).toContain('data-edge-testpoint-type');
    expect(runtime).toContain('<label>测点类型</label>');
    expect(runtime).toContain('<option value="physical"');
    expect(runtime).toContain('物理测点');
    expect(runtime).toContain('<option value="virtual"');
    expect(runtime).toContain('虚拟测点');
    expect(runtime).toContain('point.pointType=normalizeDiagnosticTestPointType');
    expect(runtime).toContain('diagnosticPointTypeLabel');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/diagnostic-testpoint-contract.spec.js --run`

Expected: FAIL because `normalizeDiagnosticTestPointType`, `data-edge-testpoint-type`, and type labels do not exist yet.

- [ ] **Step 3: Commit is not needed yet**

Keep the failing test uncommitted until the minimal implementation passes.

### Task 2: Implement Point Type UI and Save Behavior

**Files:**
- Modify: `src/services/legacy-runtime.txt`

- [ ] **Step 1: Add normalization helpers**

Add helper functions near the existing edge test point rendering helpers:

```js
  function normalizeDiagnosticTestPointType(value){
    return value === 'virtual' ? 'virtual' : 'physical';
  }

  function diagnosticPointTypeLabel(value){
    return normalizeDiagnosticTestPointType(value)==='virtual'?'虚拟测点':'物理测点';
  }
```

- [ ] **Step 2: Render the selector in edge test point settings**

In `renderEdgeTestPointCard(edge,point,index)`, add a field after “测点名称”:

```js
        <div class="props-field">
          <label>测点类型</label>
          <select data-edge-testpoint-type>
            <option value="physical" ${normalizeDiagnosticTestPointType(point.pointType)==='physical'?'selected':''}>物理测点</option>
            <option value="virtual" ${normalizeDiagnosticTestPointType(point.pointType)==='virtual'?'selected':''}>虚拟测点</option>
          </select>
        </div>
```

- [ ] **Step 3: Save the selected value**

In `saveEdgeTestPointFromPanel(edge,pointId)`, after reading the name input, read the select and assign the normalized field:

```js
    const typeInput=card.querySelector('[data-edge-testpoint-type]');
    point.pointType=normalizeDiagnosticTestPointType(typeInput?.value||point.pointType);
```

- [ ] **Step 4: Normalize configured points for display**

In all `getConfiguredPoints()` mapping paths, add:

```js
        pointType:normalizeDiagnosticTestPointType(point.pointType),
```

Add it to configured points, manual points appended to configured points, manual-only points, and the final normalized point mapping.

- [ ] **Step 5: Show the type label in compact cards**

In `renderPointCard(point,installed,scanResult)`, append ` · ${html(diagnosticPointTypeLabel(point.pointType))}` to the `<small>` line. In `renderInstalledPoint(point,scanResult)`, include the same label in the status `<small>` text.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- tests/diagnostic-testpoint-contract.spec.js --run`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add tests/diagnostic-testpoint-contract.spec.js src/services/legacy-runtime.txt
git commit -m "feat: add diagnostic testpoint type metadata"
```

### Task 3: Run Focused Regression Tests

**Files:**
- Verify: `tests/diagnostic-testpoint-contract.spec.js`
- Verify: `tests/diagnostic-authoring-service.spec.js`

- [ ] **Step 1: Run diagnostic contract tests**

Run: `npm test -- tests/diagnostic-testpoint-contract.spec.js --run`

Expected: PASS.

- [ ] **Step 2: Run diagnostic authoring tests**

Run: `npm test -- tests/diagnostic-authoring-service.spec.js --run`

Expected: PASS. This confirms D-matrix behavior is unchanged by the metadata field.

- [ ] **Step 3: Review git diff**

Run: `git diff --stat HEAD~1..HEAD` and `git status --short`.

Expected: only the planned files are committed; unrelated `__pycache__` files may remain untracked and must not be added.
