# Backend Observation Auto Detection Design

## Goal

Restore a student measurement action for practice troubleshooting and let the backend determine the observation result from simulation output instead of trusting a client-submitted `observed` value.

## Scope

This first version covers only a dedicated measurement action:

```text
measurePoint
```

It does not make `replaceWire` or `replaceComponent` update the troubleshooting path yet. Those repair actions will later be able to produce path updates, but that is intentionally deferred so the first version can establish the measurement contract and backend observation logic.

Supported practice actions after this change:

```text
replaceWire
replaceComponent
measurePoint
```

## Current State

`TroubleshootingSession.record_operation()` updates the remaining candidate faults from `operation.observed`.

The backend simulation result already contains measurement channels:

```json
{
  "curves": {
    "time": [0.0],
    "channels": {
      "scope-1.ch1.actual": [1.5],
      "scope-1.ch1.reference": [1.0]
    }
  }
}
```

The current student action protocol only allows `replaceWire` and `replaceComponent`, so there is no explicit student action for checking a diagnostic point.

## Proposed Action Contract

Add `measurePoint` to the practice action protocol.

Request example:

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-measure-001",
  "actionType": "measurePoint",
  "target": {
    "type": "testPoint",
    "id": "scope-1.ch1"
  },
  "pointCode": "M1",
  "steps": 1,
  "clientTime": "2026-06-29T16:20:00+08:00",
  "rawAction": {}
}
```

Rules:

- `actionType` must be `measurePoint`.
- `target.type` must be `testPoint`.
- `target.id` identifies the backend channel base name, such as `scope-1.ch1`.
- `pointCode` is required and should match a D-matrix point, such as `M1`.
- `faultId` is not required for `measurePoint`.
- `observed` from the client is ignored if present; backend-generated observation is authoritative.

## Processing Flow

Current repair flow:

```text
normalize action
-> business rules
-> apply model mutation
-> step simulation
```

Measurement flow:

```text
normalize measurePoint
-> step simulation
-> evaluate observation from simulationResult.curves.channels
-> write observed into action record
-> update TroubleshootingSession
-> return observationResult and troubleshootingResult
```

The order matters: observation should be based on the simulation state at the time the student measured the point.

## Observation Rule Source

First version stores observation rules on `dMatrix.points`.

Example:

```json
{
  "pointId": "tp-residual",
  "shortName": "M1",
  "name": "residual diagnostic point",
  "channel": "scope-1.ch1",
  "observationRule": {
    "method": "absoluteDelta",
    "normalThreshold": 0.1,
    "abnormalThreshold": 0.3
  }
}
```

Fallback behavior when `observationRule` is absent:

```json
{
  "method": "absoluteDelta",
  "normalThreshold": 0.05,
  "abnormalThreshold": 0.2
}
```

Channel resolution order:

1. `point.observationRule.channel`
2. `point.channel`
3. `target.id`

The backend reads:

```text
{channel}.actual
{channel}.reference
```

from `simulationResult.curves.channels`.

## First Observation Method

Support one method in v1:

```text
absoluteDelta
```

Metric:

```text
metricValue = max(abs(actual[i] - reference[i]))
```

Decision:

```text
metricValue <= normalThreshold
=> observed = normal

metricValue >= abnormalThreshold
=> observed = abnormal

otherwise
=> observed = unknown
```

If channel data is missing or empty:

```text
observed = unknown
reason = missing-channel-data
```

## Observation Result Contract

Successful response includes:

```json
{
  "observationResult": {
    "pointCode": "M1",
    "pointId": "tp-residual",
    "channel": "scope-1.ch1",
    "observed": "abnormal",
    "method": "absoluteDelta",
    "metricValue": 0.5,
    "normalThreshold": 0.1,
    "abnormalThreshold": 0.3,
    "source": "backend",
    "reason": "metric-above-abnormal-threshold"
  }
}
```

`observed` is always one of:

```text
normal
abnormal
unknown
```

## Troubleshooting Update

For `measurePoint`, the backend stores the generated observation on the action record before calling:

```python
TroubleshootingSession.record_operation(action_record)
```

The route update should behave exactly as if the client had submitted the same `observed` value manually, but the record should show that the source was backend-generated.

The action record should include:

```json
{
  "pointCode": "M1",
  "observed": "abnormal",
  "observationResult": {
    "source": "backend"
  }
}
```

The endpoint response should include:

```json
{
  "observationResult": {},
  "troubleshootingResult": {
    "remainingFaultIds": ["target-fault"],
    "nextRecommendedStep": null
  }
}
```

## Repair Action Behavior

`replaceWire` and `replaceComponent` remain unchanged in v1:

- They still use `ruleResult`.
- They still modify or skip simulation mutation through `appliedAction`.
- They do not update the troubleshooting path from automatic observations in this version.

Future work will allow repair actions to contribute to path updates, for example by checking whether repaired-object measurements return to normal after the action.

## Component Boundaries

### `practice_action_protocol.py`

Extend protocol normalization:

- Accept `measurePoint`.
- Require `target.type = testPoint`.
- Require `target.id`.
- Require `pointCode`.
- Do not require `faultId` for `measurePoint`.

### `practice_observation.py`

New module responsible for observation decisions:

- Resolve point metadata from D matrix.
- Resolve channel name.
- Read actual and reference series from simulation result.
- Compute `absoluteDelta`.
- Return `observationResult`.

It should not update the troubleshooting session directly.

### `practice.py`

Coordinates the action:

- Repair actions keep existing rule/runtime flow.
- `measurePoint` actions skip business repair rules and runtime mutation.
- `measurePoint` actions step simulation first, evaluate observation, write `observed`, then update troubleshooting.

### `troubleshooting.py`

No behavior change required. It continues to use `operation.observed`.

## Error Handling

Protocol errors:

- Missing `pointCode`: `INVALID_ACTION_SCHEMA`, field `pointCode`.
- Wrong target type: `INVALID_ACTION_SCHEMA`, field `target.type`.
- Unsupported action type: `UNSUPPORTED_ACTION_TYPE`.

Observation errors should not fail the action unless the payload is invalid. Missing channel data returns `observed = unknown` with a reason in `observationResult`.

## Testing Strategy

Add observation unit tests:

- Returns `normal` when max absolute delta is below `normalThreshold`.
- Returns `abnormal` when max absolute delta is above `abnormalThreshold`.
- Returns `unknown` when the metric falls between thresholds.
- Returns `unknown` for missing channel data.
- Uses default thresholds when no observation rule exists.

Add protocol tests:

- Normalizes `measurePoint`.
- Does not require `faultId` for `measurePoint`.
- Rejects `measurePoint` without `pointCode`.
- Rejects `measurePoint` with non-`testPoint` target.

Add endpoint tests:

- `measurePoint` returns `observationResult`.
- Backend-generated `observed` updates `remainingFaultIds`.
- Client-submitted `observed` is ignored.
- Repair actions still return `ruleResult` and do not include `observationResult`.

Run:

```text
uv run python -m unittest discover backend/tests -v
```

## Future Scope

Later, repair actions should also be able to update the troubleshooting path. That should be designed separately because repair-derived observations require deciding which measurements to inspect after the action and how to distinguish repair confirmation from diagnostic probing.
