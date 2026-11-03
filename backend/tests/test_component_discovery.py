import json
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import component_discovery
from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry, clear_module_call_cache
from backend.simulation_engine import run_simulation
from backend.server import SimulationBackendHandler
from backend.tests.fixtures import valid_package


class ComponentDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.directory = self.root / "discovery_test_components"
        self.directory.mkdir()
        (self.directory / "__init__.py").write_text("", encoding="utf-8")
        sys.path.insert(0, str(self.root))
        self.patches = [
            patch.object(component_discovery, "COMPONENT_DIRECTORY", self.directory),
            patch.object(component_discovery, "COMPONENT_PACKAGE", "discovery_test_components"),
        ]
        for item in self.patches:
            item.start()
        self.metadata = {
            "moduleId": "discovered_test_gain", "name": "测试增益", "category": "传感器",
            "inputs": [{"varName": "signal", "name": "信号"}], "outputs": ["adjusted"],
            "parameters": {"gain": {"name": "增益", "default": 3, "min": -10, "max": 10}},
        }

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        clear_module_call_cache()
        sys.path.pop(0)
        for name in list(sys.modules):
            if name == "discovery_test_components" or name.startswith("discovery_test_components."):
                sys.modules.pop(name, None)
        self.temporary.cleanup()

    def write_component(self, name="gain_component", metadata=None, source=None):
        metadata = self.metadata if metadata is None else metadata
        source = source or 'def process(signal, gain):\n    return {"outputs": {"adjusted": signal * gain}}\n'
        (self.directory / f"{name}.py").write_text(f"COMPONENT = {metadata!r}\n\n{source}", encoding="utf-8")

    def registry(self):
        return ModuleRegistry.from_manifests([ModuleRegistry.builtin_manifest_path()], discover=True)

    def test_single_file_is_discovered_and_executable_without_manifest_changes(self):
        manifest = ModuleRegistry.builtin_manifest_path().read_bytes()
        self.write_component()
        registry = self.registry()
        self.assertEqual(registry.discovery_errors, [])
        module = registry.require("discovered_test_gain")
        self.assertEqual(module.call({"signal": 4}, {})["outputs"]["adjusted"], 12)
        self.assertEqual(module.prepare().call({"signal": 2}, {"gain": 4})["outputs"]["adjusted"], 8)
        component = registry.discovered_components[0]
        self.assertEqual(component["inputs"][0]["portId"], "input-0")
        self.assertEqual(component["parameters"][0]["default"], 3)
        self.assertEqual(ModuleRegistry.builtin_manifest_path().read_bytes(), manifest)

    def test_bad_components_do_not_hide_valid_components(self):
        self.write_component()
        self.write_component("duplicate", {**self.metadata, "moduleId": "gain"})
        self.write_component("bad_signature", {**self.metadata, "moduleId": "wrong"}, "def process(other):\n    return {}\n")
        (self.directory / "syntax_error.py").write_text("COMPONENT = {", encoding="utf-8")
        registry = self.registry()
        self.assertEqual(len(registry.discovered_components), 1)
        self.assertEqual({item["fileName"] for item in registry.discovery_errors}, {"duplicate.py", "bad_signature.py", "syntax_error.py"})
        self.assertEqual(registry.require("gain").call({"input": 2}, {"gain": 2})["outputs"]["output"], 4)

    def test_metadata_reading_does_not_execute_module_code(self):
        self.write_component(source='raise RuntimeError("not imported during discovery")\ndef process(signal, gain):\n    return {}\n')
        records, components, errors = component_discovery.discover_components()
        self.assertEqual(errors, [])
        self.assertEqual(len(components), 1)
        self.assertEqual(records[0]["moduleId"], "discovered_test_gain")

    def test_electrical_group_and_menu_are_discovered_and_executable(self):
        self.write_component(metadata={**self.metadata, "group": "electrical", "paletteMenu": "power-conversion"})
        registry = self.registry()
        self.assertEqual(registry.discovery_errors, [])
        self.assertEqual(registry.discovered_components[0]["group"], "electrical")
        self.assertEqual(registry.discovered_components[0]["paletteMenu"], "power-conversion")
        self.assertEqual(registry.require("discovered_test_gain").call({"signal": 4}, {})["outputs"]["adjusted"], 12)

    def test_explicit_builtin_replacement_preserves_id_and_runs_external_source(self):
        metadata = {
            "moduleId": "electrical_dc_power_source", "name": "外部直流电源", "group": "electrical",
            "replacesBuiltin": True, "inputs": [], "outputs": ["dc_output"],
            "parameters": {"output_voltage": {"default": 36}},
        }
        self.write_component(metadata=metadata, source='def process(output_voltage=36):\n    return {"dc_output": output_voltage + 1}\n')
        registry = self.registry()
        self.assertEqual(registry.discovery_errors, [])
        module = registry.require("electrical_dc_power_source")
        self.assertEqual(module.import_path, "discovery_test_components.gain_component")
        self.assertEqual(module.call({}, {})["outputs"]["dc_output"], 37)
        self.write_component("second", metadata, 'def process(output_voltage=36):\n    return {"dc_output": 0}\n')
        self.assertEqual(len(self.registry().discovery_errors), 1)
        (self.directory / "gain_component.py").unlink()
        (self.directory / "second.py").unlink()
        self.assertEqual(self.registry().require("electrical_dc_power_source").call({}, {})["outputs"]["dc_output"], 28)

    def test_external_simulation_can_replace_builtin_interfaces_without_renaming_id(self):
        for module_id in ("gain", "11"):
            with self.subTest(module_id=module_id):
                self.write_component(metadata={**self.metadata, "moduleId": module_id, "replacesBuiltin": True})
                registry = self.registry()
                self.assertEqual(registry.discovery_errors, [])
                module = registry.require(module_id)
                self.assertEqual(module.import_path, "discovery_test_components.gain_component")
                self.assertEqual(module.call({"signal": 4}, {})["outputs"]["adjusted"], 12)
                self.assertEqual(registry.discovered_components[0]["templateId"], module_id)

    def test_replacement_can_add_new_ids_but_cannot_override_custom_registered_modules(self):
        self.write_component(metadata={**self.metadata, "replacesBuiltin": True})
        self.assertEqual(self.registry().discovery_errors, [])
        custom_manifest = self.root / "custom-manifest.json"
        custom_manifest.write_text(json.dumps({"modules": [{
            "moduleId": self.metadata["moduleId"], "importPath": "persistent_custom.gain",
            "inputs": ["signal"], "outputs": ["adjusted"], "parameters": {},
        }]}), encoding="utf-8")
        registry = ModuleRegistry.from_manifests([ModuleRegistry.builtin_manifest_path(), custom_manifest], discover=True)
        self.assertEqual(len(registry.discovery_errors), 1)
        self.assertIn("custom module", registry.discovery_errors[0]["message"])
        self.assertEqual(registry.require(self.metadata["moduleId"]).import_path, "persistent_custom.gain")

    def test_rejects_invalid_parameter_contracts_and_overlapping_arguments(self):
        cases = [
            {**self.metadata, "moduleId": ""},
            {**self.metadata, "moduleId": "__proto__"},
            {**self.metadata, "templateId": ""},
            {**self.metadata, "group": "unknown"},
            {**self.metadata, "group": []},
            {**self.metadata, "replacesBuiltin": "true"},
            {**self.metadata, "paletteMenu": []},
            {**self.metadata, "parameters": {"gain": {"default": 5, "max": 2}}},
            {**self.metadata, "parameters": {"signal": {"default": 1}}},
            {**self.metadata, "parameters": {"gain": {"default": [1], "type": "vector", "vectorLength": 2}}},
            {**self.metadata, "inputs": [], "outputs": []},
        ]
        for metadata in cases:
            with self.subTest(metadata=metadata):
                self.write_component(metadata=metadata)
                registry = self.registry()
                self.assertEqual(len(registry.discovery_errors), 1)
                self.assertEqual(registry.discovered_components, [])

    def test_vector_and_stateful_components(self):
        self.write_component(metadata={
            "name": "向量增益", "inputs": [{"varName": "signal", "type": "vector", "vectorLength": 2}],
            "outputs": [{"varName": "adjusted", "type": "vector", "vectorLength": 2}],
            "parameters": {"gain": {"default": 2}},
        }, source='def process(signal, gain, time=0, dt=0, state=None):\n    return {"outputs": {"adjusted": [x * gain for x in signal]}, "state": {"time": time}}\n')
        registry = self.registry()
        self.assertEqual(registry.discovery_errors, [])
        result = registry.require("gain_component").call({"signal": [2, 4]}, {}, time=1)
        self.assertEqual(result["outputs"]["adjusted"], [4, 8])
        self.assertEqual(result["state"], {"time": 1})

    def test_http_catalog_and_simulation_use_same_discovered_registry(self):
        self.write_component(metadata={**self.metadata, "group": "electrical", "paletteMenu": "power-conversion"})
        handler = type("DiscoveryTestHandler", (SimulationBackendHandler,), {"registry": self.registry()})
        server = HTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request("GET", "/api/components/discovered")
            response = connection.getresponse()
            catalog = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertEqual(catalog["components"][0]["moduleId"], "discovered_test_gain")
            self.assertEqual(catalog["components"][0]["group"], "electrical")
            self.assertEqual(catalog["errors"], [])
            package = valid_package()
            package["nodes"][1]["pythonBinding"]["moduleId"] = "discovered_test_gain"
            connection.request("POST", "/api/simulations/run", json.dumps(package), {"Content-Type": "application/json"})
            response = connection.getresponse()
            result = json.loads(response.read())
            self.assertEqual(response.status, 200, result)
            self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [3.0, 3.0, 3.0])
            self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [3.0, 3.0, 3.0])
            package["faultInstances"] = [{
                "faultId": "test-bias", "faultType": "sensor_bias", "targetId": "sim-1",
                "enabled": True, "startTime": 0, "parameters": {"bias": 0.5},
            }]
            connection.request("POST", "/api/simulations/run", json.dumps(package), {"Content-Type": "application/json"})
            response = connection.getresponse()
            result = json.loads(response.read())
            self.assertEqual(response.status, 200, result)
            self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [3.5, 3.5, 3.5])
            self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [3.0, 3.0, 3.0])
            connection.close()
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()

    def test_empty_default_directory_preserves_builtin_execution(self):
        directory = Path(__file__).resolve().parents[1] / "auto_components"
        with patch.object(component_discovery, "COMPONENT_DIRECTORY", directory), patch.object(
            component_discovery, "COMPONENT_PACKAGE", "backend.auto_components"
        ):
            registry = self.registry()
        self.assertEqual(registry.discovery_errors, [])
        self.assertEqual(registry.discovered_components, [])
        original = ModuleRegistry.from_builtin_manifest()
        for module_id in ("electrical_ac_power_source", "electrical_dc_power_source", "electrical_dc_boost", "electrical_ac_dc_matching"):
            with self.subTest(module_id=module_id):
                module = registry.require(module_id)
                self.assertEqual(module.import_path, f"backend.builtin_modules.{module_id}")
                for time in (0, 0.01, 0.025):
                    inputs = {name: 28 for name in module.inputs}
                    self.assertEqual(module.call(inputs, {}, time=time), original.require(module_id).call(inputs, {}, time=time))

        # Exercise the original IDs through graph execution, including the AC
        # RMS context used by the matching converter at AC zero crossings.
        ids = ["electrical_ac_power_source", "electrical_ac_dc_matching", "electrical_dc_boost", "electrical_dc_power_source"]
        nodes = []
        for module_id in ids:
            module = registry.require(module_id)
            nodes.append({
                "id": module_id, "type": "simulation_block",
                "pythonBinding": {"moduleId": module_id, "entryFunction": "process"},
                "parameters": {name: spec["default"] for name, spec in module.parameters.items()}, "powerInputs": [],
                "inputs": [{"name": name} for name in module.inputs],
                "outputs": [{"name": name} for name in module.outputs],
            })
        package = {
            "schemaVersion": 1, "packageId": "external-electrical-chain",
            "simulationConfig": {"duration": 0.02, "stepSize": 0.01},
            "nodes": nodes,
            "edges": [
                {"id": "ac-to-dc", "sourceNodeId": ids[0], "sourcePortIndex": 0, "targetNodeId": ids[1], "targetPortIndex": 0},
                {"id": "dc-to-boost", "sourceNodeId": ids[1], "sourcePortIndex": 0, "targetNodeId": ids[2], "targetPortIndex": 0},
            ],
            "faultInstances": [], "measurementPoints": [], "reportedNodeIds": ids,
        }
        result = run_simulation(compile_graph(package, registry))
        for step in result["componentOutputs"]["steps"]:
            self.assertEqual(step["actual"][ids[1]]["dc_output"], 220)
            self.assertEqual(step["actual"][ids[2]]["dc_output"], 418)
            self.assertEqual(step["actual"][ids[3]]["dc_output"], 28)
