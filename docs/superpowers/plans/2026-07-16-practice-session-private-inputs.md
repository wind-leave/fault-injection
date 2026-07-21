# Practice Session Private Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow practice-session creation to accept and privately retain `initialRecommendedPath` and `keyNodes`.

**Architecture:** The HTTP handler forwards the two optional request fields into `PracticeSession`. The session uses supplied values when present and retains the existing D-matrix-derived fallback when omitted; public creation/status responses remain unchanged.

**Tech Stack:** Python standard library HTTP server, `unittest`, Markdown API documentation.

---

### Task 1: Lock the request behavior with a regression test

**Files:**
- Modify: `backend/tests/test_server.py`

- [ ] Add `test_create_practice_session_retains_supplied_private_task_data`, posting a custom `initialRecommendedPath` object and `keyNodes` array.
- [ ] Assert the HTTP response omits both fields and the stored `PracticeSession` contains deep-equal values.
- [ ] Run `python -m unittest backend.tests.test_server.SimulationBackendServerTests.test_create_practice_session_retains_supplied_private_task_data -v` and confirm it fails because the constructor does not yet accept or retain the inputs.

### Task 2: Forward and retain the private inputs

**Files:**
- Modify: `backend/server.py`
- Modify: `backend/practice.py`

- [ ] Add optional `initial_recommended_path` and `key_nodes` constructor parameters.
- [ ] Use supplied object/list values for `initial_best_path` and `fault_tree_key_nodes`; retain generated fallbacks when the fields are omitted.
- [ ] Forward the JSON request fields from `_create_practice_session`.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Document and verify

**Files:**
- Modify: `docs/backend-api.md`

- [ ] Add both fields to the creation example and field table, documenting them as private and optional with generated fallbacks.
- [ ] Run `python -m unittest backend.tests.test_server -v` and confirm all backend server tests pass.
