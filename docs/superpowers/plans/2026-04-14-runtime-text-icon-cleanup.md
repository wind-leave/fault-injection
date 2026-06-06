# Runtime Text And Icon Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix remaining mojibake-style runtime prompts, improve weak placeholder icons using stable HTML entities, and add a minimal Python binding sample.

**Architecture:** Keep the current Vue shell plus `legacy-runtime.txt` bridge unchanged structurally. Only correct active user-facing strings, tighten icon markup/styles in the fragment layer, and add regression tests around the broken runtime paths.

**Tech Stack:** Vue 3, Vite, Vitest, legacy runtime bridge, static HTML fragments, Python sample files.

---

### Task 1: Lock Broken Text With Tests

**Files:**
- Modify: `tests/python-binding-app.spec.js`

- [x] Add a duplicate-edge warning test.
- [x] Add an occupied-input warning test.
- [x] Add an import-fault precheck warning test.

### Task 2: Repair Active Runtime Strings

**Files:**
- Modify: `src/services/legacy-runtime.txt`

- [x] Replace corrupted edge failure prompts with clean Chinese text.
- [x] Replace corrupted system-model import/save precheck prompts with clean Chinese text.
- [x] Fix the electrical-fault injection success template string.

### Task 3: Improve Icon Presentation

**Files:**
- Modify: `src/fragments/left-panel.html`
- Modify: `src/styles/components.css`
- Modify: `src/styles/dialogs.css`
- Modify: `src/services/legacy-runtime.txt`

- [x] Replace left-panel group single-character placeholders with stable entity icons.
- [x] Upgrade palette badge styling so component entries read more clearly.
- [x] Replace fault-library layer letters with clearer layer-specific icons and colors.

### Task 4: Add A Minimal Python Sample

**Files:**
- Create: `public/samples/single_io_demo.py`

- [x] Add one input parameter.
- [x] Add one observable middle variable.
- [x] Return one output value.

### Task 5: Verify

**Files:**
- Verify: `tests/python-binding-app.spec.js`
- Verify: project build output

- [ ] Run targeted Vitest coverage for the repaired prompts.
- [ ] Run the full test suite.
- [ ] Run a production build.
