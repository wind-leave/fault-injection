import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from backend.component_discovery import _read_component, discover_components
from backend.module_registry import ModuleRegistry, RegisteredModule, clear_module_call_cache
from tools.convert_builtin_components import PROJECT_ROOT, add_declaration, convert_components, read_frontend_metadata


class ConvertBuiltinComponentsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source_dir = self.root / "backend" / "builtin_modules"
        self.source_dir.mkdir(parents=True)
        self.output_dir = self.root / "converted"
        self.record = {
            "moduleId": "gain", "importPath": "backend.builtin_modules.gain", "entryFunction": "process",
            "inputs": ["signal"], "outputs": ["result"],
            "parameters": {"gain": {"type": "number", "default": 2, "min": -10, "max": 10}},
        }
        self.source = '"""Gain module."""\nfrom __future__ import annotations\n\ndef process(signal, gain=2):\n    return {"result": signal * gain}\n'
        (self.source_dir / "gain.py").write_text(self.source, encoding="utf-8")
        (self.source_dir / "manifest.json").write_text(json.dumps({"modules": [self.record]}), encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def convert(self, **kwargs):
        return convert_components(self.root, self.output_dir, frontend={}, **kwargs)

    def test_preserves_original_and_emits_valid_metadata_after_future_imports(self):
        before = {path.name: path.read_bytes() for path in self.source_dir.iterdir()}
        report = self.convert()
        self.assertEqual(report["summary"]["generated"], 1)
        path = self.output_dir / "gain.py"
        source = path.read_text(encoding="utf-8")
        self.assertLess(source.index("from __future__"), source.index("COMPONENT ="))
        self.assertIn('return {"result": signal * gain}', source)
        record, palette = _read_component(path, "backend.auto_components")
        self.assertEqual(record["moduleId"], "gain")
        self.assertEqual(palette["templateId"], "gain")
        self.assertTrue(palette["replacesBuiltin"])
        self.assertEqual(record["parameters"]["gain"]["default"], 2)
        self.assertEqual(palette["inputs"][0]["varName"], "signal")
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.source_dir.iterdir()})

    def test_preserves_explicit_port_ids_and_element_names_through_discovery(self):
        frontend = {"gain": {
            "inputs": [{"varName": "signal", "portId": "ABC", "elementNames": ["A"]}],
            "outputs": [{"varName": "result", "portId": 111}],
        }}
        report = convert_components(self.root, self.output_dir, frontend=frontend)
        self.assertEqual(report["summary"]["generated"], 1, report)
        _, palette = _read_component(self.output_dir / "gain.py", "backend.auto_components")
        self.assertEqual(palette["inputs"][0]["portId"], "ABC")
        self.assertEqual(palette["inputs"][0]["elementNames"], ["A"])
        self.assertEqual(palette["outputs"][0]["portId"], "111")

    def test_preserves_numeric_module_id_and_original_frontend_template_id(self):
        self.record["moduleId"] = "11"
        (self.source_dir / "manifest.json").write_text(json.dumps({"modules": [self.record]}), encoding="utf-8")
        report = convert_components(self.root, self.output_dir, frontend={"11": {"templateId": "legacy_component_11"}})
        self.assertEqual(report["summary"]["failed"], 0, report)
        item = report["components"][0]
        self.assertEqual(item["moduleId"], "11")
        record, palette = _read_component(self.output_dir / item["fileName"], "backend.auto_components")
        self.assertEqual(record["moduleId"], "11")
        self.assertEqual(palette["templateId"], "legacy_component_11")
        self.assertFalse(item["fileName"][0].isdigit())

    def test_explicit_prefix_remains_available_for_generating_distinct_components(self):
        report = self.convert(prefix="auto_")
        self.assertEqual(report["summary"]["failed"], 0)
        record, palette = _read_component(self.output_dir / "auto_gain.py", "backend.auto_components")
        self.assertEqual(record["moduleId"], "auto_gain")
        self.assertEqual(palette["templateId"], "auto_gain")
        self.assertFalse(palette["replacesBuiltin"])

    def test_repeat_run_is_unchanged_and_customized_destination_is_not_overwritten(self):
        self.convert()
        self.assertEqual(self.convert()["summary"]["unchanged"], 1)
        path = self.output_dir / "gain.py"
        modified = path.read_text(encoding="utf-8") + "# manually edited\n"
        path.write_text(modified, encoding="utf-8")
        self.assertEqual(self.convert()["summary"]["skipped"], 1)
        self.assertEqual(path.read_text(encoding="utf-8"), modified)
        self.assertEqual(self.convert(overwrite=True)["summary"]["generated"], 1)

    def test_disabled_entry_is_excluded_even_when_selected_with_overwrite(self):
        self.record["autoConvert"] = False
        (self.source_dir / "manifest.json").write_text(json.dumps({"modules": [self.record]}), encoding="utf-8")
        report = self.convert(selected=["gain"], overwrite=True)
        self.assertEqual(report["summary"]["excluded"], 1)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["summary"]["generated"], 0)
        self.assertFalse((self.output_dir / "gain.py").exists())
        existing = self.output_dir / "gain.py"
        existing.write_text("# manually maintained existing component\n", encoding="utf-8")
        report = self.convert(selected=["gain"], overwrite=True)
        self.assertEqual(report["components"][0]["status"], "excluded")
        self.assertEqual(existing.read_text(encoding="utf-8"), "# manually maintained existing component\n")

    def test_new_simulation_entry_is_enabled_by_default_after_existing_entries_are_disabled(self):
        self.record["autoConvert"] = False
        new_record = {**copy.deepcopy(self.record), "moduleId": "new_simulation", "importPath": "backend.builtin_modules.new_simulation"}
        new_record.pop("autoConvert")
        (self.source_dir / "new_simulation.py").write_text(self.source, encoding="utf-8")
        (self.source_dir / "manifest.json").write_text(json.dumps({"modules": [self.record, new_record]}), encoding="utf-8")
        report = self.convert()
        self.assertEqual(report["summary"]["excluded"], 1)
        self.assertEqual(report["summary"]["generated"], 1)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertFalse((self.output_dir / "gain.py").exists())
        record, palette = _read_component(self.output_dir / "new_simulation.py", "backend.auto_components")
        self.assertEqual(record["moduleId"], "new_simulation")
        self.assertEqual(palette["group"], "simulation")

    def test_invalid_conversion_flag_is_reported_without_generating_component(self):
        for invalid in ("false", 0, None):
            with self.subTest(autoConvert=invalid):
                self.record["autoConvert"] = invalid
                (self.source_dir / "manifest.json").write_text(json.dumps({"modules": [self.record]}), encoding="utf-8")
                report = self.convert()
                self.assertEqual(report["summary"]["failed"], 1)
                self.assertIn("autoConvert must be true or false", report["components"][0]["error"])
                self.assertFalse((self.output_dir / "gain.py").exists())

    @unittest.skipUnless(shutil.which("node"), "Node.js is required to read the real frontend registry")
    def test_current_manifest_converts_every_component(self):
        report = convert_components(PROJECT_ROOT, self.output_dir)
        manifest = json.loads((PROJECT_ROOT / "backend/builtin_modules/manifest.json").read_text(encoding="utf-8"))
        expected = {item["moduleId"] for item in manifest["modules"]}
        self.assertTrue(all("autoConvert" not in item for item in manifest["modules"]))
        generated = {item["originalModuleId"] for item in report["components"] if item["status"] == "generated"}
        self.assertEqual(generated, expected, report)

    def test_preserves_builtin_and_custom_menus_for_simulation_and_electrical_components(self):
        cases = [
            {"group": "simulation", "paletteMenu": "rf-signal", "category": "射频信号模型"},
            {"group": "simulation", "simulationMenu": "signal-processing", "simulationMenuLabel": "信号处理模型"},
            {"group": "electrical", "paletteMenu": "power-source", "category": "电源模块"},
            {"group": "simulation", "paletteMenu": "custom-sim", "category": "自定义仿真分类"},
            {"group": "electrical", "paletteMenu": "custom-electric", "paletteMenuLabel": "自定义电气分类"},
            {"group": "simulation", "category": "仅分类名称"},
            {},
        ]
        for template in cases:
            with self.subTest(template=template):
                report = convert_components(self.root, self.output_dir, frontend={"gain": template}, overwrite=True)
                self.assertEqual(report["summary"]["failed"], 0, report)
                _, palette = _read_component(self.output_dir / "gain.py", "backend.auto_components")
                self.assertEqual(palette["group"], template.get("group", "simulation"))
                self.assertEqual(palette["paletteMenu"], template.get("paletteMenu", template.get("simulationMenu", "")))
                self.assertEqual(palette["category"], template.get("category", template.get("paletteMenuLabel", template.get("simulationMenuLabel", "内置组件转换"))))

    def test_menu_overrides_are_written_to_generated_component(self):
        report = convert_components(
            self.root, self.output_dir,
            frontend={"gain": {"paletteMenu": "rf-signal", "category": "射频信号模型"}},
            overrides={"gain": {"paletteMenu": "my-models", "category": "我的模型"}},
        )
        self.assertEqual(report["summary"]["failed"], 0, report)
        _, palette = _read_component(self.output_dir / "gain.py", "backend.auto_components")
        self.assertEqual((palette["paletteMenu"], palette["category"]), ("my-models", "我的模型"))

    def test_reports_unregistered_source_and_rejects_unknown_selection_or_source_output(self):
        (self.source_dir / "unknown.py").write_text("def process():\n    return {}\n", encoding="utf-8")
        report = self.convert()
        self.assertEqual(report["unregisteredFiles"][0]["fileName"], "unknown.py")
        with self.assertRaisesRegex(ValueError, "unknown manifest"):
            self.convert(selected=["unknown"])
        with self.assertRaisesRegex(ValueError, "outside builtin_modules"):
            convert_components(self.root, self.source_dir, frontend={})

    def test_interface_mismatch_is_reported_without_writing_broken_component(self):
        report = convert_components(self.root, self.output_dir, frontend={"gain": {"inputs": [{"varName": "other"}]}})
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertIn("disagree", report["components"][0]["error"])
        self.assertFalse((self.output_dir / "gain.py").exists())

    def test_rewrites_relative_helpers_and_preserves_function_body(self):
        source = 'from __future__ import annotations\nfrom .helper import scale\n\ndef process(signal):\n    return {"result": scale(signal)}\n'
        metadata = {"name": "Gain", "inputs": ["signal"], "outputs": ["result"]}
        generated = add_declaration(source, metadata, "backend.builtin_modules")
        self.assertIn("from backend.builtin_modules.helper import scale", generated)
        self.assertIn('return {"result": scale(signal)}', generated)

    @unittest.skipUnless(shutil.which("node"), "Node.js is required to read frontend menus")
    def test_frontend_export_resolves_fixed_custom_and_legacy_menu_names(self):
        registry_path = self.root / "src" / "services" / "componentRegistry.js"
        registry_path.parent.mkdir(parents=True)
        self.root.joinpath("package.json").write_text('{"type":"module"}', encoding="utf-8")
        actual_registry = (PROJECT_ROOT / "src" / "services" / "componentRegistry.js").as_uri()
        templates = {
            "legacy": {"group": "simulation", "simulationMenu": "rf-signal", "simulationMenuLabel": "旧名称"},
            "neutral": {"group": "simulation", "paletteMenu": "signal-processing", "simulationMenu": "rf-signal"},
            "custom_sim": {"group": "simulation", "simulationMenu": "my-sim", "simulationMenuLabel": "我的仿真菜单"},
            "custom_electrical": {"group": "electrical", "paletteMenu": "my-electrical", "paletteMenuLabel": "我的电气菜单"},
        }
        for module_id, template in templates.items():
            template.update(label=module_id, pythonBinding={"moduleId": module_id})
        registry_path.write_text(
            f'export {{ getPaletteGroups, getSimulationMenuSections, getElectricalMenuSections }} from {json.dumps(actual_registry)};\n'
            f'export const COMPONENT_REGISTRY = {json.dumps(templates, ensure_ascii=False)};\n', encoding="utf-8"
        )
        exported = read_frontend_metadata(self.root)
        expected = {
            "legacy": ("rf-signal", "射频信号模型"),
            "neutral": ("signal-processing", "信号处理模型"),
            "custom_sim": ("my-sim", "我的仿真菜单"),
            "custom_electrical": ("my-electrical", "我的电气菜单"),
        }
        for module_id, menu in expected.items():
            with self.subTest(module_id=module_id):
                self.assertEqual((exported[module_id]["paletteMenu"], exported[module_id]["category"]), menu)

    @unittest.skipUnless(shutil.which("node"), "Node.js is required to read the real frontend registry")
    def test_all_builtin_conversion_contracts_match_original_execution(self):
        source_root = PROJECT_ROOT / "backend" / "builtin_modules"
        hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_root.iterdir() if path.is_file()}
        frontend = read_frontend_metadata(PROJECT_ROOT)
        package = self.root / "converted_test_components"
        report = convert_components(PROJECT_ROOT, package, frontend=frontend)
        originals = ModuleRegistry.from_builtin_manifest()
        self.assertEqual(report["summary"]["failed"], 0, report)
        self.assertEqual(report["summary"]["generated"], len(originals.modules))
        records, palettes, errors = discover_components(originals.modules, directory=package, package="converted_test_components", replaceable_modules=originals.modules)
        self.assertEqual(errors, [])
        self.assertEqual(len(records), len(originals.modules))
        by_id = {record["moduleId"]: record for record in records}
        definitions = {item["moduleId"]: item for item in palettes}
        sys.path.insert(0, str(self.root))
        try:
            for item in report["components"]:
                with self.subTest(module=item["originalModuleId"]):
                    metadata = by_id[item["moduleId"]]
                    original = originals.require(item["originalModuleId"])
                    converted = RegisteredModule(
                        metadata["moduleId"], metadata["importPath"], metadata["entryFunction"],
                        tuple(metadata["inputs"]), tuple(metadata["outputs"]), metadata["parameters"],
                    )
                    inputs = {}
                    for port in definitions[item["moduleId"]]["inputs"]:
                        value = {"i": 0.5, "q": 0.2, "referenceFrequencyHz": 1e6, "impedanceOhm": 50, "unit": "V"} if port.get("dataType") == "rf_complex_envelope" else 0.5
                        if port.get("type") == "vector":
                            value = [copy.deepcopy(value) for _ in range(port["vectorLength"])]
                        inputs[port["varName"]] = value
                    old_state, new_state = {}, {}
                    for time in (0, 0.02, 0.04):
                        expected = original.call(copy.deepcopy(inputs), {}, time=time, dt=0.02, state=old_state)
                        actual = converted.call(copy.deepcopy(inputs), {}, time=time, dt=0.02, state=new_state)
                        self.assertEqual(actual, expected)
                        old_state, new_state = expected["state"], actual["state"]
            rf = definitions["rf_complex_envelope_limiter"]
            self.assertEqual(rf["inputs"][0]["dataType"], "rf_complex_envelope")
            self.assertEqual(rf["inputs"][0]["collectionKind"], "vector")
            self.assertEqual(rf["inputs"][0]["vectorLength"], 4)
            self.assertEqual(by_id["rf_downconverter"]["parameters"]["input_mode"]["enum"], [1, 2])
            input_mode = next(item for item in definitions["rf_downconverter"]["parameters"] if item["key"] == "input_mode")
            self.assertEqual(input_mode["control"], "stepper")
            self.assertEqual(input_mode["options"], [
                {"value": 1, "label": "模式 1：第一路输入"},
                {"value": 2, "label": "模式 2：第二路输入"},
            ])
            self.assertEqual(definitions["electrical_ground"]["outputs"], [])
            self.assertEqual(definitions["electrical_dc_power_source"]["group"], "electrical")
            self.assertEqual(definitions["electrical_dc_power_source"]["paletteMenu"], "power-source")
            self.assertFalse(definitions["electrical_dc_power_source"]["requiresPower"])
            self.assertEqual(definitions["electrical_dc_boost"]["paletteMenu"], "power-conversion")
            for module_id, template in frontend.items():
                converted_id = module_id
                if converted_id not in definitions:
                    continue
                with self.subTest(menu=module_id):
                    self.assertEqual(definitions[converted_id]["paletteMenu"], template["paletteMenu"])
                    self.assertEqual(definitions[converted_id]["category"], template["category"])
            self.assertEqual(definitions["rf_complex_envelope_limiter"]["paletteMenu"], "rf-signal")
            self.assertEqual(definitions["rf_complex_envelope_limiter"]["category"], "射频信号模型")
            self.assertEqual(definitions["scalar_to_vector4"]["paletteMenu"], "signal-processing")
            self.assertEqual(definitions["scalar_to_vector4"]["category"], "信号处理模型")
        finally:
            clear_module_call_cache()
            sys.path.pop(0)
            for name in list(sys.modules):
                if name == "converted_test_components" or name.startswith("converted_test_components."):
                    sys.modules.pop(name, None)
        self.assertEqual(hashes, {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source_root.iterdir() if path.is_file()})
