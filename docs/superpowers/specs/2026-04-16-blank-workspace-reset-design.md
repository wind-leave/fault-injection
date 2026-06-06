# Blank Workspace And Reset Design

## Goal

Let the platform start from an explicit empty workspace without forcing the user to import a model package first, while preserving the existing import-based workflow.

This round adds two new actions:

- `新建空白模型`
- `重置画布`

Both actions must leave the workbench in a clean, buildable state. The user must always confirm before `重置画布` executes.

## Current Problem

The current runtime treats `sysLoaded` as both:

- "a system package has been imported"
- "the workbench is allowed to model"

That coupling creates two bad side effects:

- a user cannot start from a clean canvas unless they first import something
- UI copy, buttons, and status text all imply that importing is the only valid entry path

This is no longer correct once the platform supports layered canvases, subsystem encapsulation, and direct authoring.

## Chosen Direction

Keep the current import flow, but introduce a second valid workspace source: `blank`.

The workbench will support three source states:

- `blank`: user explicitly created a new empty model
- `imported`: user imported a JSON model package
- `legacy`: user restored from the old localStorage snapshot path

`sysLoaded` remains as the broad compatibility flag meaning "the canvas is active and modeling is allowed", but source-specific behavior moves to a new field.

## Why This Direction

This is the smallest change that fixes the workflow cleanly.

It avoids two mistakes:

- making the app always boot into a blank canvas, which would change the current workflow too aggressively
- faking an empty workspace as if it were an imported package, which would blur package-source semantics and make status text, export, and reset behavior harder to reason about later

With `workspaceSource`, the platform can distinguish:

- a clean authored workspace
- an imported model package
- an old restored session

without rewriting the rest of the runtime around that distinction.

## Product Shape

### Top toolbar

Add one new primary action and one destructive action:

- `新建空白模型`
- `重置画布`

The existing actions remain:

- `导入系统模型`
- `导入故障模型`
- `保存系统模型`
- `保存仿真结果`

### Empty state

The empty-state card should no longer tell the user that import is the only path.

It should clearly present two paths:

- 导入系统模型
- 新建空白模型

### Reset flow

`重置画布` always opens a confirmation dialog, even when the current canvas is already empty.

Confirmation copy should make the consequence explicit:

- current root canvas will be cleared
- all child canvases will be removed
- current model-package source state will be cleared
- current imported/injected workspace fault state will be cleared
- current simulation runtime state and open scope windows will be cleared

Cancel must leave the workspace untouched.

## State Model

Add a new runtime field:

```js
workspaceSource: 'blank' | 'imported' | 'legacy' | ''
```

Behavior:

- initial boot: `''`
- after `新建空白模型`: `'blank'`
- after JSON package import: `'imported'`
- after old localStorage restore path: `'legacy'`
- after confirmed reset: `'blank'`

Compatibility:

- `sysLoaded` remains `true` for `blank`, `imported`, and `legacy`
- old code that only checks `sysLoaded` keeps working
- UI decisions that depend on origin should use `workspaceSource`

## New Blank Workspace Behavior

When the user clicks `新建空白模型`, the runtime should:

- create a clean layered snapshot with only `canvas-root`
- clear all nodes and edges in root and child canvases
- reset `nodeSeq`, `edgeSeq`, `activeLineType`, `pendingConnection`, and selection state
- reset active canvas to `canvas-root`
- clear breadcrumbs back to root only
- clear current model package metadata
- clear imported workspace fault models and injected-fault targets
- clear simulation runtime caches and open scope windows
- set `sysLoaded = true`
- set `systemSaved = false`
- set `workspaceSource = 'blank'`

The result must be a usable canvas where the user can immediately:

- drag components
- wire ports
- create subsystems
- save the current system model

## Reset Behavior

`重置画布` should reuse the same internal reset helper as `新建空白模型`, but only after confirmation.

Post-reset state is intentionally the same as a newly created blank model:

- clean root canvas
- no child canvases
- no active imported model package
- no imported workspace fault instances
- no running simulation state
- `workspaceSource = 'blank'`

This keeps behavior deterministic and easy to explain.

## Model Package Status Rules

The model-package status area must distinguish source states:

- `imported`: show package name and execution mode, as today
- `legacy`: show restored local model state without package metadata
- `blank`: show a compact neutral state such as `空白模型工作区`
- initial unloaded state: no package status, keep the existing idle shell

Blank workspaces must not pretend to have a package source.

## Save / Export Rules

`保存系统模型` from a blank workspace is valid.

Expected behavior:

- save the current snapshot to local storage as today
- mark `systemSaved = true`
- keep `workspaceSource = 'blank'`

If the user later exports a model package from a blank-authored workspace, the package should not claim an imported source package. It is simply an authored workspace export.

This round does not require changing the model-package export schema beyond avoiding stale imported-package status.

## Simulation Rules

Blank workspaces become valid simulation workspaces once they contain a runnable model.

No special-case simulation logic is needed beyond decoupling "workspace active" from "package imported".

The gating rule becomes:

- block simulation only when there is no active workspace or no runnable topology
- do not block simulation merely because the workspace was not imported

This means existing `sysLoaded` checks remain mostly usable once blank workspaces set `sysLoaded = true`.

## UI Copy Updates

These texts should be updated to reflect the new workflow:

- status bar idle copy
- empty-state title and subtitle
- any toast that currently says "请先导入系统模型" when the real requirement is "请先新建或导入系统模型"

Preferred wording:

- `请先新建空白模型或导入系统模型`
- `空白模型工作区已创建`
- `确认重置当前画布吗？此操作会清空当前系统及其子系统内容`

## Implementation Boundaries

This round includes:

- toolbar buttons
- blank workspace creation
- always-confirm reset
- state decoupling through `workspaceSource`
- copy updates
- tests for blank/reset flows

This round does not include:

- changing the default boot experience to auto-open a blank workspace
- autosave redesign
- versioned reset history / undo
- multi-tab recovery

## Tests

Add or update integration coverage for these cases:

1. clicking `新建空白模型` enables direct modeling without importing a package
2. blank workspace can create nodes and save successfully
3. `重置画布` always asks for confirmation
4. cancelling reset preserves nodes, child canvases, and current workspace source
5. confirming reset clears root and child canvases and returns to a blank workspace
6. importing a package and then resetting clears imported package metadata and returns to `blank`
7. idle empty-state copy presents both import and blank-workspace entry paths

## Risks And Mitigations

### Risk 1: Old code still assumes import is mandatory

Mitigation:

- keep `sysLoaded`
- set it to `true` for blank workspaces
- only update copy and source-specific logic where origin actually matters

### Risk 2: Reset clears only the current canvas and leaves child canvases behind

Mitigation:

- reuse the same full workspace reset helper for both blank creation and confirmed reset
- explicitly recreate the canvas registry from a clean root snapshot

### Risk 3: Reset leaves stale package status or scope state on screen

Mitigation:

- clear `activeModelPackage`
- clear scope-window runtime state
- force a full UI rerender after reset

## Acceptance Criteria

The feature is complete when:

- the user can enter a usable empty workspace without importing any model
- `重置画布` is available and always asks for confirmation
- confirmed reset always returns the app to a clean blank workspace
- package import continues to work unchanged
- saving a blank-authored workspace still works
- tests cover both blank-entry and reset-confirmation flows
