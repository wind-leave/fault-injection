# eVTOL Hierarchical Example Packages Design

## Goal

Add two new importable example packages that demonstrate the platform's subsystem hierarchy in a realistic way:

- `evtol_small_nonlinear_hierarchical.json`
- `evtol_small_nonlinear_hierarchical_fault_injected.json`

The new examples must coexist with the existing flat examples, not replace them. After import, the user should immediately see a clean top-level eVTOL architecture composed of nested subsystems, and the fault-injected version should already contain one local subsystem fault that is easy to observe in the oscilloscope.

## Why This Is Needed

The platform now supports:

- blank workspaces
- nested subsystems
- subsystem wrapping
- layered import/export
- fault-injected example packages

But the shipped eVTOL reference package is still primarily a flat graph. That means the user can verify the mechanics of import/export and simulation, but cannot immediately verify whether the new hierarchy feature works well on a realistic model.

The missing piece is a first-class example package that is authored specifically for the layered canvas model.

## Scope

This round adds packaged examples only. It does not introduce new subsystem runtime behavior.

Included:

- one hierarchical normal example package
- one hierarchical pre-fault example package
- build-script support so the JSON files are generated, not hand-maintained
- tests for package validity and importability
- README updates listing the new examples

Not included:

- new Python modules
- new fault types beyond the chosen preloaded local fault
- new subsystem UI features
- auto-layout or visual thumbnail previews for subsystem shells

## Output Files

Keep the current two files:

- `public/model-packages/evtol_small_nonlinear.json`
- `public/model-packages/evtol_small_nonlinear_fault_injected.json`

Add two more:

- `public/model-packages/evtol_small_nonlinear_hierarchical.json`
- `public/model-packages/evtol_small_nonlinear_hierarchical_fault_injected.json`

The first pair remains the flat baseline. The second pair becomes the hierarchy showcase.

## Chosen Example Strategy

Keep the current flat examples as baseline and add a second pair of hierarchy-focused examples.

This is better than replacing the current files because it preserves two different teaching modes:

- flat examples for quick signal-chain inspection and regression comparison
- hierarchical examples for realistic system decomposition and subsystem navigation

It also avoids destabilizing existing tests and user habits that already point to the flat package names.

## Top-Level Hierarchical Structure

The hierarchical example should expose exactly four top-level subsystems:

1. `传感器`
2. `控制律`
3. `执行分配与电机`
4. `动力学与观测`

Top-level should remain intentionally sparse. It should contain:

- a small set of signal sources needed to drive the chain
- the four subsystem shells above
- one or two instrument scopes
- only the major inter-subsystem connections

The top level should feel like a flight-control architecture view, not a full implementation canvas.

## Internal Subsystem Decomposition

### 1. 传感器

Contains:

- `imu_gyro`
- `imu_accel`
- `barometer`
- `gps_velocity`

Purpose:

- group all sensing and measured-state generation in one place
- give the user a meaningful place to enter when inspecting sensor-side faults later

### 2. 控制律

Contains:

- `attitude_pid`

Purpose:

- isolate the control-law stage so the user can inspect control computation separately from sensors and actuators

Even though this subsystem is small in v1, it is still worth keeping because it reflects how a real flight-control stack is organized.

### 3. 执行分配与电机

Contains:

- `control_allocation`
- `motor_model`

Purpose:

- group the command-splitting and actuation chain together
- provide the best place for the preloaded local fault

### 4. 动力学与观测

Contains:

- `vehicle_dynamics`
- any local observation wiring needed to feed top-level scopes cleanly

Purpose:

- group the plant-side response and final observable outputs

## Chosen Preloaded Fault

The hierarchical fault-injected example will preload exactly one local fault:

- `motor_efficiency_loss`

This fault will be attached inside the `执行分配与电机` subsystem, specifically on the `motor_model` node.

## Why This Fault

This is the best first hierarchical fault example because:

- it is local to one subsystem
- it produces a visible change in downstream dynamics
- it is easier to explain than a sensor-side fault on first import
- it gives the user a clear reason to compare top-level and sub-level views

The user should be able to say:

- top level shows that the actuator chain is degraded
- entering `执行分配与电机` shows exactly which node contains the fault
- the scope makes the response difference visible

That is the right demonstration of hierarchy plus preloaded fault state.

## Top-Level Signals And Scopes

The hierarchical normal and fault versions should both include a compact set of top-level observability elements.

Recommended top-level non-subsystem nodes:

- one command or error input signal source feeding the control chain
- one held/sample support signal if the chosen module chain still needs it
- one `Dynamics Scope`
- one `Sensor Scope`

The scopes should remain at top level so the user can compare behavior without drilling into every subsystem.

The fault-injected version should not rely on the user manually opening a subsystem before the effect becomes visible. The top-level scopes should already respond differently.

## Snapshot Construction Approach

Do not hand-author four JSON packages independently.

Instead, extend the existing package build script so it generates all example variants from shared inputs:

- shared metadata
- shared parsed Python modules
- shared fault library
- shared base flat snapshot
- one derived hierarchical snapshot
- one derived flat fault-injected snapshot
- one derived hierarchical fault-injected snapshot

This keeps the examples structurally consistent and avoids drift.

## Build Script Changes

Update `tools/flight_model_package/build_evtol_package.mjs` to:

1. keep building the current flat normal package
2. keep building the current flat fault-injected package
3. derive a hierarchical snapshot from the same module set
4. build a hierarchical normal package
5. clone that hierarchical snapshot and inject the chosen local fault
6. build a hierarchical fault-injected package

The script should write four package files total.

## Hierarchical Snapshot Authoring Rules

The hierarchical snapshots should be authored directly in layered `workbenchSnapshot` form.

Required characteristics:

- root canvas contains only top-level subsystem shells, scopes, signal sources, and major connections
- each subsystem shell has a stable `targetCanvasId`
- each child canvas contains the real internal nodes and edges
- subsystem interfaces are explicit and stable
- package import should restore the correct root canvas, child canvases, and breadcrumb trail

The generated package should not depend on runtime wrapping logic. It should already be a complete layered snapshot at build time.

## Fault-Injected Hierarchical Snapshot Rules

The hierarchical fault-injected package must preserve all hierarchy from the normal hierarchical package and then add:

- the selected imported fault model entry
- the target node's `injectedFault`
- the correct `faultedBlks`
- any package metadata suffix that clearly marks the package as fault-injected

The fault should remain local to the `执行分配与电机` child canvas. It should not be represented as a fake root-level fault if that would hide where the fault actually lives.

## Naming

Use these package IDs and names:

- Normal hierarchical:
  - modelId: `evtol-small-nonlinear-hierarchical`
  - modelName: `eVTOL Small Nonlinear Flight Control (Hierarchical)`

- Fault hierarchical:
  - modelId: `evtol-small-nonlinear-hierarchical-fault-injected`
  - modelName: `eVTOL Small Nonlinear Flight Control (Hierarchical Fault Injected)`

The flat packages keep their current names.

## Testing

Add or update coverage for:

1. hierarchical normal package file exists and validates
2. hierarchical fault-injected package file exists and validates
3. hierarchical normal package imports through the app bridge
4. hierarchical fault-injected package imports through the app bridge
5. imported hierarchical package restores multiple canvases, not just `canvas-root`
6. fault-injected hierarchical package restores a faulted node inside a child canvas

The tests should verify both package correctness and user-visible import behavior.

## README Updates

README should list all four example imports clearly:

- flat normal
- flat fault-injected
- hierarchical normal
- hierarchical fault-injected

The README should also briefly explain why the hierarchical examples exist:

- they demonstrate subsystem navigation and layered import/export on a realistic eVTOL reference model

## Acceptance Criteria

This work is complete when:

- four eVTOL example JSON packages are generated successfully
- the two new hierarchical package files validate with the current package validator
- the hierarchical normal package imports and restores child canvases
- the hierarchical fault-injected package imports and restores a preloaded local fault inside the actuator subsystem
- the README documents all four example files
- existing flat-package behavior remains unchanged
