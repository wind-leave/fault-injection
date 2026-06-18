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
