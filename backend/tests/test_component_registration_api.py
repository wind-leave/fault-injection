import json
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path

from backend.component_registration import ComponentRegistrar
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.server import SimulationBackendHandler


class ComponentRegistrationApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.package_name = "test_registered_api_components"
        modules_dir = root / self.package_name
        modules_dir.mkdir()
        (modules_dir / "__init__.py").write_text("", encoding="utf-8")
        manifest_path = modules_dir / "manifest.json"
        manifest_path.write_text('{"modules": []}\n', encoding="utf-8")
        sys.path.insert(0, str(root))
        self.previous_registrar = SimulationBackendHandler.component_registrar
        self.previous_registry = SimulationBackendHandler.registry
        SimulationBackendHandler.component_registrar = ComponentRegistrar(modules_dir, manifest_path, self.package_name)
        SimulationBackendHandler.registry = ModuleRegistry.from_manifest(manifest_path)
        self.server = HTTPServer(("127.0.0.1", 0), SimulationBackendHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()
        SimulationBackendHandler.component_registrar = self.previous_registrar
        SimulationBackendHandler.registry = self.previous_registry
        sys.path.pop(0)
        for module_name in list(sys.modules):
            if module_name == self.package_name or module_name.startswith(f"{self.package_name}."):
                sys.modules.pop(module_name, None)
        self.temporary_directory.cleanup()

    def test_registers_component_through_the_http_api(self):
        payload = {
            "moduleId": "custom_api_gain",
            "source": """def process(signal, gain):
    adjusted = signal * gain
    return {\"outputs\": {\"adjusted\": adjusted}}
""",
            "inputs": [{"varName": "signal", "type": "number"}],
            "outputs": [{"varName": "adjusted", "type": "number"}],
            "parameters": [{"key": "gain", "type": "number", "default": 2}],
        }
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/components/register", json.dumps(payload), {"Content-Type": "application/json"})
        response = connection.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        connection.close()

        self.assertEqual(response.status, 201)
        self.assertEqual(body["component"]["moduleId"], "custom_api_gain")
        result = SimulationBackendHandler.registry.require("custom_api_gain").call({"signal": 4}, {})
        self.assertEqual(result["outputs"]["adjusted"], 8.0)

    def test_deletes_a_registered_component_through_the_http_api(self):
        payload = {
            "moduleId": "custom_api_remove",
            "source": "def process():\n    return {\"outputs\": {}}\n",
            "inputs": [], "outputs": [], "parameters": [],
        }
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/components/register", json.dumps(payload), {"Content-Type": "application/json"})
        self.assertEqual(connection.getresponse().status, 201)
        connection.close()

        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("DELETE", "/api/components/custom_api_remove")
        response = connection.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        connection.close()

        self.assertEqual(response.status, 200)
        self.assertEqual(body["component"]["moduleId"], "custom_api_remove")
        with self.assertRaises(SimulationBackendError):
            SimulationBackendHandler.registry.require("custom_api_remove")

    def test_updates_a_registered_component_through_the_http_api(self):
        module_id = "custom_api_edit"
        payload = {
            "moduleId": module_id,
            "source": "def process(value):\n    return {\"outputs\": {\"value\": value}}\n",
            "inputs": [{"varName": "value", "type": "number"}],
            "outputs": [{"varName": "value", "type": "number"}],
            "parameters": [],
        }
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/components/register", json.dumps(payload), {"Content-Type": "application/json"})
        self.assertEqual(connection.getresponse().status, 201)
        connection.close()

        payload["source"] = "def process(value):\n    return {\"outputs\": {\"doubled\": value * 2}}\n"
        payload["outputs"] = [{"varName": "doubled", "type": "number"}]
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("PUT", f"/api/components/{module_id}", json.dumps(payload), {"Content-Type": "application/json"})
        response = connection.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        connection.close()

        self.assertEqual(response.status, 200)
        self.assertEqual(body["component"]["moduleId"], module_id)
        result = SimulationBackendHandler.registry.require(module_id).call({"value": 4}, {})
        self.assertEqual(result["outputs"]["doubled"], 8.0)

    def test_deletes_multiple_registered_components_as_one_request(self):
        for module_id in ("custom_api_batch_one", "custom_api_batch_two"):
            payload = {
                "moduleId": module_id,
                "source": "def process():\n    return {\"outputs\": {}}\n",
                "inputs": [], "outputs": [], "parameters": [],
            }
            connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            connection.request("POST", "/api/components/register", json.dumps(payload), {"Content-Type": "application/json"})
            self.assertEqual(connection.getresponse().status, 201)
            connection.close()

        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request(
            "POST", "/api/components/batch-delete", json.dumps({"moduleIds": ["custom_api_batch_one", "custom_api_batch_two"]}),
            {"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        connection.close()

        self.assertEqual(response.status, 200)
        self.assertEqual([item["moduleId"] for item in body["components"]], ["custom_api_batch_one", "custom_api_batch_two"])


if __name__ == "__main__":
    unittest.main()
