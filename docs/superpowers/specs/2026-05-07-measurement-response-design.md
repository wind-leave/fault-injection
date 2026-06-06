# Measurement Response Snapshot Design

## Purpose

The platform needs a way to answer: after a user applies one operation or state to a loaded system, what does every predefined measurement point read?

The first implementation will support an operation snapshot. A user chooses one operation, such as cutting a link, and the multi-signal flow graph returns a comparison table for all measurement points. This is intentionally separate from permanent fault injection. The snapshot is a diagnostic simulation result; it must not modify saved model topology or write `injectedFault` unless the user later chooses a separate conversion action.

The design is optimized for the current UAV flight-control demo, while keeping the model general enough for future systems. For example, in a 3D electrical system, every measurable wire current can be imported as a predefined measurement point. In the flight-control system, measurement points come from key command, control, execution, sensor, CAN, and diagnostic links.

## Scope

In scope for the first version:

- Predefined measurement points generated from the imported model and existing multi-signal semantic graph.
- A snapshot response mode for one operation at a time.
- Comparison of baseline value, operated value, delta, status, severity, and reason for every point.
- Operations for link cut, parameter shift, CAN delay, packet loss, and actuator efficiency loss.
- Temporary graph highlighting for the active scenario target and affected measurement points.
- `samples` fields reserved in the response objects so the same model can later support time-series mode.

Out of scope for the first version:

- Full time-series plotting and curve analysis.
- User-created measurement point authoring.
- Saving snapshot results as permanent faults.
- Multi-operation scenario composition.
- A physically complete numerical solver for every possible imported system.

## User Flow

1. The user imports a complete flight-control system model.
2. The user opens the multi-signal flow graph.
3. A new measurement response area appears near the top of the graph.
4. The user selects an operation type.
5. The target selector updates based on that operation type.
6. The user optionally edits operation parameters.
7. The user clicks calculate measurement response.
8. The platform computes all predefined measurement points and renders a response matrix.
9. Selecting a response row highlights the related measurement point and flow edge.
10. Opening details shows the internal mapping and the reason for the computed status.

## UI Design

The new area should be compact and operational, consistent with the existing dense engineering workbench.

The control row contains:

- Operation type: link cut, parameter shift, CAN delay, packet loss, actuator efficiency loss.
- Target object: filtered by operation type.
- Parameters: a small group of fields that changes with the operation.
- Calculate button.

The summary row contains:

- Total measurement points.
- Affected points.
- Cut or blocked points.
- Warning or abnormal points.
- Normal points.

The response matrix contains:

- Measurement point.
- Signal or channel.
- Baseline value.
- Operated value.
- Delta.
- Status.
- Reason.

The matrix should support filters:

- All.
- Affected.
- Abnormal.
- Normal.

The graph should use temporary highlight styles:

- Scenario target: red.
- Affected point or link: orange.
- Normal observed point: default or muted blue.
- Unaffected point: muted neutral.

These styles represent only the active measurement response snapshot. They are not equivalent to a permanently injected fault.

## Data Model

The scenario object describes the operation requested by the user.

```js
const measurementScenario = {
  id: 'scenario-link-cut-edge-imu-error',
  type: 'link_cut',
  targetKind: 'edge',
  targetId: 'edge-imu-error',
  labelZh: 'Cut IMU feedback link',
  parameters: {
    time: 0,
    cutValue: null
  }
};
```

The response object describes the generated snapshot.

```js
const measurementResponse = {
  scenarioId: 'scenario-link-cut-edge-imu-error',
  generatedAt: 1778120000000,
  mode: 'snapshot',
  summary: {
    total: 12,
    affected: 4,
    cut: 1,
    abnormal: 2,
    normal: 8
  },
  points: [
    {
      pointId: 'mp-edge-imu-error',
      edgeId: 'edge-imu-error',
      labelZh: 'IMU feedback measurement',
      stage: 'measurement',
      signalId: 'imu.pitch_rate',
      unit: 'rad/s',
      baselineValue: 0.055,
      operatedValue: null,
      delta: null,
      deltaRatio: null,
      status: 'cut',
      statusLabelZh: 'Link cut',
      severity: 'critical',
      reasonZh: 'Target link is cut; no valid signal reaches this measurement point',
      propagationKind: 'blocked',
      affectedByTarget: true,
      samples: []
    }
  ]
};
```

For future time-series mode, the same point object can fill `samples`:

```js
samples: [
  { t: 0.0, baseline: 0.055, operated: null },
  { t: 0.1, baseline: 0.057, operated: null }
]
```

## Measurement Point Source

The first implementation should reuse the existing semantic model:

```js
const semantic = buildDataflowSemanticModel();
const points = semantic.measurementPoints;
```

Each semantic measurement point should be enriched into a response point. The imported model can later provide explicit measurement point declarations, but that is not required for the first version.

The source priority is:

1. Explicit measurement point declarations from a model package, when available later.
2. Existing `buildDataflowSemanticModel().measurementPoints`.
3. Dataflow edges converted into measurement points as fallback.

## Operation Types

### Link Cut

Target kind: edge.

The target edge receives `operatedValue: null` and status `cut`. Downstream points whose propagation policy allows propagation become affected. Diagnostic and residual points can become abnormal if their source path depends on the cut target.

### Parameter Shift

Target kind: node.

The target node output is perturbed by the configured bias or multiplier. Downstream measurement points become affected. Upstream command points usually remain normal unless feedback loops cause compensating behavior.

### CAN Delay

Target kind: edge, preferably CAN edge.

The operated value can remain numerically close to baseline in snapshot mode, but the response should include protocol delay metadata. Downstream diagnostic or residual points can become warning status.

### Packet Loss

Target kind: edge, preferably CAN edge.

The operated value can be marked intermittent. The response should include packet loss rate and a warning status for the target edge. Downstream points may be affected depending on propagation policy.

### Actuator Efficiency Loss

Target kind: node.

The target actuator output decreases by the configured efficiency factor. Downstream physical response points decrease, while upstream controller command points may be marked as compensating or increased.

## Calculation Strategy

The first version should use deterministic engineering rules, not a full physics solver.

The calculation pipeline is:

1. Build the semantic measurement graph.
2. Resolve target object and operation parameters.
3. Compute an influence set using graph direction and propagation policy.
4. Resolve a baseline value for every point.
5. Compute an operated value by operation type.
6. Classify status and severity.
7. Store the response in transient UI state.

Baseline value resolution should use this priority:

1. Latest simulation sample or edge runtime value, if available.
2. Dataflow metrics current value, if available.
3. Deterministic fallback value derived from signal type and point index.

Fallback values must be deterministic so tests and demos remain stable.

## API Boundary

The implementation should expose small functions rather than embedding all logic inside rendering code:

```js
buildMeasurementScenarioOptions()
buildMeasurementTargetOptions(type)
createMeasurementScenario(input)
calculateMeasurementResponse(scenario)
getMeasurementResponseSummary(response)
selectMeasurementResponsePoint(pointId)
clearMeasurementResponse()
```

Rendering code should consume the response but not own the calculation.

## State Boundary

The response state should live separately from fault injection state:

```js
S.measurementScenario = null;
S.measurementResponse = null;
S.measurementResponseFilter = 'all';
S.selectedMeasurementPointId = '';
```

The response must not write:

- `edge.injectedFault`
- `node.injectedFault`
- `faultBindings`
- saved model package state

Temporary visual state can be derived from `S.measurementResponse`.

## Details Integration

The existing internal mapping detail dialog should be reused and extended. When opened from a response row, it should show:

- Measurement point identity.
- Operation scenario.
- Baseline value.
- Operated value.
- Delta.
- Status and reason.
- Existing internal mapping fields: edge ID, signal ID, CAN channel, Python variable, source node, target node, source port, target port.

## Testing Plan

Unit-style tests should verify:

- Scenario option generation includes the expected operations.
- Target options filter edges and nodes by operation type.
- Link cut on `edge-imu-error` produces a response for every semantic measurement point.
- The target measurement point receives status `cut`.
- Downstream affected points are marked affected or abnormal.
- Unrelated points remain normal.
- The response does not mutate `injectedFault`.

UI tests should verify:

- The multi-signal flow graph renders the measurement response panel.
- Selecting link cut and a target edge enables calculation.
- The response matrix renders all points.
- Filter tabs reduce the visible rows.
- Clicking a response row selects the related dataflow edge or measurement point.
- Opening details shows both internal mapping and response reason.

Build checks:

- `npm test -- --run`
- `npm run audit:ui`
- `npm run build`

## Acceptance Criteria

- After importing `eVTOL Closed-Loop Fault Demo`, the multi-signal flow graph shows a measurement response panel.
- Choosing link cut for the IMU feedback edge and calculating response produces a full measurement-point matrix.
- IMU measurement feedback is marked as cut.
- Error, control, motor, or residual points downstream are marked affected, compensating, abnormal, or warning as appropriate.
- Unrelated measurement points remain normal.
- Selecting a matrix row highlights the corresponding graph element.
- Opening details explains the mapping and the reason for the status.
- No permanent fault is injected by calculating a response.
- The response point schema includes `samples: []` for future time-series support.
