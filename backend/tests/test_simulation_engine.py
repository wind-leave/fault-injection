import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry, RegisteredModule
from backend.simulation_engine import SimulationSession, run_simulation
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

    def test_feedback_cycle_uses_previous_time_step_value(self):
        package = {
            "schemaVersion": 1,
            "packageId": "feedback-package",
            "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "source-1",
                    "type": "signal_source",
                    "parameters": {"value": 1.0},
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "sum-1",
                    "type": "sum_block",
                    "parameters": {},
                    "inputs": [{"name": "a"}, {"name": "feedback"}],
                    "outputs": [{"name": "sum"}],
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
                    "id": "edge-source-sum",
                    "sourceNodeId": "source-1",
                    "sourcePortIndex": 0,
                    "targetNodeId": "sum-1",
                    "targetPortIndex": 0,
                },
                {
                    "id": "edge-sum-sim",
                    "sourceNodeId": "sum-1",
                    "sourcePortIndex": 0,
                    "targetNodeId": "sim-1",
                    "targetPortIndex": 0,
                },
                {
                    "id": "edge-sim-sum",
                    "sourceNodeId": "sim-1",
                    "sourcePortIndex": 0,
                    "targetNodeId": "sum-1",
                    "targetPortIndex": 1,
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
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [1.0, 2.0, 3.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.0, 2.0, 3.0])

    def test_scope_channels_evaluate_their_own_input_ports(self):
        package = {
            "schemaVersion": 1,
            "packageId": "scope-channel-package",
            "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "source-ch1",
                    "type": "signal_source",
                    "parameters": {"value": 0.08},
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "source-ch2",
                    "type": "signal_source",
                    "parameters": {"value": 0.08},
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "scope-1",
                    "type": "instrument_scope",
                    "inputs": [{"name": "CH1"}, {"name": "CH2"}],
                },
            ],
            "edges": [
                {
                    "id": "edge-ch1-scope",
                    "sourceNodeId": "source-ch1",
                    "sourcePortIndex": 0,
                    "targetNodeId": "scope-1",
                    "targetPortIndex": 0,
                },
                {
                    "id": "edge-ch2-scope",
                    "sourceNodeId": "source-ch2",
                    "sourcePortIndex": 0,
                    "targetNodeId": "scope-1",
                    "targetPortIndex": 1,
                },
            ],
            "faultInstances": [
                {
                    "faultId": "ch2-bias",
                    "faultType": "sensor_bias",
                    "targetId": "source-ch2",
                    "enabled": True,
                    "startTime": 0.1,
                    "duration": 0.1,
                    "parameters": {"bias": 5.0},
                }
            ],
            "measurementPoints": [
                {"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"},
                {"id": "scope-1.ch2", "scopeNodeId": "scope-1", "channel": "ch2"},
            ],
        }
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [0.08, 0.08, 0.08])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch2.reference"], [0.08, 0.08, 0.08])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch2.actual"], [0.08, 5.08, 5.08])

    def test_step_session_matches_full_run_across_chunks(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.1,
            "duration": 0.1,
            "parameters": {"bias": 0.5},
        }]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        full = run_simulation(graph)

        session = SimulationSession(graph, run_id="run-step")
        first = session.step()
        second = session.step(2)
        empty = session.step()

        self.assertEqual(first["curves"]["time"], [0.0])
        self.assertEqual(second["curves"]["time"], [0.1, 0.2])
        combined_times = first["curves"]["time"] + second["curves"]["time"]
        self.assertEqual(combined_times, full["curves"]["time"])
        for channel, values in full["curves"]["channels"].items():
            combined_values = first["curves"]["channels"][channel] + second["curves"]["channels"][channel]
            self.assertFloatSeriesEqual(combined_values, values)
        self.assertEqual(first["events"] + second["events"], full["events"])
        self.assertTrue(second["metrics"]["done"])
        self.assertEqual(empty["metrics"]["sampleCount"], 0)
        self.assertTrue(empty["metrics"]["done"])


if __name__ == "__main__":
    unittest.main()
