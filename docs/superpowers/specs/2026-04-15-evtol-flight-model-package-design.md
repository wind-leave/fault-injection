# eVTOL Flight Model Package Design

## Goal

Add a new subproject to the fault platform that supports a self-contained eVTOL flight-control model package.

The final user-facing result must support:

- manually decomposing the provided eVTOL Simulink model into Python modules
- packaging those modules, the workbench graph, and fault definitions into a single JSON file
- importing that JSON file into the platform
- restoring the model graph, Python bindings, and fault-library metadata from that JSON file
- saving the current model back out as the same JSON package format
- executing at least one real model path through a lightweight local Python backend instead of the current mock-only runtime

This is treated as a platform subproject, not a one-off demo script.

## Current Platform Reality

The existing platform already has three partial building blocks:

1. **Workbench snapshot persistence**
   - `src/services/workbenchSnapshotService.js` can already serialize and restore `modelNodes`, `modelEdges`, `pythonBinding`, and fault-related state.

2. **Single-file Python binding**
   - `src/components/dialogs/PythonBindingDialog.vue`
   - `src/services/pythonParserService.js`
   - `src/composables/useWorkbenchState.js`
   These already let a single simulation block bind to one Python source file and infer inputs, outputs, and observable middle variables.

3. **Execution adapter abstraction**
   - `src/services/pythonExecutionAdapter.js`
   - `src/services/pythonFlowBindingRuntime.js`
   The platform already constructs a stable execution payload, but it defaults to `mock` behavior unless a backend execution path is provided.

So the missing capability is not raw binding or raw snapshotting. The missing capability is a **first-class model package format and loading workflow** that turns multiple Python modules plus a graph into a reusable, importable flight model.

## Source Material

The subproject is grounded in two provided inputs:

- `eVTOL_Small_nonandlin_algorithm_validation.slx`
- `常见飞控模型故障梳理(1).docx`

From the Simulink model, the top-level structure already suggests several high-value subsystems:

- attitude control / PID control
- control allocation / motor actuator handling
- sensor-fault injection
- aerodynamic and force-moment calculation

From the DOCX, ten common flight-control fault cases are available, including:

- gyroscope bias
- accelerometer scale distortion
- barometer drift
- GPS freeze
- motor efficiency loss
- motor lock
- thrust saturation
- controller proportional gain anomaly
- mass parameter error
- drag coefficient jump

These sources will be manually normalized into the platform package rather than automatically parsed from `.slx`.

## Chosen Direction

Use a **self-contained single-file JSON model package**.

### Why this direction

- The user explicitly wants to import a single JSON file.
- The platform already serializes graph state as JSON, so this extends an existing strength.
- The current execution payload already includes Python source text, so embedding module source inside the package is compatible with the runtime design.
- A single-file package is portable and avoids fragile dependencies on external `.py` paths.

Rejected alternatives:

- **Separate JSON + external `.py` files**: breaks the “single JSON import” requirement and becomes path-fragile.
- **Automatic `.slx` conversion**: too large for this subproject and too risky for the first usable delivery.
- **Browser-embedded Python runtime**: heavier and less aligned with the current execution adapter than a lightweight local backend.

## Product Shape

This subproject introduces a new concept: a **flight model package**.

There are two forms of the same model:

### Authoring form

Used inside the repo while building and maintaining the eVTOL model:

- a folder of Python modules
- a generated package JSON
- optional notes and mapping docs

Suggested authoring area:

- `model-authoring/evtol_small_nonlinear/`

### Runtime import form

Used by the platform:

- one self-contained `.json` file

Suggested runtime asset location:

- `public/model-packages/evtol_small_nonlinear.json`

The platform imports only the runtime JSON package. It does not need neighboring Python files.

## Package Format

The package is a JSON object with five top-level responsibilities:

1. package identity and schema
2. provenance metadata
3. embedded Python module registry
4. embedded fault library
5. embedded workbench snapshot

### Required top-level shape

```json
{
  "schemaVersion": 1,
  "packageType": "flight-control-model",
  "modelId": "evtol-small-nonlinear",
  "modelName": "eVTOL Small Nonlinear Flight Control",
  "description": "eVTOL飞控故障传播与注入模型",
  "source": {
    "origin": "manual-from-slx",
    "slxFile": "eVTOL_Small_nonandlin_algorithm_validation.slx",
    "notesDoc": "常见飞控模型故障梳理(1).docx"
  },
  "pythonModules": [],
  "faultLibrary": [],
  "workbenchSnapshot": {}
}
```

### `pythonModules`

Each entry describes one executable Python module embedded directly in the package.

Required fields:

- `moduleId`
- `fileName`
- `entryFunction`
- `category`
- `source`
- `parsedInterface`

Example:

```json
{
  "moduleId": "attitude_pid",
  "fileName": "attitude_pid.py",
  "entryFunction": "process",
  "category": "controllers",
  "source": "def process(error, dt=0.01, kp=1.0):\n    output = kp * error\n    return output",
  "parsedInterface": {
    "inputs": [],
    "outputs": [],
    "middleVars": []
  }
}
```

`parsedInterface` is stored explicitly so import does not depend on reparsing during every restore path. The platform may still revalidate by reparsing if needed.

### `faultLibrary`

This is the reusable fault catalog associated with the model package, independent of the current faulted-node state in the graph.

Each fault entry must include:

- `faultId`
- `name`
- `category`
- `targetModuleId`
- `targetNodeId`
- `params`
- `description`

Example:

```json
{
  "faultId": "gyro_bias",
  "name": "Gyro陀螺仪零偏故障",
  "category": "sensor",
  "targetModuleId": "imu_gyro",
  "targetNodeId": "node-imu-gyro",
  "params": [
    { "name": "Gyro_Bias_X", "type": "float", "default": 0.0 },
    { "name": "Gyro_Bias_Y", "type": "float", "default": 0.0 },
    { "name": "Gyro_Bias_Z", "type": "float", "default": 0.0 }
  ],
  "description": "角速度输出产生持续零偏，导致姿态与偏航估计漂移"
}
```

### `workbenchSnapshot`

This reuses the platform’s existing snapshot shape as the graph payload.

It must preserve:

- nodes
- edges
- node sequence / edge sequence
- imported fault models
- node-level `pythonBinding`

The package layer sits above the snapshot rather than replacing it.

## Python Module Decomposition

The first eVTOL package should not attempt a block-for-block reproduction of the original `.slx`.

Instead, it should be normalized into a platform-appropriate set of modules with stable interfaces.

### First-stage module set

The initial reference model should contain these modules:

- `imu_gyro.py`
  - category: `sensors`
  - responsibility: gyro outputs and related derived rates
  - fault coverage: `gyro_bias`

- `imu_accel.py`
  - category: `sensors`
  - responsibility: accelerometer outputs
  - fault coverage: `accel_scale`

- `barometer.py`
  - category: `sensors`
  - responsibility: altitude estimate
  - fault coverage: `baro_drift`

- `gps_velocity.py`
  - category: `sensors`
  - responsibility: velocity / position feedback path
  - fault coverage: `gps_freeze`

- `attitude_pid.py`
  - category: `controllers`
  - responsibility: attitude control law
  - fault coverage: `attitude_kp_anomaly`

- `control_allocation.py`
  - category: `allocation_actuators`
  - responsibility: control mixing / allocation to actuators

- `motor_model.py`
  - category: `allocation_actuators`
  - responsibility: actuator thrust generation and saturation behavior
  - fault coverage: `motor_efficiency_loss`, `motor_lock`, `motor_thrust_saturation`

- `vehicle_dynamics.py`
  - category: `dynamics_aero`
  - responsibility: mass, drag, and simplified force / motion response
  - fault coverage: `uav_mass_shift`, `drag_coefficient_jump`

### First-stage fault coverage

The package should register all ten known faults in metadata, but at minimum the first fully validated implementation must support runtime handling for:

- `gyro_bias`
- `baro_drift`
- `gps_freeze`
- `motor_efficiency_loss`
- `drag_coefficient_jump`

This gives coverage across sensing, control feedback, actuation, and dynamics.

## Import / Save / Load Workflow

### Import

When the user imports a flight model package JSON:

1. Read file contents.
2. Parse JSON.
3. Validate `schemaVersion` and `packageType`.
4. Validate that `pythonModules` and `workbenchSnapshot` exist and are well formed.
5. Restore workbench nodes and edges from `workbenchSnapshot`.
6. Reattach each node’s `pythonBinding` using embedded module metadata and source.
7. Register `faultLibrary` into current platform state.
8. Mark the workbench as loaded and ready.

If the graph restores successfully but some Python modules are invalid, the package still loads, but affected nodes must be marked as non-runnable instead of silently downgraded.

### Save

When the user saves the current model:

1. Collect current `workbenchSnapshot`.
2. Collect unique Python modules referenced by bound nodes.
3. Collect current fault library metadata for the active model package.
4. Emit a self-contained JSON package in the same schema.

### Reload behavior

After saving and re-importing the same package, the user must see:

- the same node graph
- the same bindings
- the same module metadata
- the same fault library entries

The platform does not need to restore transient simulation sample buffers or oscilloscope windows from the package.

## Local Python Runtime

The package is not complete unless at least one path executes real Python rather than mock math.

### Chosen runtime model

Use a lightweight local Python backend exposed behind the existing execution adapter contract.

Suggested structure:

- `tools/python_model_runner/server.py`

The frontend continues to call:

- `/api/python-flow/execute`

### Request payload

The frontend already constructs a compatible payload with:

- `nodeId`
- `moduleName`
- `fileName`
- `entryFunction`
- `mode`
- `time`
- `dt`
- `inputs`
- `inputNames`
- `outputNames`
- `middleVarNames`
- `source`

The backend should execute based on embedded `source`, not on reading arbitrary local `.py` paths.

### Backend responsibilities

- safely load Python source into an isolated module namespace
- find the declared `entryFunction`
- call it with normalized numeric inputs
- produce `outputs` and `middleVars`
- return structured execution errors

### Runtime constraints

First-stage backend execution supports:

- pure Python numeric logic
- stateless or explicitly handled internal intermediate variables

First-stage backend execution does not support:

- arbitrary filesystem access
- arbitrary network access
- subprocess launching
- unrestricted third-party package imports

The backend should enforce a conservative execution environment rather than acting like a general Python shell.

## Platform Changes

### New service layer

The platform needs a dedicated model package service rather than continuing to bury all behavior in `legacy-runtime.txt`.

Suggested responsibilities:

- package schema validation
- package import / export
- module registry normalization
- node-binding rehydration from package data
- model metadata exposure to the UI

Suggested file:

- `src/services/flightModelPackageService.js`

### UI updates

The top-level system-model actions need to become real file workflows.

Current labels may stay temporarily, but behavior changes to:

- `导入系统模型` -> select and import package JSON
- `保存系统模型` -> export current model package JSON

The property panel for a Python-bound simulation block should additionally show:

- module ID
- entry function
- source package name
- runtime mode (`mock` or `backend`)
- whether the node has fault targets defined

The workbench also needs a light package status indicator showing:

- loaded model name
- package version/schema version
- current Python execution mode

### Fault integration

The imported package fault library must be attached as model-level state rather than treated only as a generic imported fault list.

This enables:

- model-scoped fault availability
- module-to-fault matching
- future validation that a fault definition still points to a valid target module

## Error Handling

Import and runtime failures must be explicit.

### Import errors

- Invalid JSON: block import and show parse failure
- Unsupported `schemaVersion`: block import and show version mismatch
- Wrong `packageType`: block import and show type mismatch
- Missing `pythonModules` or `workbenchSnapshot`: block import and show required-field failure

### Partial package recovery

If the graph is valid but one or more modules are invalid:

- load the graph
- keep the affected nodes visible
- mark their bindings as broken
- show a warning state in the inspector and a toast summary

### Runtime errors

If Python execution fails for a bound node:

- stop pretending the result is valid
- mark that node as execution-failed
- expose the error in a user-visible way
- avoid silently falling back to mock execution for the same request

## Acceptance Criteria

The first complete subproject delivery is acceptable only if all of the following are true:

1. The repo contains a manually decomposed eVTOL reference model in authoring form.
2. The repo contains a generated self-contained JSON package for that model.
3. The platform can import that JSON package from a file.
4. Import restores the graph and node bindings correctly.
5. The platform can export the current model back to the same package format.
6. Re-importing the exported package reproduces the same graph and bindings.
7. At least eight key eVTOL modules are represented in the package.
8. At least five faults are operationally modeled and targetable.
9. At least one end-to-end path executes through the local Python backend, not the mock adapter.
10. Automated tests cover package validation, import/export restore behavior, binding restoration, and backend execution handoff.

## Out of Scope

This subproject does not include:

- automatic `.slx` to Python translation
- full high-fidelity recreation of every Simulink subsystem
- arbitrary third-party Python dependency management
- remote multi-user model storage
- a generalized plugin marketplace for model packages

## Delivery Strategy

This should be executed as one subproject with staged internal milestones:

1. define package schema and service layer
2. implement import/export using package JSON
3. add local Python backend execution path
4. author the eVTOL module set and package
5. wire fault-library integration and acceptance tests

The implementation plan should preserve that order so the platform gains a reusable package mechanism before the eVTOL reference model is layered on top.
