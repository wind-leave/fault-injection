# Left Palette Registry Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the live left palette from the component registry instead of static HTML.

**Architecture:** `LeftPalette.vue` becomes the presentation layer for `getPaletteGroups()`. It preserves the DOM selectors that legacy runtime already scans for drag/drop and connection tools.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils, existing legacy runtime DOM contracts.

---

### Task 1: Convert Palette Taxonomy Test To Rendered DOM

**Files:**
- Modify: `tests/left-palette-taxonomy.spec.js`

- [ ] Replace static `readFileSync(src/fragments/left-panel.html)` assertions with `mount(LeftPalette)`.
- [ ] Assert `LeftPalette.vue` source does not contain `left-panel.html?raw`.
- [ ] Assert group order from `[data-palette-group]`.
- [ ] Assert components appear in their registered groups through `[data-component]`.
- [ ] Assert line tools appear through `[data-line-type]`.
- [ ] Run `npm.cmd test -- --run tests\left-palette-taxonomy.spec.js`; expected before implementation: fail because `LeftPalette.vue` still imports `left-panel.html?raw`.

### Task 2: Render LeftPalette From Registry

**Files:**
- Modify: `src/components/layout/LeftPalette.vue`

- [ ] Remove the raw HTML fragment import.
- [ ] Import `getPaletteGroups` from `../../services/componentRegistry.js`.
- [ ] Render `getPaletteGroups()` with Vue template loops.
- [ ] Preserve `.citem-draggable`, `data-component`, `.citem-line-tool`, `data-line-type`, `data-palette-group`, and `data-palette-body`.
- [ ] Keep the component authoring button in the simulation group.
- [ ] Run `npm.cmd test -- --run tests\left-palette-taxonomy.spec.js`; expected after implementation: pass.

### Task 3: Regression Verification

**Files:**
- No production edits expected.

- [ ] Run `npm.cmd test -- --run tests\signal-routing-app.spec.js`.
- [ ] Run `npm.cmd test -- --run tests\flight-model-package-app.spec.js -t "component registry globals|enables the run button"`.
- [ ] Run `npm.cmd run build`.
- [ ] Commit the changes with message `Render left palette from component registry`.
