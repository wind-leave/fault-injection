# Fixed Signal Source Parameter Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep palette-created signal sources in their fixed signal domain and show signal definition/configuration only in the parameter configuration tab.

**Architecture:** Reuse the existing `signal_source` node type and `props.signalDomain` normalization. Remove the editable signal-domain field from the signal source property schema, then rely on the typed property panel tab router to show schema fields only when `S.propertyPanelTab === 'parameters'`.

**Tech Stack:** Vue shell with legacy runtime JavaScript, Vitest + jsdom app tests, extracted schema services in `src/services`.

---

### Task 1: Remove Editable Signal Domain From Signal Source Schema

**Files:**
- Modify: `src/services/propertyPanelSchema.js`
- Test: `tests/property-panel-schema.spec.js`

- [ ] **Step 1: Write the failing schema test**

Add this test to `tests/property-panel-schema.spec.js` inside `describe('property panel schema service', () => { ... })`:

```js
  it('does not render signal domain as an editable signal source field', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'analog',
        signalName: 'Pitch Command',
        signalId: 'cmd.pitch'
      }
    }, schema);

    expect(html).not.toContain('id="prop-signalDomain"');
    expect(html).toContain('id="prop-signalName"');
    expect(html).toContain('id="prop-signalId"');
  });
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```powershell
npm test -- tests/property-panel-schema.spec.js
```

Expected: FAIL because the schema still renders `id="prop-signalDomain"`.

- [ ] **Step 3: Implement the schema change**

In `src/services/propertyPanelSchema.js`, remove this field from the `signal_source` signal definition group:

```js
{ key: 'signalDomain', label: '信号域', type: 'select', options: SIGNAL_DOMAINS, fallback: 'analog', row: 'signal-domain' },
```

Do not remove `SIGNAL_DOMAINS` if other code still imports it from this file. After removing the field, saving a signal source still preserves `props.signalDomain` because `applySchemaPropertyValues()` merges returned values into the existing `node.props` and then normalizes the full object.

- [ ] **Step 4: Run the schema test and verify it passes**

Run:

```powershell
npm test -- tests/property-panel-schema.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/services/propertyPanelSchema.js tests/property-panel-schema.spec.js
git commit -m "fix: make signal source domain fixed"
```

### Task 2: Keep Signal Definition And Configuration Out Of The Overview Tab

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Write the failing app test**

Add this test to `tests/property-panel-app.spec.js` after the existing RF signal source panel test:

```js
  it('shows signal source definition only in parameter configuration', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source_rf', 220, 220);
    await flushRuntime();

    window.selectNode(source.id);
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="overview"]')?.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('pd')?.textContent).not.toContain('信号定义');
    expect(document.getElementById('prop-signalName')).toBeNull();
    expect(document.getElementById('prop-centerFrequency')).toBeNull();
    expect(document.getElementById('prop-signalDomain')).toBeNull();

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    expect(document.querySelector('[data-props-tab="parameters"]')?.classList.contains('is-active')).toBe(true);
    expect(document.getElementById('pd')?.textContent).toContain('信号定义');
    expect(document.getElementById('prop-signalName')).not.toBeNull();
    expect(document.getElementById('prop-centerFrequency')).not.toBeNull();
    expect(document.getElementById('prop-signalDomain')).toBeNull();

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the app test and verify it fails**

Run:

```powershell
npm test -- tests/property-panel-app.spec.js
```

Expected: FAIL because the parameters tab still renders an editable `prop-signalDomain`.

- [ ] **Step 3: Implement the panel routing cleanup**

Inspect `src/services/legacy-runtime.txt` for the typed panel wrapper around `renderTypedPropertyPanel(target)`. Keep the existing branch:

```js
if(S.propertyPanelTab==='parameters'){pd.innerHTML=renderNodeParameters(target);}
```

Do not add signal source schema fields to the overview branch. If an older compatibility override still injects legacy signal source fields into overview, change its compatibility guard so `signal_source` uses the typed overview only and the schema-backed parameter form only.

- [ ] **Step 4: Run the app test and verify it passes**

Run:

```powershell
npm test -- tests/property-panel-app.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/services/legacy-runtime.txt tests/property-panel-app.spec.js
git commit -m "fix: show signal source fields only in parameters"
```

### Task 3: Final Verification

**Files:**
- Verify: `tests/signal-source-domain-service.spec.js`
- Verify: `tests/property-panel-schema.spec.js`
- Verify: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Run focused regression tests**

Run:

```powershell
npm test -- tests/signal-source-domain-service.spec.js tests/property-panel-schema.spec.js tests/property-panel-app.spec.js
```

Expected: PASS.

- [ ] **Step 2: Check git status**

Run:

```powershell
git status --short
```

Expected: no uncommitted changes, or only intentional changes already discussed with the user.
