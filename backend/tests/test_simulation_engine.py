import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry, RegisteredModule
from backend.simulation_engine import run_simulation
from backend.tests.fixtures import valid_package


class SimulationEngineTests(unittest.TestCase):
    def assertFloatSeriesEqual(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for actual_value, expected_value in zip(actual, expected):
            self.assertAlmostEqual(actual_value, expected_value, places=10)

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

    def test_stateful_module_state_persists_across_time_steps(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"]["moduleId"] = "stateful_accumulator"
        registry = ModuleRegistry([
            RegisteredModule(
                module_id="stateful_accumulator",
                import_path="backend.tests.stateful_module",
                entry_function="process",
                inputs=("input",),
                outputs=("output",),
                parameters={},
            )
        ])
        graph = compile_graph(package, registry)

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [0.1, 0.2, 0.3])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [0.1, 0.2, 0.3])

    def test_actual_and_reference_module_state_are_isolated(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"]["moduleId"] = "stateful_accumulator"
        package["faultInstances"] = [{
            "faultId": "source-bias",
            "faultType": "sensor_bias",
            "targetId": "source-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 1.0},
        }]
        registry = ModuleRegistry([
            RegisteredModule(
                module_id="stateful_accumulator",
                import_path="backend.tests.stateful_module",
                entry_function="process",
                inputs=("input",),
                outputs=("output",),
                parameters={},
            )
        ])
        graph = compile_graph(package, registry)

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [0.1, 0.2, 0.3])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [0.2, 0.4, 0.6])


if __name__ == "__main__":
    unittest.main()
