import json
import sys
import tempfile
import unittest
from pathlib import Path

from backend.component_registration import ComponentRegistrar
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError


class ComponentRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.package_name = "test_registered_components"
        self.modules_dir = self.root / self.package_name
        self.modules_dir.mkdir()
        (self.modules_dir / "__init__.py").write_text("", encoding="utf-8")
        self.manifest_path = self.modules_dir / "manifest.json"
        self.manifest_path.write_text('{"modules": []}\n', encoding="utf-8")
        sys.path.insert(0, str(self.root))
        self.registrar = ComponentRegistrar(
            modules_dir=self.modules_dir,
            manifest_path=self.manifest_path,
            import_package=self.package_name,
        )

    def tearDown(self):
        sys.path.remove(str(self.root))
        for module_name in list(sys.modules):
            if module_name == self.package_name or module_name.startswith(f"{self.package_name}.") or module_name == "gz_custom_components" or module_name.startswith("gz_custom_components."):
                sys.modules.pop(module_name, None)
        self.temporary_directory.cleanup()

    def test_registers_a_valid_component_and_executes_it_through_the_manifest(self):
        component = self.registrar.register({
            "moduleId": "custom_gain_sensor",
            "entryFunction": "process",
            "source": """def process(input_value, gain):
    output_value = input_value * gain
    return {\"outputs\": {\"output_value\": output_value}}
""",
            "inputs": [{"varName": "input_value", "type": "number"}],
            "outputs": [{"varName": "output_value", "type": "number"}],
            "parameters": [{"key": "gain", "type": "number", "default": 2, "min": 0, "max": 10}],
        })

        self.assertEqual(component["moduleId"], "custom_gain_sensor")
        self.assertTrue((self.modules_dir / "custom_gain_sensor.py").is_file())
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["modules"][0]["outputs"], ["output_value"])
        # The registrar's post-registration smoke test already imports the
        # module.  A direct registry read confirms normal simulation calls.
        from backend.module_registry import ModuleRegistry
        result = ModuleRegistry.from_manifest(self.manifest_path).require("custom_gain_sensor").call(
            {"input_value": 3}, {"gain": 2}
        )
        self.assertEqual(result["outputs"]["output_value"], 6.0)

    def test_rejects_unsafe_source_before_writing_a_component(self):
        with self.assertRaises(SimulationBackendError) as context:
            self.registrar.register({
                "moduleId": "custom_unsafe_component",
                "source": "import os\ndef process():\n    return {\"outputs\": {}}\n",
                "inputs": [],
                "outputs": [],
                "parameters": [],
            })

        self.assertEqual(context.exception.error_code, "COMPONENT_SOURCE_NOT_ALLOWED")
        self.assertFalse((self.modules_dir / "custom_unsafe_component.py").exists())

    def test_updates_a_registered_component_without_changing_its_id(self):
        self.registrar.register({
            "moduleId": "custom_editable_gain",
            "source": "def process(value):\n    return {\"outputs\": {\"value\": value}}\n",
            "inputs": [{"varName": "value", "type": "number"}],
            "outputs": [{"varName": "value", "type": "number"}],
            "parameters": [],
        })

        updated = self.registrar.update("custom_editable_gain", {
            "moduleId": "custom_editable_gain",
            "source": "def process(value):\n    return {\"outputs\": {\"doubled\": value * 2}}\n",
            "inputs": [{"varName": "value", "type": "number"}],
            "outputs": [{"varName": "doubled", "type": "number"}],
            "parameters": [],
        })

        self.assertEqual(updated["moduleId"], "custom_editable_gain")
        result = ModuleRegistry.from_manifest(self.manifest_path).require("custom_editable_gain").call({"value": 3}, {})
        self.assertEqual(result["outputs"]["doubled"], 6.0)

    def test_persistent_storage_is_created_outside_the_backend_module_directory(self):
        storage_dir = self.root / "persistent-component-data"
        registrar = ComponentRegistrar.for_persistent_storage(storage_dir)

        component = registrar.register({
            "moduleId": "custom_persistent_gain",
            "source": "def process(value):\n    return {\"outputs\": {\"value\": value}}\n",
            "inputs": [{"varName": "value", "type": "number"}],
            "outputs": [{"varName": "value", "type": "number"}],
            "parameters": [],
        })

        self.assertEqual(component["importPath"], "gz_custom_components.custom_persistent_gain")
        self.assertTrue((storage_dir / "gz_custom_components" / "custom_persistent_gain.py").is_file())
        manifest = json.loads((storage_dir / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["modules"][0]["moduleId"], "custom_persistent_gain")
        registry = ModuleRegistry.from_manifests([ModuleRegistry.builtin_manifest_path(), registrar.manifest_path])
        self.assertEqual(registry.require("custom_persistent_gain").call({"value": 4}, {})["outputs"]["value"], 4.0)

    def test_migrates_legacy_custom_components_to_persistent_storage(self):
        legacy_modules_dir = self.root / "legacy-builtin-modules"
        legacy_modules_dir.mkdir()
        (legacy_modules_dir / "custom_legacy_gain.py").write_text(
            "def process(signal):\n    return {\"outputs\": {\"result\": signal * 2}}\n", encoding="utf-8"
        )
        (legacy_modules_dir / "manifest.json").write_text(json.dumps({"modules": [{
            "moduleId": "custom_legacy_gain", "importPath": "backend.builtin_modules.custom_legacy_gain",
            "entryFunction": "process", "inputs": ["signal"], "outputs": ["result"], "parameters": {},
        }]}), encoding="utf-8")

        registrar = ComponentRegistrar.for_persistent_storage(self.root / "persistent-component-data")
        migrated = registrar.migrate_legacy_components(legacy_modules_dir)

        self.assertEqual(migrated, ["custom_legacy_gain"])
        registry = ModuleRegistry.from_manifest(registrar.manifest_path)
        self.assertEqual(registry.require("custom_legacy_gain").call({"signal": 3}, {})["outputs"]["result"], 6.0)


if __name__ == "__main__":
    unittest.main()
