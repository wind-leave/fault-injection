# Simulation Fault Slot Layer Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain simulation component fault setting layers so parameters default to physical injection while inputs and outputs support only electrical and protocol injection.

**Architecture:** Add role-based layer filtering to `src/services/faultSlotPanelSchema.js`, keeping middle variables and unknown roles on the existing all-layer behavior. Use the schema helper in `src/services/legacy-runtime.txt` before generating `faultSlots` so historical invalid declarations are removed on save.

**Tech Stack:** JavaScript ES modules, legacy browser runtime integration, Vitest with jsdom.

---

### Task 1: Add Failing Schema Tests

**Files:**
- Modify: `tests/fault-slot-panel-schema.spec.js`

- [ ] **Step 1: Write failing render test**

Add this test inside `describe('fault slot panel schema service', () => { ... })`:

```js
  it('filters visible fault layers by variable role and counts only visible choices', () => {
    const html = renderFaultSlotEditorFromSchema({
      variables: [
        { key: 'gain', name: 'Gain', role: 'parameter' },
        { key: 'command', name: 'Command input', role: 'input' },
        { key: 'torque', name: 'Torque output', role: 'output' },
        { key: 'integral', name: 'Integrator', role: 'middle' }
      ],
      declaration: {
        physical: ['gain', 'command', 'integral'],
        electrical: ['gain', 'command', 'torque'],
        protocol: ['torque', 'integral']
      },
      layers,
      layerLabels,
      roleLabels: {
        ...roleLabels,
        output: 'Output',
        middle: 'Middle'
      }
    });

    expect(html).toContain('data-fault-slot-layer="physical" data-fault-slot-var="gain" checked');
    expect(html).not.toContain('data-fault-slot-layer="electrical" data-fault-slot-var="gain"');
    expect(html).not.toContain('data-fault-slot-layer="protocol" data-fault-slot-var="gain"');
    expect(html).not.toContain('data-fault-slot-layer="physical" data-fault-slot-var="command"');
    expect(html).toContain('data-fault-slot-layer="electrical" data-fault-slot-var="command" checked');
    expect(html).toContain('data-fault-slot-layer="protocol" data-fault-slot-var="command"');
    expect(html).not.toContain('data-fault-slot-layer="physical" data-fault-slot-var="torque"');
    expect(html).toContain('data-fault-slot-layer="electrical" data-fault-slot-var="torque" checked');
    expect(html).toContain('data-fault-slot-layer="protocol" data-fault-slot-var="torque" checked');
    expect(html).toContain('data-fault-slot-layer="physical" data-fault-slot-var="integral" checked');
    expect(html).toContain('6 / 8');
  });
```

- [ ] **Step 2: Write failing declaration filter test**

Update the import to include `filterFaultSlotDeclarationByVariableRoles`, then add:

```js
  it('filters saved declarations by parameter input and output role rules while leaving middle variables unchanged', () => {
    expect(filterFaultSlotDeclarationByVariableRoles({
      physical: ['gain', 'command', 'torque', 'integral'],
      electrical: ['gain', 'command', 'torque', 'integral'],
      protocol: ['gain', 'command', 'torque', 'integral']
    }, [
      { key: 'gain', role: 'parameter' },
      { key: 'command', role: 'input' },
      { key: 'torque', role: 'output' },
      { key: 'integral', role: 'middle' }
    ], layers)).toEqual({
      physical: ['gain', 'integral'],
      electrical: ['command', 'torque', 'integral'],
      protocol: ['command', 'torque', 'integral']
    });
  });
```

- [ ] **Step 3: Run schema tests and verify failure**

Run: `npm.cmd test -- tests/fault-slot-panel-schema.spec.js --run`

Expected: FAIL because role-based filtering and `filterFaultSlotDeclarationByVariableRoles` do not exist yet.

### Task 2: Implement Schema Role Rules

**Files:**
- Modify: `src/services/faultSlotPanelSchema.js`
- Test: `tests/fault-slot-panel-schema.spec.js`

- [ ] **Step 1: Add default role rules and allowed-layer helper**

Add:

```js
export const DEFAULT_FAULT_SLOT_ROLE_LAYER_RULES = {
  parameter: ['physical'],
  input: ['electrical', 'protocol'],
  output: ['electrical', 'protocol']
};

function getAllowedLayersForVariable(variable = {}, layers = DEFAULT_FAULT_SLOT_LAYERS, roleLayerRules = DEFAULT_FAULT_SLOT_ROLE_LAYER_RULES) {
  const normalizedLayers = normalizeLayers(layers);
  const role = String(variable?.role || '');
  const allowed = Array.isArray(roleLayerRules?.[role]) ? roleLayerRules[role] : normalizedLayers;
  const allowedSet = new Set(allowed);
  const filtered = normalizedLayers.filter((layer) => allowedSet.has(layer));
  return filtered.length ? filtered : normalizedLayers;
}
```

- [ ] **Step 2: Render only allowed layers and count visible choices**

In `renderFaultSlotEditorFromSchema`, use `const roleLayerRules = options.roleLayerRules || DEFAULT_FAULT_SLOT_ROLE_LAYER_RULES;`.

Compute:

```js
  const variableLayerEntries = variables.map((variable) => ({
    variable,
    allowedLayers: getAllowedLayersForVariable(variable, layers, roleLayerRules)
  }));
  const selectedCount = variableLayerEntries.reduce(
    (count, entry) => count + entry.allowedLayers.filter((layer) => declaration[layer].includes(String(entry.variable?.key || ''))).length,
    0
  );
  const visibleChoiceCount = variableLayerEntries.reduce((count, entry) => count + entry.allowedLayers.length, 0);
```

Render rows from `variableLayerEntries` and map `allowedLayers` instead of all `layers`. Use `visibleChoiceCount` in the count display.

- [ ] **Step 3: Add declaration filter export**

Add:

```js
export function filterFaultSlotDeclarationByVariableRoles(declaration = {}, variables = [], layers = DEFAULT_FAULT_SLOT_LAYERS, roleLayerRules = DEFAULT_FAULT_SLOT_ROLE_LAYER_RULES) {
  const normalizedLayers = normalizeLayers(layers);
  const variablesByKey = new Map(list(variables).map((variable) => [String(variable?.key || ''), variable]));
  return normalizedLayers.reduce((draft, layer) => {
    draft[layer] = list(declaration?.[layer])
      .map((key) => String(key))
      .filter((key) => {
        const variable = variablesByKey.get(key);
        if (!variable) {
          return true;
        }
        return getAllowedLayersForVariable(variable, normalizedLayers, roleLayerRules).includes(layer);
      });
    return draft;
  }, {});
}
```

- [ ] **Step 4: Run schema tests and verify pass**

Run: `npm.cmd test -- tests/fault-slot-panel-schema.spec.js --run`

Expected: PASS.

### Task 3: Apply Save Filtering in Runtime and Update App Test

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Update property panel app expectations**

In the test that starts with `expect(document.querySelector('[data-fault-slot-editor]')).not.toBeNull();`, change the visible toggle count from `15` to `9` because the test has two parameters, one input, one output, and one middle variable. Assert that physical inputs for `B` and `E` do not exist, and that electrical/protocol inputs for `A` and `D` do not exist.

Change expected declaration to:

```js
    expect(block.props.faultInjection).toEqual({
      physical: ['A', 'D'],
      electrical: ['B', 'E', 'C'],
      protocol: []
    });
```

Change expected slots to:

```js
    expect(block.faultSlots.map((slot) => slot.slotId)).toEqual([
      'physical:A',
      'physical:D',
      'electrical:B',
      'electrical:E',
      'electrical:C'
    ]);
```

Keep assertions for `physical:A`, `physical:D`, `electrical:B`, `electrical:E`, and `electrical:C`. Remove assertions that expect `electrical:D` or `protocol:D`.

- [ ] **Step 2: Run app test and verify failure**

Run: `npm.cmd test -- tests/property-panel-app.spec.js --run -t "renders and saves component fault slot declarations from the faults tab"`

Expected: FAIL because the UI and save path still allow all layers for parameter/input/output.

- [ ] **Step 3: Apply runtime filtering before slot generation**

In `savePropertyPanelFaultSlots()`, after reading `declaration`, add:

```js
    const variables=getFaultConfigVariables(node);
    const filteredDeclaration=faultSlotSchema?.filterFaultSlotDeclarationByVariableRoles
      ?faultSlotSchema.filterFaultSlotDeclarationByVariableRoles(declaration,variables,FAULT_SLOT_CONFIG_LAYERS)
      :declaration;
```

Use `filteredDeclaration` for `buildFaultSlotsFromPanelDeclaration(node, filteredDeclaration)` and `node.props.faultInjection=filteredDeclaration`.

- [ ] **Step 4: Run app test and verify pass**

Run: `npm.cmd test -- tests/property-panel-app.spec.js --run -t "renders and saves component fault slot declarations from the faults tab"`

Expected: PASS.

### Task 4: Focused Verification and Commit

**Files:**
- Verify: `tests/fault-slot-panel-schema.spec.js`
- Verify: `tests/property-panel-app.spec.js`
- Verify: build output

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm.cmd test -- tests/fault-slot-panel-schema.spec.js --run
npm.cmd test -- tests/property-panel-app.spec.js --run -t "renders and saves component fault slot declarations from the faults tab"
```

Expected: both pass.

- [ ] **Step 2: Run build**

Run: `npm.cmd run build`

Expected: build exits 0. Existing large chunk warning is acceptable.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/services/faultSlotPanelSchema.js src/services/legacy-runtime.txt tests/fault-slot-panel-schema.spec.js tests/property-panel-app.spec.js docs/superpowers/plans/2026-06-26-simulation-fault-slot-layer-rules.md
git commit -m "feat: constrain simulation fault slot layers"
```
