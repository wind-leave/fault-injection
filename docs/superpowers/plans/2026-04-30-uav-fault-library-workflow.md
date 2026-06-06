# UAV Fault Library Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end workflow where the user first selects and imports a system model, the platform then loads the fault library that matches that system type, and the user opens a dedicated fault-injection window to inject one or more compatible faults. Confirmation mutates the current canvas by changing parameters, binding block faults, inserting fault modules, or adding protocol-edge fault metadata. The injected model can then run simulation and save result artifacts.

**Architecture:** Keep the current Vue shell and legacy runtime bridge, but make model/fault compatibility explicit. The PDF-derived catalog is a UAV flight-control fault library, not a generic global library. Every model package should expose enough metadata to identify its system family and supported fault-library IDs. Every fault should expose its applicable system family, target kind, parameter schema, runtime behavior, and graph mutation strategy.

**Tech Stack:** Vue 3, Vite, Vitest, existing model package JSON files, existing legacy runtime bridge, Python module metadata embedded in model packages, PDF-derived `fault-types/fault-type-catalog.json`.

## Fault Visual and Signal-Flow Contract

The canvas and multi-signal flow graph need a shared fault instance contract, not only a single `injectedFault` object:

```js
{
  faultBindings: [
    {
      bindingId: 'sensor_additive_bias::node-gps::node',
      faultModelId: 'sensor_additive_bias',
      name: '...',
      layer: 'electrical',
      runtimeBehavior: 'additive_bias',
      parameters: {},
      targetKind: 'node' | 'edge',
      targetId: 'node-gps',
      visualRole: 'fault-source' | 'fault-affected',
      propagationMode: 'localOnly' | 'signalTransform' | 'parameterInfluence' | 'protocolEdge' | 'derivedResidual',
      canPropagate: true,
      active: true
    }
  ],
  injectedFault: {} // compatibility field: latest active binding payload
}
```

Visual rules:
- A directly injected node or edge must turn red.
- A component can hold multiple active fault bindings. The red marker should remain on the component, and the property panel should show the fault stack.
- A CAN/protocol edge fault turns the edge red.
- A normal edge with a direct edge fault also turns red.
- Downstream signal-flow propagation is not automatic for every adjacent edge. `localOnly` and unqualified `parameterInfluence` faults stay on the target component until a specific affected output/channel is known.
- `signalTransform` faults can mark outgoing edges, optionally narrowed by `sourcePortIndex`, `channelId`, `signalId`, or `affectedChannels`.
- `protocolEdge` faults belong to CAN/data-link edges and should eventually carry frame/message/channel metadata.

Data-flow extension needed for later tasks:
- Add edge-level `signalChannels[]` or `faultTrace[]` with `cleanValue`, `faultedValue`, `sourceFaultBindingId`, `channelId`, and `propagationMode`.
- Multi-signal flow tests must prove that one contaminated lane can coexist with another clean lane on the same component or edge.

---

## Audit Summary

Current strengths:
- `public/model-packages/evtol_small_nonlinear_hierarchical.json` already provides a complete hierarchical UAV flight-control model package.
- `fault-types/fault-type-catalog.json` already contains the PDF-derived physical/electrical/protocol fault list and default parameters.
- `src/services/faultInjectionService.js` now contains a first pass of behavior mapping and scalar fault execution.
- `src/services/legacy-runtime.txt` already supports Python-bound simulation blocks, CAN edges, instruments, model packages, and basic fault metadata.

Current gaps against the corrected workflow:
- System import must remain selectable. The platform should not silently force one default flight-control model as the only normal path.
- Fault libraries must be scoped to compatible systems. The current UAV flight-control catalog should only be offered for flight-control model packages or explicitly compatible UAV packages.
- Fault injection needs a separate `注入故障` entry point. This should open a floating window for selecting fault categories, one or more faults, targets, and parameters.
- Single-fault and multi-fault injection need a shared planner. The planner should produce an ordered list of graph/parameter mutations and report incompatible selections before changing the canvas.
- Injected components and edges need to use `faultBindings[]` as the durable multi-fault record, while keeping `injectedFault` for existing runtime compatibility.
- Multi-signal flow needs propagation semantics. It should distinguish a red source component from a downstream affected edge, and should not blindly mark all adjacent edges as contaminated.
- Every PDF fault type needs an explicit injection design, not just a formula and recommended module name.
- Several fault types still need concrete platform representation: insert a module, mutate a module parameter, bind to a simulation block fault, or mutate a protocol edge.
- Parameter configuration needs schema-level validation with labels, units, ranges, defaults, and target hints.
- `保存仿真结果` needs a real export payload for injected fault runs, not just a success toast.
- End-to-end tests should prove selectable model import, compatible fault-library filtering, one physical injection, one electrical injection, one protocol injection, multi-fault injection, simulation, and save.

## File Map

- Modify `public/model-packages/*.json`: add or normalize `systemFamily`, `supportedFaultLibraries`, and capability metadata where needed.
- Modify `fault-types/fault-type-catalog.json`: add `libraryId`, `systemFamily`, `injectionDesign`, and `parameterSchema` to every fault type.
- Modify `src/services/faultInjectionService.js`: keep scalar runtime functions and add design validation helpers.
- Create `src/services/modelFaultCompatibilityService.js`: decide which fault libraries and fault types are available for the imported model.
- Create `src/services/faultInjectionPlanner.js`: decide target and graph mutation for one selected fault or a batch of selected faults.
- Modify `src/services/simulationRuntime.js`: expose compatibility, planner, and runtime service functions to legacy runtime.
- Modify `src/services/legacy-runtime.txt`: wire the `注入故障` action to the floating window, render parameter editors, run the planner, apply graph mutations, and save results.
- Modify `src/fragments/header.html`: keep selectable system import and add or rename a dedicated `注入故障` button.
- Modify `src/fragments/dialogs/fault-library-dialog.html`: turn the existing fault dialog into a system-scoped injection window: category -> fault selection -> target preview -> parameters -> inject.
- Modify `src/styles/dialogs.css`: parameter editor, multi-selection list, and target preview layout only.
- Create `tests/model-fault-compatibility.spec.js`: model/fault-library compatibility tests.
- Create `tests/fault-injection-design.spec.js`: catalog design coverage tests.
- Create `tests/fault-injection-planner.spec.js`: graph mutation and batch injection tests.
- Modify `tests/flight-model-package.spec.js`: ensure selectable model fixtures expose compatibility metadata.
- Create or extend app specs in `tests/flight-model-package-app.spec.js`: workflow-level test for import, inject, simulate, save.

## Task 1: Preserve Selectable System Import and Bind Matching Fault Libraries

**Files:**
- Modify: `public/model-packages/*.json`
- Create: `src/services/modelFaultCompatibilityService.js`
- Create: `tests/model-fault-compatibility.spec.js`
- Modify: `tests/flight-model-package.spec.js`

- [x] **Step 1: Add failing compatibility tests**

Test that a UAV flight-control package exposes:

```js
{
  systemFamily: 'uav-flight-control',
  supportedFaultLibraries: ['uav-flight-control-faults']
}
```

Also test that a non-compatible or empty model does not receive the UAV fault library.

Run:

```bash
npm test -- --run tests/model-fault-compatibility.spec.js tests/flight-model-package.spec.js
```

Expected before implementation: compatibility tests fail because metadata/service is incomplete.

- [x] **Step 2: Add model compatibility metadata**

Add model-package metadata without changing the user's ability to choose a package:
- UAV flight-control packages: `systemFamily: 'uav-flight-control'`
- UAV flight-control packages: `supportedFaultLibraries: ['uav-flight-control-faults']`
- Other demo/blank packages: no UAV library unless explicitly designed later

- [x] **Step 3: Implement compatibility service**

Function examples:

```js
export function getModelFaultLibraries(modelPackage) {
  return ['uav-flight-control-faults'];
}

export function isFaultCompatibleWithModel(faultModel, modelPackage) {
  return true;
}
```

The implementation should use metadata first and conservative fallback rules only for existing UAV package IDs.

- [x] **Step 4: Verify**

Run:

```bash
npm test -- --run tests/model-fault-compatibility.spec.js tests/flight-model-package.spec.js
```

Expected: selectable model packages remain valid, and the UAV fault library is only available for compatible packages.

## Task 2: Add Injection Design Metadata for Every PDF Fault Type

**Files:**
- Modify: `fault-types/fault-type-catalog.json`
- Create: `tests/fault-injection-design.spec.js`

- [ ] **Step 1: Write catalog coverage tests**

Create tests that assert every `faultTypes[]` entry has:

```js
libraryId: 'uav-flight-control-faults',
systemFamily: 'uav-flight-control',
injectionDesign: {
  targetKind: 'parameter_patch' | 'module_insertion' | 'simulation_block_fault' | 'protocol_edge_fault',
  platformModule: '...',
  targetSelector: { moduleIds: [], nodeTypes: [], edgeTypes: [] },
  runtimeBehavior: '...',
  pythonFunction: '...'
},
parameterSchema: [
  { key: 'start', label: '开始时间', type: 'number', default: 0, unit: 's' }
]
```

Run:

```bash
npm test -- --run tests/fault-injection-design.spec.js
```

Expected: fail because the metadata is not complete.

- [ ] **Step 2: Fill physical-layer designs**

Map:
- `physical_parameter_bias` -> `parameter_patch`
- `physical_parameter_drift` -> `module_insertion`
- `physical_parameter_step` -> `module_insertion`
- `actuator_lock_or_failure` -> `module_insertion`
- `saturation_limit` -> `module_insertion`

- [ ] **Step 3: Fill electrical-layer designs**

Map:
- `sensor_additive_bias` -> `simulation_block_fault`
- `sensor_scale_distortion` -> `module_insertion`
- `noise_increase` -> `module_insertion`
- `colored_noise` -> `module_insertion`
- `signal_freeze` -> `simulation_block_fault`
- `state_jump_or_sign_flip` -> `module_insertion`
- `intermittent_anomaly` -> `module_insertion`

- [ ] **Step 4: Fill protocol-layer designs**

Map every protocol fault to `protocol_edge_fault`, using `edgeTypes: ['can']` and protocol runtime behaviors:
- fixed delay
- jitter delay
- packet loss
- burst loss
- tamper
- interrupt

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --run tests/fault-injection-design.spec.js tests/fault-injection-service.spec.js
```

Expected: all catalog entries have concrete design metadata and remain executable by scalar runtime helpers.

## Task 3: Build the Fault Injection Planner

**Files:**
- Create: `src/services/faultInjectionPlanner.js`
- Create: `tests/fault-injection-planner.spec.js`

- [ ] **Step 1: Write failing planner tests**

Test five mutations:
- `parameter_patch`: changes a matched simulation block parameter record.
- `module_insertion`: inserts an explicit fault node between source and target.
- `simulation_block_fault`: writes `node.injectedFault`.
- `protocol_edge_fault`: writes `edge.injectedFault`.
- `batch`: applies multiple compatible fault selections in a stable order and reports partial incompatibilities.

Run:

```bash
npm test -- --run tests/fault-injection-planner.spec.js
```

Expected: fail because planner does not exist.

- [ ] **Step 2: Implement single-fault planning**

Function signature:

```js
export function planFaultInjection({ faultModel, parameters, snapshot, selectedNodeId, selectedEdgeId }) {
  return {
    ok: true,
    mutationType: 'parameter_patch',
    target: { kind: 'node', id: 'node-1' },
    operations: []
  };
}
```

- [ ] **Step 3: Implement batch planning**

Function signature:

```js
export function planFaultInjectionBatch({ selections, snapshot, modelPackage }) {
  return {
    ok: true,
    plans: [],
    rejected: []
  };
}
```

Each selection should include `faultModelId`, `parameters`, and optional `selectedNodeId` or `selectedEdgeId`.

- [ ] **Step 4: Implement plan application**

Function signature:

```js
export function applyFaultInjectionPlan(snapshot, planOrBatch) {
  return {
    snapshot: nextSnapshot,
    injectedFaults: [],
    changedNodeIds: [],
    changedEdgeIds: []
  };
}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --run tests/fault-injection-planner.spec.js
```

Expected: single-fault and batch planner tests pass.

## Task 3A: Stabilize Multi-Fault Bindings and Conservative Signal Propagation

**Files:**
- Modify: `src/services/faultInjectionService.js`
- Modify: `src/services/simulationRuntime.js`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Test: `tests/fault-injection-service.spec.js`

- [x] **Step 1: Add fault binding helpers**

Add `createFaultBinding`, `appendFaultBinding`, `getFaultBindings`, `hasActiveFaultBinding`, `inferFaultPropagationMode`, and scalar composition helpers. Keep `injectedFault` as the latest active payload for old code.

- [x] **Step 2: Preserve red visual state**

Nodes and edges should turn red from either `injectedFault` or active `faultBindings[]`. Normal edges with a direct fault should use the same red visual as CAN edges.

- [x] **Step 3: Make multi-signal flow propagation conservative**

Use `propagationMode` so local and parameter-only faults do not automatically contaminate all adjacent edges. Signal-transform faults can propagate from source node to outgoing edge; protocol faults stay on data-link edges.

- [ ] **Step 4: Add signal-channel tests**

Add tests for `sourcePortIndex`, `channelId`, `signalId`, and `affectedChannels` once the planner stores those fields on bindings.

## Task 4: Build the Dedicated Fault Injection Window

**Files:**
- Modify: `src/fragments/header.html`
- Modify: `src/fragments/dialogs/fault-library-dialog.html`
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/dialogs.css`
- Test: `tests/flight-model-package-app.spec.js`

- [x] **Step 1: Add app test for opening `注入故障`**

Test flow:
1. Import a selectable UAV flight-control model package.
2. Click `注入故障`.
3. Assert the floating window only shows UAV flight-control faults.
4. Assert incompatible models show a clear disabled/empty state instead of allowing injection.

- [ ] **Step 2: Render category and multi-selection controls**

The window should support:
- category filtering by physical/electrical/protocol fault type
- selecting one fault
- selecting multiple faults
- per-fault parameter drafts stored by fault ID
- per-fault target preview

- [ ] **Step 3: Render `parameterSchema` instead of raw object fields**

Use schema labels and units. Store draft values under a structure like:

```js
S.faultInjectionDrafts = {
  selectedFaultIds: [],
  parametersByFaultId: {},
  targetByFaultId: {}
};
```

- [ ] **Step 4: Render target preview**

Show target mode:
- `参数修改`
- `插入故障模块`
- `绑定模块故障`
- `CAN 协议边故障`

- [ ] **Step 5: Apply injection and update canvas**

On confirmation:
- build one or more fault selections
- run compatibility checks
- run the planner
- apply the graph/parameter mutations
- re-render the canvas and property panel
- keep injected fault metadata visible on changed components/edges

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- --run tests/flight-model-package-app.spec.js
npm run build
```

Expected: the dedicated injection window works for compatible models and blocks incompatible systems.

## Task 5: Inject Physical Faults

**Files:**
- Modify: `src/services/faultInjectionPlanner.js`
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/fault-injection-planner.spec.js`

- [ ] **Step 1: Add one test per physical fault**

Assert the five physical faults each produce the correct mutation type and runtime metadata.

- [ ] **Step 2: Implement explicit module insertion**

Insert modules:
- `fault_drift_ramp`
- `fault_step_jump`
- `fault_freeze_or_lock`
- `fault_saturation`

Use existing node style and ports from the current component library.

- [ ] **Step 3: Implement parameter patch**

For `physical_parameter_bias`, record:

```js
node.parameterPatches = [
  { faultModelId, targetParameter, parameters, active: true }
]
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- --run tests/fault-injection-planner.spec.js tests/fault-injection-service.spec.js
```

Expected: all physical fault tests pass.

## Task 6: Inject Electrical Faults

**Files:**
- Modify: `src/services/faultInjectionPlanner.js`
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/fault-injection-planner.spec.js`

- [ ] **Step 1: Add one test per electrical fault**

Assert all seven electrical faults can be planned and applied to a sensor/controller signal path.

- [ ] **Step 2: Use `simulation_block_fault` for direct module faults**

Use `node.injectedFault` for:
- sensor additive bias
- signal freeze

- [ ] **Step 3: Use module insertion for signal-transform faults**

Use inserted fault modules for:
- scale distortion
- configurable noise
- colored noise
- state jump/sign flip
- intermittent anomaly

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- --run tests/fault-injection-planner.spec.js
```

Expected: all electrical planning tests pass.

## Task 7: Inject Protocol Faults on CAN Edges

**Files:**
- Modify: `src/services/faultInjectionPlanner.js`
- Modify: `src/services/faultInjectionService.js`
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/fault-injection-planner.spec.js`

- [ ] **Step 1: Add one test per protocol fault**

Assert all protocol faults target CAN edges and preserve parameter values.

- [ ] **Step 2: Apply runtime edge behavior**

Map:
- fixed delay -> delay queue
- time-varying delay -> base plus jitter
- random packet loss -> hold or zero strategy
- burst loss -> burst counter
- tamper -> bias/scale/invert
- interrupt -> hold or zero for duration

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- --run tests/fault-injection-planner.spec.js tests/fault-injection-service.spec.js
```

Expected: protocol planner and scalar runtime tests pass.

## Task 8: Save Simulation Results as a Real Artifact

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Create: `src/services/simulationResultExportService.js`
- Create: `tests/simulation-result-export.spec.js`

- [ ] **Step 1: Write export test**

Given a simulated state with samples, injected faults, model package metadata, and active parameters, expect JSON with:
- model id/name
- timestamp
- fault list
- parameters
- sampled channels
- residual summary

- [ ] **Step 2: Implement export service**

Function signature:

```js
export function buildSimulationResultExport({ state, sim }) {
  return { schemaVersion: 1, model, faults, samples, summary };
}
```

- [ ] **Step 3: Wire `doSaveRes()`**

Generate downloadable `.json`. Keep a toast only after the file is created.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- --run tests/simulation-result-export.spec.js
npm run build
```

Expected: export test and build pass.

## Task 9: End-to-End Workflow Tests

**Files:**
- Modify: `tests/flight-model-package-app.spec.js`
- Possibly modify: `tests/oscilloscope-app.spec.js`

- [ ] **Step 1: Add selectable-system workflow test**

Select and import a UAV flight-control model package. Assert the compatible UAV fault library is available.

- [ ] **Step 2: Add incompatible-system workflow test**

Import or create a non-UAV model. Assert the UAV flight-control fault library is unavailable and injection is blocked.

- [ ] **Step 3: Add physical workflow test**

Import a UAV model, inject `saturation_limit`, run one step, assert a fault node or parameter patch exists and simulation samples update.

- [ ] **Step 4: Add electrical workflow test**

Import a UAV model, inject `sensor_additive_bias`, run one step, assert target node has `injectedFault.parameters.offset`.

- [ ] **Step 5: Add protocol workflow test**

Import a UAV model, select a CAN edge, inject `random_packet_loss`, run one step, assert edge state records held/previous output.

- [ ] **Step 6: Add multi-fault workflow test**

Import a UAV model, select one physical and one electrical fault, set separate parameters, inject both, and assert both mutations appear on the canvas.

- [ ] **Step 7: Add save result workflow test**

Run simulation and click save result, assert export payload is created with model, all active faults, parameters, and samples.

- [ ] **Step 8: Verify**

Run:

```bash
npm test -- --run tests/flight-model-package-app.spec.js tests/oscilloscope-app.spec.js
npm run build
```

Expected: workflow tests and build pass.

## Review Gates

After each task:
- Run the task-specific test command.
- Run `npm run build` if UI/runtime files changed.
- Review the diff for unrelated file churn.
- Confirm the task maps to the requested workflow before moving on.

Local review checklist:
- Does system import remain selectable?
- Does the imported model expose its system family and supported fault libraries?
- Is the UAV flight-control fault library hidden or disabled for incompatible systems?
- Does `注入故障` open a dedicated floating window?
- Can faults be selected by category?
- Can the user inject exactly one fault?
- Can the user inject multiple faults in one confirmation?
- Does every selected fault show a parameter form?
- Does confirmation mutate the system graph or parameters in a visible way?
- Does a directly injected component or edge turn red?
- If one component has multiple fault forms, does the property panel show the stack and keep all active bindings?
- In the multi-signal flow graph, are propagated and non-propagated fault forms represented differently?
- Does simulation runtime consume the stored parameters?
- Does saving results produce an artifact with model, all active faults, parameters, and sample data?

## Execution Recommendation

Use inline execution for code changes, one task at a time, because the runtime is a large legacy file and there are already many uncommitted workspace changes. When the user explicitly asks for parallel review, dispatch read-only agents for browser/runtime review and code audit, then integrate findings locally.
