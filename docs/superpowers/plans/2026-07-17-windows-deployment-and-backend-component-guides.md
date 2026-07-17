# Windows Deployment and Backend Component Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two accurate Chinese Markdown operation guides for Windows production deployment and backend-executable simulation component creation.

**Architecture:** The deployment guide documents IIS as the public static site and reverse proxy, with the Python backend bound to localhost and managed as a Windows service. The component guide follows the actual backend whitelist execution path from Python implementation and manifest registration through frontend binding, tests, API smoke checks, and release.

**Tech Stack:** Markdown, PowerShell, IIS, Python standard library HTTP backend, Vue/Vite frontend, `unittest`, JSON.

---

### Task 1: Write the Windows production deployment guide

**Files:**

- Create: `docs/故障注入平台Windows正式部署操作手册.md`
- Reference: `README.md`
- Reference: `package.json`
- Reference: `vite.config.js`
- Reference: `serve-dist-local.mjs`
- Reference: `backend/server.py`

- [x] **Step 1: Write the deployment architecture and prerequisites**

Document the IIS + localhost backend topology, port plan, directory plan, accounts, software prerequisites, and the distinction between build-machine and target-machine dependencies.

- [x] **Step 2: Write packaging and target-machine installation steps**

Provide exact PowerShell commands to run tests and build the frontend, describe the release package contents, and show directory creation and copy procedures on the target machine.

- [x] **Step 3: Write backend service and IIS configuration steps**

Provide a concrete WinSW service XML, service installation commands, IIS static-site setup, URL Rewrite/ARR proxy rule, and firewall guidance.

- [x] **Step 4: Write acceptance, operations, upgrade, rollback, and troubleshooting sections**

Add layered health checks, API smoke requests, backup and version switching procedures, log locations, recurring inspection items, and symptom-to-cause troubleshooting tables.

- [x] **Step 5: Validate the guide**

Run:

```powershell
rg -n "TODO|TBD|待补充|以后填写" docs/故障注入平台Windows正式部署操作手册.md
```

Expected: no matches.

Run:

```powershell
rg -n "127\.0\.0\.1:8766|/api/|dist/|backend\.server|IIS" docs/故障注入平台Windows正式部署操作手册.md
```

Expected: all critical deployment concepts appear.

### Task 2: Write the backend simulation component creation guide

**Files:**

- Create: `docs/后端仿真组件创建与接入流程.md`
- Reference: `backend/module_registry.py`
- Reference: `backend/builtin_modules/manifest.json`
- Reference: `backend/builtin_modules/pid_controller.py`
- Reference: `backend/tests/test_module_registry.py`
- Reference: `backend/tests/test_simulation_engine.py`
- Reference: `src/services/backendExecutablePackageService.js`
- Reference: `docs/backend-api.md`

- [x] **Step 1: Document the execution boundary and interface design**

Explain the whitelist boundary, module naming, input/output/parameter schema, optional execution context, state isolation, deterministic behavior, and numeric-only restrictions.

- [x] **Step 2: Add complete stateless and stateful implementation examples**

Use a `first_order_actuator` example with `command`, `gain`, `timeConstant`, `dt`, `state`, `outputs`, `state`, and `middleVars`. Include a simpler stateless variant for comparison.

- [x] **Step 3: Add manifest, test, frontend binding, and API integration steps**

Provide exact JSON registration, `unittest` examples, a minimal executable model package, PowerShell API smoke commands, and the corresponding `simulation_block` binding structure.

- [x] **Step 4: Add fault-injection compatibility and release checklists**

Cover parameter faults, signal faults, parameter bounds, port ordering, cycles, performance limits, common backend error codes, and publishing the module to every deployed backend machine.

- [x] **Step 5: Validate the guide**

Run:

```powershell
rg -n "TODO|TBD|待补充|以后填写" docs/后端仿真组件创建与接入流程.md
```

Expected: no matches.

Run:

```powershell
rg -n "manifest\.json|moduleId|outputs|middleVars|pythonBinding|MODULE_NOT_WHITELISTED" docs/后端仿真组件创建与接入流程.md
```

Expected: all critical component integration concepts appear.

### Task 3: Cross-check both guides against the repository

**Files:**

- Verify: `docs/故障注入平台Windows正式部署操作手册.md`
- Verify: `docs/后端仿真组件创建与接入流程.md`

- [x] **Step 1: Check Markdown and whitespace**

Run:

```powershell
git diff --check -- docs/故障注入平台Windows正式部署操作手册.md docs/后端仿真组件创建与接入流程.md
```

Expected: no output.

- [x] **Step 2: Check referenced repository paths**

Verify every repository-relative path named in either guide exists in the current tree or is explicitly introduced as a new example file.

- [x] **Step 3: Review safety and operational consistency**

Confirm that the public firewall rule does not expose port 8766, IIS proxies `/api/*`, Python source embedded in model packages is not claimed to execute, and both actual/reference simulation state isolation is described correctly.

- [x] **Step 4: Commit only the two requested guides and this plan**

Run:

```powershell
git add -- docs/superpowers/plans/2026-07-17-windows-deployment-and-backend-component-guides.md docs/故障注入平台Windows正式部署操作手册.md docs/后端仿真组件创建与接入流程.md
git commit -m "docs: add Windows deployment and backend component guides"
```

Expected: one commit containing only the plan and two requested guides.
