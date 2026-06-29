# Practice Action Business Rules Design

## Goal

Add a focused business-rule layer for practice actions during 3D integration testing. The rule layer should explain whether a normalized student action is allowed, repeated, risky, or rejected before the simulation model is modified.

## Scope

This design covers only the integration version of practice action business rules. It does not implement score deductions, safety vetoes, task persistence, playback, or teacher-configurable scoring templates.

Supported student actions remain:

```text
replaceWire
replaceComponent
```

## Current State

The backend already normalizes `/api/practice/session/{id}/action` payloads into a protocol v1 action and then applies the action by disabling a matching fault instance.

Current flow:

```text
raw action
-> normalize_practice_action()
-> PracticeActionRuntime.apply()
-> SimulationSession.step()
```

The missing layer is the business decision between protocol validation and simulation mutation. Today, a matching `faultId` is immediately disabled. There is no explicit result for repeated repair, action duration, risk level, or rule reason.

## Proposed Flow

Add a `PracticeActionRuleEngine` between normalization and runtime application:

```text
raw action
-> normalize_practice_action()
-> PracticeActionRuleEngine.evaluate()
-> PracticeActionRuntime.apply() when allowed
-> SimulationSession.step()
```

The rule engine evaluates a normalized action against the current simulation session and returns a structured `ruleResult`.

## Rule Result Contract

`ruleResult` is returned from the action endpoint and stored with the student action record.

```json
{
  "allowed": true,
  "ruleCode": "ACTION_ALLOWED",
  "durationSeconds": 120,
  "riskLevel": "medium",
  "repeatAction": false,
  "warnings": []
}
```

Fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `allowed` | boolean | Whether the runtime should modify the simulation model. |
| `ruleCode` | string | Stable machine-readable rule outcome. |
| `durationSeconds` | number | Business duration for later scoring or timeline use. |
| `riskLevel` | string | One of `none`, `low`, `medium`, `high`. |
| `repeatAction` | boolean | True when the student repeats a repair on an already repaired fault. |
| `warnings` | array | Human-readable integration warnings. |

## Default Rules

### replaceComponent

```json
{
  "durationSeconds": 120,
  "riskLevel": "medium"
}
```

### replaceWire

```json
{
  "durationSeconds": 90,
  "riskLevel": "low"
}
```

These values are backend defaults for integration testing. They are not score deductions yet.

## Rule Outcomes

### ACTION_ALLOWED

Returned when:

- `faultId` exists.
- `fault.targetId` equals `target.id`.
- Fault is currently enabled.

Behavior:

- `allowed` is `true`.
- Runtime disables the fault.
- Simulation advances by the requested `steps`.

### REPEAT_REPAIR

Returned when:

- `faultId` exists.
- `fault.targetId` equals `target.id`.
- Fault is already disabled.

Behavior:

- `allowed` is `false`.
- Endpoint still returns HTTP 200.
- The action is recorded for review.
- Runtime does not modify the model.
- Simulation may still advance by the requested `steps`, preserving existing action-step behavior.

Reasoning:

Repeated repair is a student behavior worth recording during integration and later scoring, but it is not a protocol error. Returning 200 keeps the 3D client workflow simple and lets the teacher review the repeated operation.

### TARGET_NOT_FOUND

Returned as an error when `faultId` does not match any fault instance in the practice simulation session.

Behavior:

- Endpoint returns HTTP 400.
- Runtime does not modify the model.
- The action is not appended to the normal student action sequence.

### TARGET_MISMATCH

Returned as an error when `faultId` exists but `fault.targetId` does not equal the normalized `target.id`.

Behavior:

- Endpoint returns HTTP 400.
- Runtime does not modify the model.
- The action is not appended to the normal student action sequence.

### UNSUPPORTED_ACTION_TYPE

Already handled by protocol normalization. Non-integration actions such as `measure`, `adjustParameter`, and `resetDevice` remain rejected.

## Endpoint Response Shape

Successful allowed action:

```json
{
  "status": "success",
  "practiceSessionId": "practice-001",
  "simulationSessionId": "session-001",
  "normalizedAction": {},
  "ruleResult": {
    "allowed": true,
    "ruleCode": "ACTION_ALLOWED",
    "durationSeconds": 120,
    "riskLevel": "medium",
    "repeatAction": false,
    "warnings": []
  },
  "appliedAction": {
    "status": "applied",
    "changes": []
  },
  "simulationResult": {}
}
```

Successful repeated repair:

```json
{
  "status": "success",
  "practiceSessionId": "practice-001",
  "simulationSessionId": "session-001",
  "normalizedAction": {},
  "ruleResult": {
    "allowed": false,
    "ruleCode": "REPEAT_REPAIR",
    "durationSeconds": 0,
    "riskLevel": "none",
    "repeatAction": true,
    "warnings": ["fault is already repaired"]
  },
  "appliedAction": {
    "status": "skipped",
    "actionType": "replaceComponent",
    "changes": [],
    "warnings": ["action skipped by business rules"]
  },
  "simulationResult": {}
}
```

## Storage and Record Changes

Each stored student action should include:

```json
{
  "ruleResult": {},
  "simulationActionResult": {}
}
```

`ruleResult` explains the business decision. `simulationActionResult` explains whether and how the runtime changed the model.

## Component Boundaries

### `practice_action_protocol.py`

Keeps validating the wire protocol:

- Required fields.
- Supported action types.
- Target type shape.
- `faultId` presence.
- `steps` range.

It should not inspect simulation state.

### `practice_action_rules.py`

New module responsible for business decisions:

- Locate the fault instance.
- Check target match.
- Detect already-disabled faults.
- Attach default duration and risk metadata.
- Return `ruleResult`.

It should not mutate the simulation model.

### `practice_actions.py`

Keeps runtime mutation behavior:

- Disable faults when allowed.
- Return changes.
- Support a skipped result when business rules reject mutation without treating it as an HTTP error.

### `practice.py`

Coordinates the flow:

1. Normalize action.
2. Evaluate rules.
3. Apply action only when `ruleResult.allowed` is true.
4. Store normalized action, rule result, and runtime result.
5. Step simulation and return the full response.

## Error Handling

Errors that indicate integration bugs stay as HTTP 400:

- `UNSUPPORTED_ACTION_TYPE`
- `INVALID_ACTION_SCHEMA`
- `TARGET_NOT_FOUND`
- `TARGET_MISMATCH`

Repeated repairs return HTTP 200 with `ruleCode = REPEAT_REPAIR`.

## Testing Strategy

Add unit tests for the rule engine:

- Allows enabled `replaceComponent` fault.
- Allows enabled `replaceWire` fault.
- Rejects unknown `faultId` with `TARGET_NOT_FOUND`.
- Rejects mismatched `target.id` with `TARGET_MISMATCH`.
- Returns `REPEAT_REPAIR` for already-disabled faults.

Add endpoint tests:

- Response includes `ruleResult` for a successful repair.
- Repeated repair returns HTTP 200, `ruleCode = REPEAT_REPAIR`, and `appliedAction.status = skipped`.
- Target mismatch returns HTTP 400 and does not disable any fault.

Run the full backend test suite after implementation:

```text
uv run python -m unittest discover backend/tests -v
```

## Future Extension

This design intentionally keeps scoring out of scope. Later work can use `durationSeconds`, `riskLevel`, and `repeatAction` to compute efficiency and safety deductions without changing the 3D action protocol.
