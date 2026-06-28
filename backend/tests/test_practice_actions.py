import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry, RegisteredModule
from backend.practice_actions import PracticeActionRuntime
from backend.simulation_engine import SimulationSession
from backend.tests.fixtures import valid_package


class PracticeActionRuntimeTests(unittest.TestCase):
    def assertFloatSeriesEqual(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for actual_value, expected_value in zip(actual, expected):
            self.assertAlmostEqual(actual_value, expected_value, places=10)

    def _session(self, package=None, registry=None):
        graph = compile_graph(package or valid_package(), registry or ModuleRegistry.from_builtin_manifest())
        return SimulationSession(graph, run_id="practice-action-test")

    def test_adjust_parameter_updates_following_simulation_steps(self):
        session = self._session()
        runtime = PracticeActionRuntime(session)

        result = runtime.apply({"actionType": "adjustParameter", "targetId": "source-1", "parameter": "value", "value": 2.0})
        step = session.step(2)

        self.assertEqual(result["changes"][0]["type"], "parameter_updated")
        self.assertFloatSeriesEqual(step["curves"]["channels"]["scope-1.ch1.actual"], [2.0, 2.0])

    def test_repair_component_disables_matching_runtime_faults(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-bias",
            "faultType": "sensor_bias",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.0,
            "duration": 0.3,
            "parameters": {"bias": 0.5},
        }]
        session = self._session(package)
        runtime = PracticeActionRuntime(session)

        result = runtime.apply({"actionType": "replaceComponent", "targetId": "sim-1"})
        step = session.step(1)

        self.assertEqual(result["changes"][0]["type"], "fault_disabled")
        self.assertFalse(session.fault_runtime.fault_instances[0]["enabled"])
        self.assertFloatSeriesEqual(step["curves"]["channels"]["scope-1.ch1.actual"], [1.0])

    def test_disconnect_and_reconnect_line_persist_on_session(self):
        session = self._session()
        runtime = PracticeActionRuntime(session)

        runtime.apply({"actionType": "disconnectLine", "targetId": "edge-source-sim"})
        disconnected = session.step(2)
        runtime.apply({"actionType": "reconnectLine", "targetId": "edge-source-sim"})
        reconnected = session.step(1)

        self.assertFloatSeriesEqual(disconnected["curves"]["channels"]["scope-1.ch1.actual"], [0.0, 0.0])
        self.assertFloatSeriesEqual(reconnected["curves"]["channels"]["scope-1.ch1.actual"], [1.0])

    def test_reset_device_clears_module_state_for_next_step(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.4
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
        session = self._session(package, registry)
        runtime = PracticeActionRuntime(session)

        before_reset = session.step(2)
        result = runtime.apply({"actionType": "resetDevice", "targetId": "sim-1"})
        after_reset = session.step(1)

        self.assertFloatSeriesEqual(before_reset["curves"]["channels"]["scope-1.ch1.actual"], [0.1, 0.2])
        self.assertEqual(result["changes"][0]["type"], "device_state_reset")
        self.assertFloatSeriesEqual(after_reset["curves"]["channels"]["scope-1.ch1.actual"], [0.1])


if __name__ == "__main__":
    unittest.main()
