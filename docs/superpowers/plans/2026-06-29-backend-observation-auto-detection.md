# Backend Observation Auto Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a `measurePoint` practice action and generate `observed` on the backend from simulation output.

**Architecture:** Extend protocol normalization to accept `measurePoint` without `faultId`, add a pure `practice_observation.py` evaluator for `absoluteDelta`, and split `PracticeSession.record_action()` so repair actions keep the rule/runtime path while measurement actions step simulation, evaluate observation, then update troubleshooting with backend-generated `observed`.

**Tech Stack:** Python standard library, existing `unittest` backend tests, existing HTTP practice API.

---

## File Structure

- Modify `backend/practice_action_protocol.py`: add `measurePoint`, `testPoint` targets, required `pointCode`, no `faultId` requirement for measurements.
- Create `backend/practice_observation.py`: resolve D-matrix point rules and calculate `observationResult`.
- Create `backend/tests/test_practice_observation.py`: unit tests for normal, abnormal, unknown, missing channel, and default thresholds.
- Modify `backend/practice.py`: branch measurement actions away from repair rules and update troubleshooting after auto observation.
- Modify `backend/tests/test_practice_action_protocol.py`: protocol tests for `measurePoint`.
- Modify `backend/tests/test_server.py`: endpoint tests for `measurePoint` response, ignored client `observed`, repair action behavior.
- Modify `docs/practice-action-protocol-v1.md`: document `measurePoint` and `observationResult`.

## Task 1: Protocol Support for `measurePoint`

**Files:**
- Modify: `backend/practice_action_protocol.py`
- Modify: `backend/tests/test_practice_action_protocol.py`

- [ ] **Step 1: Write failing protocol tests**

Add these tests to `backend/tests/test_practice_action_protocol.py` inside `PracticeActionProtocolTests`:

```python
    def test_normalizes_measure_point_without_fault_id(self):
        normalized = normalize_practice_action({
            "protocolVersion": "1.0",
            "operationId": "op-measure",
            "actionType": "measurePoint",
            "target": {"type": "testPoint", "id": "scope-1.ch1"},
            "pointCode": "M1",
            "steps": 2,
            "observed": "normal",
        })

        self.assertEqual(normalized["actionType"], "measurePoint")
        self.assertEqual(normalized["target"], {"type": "testPoint", "id": "scope-1.ch1"})
        self.assertEqual(normalized["targetId"], "scope-1.ch1")
        self.assertEqual(normalized["pointCode"], "M1")
        self.assertNotIn("faultId", normalized)
        self.assertNotIn("observed", normalized)

    def test_rejects_measure_point_without_point_code(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "pointCode")

    def test_rejects_measure_point_with_wrong_target_type(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "component", "id": "sim-1"},
                "pointCode": "M1",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "target.type")
```

- [ ] **Step 2: Run protocol tests and verify RED**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_protocol -v
```

Expected: FAIL because `measurePoint` is unsupported or still requires `faultId`.

- [ ] **Step 3: Extend protocol normalizer**

Modify `backend/practice_action_protocol.py`:

```python
SUPPORTED_ACTION_TARGETS = {
    "replaceComponent": "component",
    "replaceWire": "wire",
    "measurePoint": "testPoint",
}
```

In `normalize_practice_action()`, replace the unconditional `fault_id = _require_text(action, "faultId")` and normalized dict creation with:

```python
    normalized = {
        "protocolVersion": _text(action.get("protocolVersion")) or "1.0",
        "operationId": _text(action.get("operationId")),
        "actionType": action_type,
        "target": {"type": target_type, "id": target_id},
        "targetId": target_id,
        "steps": _validate_steps(action.get("steps")),
        "rawAction": action.get("rawAction") if isinstance(action.get("rawAction"), dict) else {},
    }
    if action_type == "measurePoint":
        normalized["pointCode"] = _require_text(action, "pointCode")
    else:
        normalized["faultId"] = _require_text(action, "faultId")
```

Leave `clientTime` handling unchanged after this block.

- [ ] **Step 4: Run protocol tests and verify GREEN**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_protocol -v
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add backend/practice_action_protocol.py backend/tests/test_practice_action_protocol.py
git commit -m "feat: allow practice measure point actions"
```

## Task 2: Observation Evaluator

**Files:**
- Create: `backend/practice_observation.py`
- Create: `backend/tests/test_practice_observation.py`

- [ ] **Step 1: Write failing observation tests**

Create `backend/tests/test_practice_observation.py`:

```python
import unittest

from backend.practice_observation import evaluate_observation


def d_matrix_with_point(rule=None, channel="scope-1.ch1"):
    point = {
        "pointId": "tp-residual",
        "shortName": "M1",
        "name": "residual diagnostic point",
        "channel": channel,
    }
    if rule is not None:
        point["observationRule"] = rule
    return {"points": [point], "rows": []}


def simulation_result(actual, reference, channel="scope-1.ch1"):
    return {
        "curves": {
            "time": [0.0, 0.1],
            "channels": {
                f"{channel}.actual": actual,
                f"{channel}.reference": reference,
            },
        }
    }


class PracticeObservationTests(unittest.TestCase):
    def test_absolute_delta_normal(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.02, 1.03], [1.0, 1.0]),
        )

        self.assertEqual(result["observed"], "normal")
        self.assertEqual(result["reason"], "metric-below-normal-threshold")
        self.assertAlmostEqual(result["metricValue"], 0.03)

    def test_absolute_delta_abnormal(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.4, 1.5], [1.0, 1.0]),
        )

        self.assertEqual(result["observed"], "abnormal")
        self.assertEqual(result["reason"], "metric-above-abnormal-threshold")
        self.assertAlmostEqual(result["metricValue"], 0.5)

    def test_absolute_delta_unknown_between_thresholds(self):
        result = evaluate_observation(
            d_matrix_with_point({
                "method": "absoluteDelta",
                "normalThreshold": 0.1,
                "abnormalThreshold": 0.3,
            }),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.2], [1.0]),
        )

        self.assertEqual(result["observed"], "unknown")
        self.assertEqual(result["reason"], "metric-between-thresholds")

    def test_missing_channel_returns_unknown(self):
        result = evaluate_observation(
            d_matrix_with_point(),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            {"curves": {"channels": {}}},
        )

        self.assertEqual(result["observed"], "unknown")
        self.assertEqual(result["reason"], "missing-channel-data")

    def test_uses_default_thresholds_without_rule(self):
        result = evaluate_observation(
            d_matrix_with_point(),
            {"pointCode": "M1", "targetId": "scope-1.ch1"},
            simulation_result([1.21], [1.0]),
        )

        self.assertEqual(result["method"], "absoluteDelta")
        self.assertEqual(result["normalThreshold"], 0.05)
        self.assertEqual(result["abnormalThreshold"], 0.2)
        self.assertEqual(result["observed"], "abnormal")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run observation tests and verify RED**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_observation -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.practice_observation'`.

- [ ] **Step 3: Implement observation evaluator**

Create `backend/practice_observation.py`:

```python
import math


DEFAULT_OBSERVATION_RULE = {
    "method": "absoluteDelta",
    "normalThreshold": 0.05,
    "abnormalThreshold": 0.2,
}


def _arr(value):
    return value if isinstance(value, list) else []


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


def _number(value, fallback):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return fallback
    return float(value)


def _point_code(action):
    return _text(action.get("pointCode") or action.get("shortName") or action.get("pointId"))


def _find_point(d_matrix, point_code):
    for point in _arr((d_matrix or {}).get("points")):
        if _text(point.get("shortName")) == point_code or _text(point.get("pointId")) == point_code:
            return point
    return {}


def _resolve_rule(point):
    raw_rule = point.get("observationRule") if isinstance(point, dict) else None
    raw_rule = raw_rule if isinstance(raw_rule, dict) else {}
    return {
        "method": _text(raw_rule.get("method")) or DEFAULT_OBSERVATION_RULE["method"],
        "normalThreshold": _number(raw_rule.get("normalThreshold"), DEFAULT_OBSERVATION_RULE["normalThreshold"]),
        "abnormalThreshold": _number(raw_rule.get("abnormalThreshold"), DEFAULT_OBSERVATION_RULE["abnormalThreshold"]),
        "channel": _text(raw_rule.get("channel")),
    }


def _channel(point, rule, action):
    return rule.get("channel") or _text(point.get("channel")) or _text(action.get("targetId"))


def _series(channels, name):
    values = channels.get(name)
    return values if isinstance(values, list) else []


def evaluate_observation(d_matrix, action, simulation_result):
    point_code = _point_code(action)
    point = _find_point(d_matrix, point_code)
    rule = _resolve_rule(point)
    channel = _channel(point, rule, action)
    channels = ((simulation_result or {}).get("curves") or {}).get("channels") or {}
    actual = _series(channels, f"{channel}.actual")
    reference = _series(channels, f"{channel}.reference")

    base = {
        "pointCode": point_code,
        "pointId": point.get("pointId") or "",
        "channel": channel,
        "method": rule["method"],
        "normalThreshold": rule["normalThreshold"],
        "abnormalThreshold": rule["abnormalThreshold"],
        "source": "backend",
    }
    if not actual or not reference:
        return {
            **base,
            "observed": "unknown",
            "metricValue": None,
            "reason": "missing-channel-data",
        }

    sample_count = min(len(actual), len(reference))
    if sample_count <= 0:
        return {
            **base,
            "observed": "unknown",
            "metricValue": None,
            "reason": "missing-channel-data",
        }
    metric_value = max(abs(float(actual[index]) - float(reference[index])) for index in range(sample_count))
    if metric_value <= rule["normalThreshold"]:
        observed = "normal"
        reason = "metric-below-normal-threshold"
    elif metric_value >= rule["abnormalThreshold"]:
        observed = "abnormal"
        reason = "metric-above-abnormal-threshold"
    else:
        observed = "unknown"
        reason = "metric-between-thresholds"
    return {
        **base,
        "observed": observed,
        "metricValue": metric_value,
        "reason": reason,
    }
```

- [ ] **Step 4: Run observation tests and verify GREEN**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_observation -v
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add backend/practice_observation.py backend/tests/test_practice_observation.py
git commit -m "feat: add backend observation evaluator"
```

## Task 3: Practice Endpoint Integration

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/tests/test_server.py`

- [ ] **Step 1: Write failing endpoint tests**

Add this helper near the top of `backend/tests/test_server.py` after imports:

```python
def d_matrix_with_observation_rule():
    matrix = sample_d_matrix()
    matrix["points"][0]["channel"] = "scope-1.ch1"
    matrix["points"][0]["observationRule"] = {
        "method": "absoluteDelta",
        "normalThreshold": 0.1,
        "abnormalThreshold": 0.3,
    }
    return matrix
```

Add endpoint test inside `SimulationBackendServerTests`:

```python
    def test_measure_point_generates_observation_and_updates_troubleshooting(self):
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
                "dMatrix": d_matrix_with_observation_rule(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "pointCode": "M1",
                "steps": 1,
                "observed": "normal",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["normalizedAction"]["actionType"], "measurePoint")
        self.assertNotIn("ruleResult", body)
        self.assertNotIn("appliedAction", body)
        self.assertEqual(body["observationResult"]["observed"], "abnormal")
        self.assertEqual(body["observationResult"]["source"], "backend")
        self.assertEqual(body["troubleshootingResult"]["remainingFaultIds"], ["target-fault", "controller-fault"])
```

Add a repair guard assertion to `test_runs_practice_session_action_and_submit_flow()`:

```python
self.assertNotIn("observationResult", updated)
```

- [ ] **Step 2: Run endpoint tests and verify RED**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: FAIL because `measurePoint` currently enters repair rule evaluation and does not return `observationResult`.

- [ ] **Step 3: Integrate observation flow in `PracticeSession`**

Modify imports in `backend/practice.py`:

```python
from backend.practice_observation import evaluate_observation
```

Refactor `record_action()` to branch after normalization:

```python
        action_record = normalize_practice_action(action)
        normalized_action = _clone(action_record)
        action_record.setdefault("recordedAt", time.time())
        if action_record.get("actionType") == "measurePoint":
            return self._record_measure_point_action(action_record, normalized_action, steps)
```

Then keep the existing repair flow after that branch.

Add this method to `PracticeSession` before `submit()`:

```python
    def _record_measure_point_action(self, action_record, normalized_action, steps):
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        observation_result = evaluate_observation(self.troubleshooting.d_matrix, action_record, simulation_result)
        action_record["observed"] = observation_result["observed"]
        action_record["observationResult"] = _clone(observation_result)
        self.student_actions.append(action_record)
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": {"status": "observed", "observationResult": _clone(observation_result)},
        })
        recommendation_record = self._build_recommendation_record(action_record)
        troubleshooting_result = self.troubleshooting.record_operation(action_record)
        recommendation_record["nextRecommendedStepAfterAction"] = _clone(troubleshooting_result.get("nextRecommendedStep"))
        recommendation_record["remainingFaultIdsAfterAction"] = _clone(troubleshooting_result.get("remainingFaultIds"))
        recommendation_record["routeQuality"] = _clone(troubleshooting_result.get("routeQuality"))
        self.recommended_path_history.append(recommendation_record)
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "observationResult": observation_result,
            "troubleshootingResult": troubleshooting_result,
            "simulationResult": simulation_result,
        }
```

- [ ] **Step 4: Run endpoint tests and verify GREEN**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add backend/practice.py backend/tests/test_server.py
git commit -m "feat: auto-detect measure point observations"
```

## Task 4: Documentation and Full Verification

**Files:**
- Modify: `docs/practice-action-protocol-v1.md`
- Test: backend tests

- [ ] **Step 1: Update protocol document**

In `docs/practice-action-protocol-v1.md`, update the supported action list from two actions to three:

```text
replaceWire
replaceComponent
measurePoint
```

Add a section after the replace wire section:

```markdown
## 检测测点

请求示例：

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

三维端不需要提交 `observed`。后端会根据仿真曲线和测点规则生成 `observationResult.observed`，再用该结果更新排故路径。
```

Add a response note:

```markdown
`measurePoint` 成功返回时包含 `observationResult` 和 `troubleshootingResult`，不包含 `ruleResult` 和 `appliedAction`。
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_protocol backend.tests.test_practice_observation backend.tests.test_server -v
```

Expected: PASS.

- [ ] **Step 3: Run full backend suite**

Run:

```powershell
uv run python -m unittest discover backend/tests -v
```

Expected: PASS, all discovered backend tests OK.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add docs/practice-action-protocol-v1.md
git commit -m "docs: document measure point observation flow"
```

## Self-Review Checklist

- Spec coverage: `measurePoint` protocol, backend-generated `observed`, `absoluteDelta`, D-matrix point rules, fallback thresholds, troubleshooting update, endpoint response, repair action non-observation behavior.
- Scope check: repair actions causing path updates are intentionally excluded and documented as future work.
- Type consistency: plan uses `measurePoint`, `testPoint`, `pointCode`, `observationResult`, `troubleshootingResult`, `absoluteDelta`, and `evaluate_observation()` consistently.
- Verification command: final implementation must pass `uv run python -m unittest discover backend/tests -v`.
