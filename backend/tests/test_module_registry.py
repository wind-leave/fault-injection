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

    def test_command_shaper_module_clamps_pitch_command(self):
        registry = ModuleRegistry.from_builtin_manifest()
        module = registry.require("command_shaper")

        high_result = module.call({"pitch_command": 1.8}, {})
        low_result = module.call({"pitch_command": -1.4}, {})
        nominal_result = module.call({"pitch_command": 0.25}, {})

        self.assertEqual(high_result["outputs"]["shaped_command"], 1.0)
        self.assertEqual(low_result["outputs"]["shaped_command"], -1.0)
        self.assertEqual(nominal_result["outputs"]["shaped_command"], 0.25)

    def test_closed_loop_backend_modules_execute_sample_inputs(self):
        registry = ModuleRegistry.from_builtin_manifest()
        cases = [
            ("attitude_controller", {"attitude_error": 0.2}, "torque_command"),
            ("control_allocator", {"torque_command": 0.2}, "motor_total_command"),
            ("motor_mixer", {"motor_total_command": 0.2}, "motor_1_command"),
            ("motor_model", {"motor_command": 0.2}, "thrust"),
            ("vehicle_dynamics", {"thrust_1": 0.1, "thrust_2": 0.1, "thrust_3": 0.1, "thrust_4": 0.1}, "pitch_rate"),
            ("imu_gyro", {"body_rate": 0.1}, "measured_rate"),
        ]

        for module_id, inputs, output_name in cases:
            with self.subTest(module_id=module_id):
                result = registry.require(module_id).call(inputs, {}, dt=0.1, state={})
                self.assertIn(output_name, result["outputs"])
                self.assertIsInstance(result["state"], dict)


if __name__ == "__main__":
    unittest.main()
