# Practice Action Protocol V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the practice action protocol used by the 3D client for integration testing.

**Architecture:** Add a small backend protocol normalizer that accepts only `replaceWire` and `replaceComponent` student actions, validates `faultId` plus target fields, and preserves the normalized action in practice responses. Keep the existing simulation action runtime focused on applying repairs by disabling matching fault instances.

**Tech Stack:** Python standard library, existing `unittest` backend test suite, existing HTTP practice API.

---

## File Structure

- Create `backend/practice_action_protocol.py`: normalize and validate action payloads for the integration protocol.
- Modify `backend/practice.py`: call the normalizer before applying an action and return `normalizedAction`.
- Modify `backend/practice_actions.py`: apply only normalized `replaceWire` / `replaceComponent` repair semantics for protocol actions while preserving existing repair behavior.
- Add `backend/tests/test_practice_action_protocol.py`: unit tests for protocol validation and compatibility fields.
- Modify `backend/tests/test_server.py`: assert the practice action endpoint returns `normalizedAction` and rejects unsupported actions.
- Add `docs/practice-action-protocol-v1.md`: concise integration contract for the 3D client.

## Tasks

### Task 1: Protocol Normalizer

**Files:**
- Create: `故障注入/backend/practice_action_protocol.py`
- Test: `故障注入/backend/tests/test_practice_action_protocol.py`

- [ ] **Step 1: Write failing tests**

Add tests that require `replaceWire` and `replaceComponent`, require `faultId`, require `target.type` / `target.id`, reject unknown actions, and normalize `steps` to `1` when missing.

- [ ] **Step 2: Run tests and confirm RED**

Run: `python -m unittest backend.tests.test_practice_action_protocol -v`
Expected: FAIL because `backend.practice_action_protocol` does not exist.

- [ ] **Step 3: Implement normalizer**

Create `normalize_practice_action(action)` and raise `SimulationBackendError` for invalid payloads.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `python -m unittest backend.tests.test_practice_action_protocol -v`
Expected: PASS.

### Task 2: Practice Session Integration

**Files:**
- Modify: `故障注入/backend/practice.py`
- Modify: `故障注入/backend/practice_actions.py`
- Test: `故障注入/backend/tests/test_server.py`

- [ ] **Step 1: Write failing endpoint tests**

Add tests asserting `/api/practice/session/{id}/action` returns `normalizedAction` for `replaceComponent` and returns `UNSUPPORTED_ACTION_TYPE` for `measure`.

- [ ] **Step 2: Run tests and confirm RED**

Run: `python -m unittest backend.tests.test_server -v`
Expected: FAIL because the endpoint does not return `normalizedAction` and currently accepts `measure`.

- [ ] **Step 3: Integrate normalizer**

Normalize the action in `PracticeSession.record_action()`, apply the normalized action, store the normalized action in records, and return it.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `python -m unittest backend.tests.test_server -v`
Expected: PASS.

### Task 3: Integration Contract Documentation

**Files:**
- Add: `故障注入/docs/practice-action-protocol-v1.md`

- [ ] **Step 1: Write protocol document**

Document endpoint, supported actions, required fields, request examples, response shape, and error behavior for `replaceWire` and `replaceComponent`.

- [ ] **Step 2: Final verification**

Run:
- `python -m unittest backend.tests.test_practice_action_protocol backend.tests.test_practice_actions backend.tests.test_server -v`

Expected: all tests pass.
