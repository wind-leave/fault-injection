# Simulation Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first backend simulation path for restricted frontend model packages, with Python execution limited to backend whitelist modules.

**Architecture:** Add a focused Python backend package under `backend/` that validates an executable package, resolves whitelisted modules, compiles the supported graph subset, runs bounded reference/actual simulations, and serves `POST /api/simulations/run`. Add frontend services that export a backend executable package and call the backend without replacing the existing browser runtime.

**Tech Stack:** Python 3 stdlib (`dataclasses`, `http.server`, `unittest`, `importlib`, `json`), existing Vue/Vite frontend, Vitest for frontend service tests.

---

## File Structure

- Create `backend/__init__.py`: package marker.
- Create `backend/schemas.py`: error codes, validation limits, numeric helpers, package validation.
- Create `backend/module_registry.py`: backend whitelist registry and callable module resolution.
- Create `backend/graph_compiler.py`: supported node/edge compilation into an executable graph.
- Create `backend/fault_runtime.py`: runtime-only fault application and fault lifecycle events.
- Create `backend/simulation_engine.py`: reference/actual time-step execution and curve collection.
- Create `backend/server.py`: stdlib HTTP API for `/api/simulations/run`.
- Create `backend/builtin_modules/__init__.py`: module package marker.
- Create `backend/builtin_modules/passthrough.py`: simple whitelisted test/demo module.
- Create `backend/builtin_modules/gain.py`: simple whitelisted test/demo module with parameter support.
- Create `backend/builtin_modules/manifest.json`: default whitelist module manifest.
- Create `backend/tests/__init__.py`: test package marker.
- Create `backend/tests/fixtures.py`: reusable valid and invalid executable packages.
- Create `backend/tests/test_schemas.py`: schema validation tests.
- Create `backend/tests/test_module_registry.py`: whitelist registry tests.
- Create `backend/tests/test_graph_compiler.py`: topology compilation tests.
- Create `backend/tests/test_fault_runtime.py`: fault behavior tests.
- Create `backend/tests/test_simulation_engine.py`: full simulation engine tests.
- Create `backend/tests/test_server.py`: HTTP API tests.
- Create `src/services/backendExecutablePackageService.js`: strip UI-only state and build backend executable packages.
- Create `src/services/backendSimulationClient.js`: call backend API and normalize response/errors.
- Create `tests/backend-executable-package-service.spec.js`: frontend export tests.
- Create `tests/backend-simulation-client.spec.js`: frontend client tests.
- Modify `package.json`: no dependency changes; keep existing scripts.
- Optional modify `src/services/simulationRuntime.js`: expose backend client under the runtime facade after service tests pass.

Implementation order is backend core first, HTTP second, frontend service third. Do not modify `src/services/legacy-runtime.txt` in this first implementation plan.

## Commands

Backend tests:

```powershell
python -m unittest discover backend.tests -v
```

Frontend service tests:

```powershell
npm.cmd test -- --run tests\backend-executable-package-service.spec.js tests\backend-simulation-client.spec.js
```

Regression tests:

```powershell
npm.cmd test -- --run tests\python-binding.spec.js tests\flight-model-package.spec.js
```

Build:

```powershell
npm.cmd run build
```

---

### Task 1: Backend Error Model And Schema Validator

**Files:**
- Create: `backend/__init__.py`
- Create: `backend/schemas.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/fixtures.py`
- Create: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing fixture and schema tests**

Create `backend/tests/fixtures.py`:

```python
def valid_package():
    return {
        "schemaVersion": 1,
        "packageId": "test-package",
        "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
        "nodes": [
            {
                "id": "source-1",
                "type": "signal_source",
                "parameters": {"value": 1.0},
                "outputs": [{"name": "out"}],
            },
            {
                "id": "sim-1",
                "type": "simulation_block",
                "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                "parameters": {},
                "inputs": [{"name": "input"}],
                "outputs": [{"name": "output"}],
            },
            {
                "id": "scope-1",
                "type": "instrument_scope",
                "inputs": [{"name": "CH1"}],
            },
        ],
        "edges": [
            {
                "id": "edge-source-sim",
                "sourceNodeId": "source-1",
                "sourcePortIndex": 0,
                "targetNodeId": "sim-1",
                "targetPortIndex": 0,
            },
            {
                "id": "edge-sim-scope",
                "sourceNodeId": "sim-1",
                "sourcePortIndex": 0,
                "targetNodeId": "scope-1",
                "targetPortIndex": 0,
            },
        ],
        "faultInstances": [],
        "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
    }
```

Create empty `backend/__init__.py` and `backend/tests/__init__.py`.

Create `backend/tests/test_schemas.py`:

```python
import unittest

from backend.schemas import SimulationBackendError, validate_executable_package
from backend.tests.fixtures import valid_package


class SchemaValidationTests(unittest.TestCase):
    def test_accepts_valid_executable_package(self):
        package = valid_package()

        result = validate_executable_package(package)

        self.assertIs(result, package)

    def test_rejects_unsupported_node_type(self):
        package = valid_package()
        package["nodes"].append({"id": "bad-1", "type": "ui_panel"})

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "UNSUPPORTED_NODE_TYPE")
        self.assertEqual(context.exception.field, "nodes[3].type")

    def test_rejects_invalid_duration_limit(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 120

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(context.exception.field, "simulationConfig.duration")

    def test_rejects_non_numeric_parameter(self):
        package = valid_package()
        package["nodes"][0]["parameters"]["value"] = "fast"

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
        self.assertEqual(context.exception.field, "nodes[0].parameters.value")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_schemas -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.schemas'`.

- [ ] **Step 3: Implement the schema validator**

Create `backend/schemas.py`:

```python
import math


SUPPORTED_NODE_TYPES = {
    "signal_source",
    "flow_block",
    "simulation_block",
    "gain_block",
    "sum_block",
    "mux_block",
    "instrument_scope",
}

LIMITS = {
    "max_duration": 60.0,
    "min_step_size": 0.001,
    "max_step_size": 1.0,
    "max_nodes": 200,
    "max_edges": 400,
    "max_faults": 50,
    "max_measurement_points": 100,
}


class SimulationBackendError(Exception):
    def __init__(self, error_code, field, message):
        super().__init__(message)
        self.error_code = error_code
        self.field = field
        self.message = message

    def to_response(self, run_id=""):
        return {
            "runId": run_id,
            "status": "error",
            "errorCode": self.error_code,
            "field": self.field,
            "message": self.message,
        }


def ensure_mapping(value, field):
    if not isinstance(value, dict):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be an object")
    return value


def ensure_list(value, field):
    if not isinstance(value, list):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be an array")
    return value


def ensure_number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise SimulationBackendError("INVALID_SCHEMA", field, f"{field} must be a finite number")
    return float(value)


def validate_numeric_parameters(parameters, field):
    if parameters is None:
        return {}
    ensure_mapping(parameters, field)
    for key, value in parameters.items():
        ensure_number(value, f"{field}.{key}")
    return parameters


def validate_executable_package(package):
    ensure_mapping(package, "request")
    if package.get("schemaVersion") != 1:
        raise SimulationBackendError("INVALID_SCHEMA", "schemaVersion", "schemaVersion must be 1")

    config = ensure_mapping(package.get("simulationConfig"), "simulationConfig")
    duration = ensure_number(config.get("duration"), "simulationConfig.duration")
    step_size = ensure_number(config.get("stepSize"), "simulationConfig.stepSize")
    if duration <= 0 or duration > LIMITS["max_duration"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "simulationConfig.duration", "duration is outside the allowed range")
    if step_size < LIMITS["min_step_size"] or step_size > LIMITS["max_step_size"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "simulationConfig.stepSize", "stepSize is outside the allowed range")

    nodes = ensure_list(package.get("nodes"), "nodes")
    edges = ensure_list(package.get("edges"), "edges")
    faults = ensure_list(package.get("faultInstances", []), "faultInstances")
    measurement_points = ensure_list(package.get("measurementPoints", []), "measurementPoints")

    if len(nodes) > LIMITS["max_nodes"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "nodes", "too many nodes")
    if len(edges) > LIMITS["max_edges"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "edges", "too many edges")
    if len(faults) > LIMITS["max_faults"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "faultInstances", "too many fault instances")
    if len(measurement_points) > LIMITS["max_measurement_points"]:
        raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "measurementPoints", "too many measurement points")

    for index, node in enumerate(nodes):
        ensure_mapping(node, f"nodes[{index}]")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise SimulationBackendError("INVALID_SCHEMA", f"nodes[{index}].id", "node id is required")
        node_type = node.get("type")
        if node_type not in SUPPORTED_NODE_TYPES:
            raise SimulationBackendError("UNSUPPORTED_NODE_TYPE", f"nodes[{index}].type", f"unsupported node type: {node_type}")
        validate_numeric_parameters(node.get("parameters", {}), f"nodes[{index}].parameters")

    return package
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_schemas -v
```

Expected: PASS all 4 tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/__init__.py backend/schemas.py backend/tests/__init__.py backend/tests/fixtures.py backend/tests/test_schemas.py
git commit -m "Add simulation backend schema validation"
```

Expected: commit succeeds.

---

### Task 2: Backend Whitelist Module Registry

**Files:**
- Create: `backend/module_registry.py`
- Create: `backend/builtin_modules/__init__.py`
- Create: `backend/builtin_modules/passthrough.py`
- Create: `backend/builtin_modules/gain.py`
- Create: `backend/builtin_modules/manifest.json`
- Create: `backend/tests/test_module_registry.py`

- [ ] **Step 1: Write the failing registry tests**

Create `backend/tests/test_module_registry.py`:

```python
import unittest

from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError


class ModuleRegistryTests(unittest.TestCase):
    def test_resolves_registered_module_and_executes_entry(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("passthrough")

        result = module.call({"input": 2.5}, {})

        self.assertEqual(result["outputs"]["output"], 2.5)

    def test_rejects_unknown_module_id(self):
        registry = ModuleRegistry.from_builtin_manifest()

        with self.assertRaises(SimulationBackendError) as context:
            registry.require("missing")

        self.assertEqual(context.exception.error_code, "MODULE_NOT_WHITELISTED")
        self.assertEqual(context.exception.field, "pythonBinding.moduleId")

    def test_rejects_out_of_range_parameter(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("gain")

        with self.assertRaises(SimulationBackendError) as context:
            module.call({"input": 1.0}, {"gain": 100.0})

        self.assertEqual(context.exception.error_code, "PARAM_OUT_OF_RANGE")
        self.assertEqual(context.exception.field, "parameters.gain")

    def test_gain_module_uses_parameter(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("gain")

        result = module.call({"input": 3.0}, {"gain": 2.0})

        self.assertEqual(result["outputs"]["output"], 6.0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_module_registry -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.module_registry'`.

- [ ] **Step 3: Add builtin modules and manifest**

Create empty `backend/builtin_modules/__init__.py`.

Create `backend/builtin_modules/passthrough.py`:

```python
def process(input=0.0):
    return {"output": float(input)}
```

Create `backend/builtin_modules/gain.py`:

```python
def process(input=0.0, gain=1.0):
    return {"output": float(input) * float(gain)}
```

Create `backend/builtin_modules/manifest.json`:

```json
{
  "modules": [
    {
      "moduleId": "passthrough",
      "importPath": "backend.builtin_modules.passthrough",
      "entryFunction": "process",
      "inputs": ["input"],
      "outputs": ["output"],
      "parameters": {}
    },
    {
      "moduleId": "gain",
      "importPath": "backend.builtin_modules.gain",
      "entryFunction": "process",
      "inputs": ["input"],
      "outputs": ["output"],
      "parameters": {
        "gain": {"type": "number", "min": -20, "max": 20, "default": 1}
      }
    }
  ]
}
```

- [ ] **Step 4: Implement the module registry**

Create `backend/module_registry.py`:

```python
import importlib
import json
from dataclasses import dataclass
from pathlib import Path

from backend.schemas import SimulationBackendError, ensure_number


@dataclass(frozen=True)
class RegisteredModule:
    module_id: str
    import_path: str
    entry_function: str
    inputs: tuple
    outputs: tuple
    parameters: dict

    def call(self, inputs, parameters):
        resolved_parameters = self._resolve_parameters(parameters or {})
        module = importlib.import_module(self.import_path)
        entry = getattr(module, self.entry_function, None)
        if not callable(entry):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "pythonBinding.entryFunction", f"entry function not found: {self.entry_function}")

        kwargs = {name: ensure_number(inputs.get(name, 0.0), f"inputs.{name}") for name in self.inputs}
        kwargs.update(resolved_parameters)
        result = entry(**kwargs)
        if not isinstance(result, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult", "module result must be an output mapping")
        return {"outputs": {name: ensure_number(result.get(name, 0.0), f"outputs.{name}") for name in self.outputs}}

    def _resolve_parameters(self, parameters):
        resolved = {}
        for name, spec in self.parameters.items():
            value = parameters.get(name, spec.get("default", 0.0))
            numeric = ensure_number(value, f"parameters.{name}")
            minimum = spec.get("min")
            maximum = spec.get("max")
            if minimum is not None and numeric < float(minimum):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is below minimum")
            if maximum is not None and numeric > float(maximum):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is above maximum")
            resolved[name] = numeric
        return resolved


class ModuleRegistry:
    def __init__(self, modules):
        self.modules = {module.module_id: module for module in modules}

    @classmethod
    def from_builtin_manifest(cls):
        manifest_path = Path(__file__).parent / "builtin_modules" / "manifest.json"
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        modules = [
            RegisteredModule(
                module_id=item["moduleId"],
                import_path=item["importPath"],
                entry_function=item.get("entryFunction", "process"),
                inputs=tuple(item.get("inputs", [])),
                outputs=tuple(item.get("outputs", [])),
                parameters=item.get("parameters", {}),
            )
            for item in data.get("modules", [])
        ]
        return cls(modules)

    def require(self, module_id, field="pythonBinding.moduleId"):
        module = self.modules.get(module_id)
        if not module:
            raise SimulationBackendError("MODULE_NOT_WHITELISTED", field, f"moduleId {module_id} is not registered on backend")
        return module
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_module_registry -v
```

Expected: PASS all 4 tests.

- [ ] **Step 6: Commit**

Run:

```powershell
git add backend/module_registry.py backend/builtin_modules backend/tests/test_module_registry.py
git commit -m "Add backend whitelist module registry"
```

Expected: commit succeeds.

---

### Task 3: Graph Compiler

**Files:**
- Create: `backend/graph_compiler.py`
- Create: `backend/tests/test_graph_compiler.py`
- Modify: `backend/tests/fixtures.py`

- [ ] **Step 1: Write the failing graph compiler tests**

Create `backend/tests/test_graph_compiler.py`:

```python
import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.tests.fixtures import valid_package


class GraphCompilerTests(unittest.TestCase):
    def test_compiles_nodes_edges_and_scope_bindings(self):
        package = valid_package()
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(len(graph.nodes), 3)
        self.assertEqual(len(graph.edges), 2)
        self.assertEqual(graph.measurements[0].scope_node_id, "scope-1")
        self.assertEqual(graph.nodes["sim-1"].module.module_id, "passthrough")

    def test_rejects_missing_edge_endpoint(self):
        package = valid_package()
        package["edges"][0]["targetNodeId"] = "missing-node"

        with self.assertRaises(SimulationBackendError) as context:
            compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(context.exception.error_code, "EDGE_ENDPOINT_NOT_FOUND")
        self.assertEqual(context.exception.field, "edges[0].targetNodeId")

    def test_rejects_duplicate_input_port(self):
        package = valid_package()
        package["edges"].append({
            "id": "edge-source-sim-duplicate",
            "sourceNodeId": "source-1",
            "sourcePortIndex": 0,
            "targetNodeId": "sim-1",
            "targetPortIndex": 0,
        })

        with self.assertRaises(SimulationBackendError) as context:
            compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(context.exception.error_code, "INPUT_PORT_CONFLICT")
        self.assertEqual(context.exception.field, "edges[2].targetPortIndex")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_graph_compiler -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.graph_compiler'`.

- [ ] **Step 3: Implement graph compiler dataclasses**

Create `backend/graph_compiler.py`:

```python
from dataclasses import dataclass

from backend.schemas import SimulationBackendError, validate_executable_package


@dataclass(frozen=True)
class ExecutableNode:
    id: str
    type: str
    parameters: dict
    module: object = None


@dataclass(frozen=True)
class ExecutableEdge:
    id: str
    source_node_id: str
    source_port_index: int
    target_node_id: str
    target_port_index: int


@dataclass(frozen=True)
class MeasurementBinding:
    id: str
    scope_node_id: str
    channel: str


@dataclass(frozen=True)
class ExecutableGraph:
    nodes: dict
    edges: list
    incoming: dict
    measurements: list
    fault_instances: list
    duration: float
    step_size: float


def _edge_port(edge, key):
    value = edge.get(key, 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def compile_graph(package, registry):
    validate_executable_package(package)
    raw_nodes = package["nodes"]
    nodes = {}
    for index, node in enumerate(raw_nodes):
        module = None
        if node["type"] == "simulation_block":
            binding = node.get("pythonBinding") or {}
            module_id = binding.get("moduleId")
            module = registry.require(module_id, f"nodes[{index}].pythonBinding.moduleId")
        nodes[node["id"]] = ExecutableNode(
            id=node["id"],
            type=node["type"],
            parameters=dict(node.get("parameters") or {}),
            module=module,
        )

    edges = []
    incoming = {}
    occupied_inputs = {}
    for index, edge in enumerate(package["edges"]):
        source_id = edge.get("sourceNodeId")
        target_id = edge.get("targetNodeId")
        if source_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"edges[{index}].sourceNodeId", f"source node not found: {source_id}")
        if target_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"edges[{index}].targetNodeId", f"target node not found: {target_id}")
        target_port_index = _edge_port(edge, "targetPortIndex")
        input_key = (target_id, target_port_index)
        if input_key in occupied_inputs:
            raise SimulationBackendError("INPUT_PORT_CONFLICT", f"edges[{index}].targetPortIndex", f"duplicate input connection for {target_id}:{target_port_index}")
        occupied_inputs[input_key] = edge.get("id")
        compiled = ExecutableEdge(
            id=edge.get("id", f"edge-{index}"),
            source_node_id=source_id,
            source_port_index=_edge_port(edge, "sourcePortIndex"),
            target_node_id=target_id,
            target_port_index=target_port_index,
        )
        edges.append(compiled)
        incoming.setdefault(target_id, []).append(compiled)

    measurements = []
    for index, point in enumerate(package.get("measurementPoints", [])):
        scope_node_id = point.get("scopeNodeId")
        if scope_node_id not in nodes:
            raise SimulationBackendError("EDGE_ENDPOINT_NOT_FOUND", f"measurementPoints[{index}].scopeNodeId", f"scope node not found: {scope_node_id}")
        measurements.append(MeasurementBinding(
            id=point.get("id", f"{scope_node_id}.ch1"),
            scope_node_id=scope_node_id,
            channel=point.get("channel", "ch1"),
        ))

    config = package["simulationConfig"]
    return ExecutableGraph(
        nodes=nodes,
        edges=edges,
        incoming=incoming,
        measurements=measurements,
        fault_instances=list(package.get("faultInstances", [])),
        duration=float(config["duration"]),
        step_size=float(config["stepSize"]),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_graph_compiler -v
```

Expected: PASS all 3 tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/graph_compiler.py backend/tests/test_graph_compiler.py
git commit -m "Add simulation graph compiler"
```

Expected: commit succeeds.

---

### Task 4: Fault Runtime

**Files:**
- Create: `backend/fault_runtime.py`
- Create: `backend/tests/test_fault_runtime.py`

- [ ] **Step 1: Write the failing fault runtime tests**

Create `backend/tests/test_fault_runtime.py`:

```python
import unittest

from backend.fault_runtime import FaultRuntime


class FaultRuntimeTests(unittest.TestCase):
    def test_sensor_bias_applies_only_in_active_window(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.1,
                "duration": 0.2,
                "parameters": {"bias": 0.5},
            }
        ])

        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.0), 1.0)
        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.1), 1.5)
        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.4), 1.0)

    def test_motor_efficiency_loss_scales_output(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-motor",
                "faultType": "motor_efficiency_loss",
                "targetId": "motor-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 1.0,
                "parameters": {"efficiency": 0.25},
            }
        ])

        self.assertEqual(runtime.apply_node_output("motor-1", 8.0, 0.1), 2.0)

    def test_link_loss_holds_previous_edge_value(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-link",
                "faultType": "link_loss",
                "targetId": "edge-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 1.0,
                "parameters": {},
            }
        ])

        self.assertEqual(runtime.apply_edge_value("edge-1", 4.0, 0.0), 4.0)
        self.assertEqual(runtime.apply_edge_value("edge-1", 9.0, 0.1), 4.0)

    def test_emits_fault_started_event_once(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.1,
                "duration": 0.2,
                "parameters": {"bias": 0.5},
            }
        ])

        self.assertEqual(runtime.collect_events(0.0), [])
        self.assertEqual(runtime.collect_events(0.1)[0]["type"], "fault_started")
        self.assertEqual(runtime.collect_events(0.2), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_fault_runtime -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.fault_runtime'`.

- [ ] **Step 3: Implement fault runtime**

Create `backend/fault_runtime.py`:

```python
class FaultRuntime:
    def __init__(self, fault_instances):
        self.fault_instances = list(fault_instances or [])
        self.edge_state = {}
        self.started_fault_ids = set()
        self.ended_fault_ids = set()

    def _is_active(self, fault, time):
        if not fault.get("enabled", True):
            return False
        start = float(fault.get("startTime", 0.0))
        duration = float(fault.get("duration", 0.0))
        end = start + max(duration, 0.0)
        return time >= start and (duration == 0.0 or time <= end)

    def apply_node_output(self, node_id, value, time):
        result = float(value)
        for fault in self.fault_instances:
            if fault.get("targetId") != node_id or not self._is_active(fault, time):
                continue
            params = fault.get("parameters") or {}
            fault_type = fault.get("faultType")
            if fault_type == "sensor_bias":
                result += float(params.get("bias", 0.0))
            elif fault_type == "noise_increase":
                amplitude = float(params.get("amplitude", 0.1))
                result += amplitude
            elif fault_type == "signal_stuck":
                result = float(params.get("value", result))
            elif fault_type == "motor_efficiency_loss":
                result *= float(params.get("efficiency", 0.5))
        return result

    def apply_edge_value(self, edge_id, value, time):
        result = float(value)
        state = self.edge_state.setdefault(edge_id, {"last": result})
        for fault in self.fault_instances:
            if fault.get("targetId") != edge_id or not self._is_active(fault, time):
                continue
            fault_type = fault.get("faultType")
            if fault_type == "link_loss":
                result = float(state.get("last", result))
            elif fault_type == "link_delay":
                queue = state.setdefault("queue", [])
                queue.append(result)
                delay_steps = int((fault.get("parameters") or {}).get("delaySteps", 1))
                result = queue.pop(0) if len(queue) > delay_steps else float(state.get("last", result))
        state["last"] = result
        return result

    def collect_events(self, time):
        events = []
        for fault in self.fault_instances:
            fault_id = fault.get("faultId", "")
            if not fault_id:
                continue
            active = self._is_active(fault, time)
            if active and fault_id not in self.started_fault_ids:
                self.started_fault_ids.add(fault_id)
                events.append({"time": time, "type": "fault_started", "relatedFaultId": fault_id})
            start = float(fault.get("startTime", 0.0))
            duration = float(fault.get("duration", 0.0))
            if duration > 0 and time > start + duration and fault_id not in self.ended_fault_ids:
                self.ended_fault_ids.add(fault_id)
                events.append({"time": time, "type": "fault_ended", "relatedFaultId": fault_id})
        return events
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_fault_runtime -v
```

Expected: PASS all 4 tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/fault_runtime.py backend/tests/test_fault_runtime.py
git commit -m "Add simulation fault runtime"
```

Expected: commit succeeds.

---

### Task 5: Simulation Engine

**Files:**
- Create: `backend/simulation_engine.py`
- Create: `backend/tests/test_simulation_engine.py`
- Modify: `backend/tests/fixtures.py`

- [ ] **Step 1: Write the failing simulation engine tests**

Create `backend/tests/test_simulation_engine.py`:

```python
import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.simulation_engine import run_simulation
from backend.tests.fixtures import valid_package


class SimulationEngineTests(unittest.TestCase):
    def test_returns_reference_and_actual_curves(self):
        graph = compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["curves"]["time"], [0.0, 0.1, 0.2])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.0, 1.0, 1.0])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [1.0, 1.0, 1.0])

    def test_actual_curve_reflects_node_fault_while_reference_stays_baseline(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.1,
            "duration": 0.2,
            "parameters": {"bias": 0.5},
        }]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [1.0, 1.0, 1.0])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.0, 1.5, 1.5])
        self.assertEqual(result["events"][0]["type"], "fault_started")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_simulation_engine -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.simulation_engine'`.

- [ ] **Step 3: Implement simulation engine**

Create `backend/simulation_engine.py`:

```python
from backend.fault_runtime import FaultRuntime


def _round_time(value):
    return round(float(value) + 0.0, 10)


def _source_value(node, time):
    params = node.parameters
    if "value" in params:
        return float(params["value"])
    amplitude = float(params.get("amplitude", 1.0))
    return amplitude


def _evaluate_node(graph, node_id, mode, time, cache, fault_runtime):
    key = (mode, node_id)
    if key in cache:
        return cache[key]

    node = graph.nodes[node_id]
    incoming_edges = graph.incoming.get(node_id, [])
    inputs = []
    for edge in incoming_edges:
        upstream = _evaluate_node(graph, edge.source_node_id, mode, time, cache, fault_runtime)
        if mode == "actual":
            upstream = fault_runtime.apply_edge_value(edge.id, upstream, time)
        inputs.append(upstream)

    if node.type == "signal_source":
        value = _source_value(node, time)
    elif node.type == "simulation_block":
        module_inputs = {}
        for index, input_name in enumerate(node.module.inputs):
            module_inputs[input_name] = inputs[index] if index < len(inputs) else 0.0
        output_map = node.module.call(module_inputs, node.parameters)["outputs"]
        value = float(output_map.get(node.module.outputs[0], 0.0)) if node.module.outputs else 0.0
    elif node.type == "gain_block":
        value = (inputs[0] if inputs else 0.0) * float(node.parameters.get("gain", 1.0))
    elif node.type == "sum_block":
        value = sum(inputs)
    elif node.type == "mux_block":
        value = inputs[0] if inputs else 0.0
    elif node.type == "instrument_scope":
        value = inputs[0] if inputs else 0.0
    else:
        value = inputs[0] if inputs else 0.0

    if mode == "actual":
        value = fault_runtime.apply_node_output(node_id, value, time)

    cache[key] = float(value)
    return cache[key]


def _time_values(duration, step_size):
    values = []
    current = 0.0
    while current < duration - 1e-12:
        values.append(_round_time(current))
        current += step_size
    return values


def run_simulation(graph, run_id=""):
    times = _time_values(graph.duration, graph.step_size)
    fault_runtime = FaultRuntime(graph.fault_instances)
    channels = {}
    for measurement in graph.measurements:
        channels[f"{measurement.id}.actual"] = []
        channels[f"{measurement.id}.reference"] = []

    events = []
    for time in times:
        cache = {}
        events.extend(fault_runtime.collect_events(time))
        for measurement in graph.measurements:
            actual = _evaluate_node(graph, measurement.scope_node_id, "actual", time, cache, fault_runtime)
            reference = _evaluate_node(graph, measurement.scope_node_id, "reference", time, cache, fault_runtime)
            channels[f"{measurement.id}.actual"].append(actual)
            channels[f"{measurement.id}.reference"].append(reference)

    return {
        "runId": run_id,
        "status": "success",
        "curves": {"time": times, "channels": channels},
        "events": events,
        "metrics": {"sampleCount": len(times)},
        "warnings": [],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_simulation_engine -v
```

Expected: PASS all 2 tests.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/simulation_engine.py backend/tests/test_simulation_engine.py
git commit -m "Add backend simulation engine"
```

Expected: commit succeeds.

---

### Task 6: HTTP Simulation API

**Files:**
- Create: `backend/server.py`
- Create: `backend/tests/test_server.py`

- [ ] **Step 1: Write the failing server tests**

Create `backend/tests/test_server.py`:

```python
import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer

from backend.server import SimulationBackendHandler
from backend.tests.fixtures import valid_package


class SimulationBackendServerTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), SimulationBackendHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    def _post(self, path, payload):
        body = json.dumps(payload)
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", path, body=body, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        response_body = response.read().decode("utf-8")
        connection.close()
        return response.status, json.loads(response_body)

    def test_runs_valid_simulation_request(self):
        status, body = self._post("/api/simulations/run", valid_package())

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertIn("scope-1.ch1.actual", body["curves"]["channels"])

    def test_returns_structured_error_for_unknown_module(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"]["moduleId"] = "unknown"

        status, body = self._post("/api/simulations/run", package)

        self.assertEqual(status, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errorCode"], "MODULE_NOT_WHITELISTED")

    def test_returns_404_for_unknown_path(self):
        status, body = self._post("/api/nope", valid_package())

        self.assertEqual(status, 404)
        self.assertEqual(body["errorCode"], "NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_server -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.server'`.

- [ ] **Step 3: Implement HTTP API**

Create `backend/server.py`:

```python
import json
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.simulation_engine import run_simulation


MAX_REQUEST_BYTES = 1_000_000


def _json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")


class SimulationBackendHandler(BaseHTTPRequestHandler):
    endpoint = "/api/simulations/run"
    registry = ModuleRegistry.from_builtin_manifest()

    def log_message(self, format, *args):
        return

    def _send_json(self, status_code, payload):
        body = _json_bytes(payload)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise SimulationBackendError("INVALID_SCHEMA", "Content-Length", "invalid Content-Length") from exc
        if length <= 0:
            raise SimulationBackendError("INVALID_SCHEMA", "request", "request body is required")
        if length > MAX_REQUEST_BYTES:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "request", "request body is too large")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SimulationBackendError("INVALID_SCHEMA", "request", "invalid JSON") from exc
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "request", "top-level JSON object is required")
        return payload

    def do_POST(self):
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        if self.path != self.endpoint:
            self._send_json(404, {"runId": run_id, "status": "error", "errorCode": "NOT_FOUND", "field": "path", "message": "not found"})
            return

        started = time.monotonic()
        try:
            payload = self._read_json()
            graph = compile_graph(payload, self.registry)
            result = run_simulation(graph, run_id=run_id)
            result["metrics"]["elapsedMs"] = round((time.monotonic() - started) * 1000, 3)
            self._send_json(200, result)
        except SimulationBackendError as exc:
            self._send_json(400, exc.to_response(run_id))
        except Exception as exc:
            self._send_json(500, {"runId": run_id, "status": "error", "errorCode": "INTERNAL_ERROR", "field": "server", "message": str(exc)})


def serve(host="127.0.0.1", port=8766):
    server = ThreadingHTTPServer((host, port), SimulationBackendHandler)
    print(f"Simulation backend listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    serve()
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest backend.tests.test_server -v
```

Expected: PASS all 3 tests.

- [ ] **Step 5: Run backend test suite**

Run:

```powershell
python -m unittest discover backend.tests -v
```

Expected: PASS all backend tests.

- [ ] **Step 6: Commit**

Run:

```powershell
git add backend/server.py backend/tests/test_server.py
git commit -m "Add simulation backend HTTP API"
```

Expected: commit succeeds.

---

### Task 7: Frontend Backend Executable Package Export

**Files:**
- Create: `src/services/backendExecutablePackageService.js`
- Create: `tests/backend-executable-package-service.spec.js`

- [ ] **Step 1: Write the failing frontend export tests**

Create `tests/backend-executable-package-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';

describe('backendExecutablePackageService', () => {
  it('exports only backend executable canvas state', () => {
    const state = {
      packageId: 'pkg-1',
      simulationConfig: { duration: 1, stepSize: 0.1 },
      selectedNodeId: 'sim-1',
      viewport: { scale: 1.5 },
      modelNodes: [
        {
          id: 'source-1',
          type: 'signal_source',
          x: 100,
          y: 200,
          props: { value: 1 },
          outputs: [{ name: 'out' }]
        },
        {
          id: 'sim-1',
          type: 'simulation_block',
          props: { kp: 4.5 },
          pythonBinding: { moduleId: 'passthrough', entryFunction: 'process', rawSource: 'def process(): pass' },
          inputs: [{ name: 'input' }],
          outputs: [{ name: 'output' }]
        },
        {
          id: 'scope-1',
          type: 'instrument_scope',
          props: {},
          inputs: [{ name: 'CH1' }]
        }
      ],
      modelEdges: [
        { id: 'edge-1', sourceNodeId: 'source-1', sourcePortIndex: 0, targetNodeId: 'sim-1', targetPortIndex: 0 },
        { id: 'edge-2', sourceNodeId: 'sim-1', sourcePortIndex: 0, targetNodeId: 'scope-1', targetPortIndex: 0 }
      ],
      faultInstances: [],
      measurementPoints: [{ id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' }]
    };

    const pkg = buildBackendExecutablePackage(state);

    expect(pkg.schemaVersion).toBe(1);
    expect(pkg.nodes[0]).toEqual({
      id: 'source-1',
      type: 'signal_source',
      parameters: { value: 1 },
      inputs: [],
      outputs: [{ name: 'out' }]
    });
    expect(pkg.nodes[1].pythonBinding).toEqual({ moduleId: 'passthrough', entryFunction: 'process' });
    expect(JSON.stringify(pkg)).not.toContain('rawSource');
    expect(JSON.stringify(pkg)).not.toContain('selectedNodeId');
    expect(JSON.stringify(pkg)).not.toContain('viewport');
    expect(JSON.stringify(pkg)).not.toContain('"x"');
  });

  it('uses default simulation config when state omits it', () => {
    const pkg = buildBackendExecutablePackage({ modelNodes: [], modelEdges: [] });

    expect(pkg.simulationConfig).toEqual({ duration: 10, stepSize: 0.1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests\backend-executable-package-service.spec.js
```

Expected: FAIL because `src/services/backendExecutablePackageService.js` does not exist.

- [ ] **Step 3: Implement backend executable package export**

Create `src/services/backendExecutablePackageService.js`:

```js
const SUPPORTED_NODE_TYPES = new Set([
  'signal_source',
  'flow_block',
  'simulation_block',
  'gain_block',
  'sum_block',
  'mux_block',
  'instrument_scope'
]);

function sanitizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function pickNumericParameters(props = {}) {
  return Object.fromEntries(
    Object.entries(props)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function normalizePorts(ports = []) {
  return Array.isArray(ports)
    ? ports.map((port) => ({ name: String(port?.name ?? port?.label ?? '') })).filter((port) => port.name)
    : [];
}

function normalizeNode(node) {
  const normalized = {
    id: String(node.id),
    type: node.type,
    parameters: pickNumericParameters(node.props ?? node.parameters ?? {}),
    inputs: normalizePorts(node.inputs ?? node.props?.inputs),
    outputs: normalizePorts(node.outputs ?? node.props?.outputs)
  };

  if (node.type === 'simulation_block') {
    normalized.pythonBinding = {
      moduleId: String(node.pythonBinding?.moduleId ?? ''),
      entryFunction: String(node.pythonBinding?.entryFunction ?? 'process')
    };
  }

  return normalized;
}

function normalizeEdge(edge) {
  return {
    id: String(edge.id),
    sourceNodeId: String(edge.sourceNodeId),
    sourcePortIndex: sanitizeNumber(edge.sourcePortIndex, 0),
    targetNodeId: String(edge.targetNodeId),
    targetPortIndex: sanitizeNumber(edge.targetPortIndex, 0)
  };
}

export function buildBackendExecutablePackage(state = {}) {
  const simulationConfig = state.simulationConfig ?? {};
  return {
    schemaVersion: 1,
    packageId: String(state.packageId ?? state.modelPackageId ?? 'frontend-package'),
    simulationConfig: {
      duration: sanitizeNumber(simulationConfig.duration, 10),
      stepSize: sanitizeNumber(simulationConfig.stepSize, 0.1)
    },
    nodes: (state.modelNodes ?? state.nodes ?? [])
      .filter((node) => node?.id && SUPPORTED_NODE_TYPES.has(node.type))
      .map(normalizeNode),
    edges: (state.modelEdges ?? state.edges ?? []).map(normalizeEdge),
    faultInstances: Array.isArray(state.faultInstances) ? state.faultInstances.map((fault) => ({ ...fault })) : [],
    measurementPoints: Array.isArray(state.measurementPoints) ? state.measurementPoints.map((point) => ({ ...point })) : []
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- --run tests\backend-executable-package-service.spec.js
```

Expected: PASS all tests in the file.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/services/backendExecutablePackageService.js tests/backend-executable-package-service.spec.js
git commit -m "Add backend executable package export"
```

Expected: commit succeeds.

---

### Task 8: Frontend Backend Simulation Client

**Files:**
- Create: `src/services/backendSimulationClient.js`
- Create: `tests/backend-simulation-client.spec.js`

- [ ] **Step 1: Write the failing client tests**

Create `tests/backend-simulation-client.spec.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { runBackendSimulation } from '../src/services/backendSimulationClient.js';

describe('backendSimulationClient', () => {
  it('posts executable package to backend endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', curves: { time: [], channels: {} }, events: [], metrics: {}, warnings: [] })
    }));
    const pkg = { schemaVersion: 1 };

    const result = await runBackendSimulation(pkg, { fetchImpl, endpoint: '/api/simulations/run' });

    expect(result.status).toBe('success');
    expect(fetchImpl).toHaveBeenCalledWith('/api/simulations/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg)
    });
  });

  it('throws structured backend errors', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: 'error', errorCode: 'MODULE_NOT_WHITELISTED', field: 'nodes[1]', message: 'bad module' })
    }));

    await expect(runBackendSimulation({}, { fetchImpl })).rejects.toMatchObject({
      errorCode: 'MODULE_NOT_WHITELISTED',
      field: 'nodes[1]',
      message: 'bad module'
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests\backend-simulation-client.spec.js
```

Expected: FAIL because `src/services/backendSimulationClient.js` does not exist.

- [ ] **Step 3: Implement backend simulation client**

Create `src/services/backendSimulationClient.js`:

```js
export class BackendSimulationError extends Error {
  constructor(payload) {
    super(payload?.message ?? 'Backend simulation failed');
    this.name = 'BackendSimulationError';
    this.status = payload?.status ?? 'error';
    this.errorCode = payload?.errorCode ?? 'BACKEND_SIMULATION_FAILED';
    this.field = payload?.field ?? '';
    this.runId = payload?.runId ?? '';
  }
}

export async function runBackendSimulation(
  executablePackage,
  { endpoint = '/api/simulations/run', fetchImpl = globalThis.fetch } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(executablePackage)
  });
  const payload = await response.json();

  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }

  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- --run tests\backend-simulation-client.spec.js
```

Expected: PASS all tests in the file.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/services/backendSimulationClient.js tests/backend-simulation-client.spec.js
git commit -m "Add backend simulation client"
```

Expected: commit succeeds.

---

### Task 9: Runtime Facade Exposure

**Files:**
- Modify: `src/services/simulationRuntime.js`
- Create: `tests/backend-simulation-runtime-facade.spec.js`

- [ ] **Step 1: Write the failing facade test**

Create `tests/backend-simulation-runtime-facade.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import { createSimulationRuntimeFacade } from '../src/services/simulationRuntime.js';

describe('simulationRuntime backend facade', () => {
  it('exposes backend package export and backend run client', () => {
    const facade = createSimulationRuntimeFacade();

    expect(typeof facade.backend.buildExecutablePackage).toBe('function');
    expect(typeof facade.backend.runSimulation).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- --run tests\backend-simulation-runtime-facade.spec.js
```

Expected: FAIL because `facade.backend` is undefined.

- [ ] **Step 3: Expose backend services through the facade**

Modify `src/services/simulationRuntime.js` imports:

```js
import { buildBackendExecutablePackage } from './backendExecutablePackageService.js';
import { runBackendSimulation } from './backendSimulationClient.js';
```

Inside the object returned by `createSimulationRuntimeFacade()`, add:

```js
    backend: {
      buildExecutablePackage: buildBackendExecutablePackage,
      runSimulation: runBackendSimulation
    },
```

At the bottom where browser globals are assigned, add:

```js
  window.__GZ_BACKEND_SIMULATION__ = {
    buildExecutablePackage: buildBackendExecutablePackage,
    runSimulation: runBackendSimulation
  };
```

- [ ] **Step 4: Run facade test to verify it passes**

Run:

```powershell
npm.cmd test -- --run tests\backend-simulation-runtime-facade.spec.js
```

Expected: PASS.

- [ ] **Step 5: Run frontend service tests**

Run:

```powershell
npm.cmd test -- --run tests\backend-executable-package-service.spec.js tests\backend-simulation-client.spec.js tests\backend-simulation-runtime-facade.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/services/simulationRuntime.js tests/backend-simulation-runtime-facade.spec.js
git commit -m "Expose backend simulation services"
```

Expected: commit succeeds.

---

### Task 10: End-To-End Verification And Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `docs/platform-file-map.md`

- [ ] **Step 1: Add backend usage documentation**

Append this section to `README.md`:

```markdown
## Backend Simulation API

The first backend simulation service runs a restricted executable model package exported from the frontend canvas. Python execution is limited to modules registered in `backend/builtin_modules/manifest.json`; Python source embedded in a frontend model package is not executed.

Run backend tests:

```powershell
python -m unittest discover backend.tests -v
```

Start the local backend:

```powershell
python -m backend.server
```

Endpoint:

```text
POST http://127.0.0.1:8766/api/simulations/run
```
```

In `docs/platform-file-map.md`, add a short backend section:

```markdown
## Backend Simulation Service

`backend/` contains the restricted model-package simulation backend. It validates executable packages, resolves whitelisted Python modules, compiles supported canvas graphs, runs reference and actual simulations, and serves `POST /api/simulations/run`.
```

- [ ] **Step 2: Run full backend tests**

Run:

```powershell
python -m unittest discover backend.tests -v
```

Expected: PASS all backend tests.

- [ ] **Step 3: Run frontend service and focused regression tests**

Run:

```powershell
npm.cmd test -- --run tests\backend-executable-package-service.spec.js tests\backend-simulation-client.spec.js tests\backend-simulation-runtime-facade.spec.js tests\python-binding.spec.js tests\flight-model-package.spec.js
```

Expected: PASS.

- [ ] **Step 4: Build frontend**

Run:

```powershell
npm.cmd run build
```

Expected: PASS. A Vite chunk-size warning is acceptable if it matches the current project behavior.

- [ ] **Step 5: Inspect status**

Run:

```powershell
git status --short
```

Expected: only `README.md` and `docs/platform-file-map.md` are modified in this task.

- [ ] **Step 6: Commit**

Run:

```powershell
git add README.md docs/platform-file-map.md
git commit -m "Document simulation backend service"
```

Expected: commit succeeds.

---

## Final Verification

After all tasks are complete, run:

```powershell
python -m unittest discover backend.tests -v
npm.cmd test -- --run tests\backend-executable-package-service.spec.js tests\backend-simulation-client.spec.js tests\backend-simulation-runtime-facade.spec.js tests\python-binding.spec.js tests\flight-model-package.spec.js
npm.cmd run build
git status --short
```

Expected:

- backend tests pass
- frontend focused tests pass
- build passes
- `git status --short` shows only pre-existing unrelated worktree changes, if any

Do not claim completion if any new backend or frontend test fails.

