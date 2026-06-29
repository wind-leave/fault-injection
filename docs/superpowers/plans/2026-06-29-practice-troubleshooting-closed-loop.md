# Practice Troubleshooting Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-measurement diagnostic-tree behavior with a closed-loop practice flow based on physical console snapshots, virtual instrument measurements, and repair verification.

**Architecture:** Keep the existing action protocol and simulation session model. Generalize the observation evaluator so it can evaluate either one point or all physical points, then let `PracticeSession` own closed-loop state: physical snapshots, virtual measurements, repair attempts, and current troubleshooting state. `TroubleshootingSession` remains available for legacy D-matrix candidate inference, but new responses should prefer `physicalMeasurementSnapshot`, `virtualMeasurement`, `repairEffect`, and `troubleshootingState`.

**Tech Stack:** Python standard library, existing `unittest` suite, existing backend modules under `backend/`.

---

### Task 1: Generalize Measurement Observation Utilities

**Files:**
- Modify: `backend/practice_observation.py`
- Modify: `backend/tests/test_practice_observation.py`

- [ ] **Step 1: Add failing tests for point type, latest values, physical snapshots, and repair effects**

Append these tests to `backend/tests/test_practice_observation.py` inside `PracticeObservationTests`:

```python
    def test_virtual_point_observation_includes_latest_values(self):
        matrix = d_matrix_with_point({
            "method": "absoluteDelta",
            "normalThreshold": 0.1,
            "abnormalThreshold": 0.3,
        })
        matrix["points"][0]["pointType"] = "virtual"

        result = evaluate_observation(
            matrix,
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.2, 1.5], [1.0, 1.1]),
        )

        self.assertEqual(result["pointType"], "virtual")
        self.assertEqual(result["actualValue"], 1.5)
        self.assertEqual(result["referenceValue"], 1.1)
        self.assertAlmostEqual(result["metricValue"], 0.4)
        self.assertEqual(result["observed"], "abnormal")

    def test_physical_snapshot_contains_only_physical_points(self):
        matrix = {
            "points": [
                {
                    "pointId": "tp-physical",
                    "shortName": "M1",
                    "name": "physical display point",
                    "pointType": "physical",
                    "channel": "scope-1.ch1",
                    "observationRule": {
                        "method": "absoluteDelta",
                        "normalThreshold": 0.1,
                        "abnormalThreshold": 0.3,
                    },
                },
                {
                    "pointId": "tp-virtual",
                    "shortName": "V1",
                    "name": "virtual instrument point",
                    "pointType": "virtual",
                    "channel": "scope-2.ch1",
                },
            ],
            "rows": [],
        }
        result = evaluate_physical_measurement_snapshot(
            matrix,
            {
                "curves": {
                    "channels": {
                        "scope-1.ch1.actual": [1.4],
                        "scope-1.ch1.reference": [1.0],
                        "scope-2.ch1.actual": [9.0],
                        "scope-2.ch1.reference": [0.0],
                    }
                }
            },
        )

        self.assertEqual(result["source"], "backend")
        self.assertEqual([point["pointCode"] for point in result["points"]], ["M1"])
        self.assertEqual(result["abnormalPointCodes"], ["M1"])
        self.assertEqual(result["normalPointCodes"], [])
        self.assertEqual(result["unknownPointCodes"], [])

    def test_missing_point_type_defaults_to_physical(self):
        result = evaluate_physical_measurement_snapshot(
            d_matrix_with_point(),
            simulation_result([1.21], [1.0]),
        )

        self.assertEqual([point["pointCode"] for point in result["points"]], ["M1"])
        self.assertEqual(result["points"][0]["pointType"], "physical")

    def test_compare_physical_snapshots_reports_repair_effect(self):
        before = {
            "points": [
                {"pointCode": "M1", "observed": "abnormal"},
                {"pointCode": "M2", "observed": "abnormal"},
            ],
            "abnormalPointCodes": ["M1", "M2"],
            "normalPointCodes": [],
            "unknownPointCodes": [],
        }
        after = {
            "points": [
                {"pointCode": "M1", "observed": "normal"},
                {"pointCode": "M2", "observed": "abnormal"},
            ],
            "abnormalPointCodes": ["M2"],
            "normalPointCodes": ["M1"],
            "unknownPointCodes": [],
        }

        result = compare_physical_snapshots(before, after)

        self.assertTrue(result["effective"])
        self.assertEqual(result["status"], "improved")
        self.assertEqual(result["recoveredPointCodes"], ["M1"])
        self.assertEqual(result["remainingAbnormalPointCodes"], ["M2"])
        self.assertEqual(result["unchangedAbnormalPointCodes"], ["M2"])
        self.assertEqual(result["newAbnormalPointCodes"], [])
```

Add the required imports at the top of `backend/tests/test_practice_observation.py`:

```python
from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_observation,
    evaluate_physical_measurement_snapshot,
)
```

- [ ] **Step 2: Run the focused observation tests and verify they fail**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_observation -v
```

Expected: FAIL because `evaluate_physical_measurement_snapshot` and `compare_physical_snapshots` do not exist, and `evaluate_observation` does not yet return `pointType`, `actualValue`, or `referenceValue`.

- [ ] **Step 3: Implement generalized observation helpers**

In `backend/practice_observation.py`, add these helpers after `_text`:

```python
def _point_type(point):
    value = _text((point or {}).get("pointType") or (point or {}).get("type")).lower()
    return value if value in {"physical", "virtual"} else "physical"


def find_point(d_matrix, point_code):
    return _find_point(d_matrix, point_code)


def point_type(d_matrix, point_code):
    return _point_type(_find_point(d_matrix, point_code))
```

Modify the `base` object in `evaluate_observation()` so it includes point type and latest values:

```python
    latest_actual = actual[sample_count - 1] if sample_count > 0 else None
    latest_reference = reference[sample_count - 1] if sample_count > 0 else None
    base = {
        "pointCode": point_code,
        "pointId": point.get("pointId") or "",
        "pointType": _point_type(point),
        "channel": channel,
        "method": rule["method"],
        "normalThreshold": rule["normalThreshold"],
        "abnormalThreshold": rule["abnormalThreshold"],
        "actualValue": latest_actual,
        "referenceValue": latest_reference,
        "source": "backend",
    }
```

Because `sample_count` is needed before `base`, restructure the top of `evaluate_observation()` to compute it immediately after reading `actual` and `reference`:

```python
    sample_count = min(len(actual), len(reference))
```

Keep the missing-channel return, but let it reuse `base` with `actualValue` and `referenceValue` set to `None`.

Add these functions at the bottom of `backend/practice_observation.py`:

```python
def evaluate_point_observation(d_matrix, point, simulation_result):
    action = {
        "pointCode": _text(point.get("shortName") or point.get("pointId")),
        "targetId": _text(point.get("channel")),
    }
    return evaluate_observation(d_matrix, action, simulation_result)


def evaluate_physical_measurement_snapshot(d_matrix, simulation_result):
    points = []
    for point in _arr((d_matrix or {}).get("points")):
        if _point_type(point) != "physical":
            continue
        points.append(evaluate_point_observation(d_matrix, point, simulation_result))

    abnormal = [point["pointCode"] for point in points if point.get("observed") == "abnormal"]
    normal = [point["pointCode"] for point in points if point.get("observed") == "normal"]
    unknown = [point["pointCode"] for point in points if point.get("observed") == "unknown"]
    return {
        "source": "backend",
        "points": points,
        "abnormalPointCodes": abnormal,
        "normalPointCodes": normal,
        "unknownPointCodes": unknown,
    }


def compare_physical_snapshots(before, after):
    before_abnormal = set(_arr((before or {}).get("abnormalPointCodes")))
    after_abnormal = set(_arr((after or {}).get("abnormalPointCodes")))
    recovered = sorted(before_abnormal - after_abnormal)
    remaining = sorted(after_abnormal)
    unchanged = sorted(before_abnormal & after_abnormal)
    new_abnormal = sorted(after_abnormal - before_abnormal)
    if not isinstance(before, dict) or not isinstance(after, dict) or (not before and not after):
        status = "unknown"
    elif not remaining and recovered:
        status = "recovered"
    elif recovered:
        status = "improved"
    elif new_abnormal:
        status = "worse"
    elif remaining or unchanged:
        status = "unchanged"
    else:
        status = "unchanged"
    return {
        "effective": bool(recovered) and status in {"recovered", "improved"},
        "recoveredPointCodes": recovered,
        "newAbnormalPointCodes": new_abnormal,
        "remainingAbnormalPointCodes": remaining,
        "unchangedAbnormalPointCodes": unchanged,
        "status": status,
    }
```

- [ ] **Step 4: Run the focused observation tests and verify they pass**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_observation -v
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- backend/practice_observation.py backend/tests/test_practice_observation.py
git commit -m "feat: add physical measurement snapshot utilities"
```

---

### Task 2: Return Initial Physical Snapshot On Practice Session Creation

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/tests/test_server.py`

- [ ] **Step 1: Add a failing endpoint test for initial physical snapshots**

In `backend/tests/test_server.py`, add this helper near `d_matrix_with_observation_rule()`:

```python
def d_matrix_with_physical_and_virtual_points():
    matrix = sample_d_matrix()
    matrix["points"][0]["pointType"] = "physical"
    matrix["points"][0]["channel"] = "scope-1.ch1"
    matrix["points"][0]["observationRule"] = {
        "method": "absoluteDelta",
        "normalThreshold": 0.1,
        "abnormalThreshold": 0.3,
    }
    matrix["points"].append({
        "pointId": "tp-virtual",
        "shortName": "V1",
        "name": "virtual instrument point",
        "pointType": "virtual",
        "channel": "scope-2.ch1",
    })
    return matrix
```

Add this test to `SimulationBackendServerTests`:

```python
    def test_practice_session_creation_returns_physical_measurement_snapshot(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.3
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]

        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )

        self.assertEqual(status, 200)
        snapshot = created["physicalMeasurementSnapshot"]
        self.assertEqual([point["pointCode"] for point in snapshot["points"]], ["M1", "M2", "M3"])
        self.assertIn("M1", snapshot["abnormalPointCodes"])
        self.assertNotIn("V1", [point["pointCode"] for point in snapshot["points"]])
        self.assertEqual(created["troubleshootingState"]["physicalMeasurementSnapshot"], snapshot)
        self.assertEqual(created["troubleshootingState"]["virtualMeasurements"], [])
        self.assertEqual(created["troubleshootingState"]["repairAttempts"], [])
```

- [ ] **Step 2: Run the specific server test and verify it fails**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_practice_session_creation_returns_physical_measurement_snapshot -v
```

Expected: FAIL because practice session creation does not return `physicalMeasurementSnapshot`.

- [ ] **Step 3: Implement initial snapshot state in `PracticeSession`**

Modify the import in `backend/practice.py`:

```python
from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_observation,
    evaluate_physical_measurement_snapshot,
)
```

Add these fields at the end of `PracticeSession.__init__()`:

```python
        self.physical_measurement_snapshots = []
        self.virtual_measurements = []
        self.repair_attempts = []
        self.latest_physical_measurement_snapshot = None
```

Add this method to `PracticeSession` before `initial_response()`:

```python
    def _build_troubleshooting_state(self):
        return {
            "physicalMeasurementSnapshot": _clone(self.latest_physical_measurement_snapshot or {}),
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": _clone(self.troubleshooting.remaining_fault_ids),
            "status": "resolved" if not _arr((self.latest_physical_measurement_snapshot or {}).get("abnormalPointCodes")) else "inProgress",
        }
```

Add `_arr()` near `_clone()` in `backend/practice.py`:

```python
def _arr(value):
    return value if isinstance(value, list) else []
```

Modify `initial_response()` so it steps the simulation once and returns the first physical snapshot:

```python
    def initial_response(self):
        simulation_result = self.simulation_session.step(1)
        simulation_result["sessionId"] = self.simulation_session_id
        self.simulation_results.append(_clone(simulation_result))
        snapshot = evaluate_physical_measurement_snapshot(self.troubleshooting.d_matrix, simulation_result)
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "physicalMeasurementSnapshot": snapshot,
            "troubleshootingState": self._build_troubleshooting_state(),
        }
```

- [ ] **Step 4: Run the specific server test and verify it passes**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_practice_session_creation_returns_physical_measurement_snapshot -v
```

Expected: PASS.

- [ ] **Step 5: Run the current server suite to catch creation-flow regressions**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: PASS. If existing tests assert the first action simulation time starts at `[0.0]`, update those assertions to the new behavior caused by the initial snapshot step. The correct post-creation first repair simulation time should start after the initial sample.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- backend/practice.py backend/tests/test_server.py
git commit -m "feat: return initial physical measurement snapshot"
```

---

### Task 3: Make `measurePoint` A Virtual Measurement Action

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/tests/test_server.py`
- Modify: `backend/tests/test_practice_action_protocol.py`

- [ ] **Step 1: Replace the old measure-point endpoint test with virtual-measurement behavior**

In `backend/tests/test_server.py`, replace `test_measure_point_generates_observation_and_updates_troubleshooting` with:

```python
    def test_measure_point_returns_virtual_measurement_without_updating_repair_path(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure-virtual",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
                "steps": 1,
                "observed": "normal",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["normalizedAction"]["actionType"], "measurePoint")
        self.assertNotIn("ruleResult", body)
        self.assertNotIn("appliedAction", body)
        self.assertEqual(body["virtualMeasurement"]["pointCode"], "V1")
        self.assertEqual(body["virtualMeasurement"]["pointType"], "virtual")
        self.assertEqual(body["virtualMeasurement"]["source"], "backend")
        self.assertEqual(body["troubleshootingState"]["virtualMeasurements"][0]["pointCode"], "V1")
        self.assertEqual(body["troubleshootingState"]["repairAttempts"], [])
```

Add this rejection test:

```python
    def test_measure_point_rejects_physical_console_point(self):
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": valid_package(),
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure-physical",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "pointCode": "M1",
                "steps": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["errorCode"], "INVALID_ACTION_SCHEMA")
        self.assertEqual(body["field"], "pointCode")
```

- [ ] **Step 2: Run the measure-point tests and verify they fail**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_measure_point_returns_virtual_measurement_without_updating_repair_path backend.tests.test_server.SimulationBackendServerTests.test_measure_point_rejects_physical_console_point -v
```

Expected: FAIL because `measurePoint` still returns `observationResult` and currently allows physical points.

- [ ] **Step 3: Implement virtual point validation and response**

Add this import in `backend/practice.py`:

```python
from backend.practice_observation import point_type
```

Modify `_record_measure_point_action()`:

```python
    def _record_measure_point_action(self, action_record, normalized_action, steps):
        measured_point_type = point_type(self.troubleshooting.d_matrix, action_record.get("pointCode"))
        if measured_point_type != "virtual":
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "pointCode",
                "measurePoint can only be used for virtual measurement points",
            )
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        virtual_measurement = evaluate_observation(self.troubleshooting.d_matrix, action_record, simulation_result)
        action_record["observed"] = virtual_measurement["observed"]
        action_record["virtualMeasurement"] = _clone(virtual_measurement)
        self.student_actions.append(action_record)
        self.virtual_measurements.append(_clone(virtual_measurement))
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": {"status": "measured", "virtualMeasurement": _clone(virtual_measurement)},
        })
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "virtualMeasurement": virtual_measurement,
            "troubleshootingState": self._build_troubleshooting_state(),
            "simulationResult": simulation_result,
        }
```

Remove the call to `self.troubleshooting.record_operation(action_record)` from the measure-point path. Virtual measurements should be evidence records, not the main repair path.

- [ ] **Step 4: Run the measure-point tests and verify they pass**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_measure_point_returns_virtual_measurement_without_updating_repair_path backend.tests.test_server.SimulationBackendServerTests.test_measure_point_rejects_physical_console_point -v
```

Expected: PASS.

- [ ] **Step 5: Run protocol and server tests**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_protocol backend.tests.test_server -v
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- backend/practice.py backend/tests/test_server.py backend/tests/test_practice_action_protocol.py
git commit -m "feat: treat measure point as virtual measurement"
```

---

### Task 4: Add Repair Snapshot And Repair Effect To Repair Actions

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/tests/test_server.py`

- [ ] **Step 1: Add failing tests for repair effects**

Add this test to `SimulationBackendServerTests`:

```python
    def test_repair_action_returns_physical_snapshot_and_repair_effect(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        self.assertIn("M1", created["physicalMeasurementSnapshot"]["abnormalPointCodes"])
        session_id = created["sessionId"]

        status, updated = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-repair",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["ruleResult"]["ruleCode"], "ACTION_ALLOWED")
        self.assertIn("physicalMeasurementSnapshot", updated)
        self.assertIn("repairEffect", updated)
        self.assertIn(updated["repairEffect"]["status"], {"recovered", "improved"})
        self.assertIn("M1", updated["repairEffect"]["recoveredPointCodes"])
        self.assertEqual(updated["troubleshootingState"]["repairAttempts"][0]["operationId"], "op-repair")
        self.assertEqual(updated["troubleshootingState"]["repairAttempts"][0]["repairEffect"], updated["repairEffect"])
```

Add this repeated repair test near the existing repeated repair test:

```python
    def test_skipped_repeated_repair_reports_unchanged_repair_effect(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.5
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.5,
            "parameters": {"bias": 0.5},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": d_matrix_with_physical_and_virtual_points(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]
        repair_payload = {
            "operationId": "op-repair",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "faultId": "fault-bias",
            "steps": 1,
        }
        status, first = self._post(f"/api/practice/session/{session_id}/action", repair_payload)
        self.assertEqual(status, 200)

        status, second = self._post(
            f"/api/practice/session/{session_id}/action",
            {**repair_payload, "operationId": "op-repair-repeat"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(second["ruleResult"]["ruleCode"], "REPEAT_REPAIR")
        self.assertFalse(second["repairEffect"]["effective"])
        self.assertEqual(second["repairEffect"]["status"], "unchanged")
        self.assertEqual(len(second["troubleshootingState"]["repairAttempts"]), 2)
```

- [ ] **Step 2: Run repair-effect tests and verify they fail**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_repair_action_returns_physical_snapshot_and_repair_effect backend.tests.test_server.SimulationBackendServerTests.test_skipped_repeated_repair_reports_unchanged_repair_effect -v
```

Expected: FAIL because repair actions do not return `physicalMeasurementSnapshot`, `repairEffect`, or closed-loop repair attempts.

- [ ] **Step 3: Implement repair snapshot comparison**

In `PracticeSession.record_action()`, after `simulation_result` is generated for repair actions, replace the old recommendation-history-only update with this closed-loop block:

```python
        previous_snapshot = _clone(self.latest_physical_measurement_snapshot or {})
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        snapshot = evaluate_physical_measurement_snapshot(self.troubleshooting.d_matrix, simulation_result)
        repair_effect = compare_physical_snapshots(previous_snapshot, snapshot)
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        repair_attempt = {
            "operationId": action_record.get("operationId") or f"operation-{len(self.repair_attempts) + 1}",
            "actionType": action_record.get("actionType") or "",
            "target": _clone(action_record.get("target") or {}),
            "faultId": action_record.get("faultId") or "",
            "ruleResult": _clone(rule_result),
            "appliedAction": _clone(action_application),
            "repairEffect": _clone(repair_effect),
        }
        self.repair_attempts.append(repair_attempt)
        self.simulation_results.append(_clone(simulation_result))
```

Keep `ruleResult`, `appliedAction`, `simulationActionHistory`, and `studentActions` behavior. Stop calling `self.troubleshooting.record_operation(action_record)` for repair actions because repair actions do not carry a point observation.

Modify the repair action return object:

```python
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "ruleResult": _clone(rule_result),
            "appliedAction": action_application,
            "repairEffect": repair_effect,
            "physicalMeasurementSnapshot": snapshot,
            "troubleshootingState": self._build_troubleshooting_state(),
            "simulationResult": simulation_result,
        }
```

- [ ] **Step 4: Run repair-effect tests and verify they pass**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_repair_action_returns_physical_snapshot_and_repair_effect backend.tests.test_server.SimulationBackendServerTests.test_skipped_repeated_repair_reports_unchanged_repair_effect -v
```

Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: PASS. Update older assertions that require repair responses to omit troubleshooting fields so they now assert the presence of `physicalMeasurementSnapshot`, `repairEffect`, and `troubleshootingState`.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- backend/practice.py backend/tests/test_server.py
git commit -m "feat: add repair verification snapshots"
```

---

### Task 5: Persist Closed-Loop State In Submit Records And Update Protocol Docs

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/tests/test_server.py`
- Modify: `docs/practice-action-protocol-v1.md`

- [ ] **Step 1: Add failing submit-record assertions**

In `test_runs_practice_session_action_and_submit_flow`, replace the old recommended-path-history-only assertions with:

```python
        self.assertIn("initialPhysicalMeasurementSnapshot", submitted["record"])
        self.assertIn("physicalMeasurementSnapshots", submitted["record"])
        self.assertIn("virtualMeasurements", submitted["record"])
        self.assertIn("repairAttempts", submitted["record"])
        self.assertGreaterEqual(len(submitted["record"]["physicalMeasurementSnapshots"]), 2)
        self.assertEqual(submitted["record"]["repairAttempts"][0]["faultId"], "fault-bias")
        self.assertIn("repairEffect", submitted["record"]["repairAttempts"][0])
        self.assertEqual(submitted["record"]["troubleshootingState"]["repairAttempts"], submitted["record"]["repairAttempts"])
```

Insert this virtual measurement before the submit call in that test so `virtualMeasurements` is covered:

```python
        status, measured = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-virtual-before-submit",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-2.ch1"},
                "pointCode": "V1",
                "steps": 1,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(measured["virtualMeasurement"]["pointCode"], "V1")
```

- [ ] **Step 2: Run the submit-flow test and verify it fails**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_runs_practice_session_action_and_submit_flow -v
```

Expected: FAIL because submit records do not include closed-loop state fields.

- [ ] **Step 3: Persist closed-loop state in submit output**

In `PracticeSession.__init__()`, add:

```python
        self.initial_physical_measurement_snapshot = None
```

In `initial_response()`, after assigning `self.latest_physical_measurement_snapshot`, add:

```python
        self.initial_physical_measurement_snapshot = _clone(snapshot)
```

Modify the `record` object returned by `submit()` to include:

```python
                "initialPhysicalMeasurementSnapshot": _clone(self.initial_physical_measurement_snapshot or {}),
                "physicalMeasurementSnapshots": _clone(self.physical_measurement_snapshots),
                "virtualMeasurements": _clone(self.virtual_measurements),
                "repairAttempts": _clone(self.repair_attempts),
                "troubleshootingState": self._build_troubleshooting_state(),
```

Keep `initialBestPath`, `actualTroubleshootingPath`, and `recommendedPathHistory` for compatibility in the first closed-loop version. They are legacy review aids.

- [ ] **Step 4: Run the submit-flow test and verify it passes**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_runs_practice_session_action_and_submit_flow -v
```

Expected: PASS.

- [ ] **Step 5: Update protocol documentation**

In `docs/practice-action-protocol-v1.md`, update the `measurePoint` section so it states:

```markdown
`measurePoint` is used only for virtual measurement points. Physical points are returned through `physicalMeasurementSnapshot` for display/control console rendering.
```

Add response fragments for:

```json
{
  "physicalMeasurementSnapshot": {
    "source": "backend",
    "points": [],
    "abnormalPointCodes": [],
    "normalPointCodes": [],
    "unknownPointCodes": []
  }
}
```

```json
{
  "virtualMeasurement": {
    "pointCode": "V1",
    "observed": "normal",
    "actualValue": 1.0,
    "referenceValue": 1.0
  }
}
```

```json
{
  "repairEffect": {
    "effective": true,
    "status": "recovered",
    "recoveredPointCodes": ["M1"],
    "remainingAbnormalPointCodes": []
  }
}
```

- [ ] **Step 6: Run focused and full backend tests**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_observation backend.tests.test_practice_action_protocol backend.tests.test_server -v
```

Expected: PASS.

Run:

```powershell
uv run python -m unittest discover backend/tests -v
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- backend/practice.py backend/tests/test_server.py docs/practice-action-protocol-v1.md
git commit -m "docs: document closed loop troubleshooting responses"
```

---

### Task 6: Final Verification And Compatibility Review

**Files:**
- Inspect: `backend/practice.py`
- Inspect: `backend/practice_observation.py`
- Inspect: `backend/tests/test_server.py`
- Inspect: `docs/practice-action-protocol-v1.md`

- [ ] **Step 1: Search for old main-path assumptions**

Run:

```powershell
rg -n "observationResult|troubleshootingResult|remainingFaultIds|nextRecommendedStep|recommendedPathHistory|measurePoint" backend docs/practice-action-protocol-v1.md
```

Expected: Remaining references to `observationResult` are either legacy compatibility notes or removed from `measurePoint` endpoint responses. Remaining references to `recommendedPathHistory` are submit-record compatibility only.

- [ ] **Step 2: Verify no physical `measurePoint` success path remains**

Run:

```powershell
uv run python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_measure_point_rejects_physical_console_point -v
```

Expected: PASS with 400 response for physical point measurement.

- [ ] **Step 3: Verify complete backend suite**

Run:

```powershell
uv run python -m unittest discover backend/tests -v
```

Expected: PASS.

- [ ] **Step 4: Review git diff before final response**

Run:

```powershell
git status --short
git log --oneline -8
```

Expected: Worktree has no tracked uncommitted changes. It may still show the pre-existing untracked `docs/practice-backend-completion-notes.md`; do not stage that file.
