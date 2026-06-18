# Simulation Backend Design

## Goal

Build a backend simulation service for the fault-injection platform. The first backend stage should run executable model packages exported from the current frontend canvas, while keeping Python execution controlled through backend-registered whitelist modules.

The backend must support platform-style simulation rather than only a fixed demo model, but it must not execute arbitrary Python source submitted by the browser.

## Confirmed Direction

Use a restricted model-package execution API.

The frontend submits a backend executable model package derived from the current canvas. The backend validates the package, compiles the supported node and edge subset into an executable graph, resolves each Python-bound simulation block against the backend module registry, runs a bounded simulation, and returns curves, events, metrics, warnings, or structured errors.

Rejected alternatives:

- Fixed model API only: safer and faster, but it cannot run a model assembled on the canvas.
- Full model package with user Python execution: flexible, but sandboxing and dependency isolation would dominate the first backend milestone.
- Directly porting `legacy-runtime.txt`: may appear behaviorally consistent at first, but would preserve UI/runtime coupling and make backend maintenance fragile.

## Scope

Included in the first stage:

- `POST /api/simulations/run`
- Frontend export of a backend executable model package
- Backend schema validation
- Backend whitelist Python module registry
- Graph compilation from supported nodes and edges
- Reference and actual simulation modes
- Runtime fault effects in actual mode only
- Curves, events, metrics, warnings, and structured error responses
- Backend and frontend integration tests for the supported flow

Supported model package subset:

- `signal_source`
- `flow_block`
- `simulation_block`
- `gain_block`
- `sum_block`
- `mux_block`
- `instrument_scope`
- Standard `modelEdges`
- Fault instances and fault bindings
- Measurement points or scope bindings needed for returned curves

Excluded from the first stage:

- Executing Python source submitted in the model package
- Arbitrary third-party Python dependencies
- Backend-hosted realtime step, pause, and resume sessions
- Async job queue
- WebSocket streaming
- Server-side project persistence
- Full `legacy-runtime.txt` feature parity
- UI state such as coordinates, selected tabs, scope window positions, zoom, toast state, and right panel state
- D matrix view state and diagnostic panel UI state

## Architecture

The frontend remains responsible for model editing, fault configuration, measurement setup, and result presentation. The backend becomes a controlled simulation service.

Flow:

```text
Vue frontend
  -> builds BackendExecutableModelPackage from the current canvas
  -> POST /api/simulations/run

Python backend
  -> validates request size and JSON
  -> validates model package schema
  -> resolves simulation_block moduleId values against the whitelist registry
  -> compiles nodes and edges into an executable graph
  -> runs reference and actual simulations
  -> applies fault runtime effects only in actual mode
  -> returns curves, events, metrics, warnings, or structured errors

Vue frontend
  -> renders backend results in the existing scope, status, and export surfaces
```

## Backend Components

### API Layer

Receives `POST /api/simulations/run`, enforces request size limits, parses JSON, attaches a `runId`, and normalizes success and error responses.

The first API is synchronous and bounded. It can later be wrapped by an async job API without changing the executable package schema.

### Schema Validation Layer

Validates:

- schema version
- supported node types
- edge endpoint references
- input port conflicts
- simulation duration and step size limits
- maximum node, edge, fault, and measurement counts
- fault target references
- numeric parameter ranges

Invalid packages are rejected before graph compilation or Python module resolution.

### Module Registry

Owns the backend whitelist of executable Python modules.

Each module has a manifest declaring:

- `moduleId`
- entry function
- input names and types
- output names and types
- allowed parameters, defaults, and ranges
- optional engineering description

When a model package references `pythonBinding.moduleId`, the backend resolves that ID against the registry. Missing modules fail with `MODULE_NOT_WHITELISTED`.

The registry must be extensible by adding new backend module directories and manifests. The API shape should not change when new modules are added.

Example structure:

```text
backend/
  registry/
    builtin_modules/
      evtol_closed_loop_v1/
        manifest.json
        modules/
          attitude_pid.py
          imu_gyro.py
          motor_model.py
          vehicle_dynamics.py
```

### Graph Compiler

Converts the supported package subset into an executable graph. It checks missing nodes, missing ports, unsupported node types, duplicate input bindings, and unsupported topology patterns.

The compiler output should be independent of frontend UI structures. It should contain only the data needed for simulation: executable nodes, edges, port mappings, module bindings, fault bindings, and measurement bindings.

### Simulation Engine

Runs from `t = 0` to `duration` with `stepSize`.

Each step evaluates two modes:

- `reference`: baseline behavior without active fault effects.
- `actual`: same graph with active runtime fault effects.

The engine collects measurement channels for both modes so the frontend can show fault response versus baseline.

### Fault Runtime

Applies faults during configured time windows without mutating the submitted model package.

First supported fault categories:

- sensor additive bias
- noise increase
- signal stuck/freeze
- link delay or packet loss
- motor efficiency loss

The fault runtime should emit lifecycle events such as `fault_started` and `fault_ended`, plus warning events when a fault cannot affect its target.

## API Contract

### Request

```json
{
  "schemaVersion": 1,
  "packageId": "evtol-demo-001",
  "simulationConfig": {
    "duration": 10,
    "stepSize": 0.01
  },
  "nodes": [
    {
      "id": "node-controller",
      "type": "simulation_block",
      "pythonBinding": {
        "moduleId": "attitude_pid",
        "entryFunction": "process"
      },
      "parameters": {
        "kp": 4.5
      }
    }
  ],
  "edges": [],
  "faultInstances": [],
  "measurementPoints": []
}
```

### Success Response

```json
{
  "runId": "run-001",
  "status": "success",
  "curves": {
    "time": [0, 0.01, 0.02],
    "channels": {
      "node-scope.ch1.actual": [0, 0.1, 0.2],
      "node-scope.ch1.reference": [0, 0.05, 0.1]
    }
  },
  "events": [],
  "metrics": {},
  "warnings": []
}
```

### Error Response

```json
{
  "runId": "run-001",
  "status": "error",
  "errorCode": "MODULE_NOT_WHITELISTED",
  "field": "nodes[3].pythonBinding.moduleId",
  "message": "moduleId attitude_pid_v2 is not registered on backend"
}
```

Required first-stage error codes:

- `INVALID_SCHEMA`
- `UNSUPPORTED_NODE_TYPE`
- `EDGE_ENDPOINT_NOT_FOUND`
- `INPUT_PORT_CONFLICT`
- `MODULE_NOT_WHITELISTED`
- `MODULE_SIGNATURE_MISMATCH`
- `PARAM_OUT_OF_RANGE`
- `FAULT_TARGET_NOT_FOUND`
- `SIMULATION_LIMIT_EXCEEDED`
- `SIMULATION_TIMEOUT`

## Frontend Integration

Add a backend simulation adapter beside the current browser simulation runtime.

The frontend should:

- export a backend executable package from current canvas state
- remove UI-only state during export
- submit the package to `/api/simulations/run`
- map returned channels into existing scope and result presentation state
- surface backend structured errors in the status area

The existing browser runtime can remain available for local step-by-step interaction while the backend API handles bounded full-run simulation.

## Security And Limits

The backend must not execute Python source sent by the frontend.

Limits required in the first stage:

- maximum request body size
- maximum simulation duration
- minimum and maximum step size
- maximum node count
- maximum edge count
- maximum measurement point count
- maximum fault instance count
- execution timeout
- module whitelist enforcement
- numeric parameter range enforcement

The backend should log only operational metadata such as request time, run ID, model package ID, elapsed time, status, error code, and limit hits. It should not persist full user models or full curve payloads by default.

## Testing

Backend unit tests:

- module registry resolves known modules and rejects unknown IDs
- schema validator rejects unsupported nodes, missing edge endpoints, duplicate input connections, and out-of-range parameters
- graph compiler produces a stable executable graph for the supported eVTOL package subset
- fault runtime applies supported fault categories only during active time windows

Backend API tests:

- valid eVTOL executable package returns reference and actual curves
- unregistered `moduleId` returns `MODULE_NOT_WHITELISTED`
- invalid edge endpoint returns `EDGE_ENDPOINT_NOT_FOUND`
- parameter range violation returns `PARAM_OUT_OF_RANGE`
- excessive duration or too-small step size returns `SIMULATION_LIMIT_EXCEEDED`

Frontend integration tests:

- backend executable package export strips UI-only state
- clicking backend simulation submits the package and renders returned scope channels
- backend error responses appear in the status/result area with actionable messages

## Success Criteria

The first backend milestone is complete when:

- the current eVTOL closed-loop demo can be exported as a supported backend executable package
- `POST /api/simulations/run` returns usable reference and actual curves
- at least three fault categories affect actual curves while reference curves remain baseline
- model package Python source is ignored or rejected
- missing backend module whitelist entries fail with structured errors
- duration, step size, node count, fault count, and measurement count are bounded
- frontend can display backend-run results without breaking the existing browser runtime path

