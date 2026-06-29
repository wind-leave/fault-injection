# Practice Troubleshooting Closed Loop Design

## Background

The current backend troubleshooting flow treats each `measurePoint` action as a diagnostic-tree step. After one point is observed as normal or abnormal, the backend filters remaining candidate faults through the D matrix and recommends another point.

That does not match the intended practice workflow. In the real training scenario, the 3D scene contains a display/control console that continuously shows all physical measurement points. The student reads abnormal physical measurements from the console, optionally measures additional virtual points with instruments such as an oscilloscope, then replaces a component or wire. The loop ends when the relevant measurements recover and the student identifies the final fault.

## Goal

Redefine the backend practice troubleshooting flow around measurement snapshots and repair verification:

- Physical points are displayed by the console and should be evaluated as a full snapshot by the backend.
- Virtual points are not displayed by the console and are only revealed when the student performs `measurePoint`.
- Repair actions, not single measurement actions, are the main events that advance the troubleshooting closed loop.
- The backend records whether each repair attempt makes abnormal measurements recover.

## Non-Goals

- Do not remove `faultId` from repair actions.
- Do not add new student action types beyond `replaceWire`, `replaceComponent`, and `measurePoint`.
- Do not build a full diagnostic expert system in this step.
- Do not require the 3D client to submit `observed`.

## Measurement Point Types

D-matrix points should identify whether a point is physical or virtual. The preferred field is:

```json
{
  "pointId": "tp-001",
  "shortName": "M1",
  "pointType": "physical"
}
```

Allowed values:

- `physical`: visible on the display/control console.
- `virtual`: hidden from the console and only available through instrument measurement.

For compatibility, missing `pointType` should be treated as `physical` in the first implementation unless existing package data already provides a different stable field.

## Physical Measurement Snapshot

The backend should generate a `physicalMeasurementSnapshot` from all D-matrix points whose `pointType` is `physical`.

The snapshot should be returned:

- when a practice session is created;
- after `replaceComponent`;
- after `replaceWire`;
- after any explicit simulation progression that changes practice state, if such endpoint is later exposed.

Example response fragment:

```json
{
  "physicalMeasurementSnapshot": {
    "source": "backend",
    "points": [
      {
        "pointCode": "M1",
        "pointId": "tp-residual",
        "channel": "scope-1.ch1",
        "actualValue": 1.5,
        "referenceValue": 1.0,
        "metricValue": 0.5,
        "observed": "abnormal",
        "reason": "metric-above-abnormal-threshold"
      }
    ],
    "abnormalPointCodes": ["M1"],
    "normalPointCodes": [],
    "unknownPointCodes": []
  }
}
```

`actualValue` and `referenceValue` should use the latest sample in the evaluated simulation window. `metricValue` remains the point-level diagnostic metric, currently `max(abs(actual - reference))` for `absoluteDelta`.

## Virtual Measurement Action

`measurePoint` represents the student actively measuring a virtual point with an instrument.

Rules:

- `measurePoint` should target a D-matrix point whose `pointType` is `virtual`.
- It does not require `faultId`.
- The backend should ignore client-submitted `observed`.
- It should return the measured virtual point data and backend-generated observation.

Example response fragment:

```json
{
  "virtualMeasurement": {
    "pointCode": "V1",
    "pointId": "tp-controller-internal",
    "channel": "scope-2.ch1",
    "actualValue": 3.2,
    "referenceValue": 3.0,
    "metricValue": 0.2,
    "observed": "unknown",
    "reason": "metric-between-thresholds"
  }
}
```

For the first implementation, measuring a physical point with `measurePoint` should be rejected with a clear action-schema error, because physical points already belong to the console snapshot.

## Repair Actions And Closed Loop

`replaceComponent` and `replaceWire` remain the only repair actions.

After a repair action, the backend should:

1. evaluate the business rule and apply or skip the repair;
2. step the simulation;
3. generate a new `physicalMeasurementSnapshot`;
4. compare the new snapshot with the previous physical snapshot;
5. record a `repairEffect`.

Example response fragment:

```json
{
  "repairEffect": {
    "effective": true,
    "recoveredPointCodes": ["M1", "M2"],
    "newAbnormalPointCodes": [],
    "remainingAbnormalPointCodes": [],
    "unchangedAbnormalPointCodes": [],
    "status": "recovered"
  }
}
```

Suggested `status` values:

- `recovered`: no physical abnormal points remain.
- `improved`: at least one previously abnormal physical point recovered, but some abnormal points remain.
- `unchanged`: no meaningful physical measurement improvement.
- `worse`: new physical abnormalities appeared.
- `unknown`: insufficient measurement data.

## Troubleshooting State

The backend should stop treating `currentPath` as a sequence of recommended measurement points. Instead, practice troubleshooting state should be process-oriented:

```json
{
  "troubleshootingState": {
    "physicalMeasurementSnapshot": {},
    "virtualMeasurements": [],
    "repairAttempts": [],
    "faultCandidates": [],
    "status": "inProgress"
  }
}
```

`faultCandidates` can still be derived from the D matrix, but it should be based on the full current observation set:

- current physical snapshot observations;
- virtual measurements the student has performed;
- optionally repair effectiveness when enough mapping exists.

This makes candidate faults a backend inference aid, not the primary representation of the student's path.

## Practice Record

The final practice record should preserve:

- initial physical measurement snapshot;
- every physical snapshot after repair;
- every virtual measurement action;
- every repair action and its `repairEffect`;
- final fault submitted by the student;
- scoring fields.

This record allows teacher review of the student's actual troubleshooting loop: observe abnormal data, gather additional evidence, repair, and verify recovery.

## Compatibility

The existing `observationResult` evaluator can be reused, but it should be generalized to evaluate:

- one selected point for virtual measurement;
- all physical points for console snapshots.

Existing repair action `ruleResult` and `appliedAction` response fields should remain.

The old `troubleshootingResult.remainingFaultIds` can be retained temporarily for compatibility, but new clients should prefer `troubleshootingState` and `repairEffect`.

## Tests

Required backend tests:

- Creating a practice session returns a physical snapshot with only physical points.
- `measurePoint` succeeds for a virtual point and returns `virtualMeasurement`.
- `measurePoint` rejects a physical point.
- `replaceComponent` returns a new physical snapshot and `repairEffect`.
- Repair that resolves the fault reports recovered or improved physical points.
- Repair that does not affect the current fault reports unchanged.
- The final submit record includes snapshots, virtual measurements, and repair attempts.

## Acceptance Criteria

- The display/control console can be populated from backend `physicalMeasurementSnapshot`.
- Virtual point values are only returned through `measurePoint`.
- Repair actions update the closed-loop troubleshooting state.
- The backend no longer presents the main practice path as a linear sequence of recommended measurement points.
