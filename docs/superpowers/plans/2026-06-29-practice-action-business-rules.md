# Practice Action Business Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a business-rule layer that evaluates normalized 3D practice actions before mutating the simulation model.

**Architecture:** Keep protocol validation in `practice_action_protocol.py`, add a new non-mutating `practice_action_rules.py` module, and let `PracticeSession.record_action()` coordinate normalize -> evaluate rules -> apply or skip -> step simulation. Runtime mutation remains in `practice_actions.py`, with a small skipped-result helper for repeated repairs.

**Tech Stack:** Python standard library, existing `unittest` backend tests, existing HTTP practice API.

---

## File Structure

- Create `backend/practice_action_rules.py`: business-rule engine that inspects normalized actions against current fault instances without mutating the model.
- Create `backend/tests/test_practice_action_rules.py`: unit tests for allowed repair, repeated repair, missing fault, and target mismatch.
- Modify `backend/practice.py`: instantiate the rule engine, attach `ruleResult` to records and responses, and skip runtime mutation when `allowed` is false.
- Modify `backend/practice_actions.py`: add `skipped(action, warning)` so business-rule skips produce a stable `appliedAction`.
- Modify `backend/tests/test_server.py`: endpoint coverage for `ruleResult`, repeated repair, and target mismatch.

## Task 1: Rule Engine Unit

**Files:**
- Create: `backend/practice_action_rules.py`
- Create: `backend/tests/test_practice_action_rules.py`

- [ ] **Step 1: Write the failing rule engine tests**

Create `backend/tests/test_practice_action_rules.py`:

```python
import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.schemas import SimulationBackendError
from backend.simulation_engine import SimulationSession
from backend.tests.fixtures import valid_package


def package_with_fault(fault_id="fault-bias", target_id="sim-1", enabled=True):
    package = valid_package()
    package["faultInstances"] = [{
        "faultId": fault_id,
        "faultType": "sensor_bias",
        "targetId": target_id,
        "enabled": enabled,
        "startTime": 0.0,
        "duration": 0.3,
        "parameters": {"bias": 0.5},
    }]
    return package


class PracticeActionRuleEngineTests(unittest.TestCase):
    def _engine(self, package):
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        session = SimulationSession(graph, run_id="rule-engine-test")
        return PracticeActionRuleEngine(session)

    def test_allows_enabled_replace_component_fault(self):
        engine = self._engine(package_with_fault())

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {
            "allowed": True,
            "ruleCode": "ACTION_ALLOWED",
            "durationSeconds": 120,
            "riskLevel": "medium",
            "repeatAction": False,
            "warnings": [],
        })

    def test_allows_enabled_replace_wire_fault(self):
        engine = self._engine(package_with_fault(
            fault_id="fault-wire-open",
            target_id="edge-source-sim",
        ))

        result = engine.evaluate({
            "actionType": "replaceWire",
            "target": {"type": "wire", "id": "edge-source-sim"},
            "targetId": "edge-source-sim",
            "faultId": "fault-wire-open",
        })

        self.assertEqual(result["allowed"], True)
        self.assertEqual(result["ruleCode"], "ACTION_ALLOWED")
        self.assertEqual(result["durationSeconds"], 90)
        self.assertEqual(result["riskLevel"], "low")

    def test_returns_repeat_repair_for_disabled_fault(self):
        engine = self._engine(package_with_fault(enabled=False))

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {
            "allowed": False,
            "ruleCode": "REPEAT_REPAIR",
            "durationSeconds": 0,
            "riskLevel": "none",
            "repeatAction": True,
            "warnings": ["fault is already repaired"],
        })

    def test_rejects_unknown_fault_id(self):
        engine = self._engine(package_with_fault())

        with self.assertRaises(SimulationBackendError) as context:
            engine.evaluate({
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "targetId": "sim-1",
                "faultId": "missing-fault",
            })

        self.assertEqual(context.exception.error_code, "TARGET_NOT_FOUND")
        self.assertEqual(context.exception.field, "faultId")

    def test_rejects_target_mismatch(self):
        engine = self._engine(package_with_fault())

        with self.assertRaises(SimulationBackendError) as context:
            engine.evaluate({
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "source-1"},
                "targetId": "source-1",
                "faultId": "fault-bias",
            })

        self.assertEqual(context.exception.error_code, "TARGET_MISMATCH")
        self.assertEqual(context.exception.field, "target.id")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run rule engine tests and verify RED**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_rules -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.practice_action_rules'`.

- [ ] **Step 3: Implement `PracticeActionRuleEngine`**

Create `backend/practice_action_rules.py`:

```python
from backend.schemas import SimulationBackendError


DEFAULT_RULES = {
    "replaceComponent": {"durationSeconds": 120, "riskLevel": "medium"},
    "replaceWire": {"durationSeconds": 90, "riskLevel": "low"},
}


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


class PracticeActionRuleEngine:
    def __init__(self, simulation_session, rules=None):
        self.simulation_session = simulation_session
        self.rules = rules if isinstance(rules, dict) else DEFAULT_RULES

    def evaluate(self, action):
        action_type = _text(action.get("actionType"))
        target_id = _text(action.get("targetId"))
        fault_id = _text(action.get("faultId"))
        fault = self._find_fault(fault_id)
        if fault is None:
            raise SimulationBackendError("TARGET_NOT_FOUND", "faultId", f"fault not found: {fault_id}")
        fault_target_id = _text(fault.get("targetId"))
        if target_id and fault_target_id != target_id:
            raise SimulationBackendError(
                "TARGET_MISMATCH",
                "target.id",
                f"faultId {fault_id} does not match target {target_id}",
            )
        if not bool(fault.get("enabled", True)):
            return {
                "allowed": False,
                "ruleCode": "REPEAT_REPAIR",
                "durationSeconds": 0,
                "riskLevel": "none",
                "repeatAction": True,
                "warnings": ["fault is already repaired"],
            }
        rule = self.rules.get(action_type, {})
        return {
            "allowed": True,
            "ruleCode": "ACTION_ALLOWED",
            "durationSeconds": rule.get("durationSeconds", 0),
            "riskLevel": rule.get("riskLevel", "none"),
            "repeatAction": False,
            "warnings": [],
        }

    def _find_fault(self, fault_id):
        for fault in self.simulation_session.fault_runtime.fault_instances:
            if _text(fault.get("faultId")) == fault_id:
                return fault
        return None
```

- [ ] **Step 4: Run rule engine tests and verify GREEN**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_rules -v
```

Expected: PASS, 5 tests OK.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add backend/practice_action_rules.py backend/tests/test_practice_action_rules.py
git commit -m "feat: add practice action rule engine"
```

## Task 2: Practice Session Rule Integration

**Files:**
- Modify: `backend/practice.py`
- Modify: `backend/practice_actions.py`
- Modify: `backend/tests/test_server.py`

- [ ] **Step 1: Write failing endpoint tests**

In `backend/tests/test_server.py`, update `test_runs_practice_session_action_and_submit_flow()` after the existing `normalizedAction` assertions:

```python
self.assertEqual(updated["ruleResult"], {
    "allowed": True,
    "ruleCode": "ACTION_ALLOWED",
    "durationSeconds": 120,
    "riskLevel": "medium",
    "repeatAction": False,
    "warnings": [],
})
```

Add a new endpoint test:

```python
    def test_practice_action_repeated_repair_is_recorded_and_skipped(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.4,
            "parameters": {"bias": 1.0},
        }]
        status, created = self._post(
            "/api/practice/session",
            {
                "simulationPackage": package,
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]
        payload = {
            "operationId": "op-repair",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "faultId": "fault-bias",
            "steps": 1,
        }

        first_status, first = self._post(f"/api/practice/session/{session_id}/action", payload)
        self.assertEqual(first_status, 200)
        self.assertEqual(first["ruleResult"]["ruleCode"], "ACTION_ALLOWED")

        payload["operationId"] = "op-repeat"
        second_status, second = self._post(f"/api/practice/session/{session_id}/action", payload)

        self.assertEqual(second_status, 200)
        self.assertEqual(second["ruleResult"], {
            "allowed": False,
            "ruleCode": "REPEAT_REPAIR",
            "durationSeconds": 0,
            "riskLevel": "none",
            "repeatAction": True,
            "warnings": ["fault is already repaired"],
        })
        self.assertEqual(second["appliedAction"]["status"], "skipped")
        self.assertEqual(second["appliedAction"]["changes"], [])
```

Add a target mismatch endpoint test:

```python
    def test_practice_action_target_mismatch_returns_error(self):
        package = valid_package()
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
                "dMatrix": sample_d_matrix(),
                "targetFaultId": "target-fault",
            },
        )
        self.assertEqual(status, 200)
        session_id = created["sessionId"]

        status, body = self._post(
            f"/api/practice/session/{session_id}/action",
            {
                "operationId": "op-mismatch",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "source-1"},
                "faultId": "fault-bias",
                "steps": 1,
            },
        )

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "TARGET_MISMATCH")
        self.assertEqual(body["field"], "target.id")
```

- [ ] **Step 2: Run endpoint tests and verify RED**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: FAIL because responses do not include `ruleResult`, and repeated repair still returns `applied`.

- [ ] **Step 3: Add skipped runtime result**

Modify `backend/practice_actions.py` inside `PracticeActionRuntime`:

```python
    def skipped(self, action, warning="action skipped by business rules"):
        return {
            "status": "skipped",
            "actionType": action.get("actionType") or "",
            "changes": [],
            "warnings": [warning],
        }
```

Keep existing `apply()` behavior unchanged for allowed actions.

- [ ] **Step 4: Integrate rule engine in `PracticeSession`**

Modify imports in `backend/practice.py`:

```python
from backend.practice_action_protocol import normalize_practice_action
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.practice_actions import PracticeActionRuntime
```

In `PracticeSession.__init__`, add:

```python
self.rule_engine = PracticeActionRuleEngine(simulation_session)
```

In `PracticeSession.record_action()`, replace the action application block with:

```python
        action_record = normalize_practice_action(action)
        normalized_action = _clone(action_record)
        action_record.setdefault("recordedAt", time.time())
        rule_result = self.rule_engine.evaluate(action_record)
        if rule_result.get("allowed"):
            action_application = self.action_runtime.apply(action_record)
        else:
            action_application = self.action_runtime.skipped(action_record)
        action_record["ruleResult"] = _clone(rule_result)
        action_record["simulationActionResult"] = _clone(action_application)
```

In the returned payload, add:

```python
"ruleResult": _clone(rule_result),
```

Place it next to `normalizedAction` and before `appliedAction`.

- [ ] **Step 5: Run endpoint tests and verify GREEN**

Run:

```powershell
uv run python -m unittest backend.tests.test_server -v
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add backend/practice.py backend/practice_actions.py backend/tests/test_server.py
git commit -m "feat: apply practice action business rules"
```

## Task 3: Regression and Documentation Alignment

**Files:**
- Modify: `docs/practice-action-protocol-v1.md`
- Test: `backend/tests/test_practice_action_rules.py`
- Test: `backend/tests/test_server.py`
- Test: `backend/tests/test_practice_actions.py`

- [ ] **Step 1: Update protocol documentation with rule result**

In `docs/practice-action-protocol-v1.md`, add a short section after the success response explaining:

```markdown
## 业务规则结果

`ruleResult` 表示后端对学生动作的业务判断。联调阶段支持：

- `ACTION_ALLOWED`：允许执行，后端会修复故障。
- `REPEAT_REPAIR`：重复更换，HTTP 200 返回，动作会被记录，但不会再次修改模型。

`durationSeconds`、`riskLevel`、`repeatAction` 只记录业务语义，当前版本不参与评分。
```

Also update the success response example to include:

```json
"ruleResult": {
  "allowed": true,
  "ruleCode": "ACTION_ALLOWED",
  "durationSeconds": 90,
  "riskLevel": "low",
  "repeatAction": false,
  "warnings": []
}
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
uv run python -m unittest backend.tests.test_practice_action_rules backend.tests.test_practice_actions backend.tests.test_server -v
```

Expected: PASS.

- [ ] **Step 3: Run full backend suite**

Run:

```powershell
uv run python -m unittest discover backend/tests -v
```

Expected: PASS, all discovered backend tests OK.

- [ ] **Step 4: Commit Task 3**

Run:

```powershell
git add docs/practice-action-protocol-v1.md
git commit -m "docs: document practice action rule results"
```

## Self-Review Checklist

- Spec coverage: rule engine, `ruleResult`, default durations/risk levels, repeated repair, target mismatch, storage, endpoint response, and tests are all covered.
- Scope check: scoring, persistence, playback, and task configuration are intentionally excluded.
- Type consistency: all plan snippets use `PracticeActionRuleEngine.evaluate()`, `ruleResult`, `ACTION_ALLOWED`, `REPEAT_REPAIR`, `durationSeconds`, `riskLevel`, `repeatAction`, and `warnings` consistently.
- Verification command: final implementation must pass `uv run python -m unittest discover backend/tests -v`.
