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

    def test_records_each_component_output_for_every_step(self):
        graph = compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["componentOutputs"]["time"], [0.0, 0.1, 0.2])
        self.assertEqual(len(result["componentOutputs"]["steps"]), 3)
        first_step = result["componentOutputs"]["steps"][0]
        self.assertEqual(first_step["time"], 0.0)
        self.assertEqual(first_step["actual"]["source-1"]["out"], 1.0)
        self.assertEqual(first_step["actual"]["sim-1"]["output"], 1.0)
        self.assertEqual(first_step["reference"]["source-1"]["out"], 1.0)
        self.assertEqual(first_step["reference"]["sim-1"]["output"], 1.0)

    def test_component_output_trace_reflects_actual_faults_without_changing_reference(self):
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

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(
            [step["actual"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, 1.5, 1.5],
        )
        self.assertFloatSeriesEqual(
            [step["reference"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, 1.0, 1.0],
        )

    def test_component_output_trace_reflects_parameter_step_faults(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-parameter-step",
            "faultType": "parameter_step",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.1,
            "duration": 0.2,
            "parameters": {"stepValue": -0.35},
        }]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(
            [step["actual"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, 0.65, 0.65],
        )
        self.assertFloatSeriesEqual(
            [step["reference"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, 1.0, 1.0],
        )

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

    def test_sum_block_applies_signs_by_target_port(self):
        package = {
            "schemaVersion": 1,
            "packageId": "signed-sum-package",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "source-command",
                    "type": "signal_source",
                    "parameters": {"value": 3.0},
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "source-feedback",
                    "type": "signal_source",
                    "parameters": {"value": 1.0},
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "sum-1",
                    "type": "sum_block",
                    "parameters": {"inputCount": 2, "signs": ["+", "-"]},
                    "inputs": [{"name": "command"}, {"name": "feedback"}],
                    "outputs": [{"name": "error"}],
                },
                {
                    "id": "scope-1",
                    "type": "instrument_scope",
                    "inputs": [{"name": "CH1"}],
                },
            ],
            "edges": [
                {
                    "id": "edge-feedback-sum",
                    "sourceNodeId": "source-feedback",
                    "sourcePortIndex": 0,
                    "targetNodeId": "sum-1",
                    "targetPortIndex": 1,
                },
                {
                    "id": "edge-command-sum",
                    "sourceNodeId": "source-command",
                    "sourcePortIndex": 0,
                    "targetNodeId": "sum-1",
                    "targetPortIndex": 0,
                },
                {
                    "id": "edge-sum-scope",
                    "sourceNodeId": "sum-1",
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

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [2.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [2.0])
        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"]["sum-1"]["error"], 2.0)

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

    def test_signal_source_domain_scalar_fallbacks(self):
        package = {
            "schemaVersion": 1,
            "packageId": "signal-domain-package",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {"id": "analog", "type": "signal_source", "parameters": {"amplitude": 1.5}, "outputs": [{"name": "out"}]},
                {"id": "digital", "type": "signal_source", "parameters": {"initialState": 1}, "outputs": [{"name": "out"}]},
                {"id": "command", "type": "signal_source", "parameters": {"payloadValue": 7}, "outputs": [{"name": "out"}]},
                {"id": "rf", "type": "signal_source", "parameters": {"power": 10}, "outputs": [{"name": "out"}]},
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}, {"name": "CH2"}, {"name": "CH3"}, {"name": "CH4"}]},
            ],
            "edges": [
                {"id": "edge-analog", "sourceNodeId": "analog", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
                {"id": "edge-digital", "sourceNodeId": "digital", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 1},
                {"id": "edge-command", "sourceNodeId": "command", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 2},
                {"id": "edge-rf", "sourceNodeId": "rf", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 3},
            ],
            "faultInstances": [],
            "measurementPoints": [
                {"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"},
                {"id": "scope-1.ch2", "scopeNodeId": "scope-1", "channel": "ch2"},
                {"id": "scope-1.ch3", "scopeNodeId": "scope-1", "channel": "ch3"},
                {"id": "scope-1.ch4", "scopeNodeId": "scope-1", "channel": "ch4"},
            ],
        }

        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.5])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch2.actual"], [1.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch3.actual"], [7.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch4.actual"], [10.0])

    def test_analog_signal_source_sine_waveform(self):
        package = {
            "schemaVersion": 1,
            "packageId": "signal-waveform-package",
            "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "sine",
                    "type": "signal_source",
                    "parameters": {
                        "signalDomain": "analog",
                        "waveType": "sine",
                        "amplitude": 2,
                        "frequency": 1,
                        "phase": 0,
                        "offset": 0,
                    },
                    "outputs": [{"name": "out"}],
                },
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "edge-sine-scope", "sourceNodeId": "sine", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
        }

        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        result = run_simulation(graph)

        self.assertFloatSeriesEqual(
            result["curves"]["channels"]["scope-1.ch1.actual"],
            [0.0, 1.1755705045849463, 1.902113032590307],
        )

    def test_evtol_builtin_modules_compile_and_run(self):
        rotor_nodes = [
            {
                "id": f"rotor-{index}",
                "type": "simulation_block",
                "pythonBinding": {"moduleId": "rotor_motor", "entryFunction": "process"},
                "parameters": {},
                "inputs": [{"name": "rotor_command"}],
                "outputs": [{"name": "rotor_thrust"}],
            }
            for index in range(1, 9)
        ]
        package = {
            "schemaVersion": 1,
            "packageId": "evtol-builtin-package",
            "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
            "nodes": [
                {"id": "attitude-command", "type": "signal_source", "parameters": {"value": 0.3}, "outputs": [{"name": "out"}]},
                {"id": "attitude-feedback", "type": "signal_source", "parameters": {"value": 0.0}, "outputs": [{"name": "out"}]},
                {"id": "speed-command", "type": "signal_source", "parameters": {"value": 0.2}, "outputs": [{"name": "out"}]},
                {"id": "altitude-command", "type": "signal_source", "parameters": {"value": 0.1}, "outputs": [{"name": "out"}]},
                {"id": "bus-voltage", "type": "signal_source", "parameters": {"value": 0.95}, "outputs": [{"name": "out"}]},
                {
                    "id": "pid",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "pid_controller", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "attitude_command"}, {"name": "attitude_feedback"}],
                    "outputs": [{"name": "moment_command"}],
                },
                {
                    "id": "allocation",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "control_allocation", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "moment_command"}, {"name": "speed_command"}, {"name": "altitude_command"}],
                    "outputs": [{"name": "actuator_command"}],
                },
                {
                    "id": "voltage",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "voltage_drop", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "actuator_command"}, {"name": "bus_voltage"}],
                    "outputs": [{"name": "voltage_limited_command"}],
                },
                {
                    "id": "actuator",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "motor_actuator", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "voltage_limited_command"}],
                    "outputs": [{"name": f"rotor_{index}_command"} for index in range(1, 9)],
                },
                *rotor_nodes,
                {
                    "id": "aero",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "aero_moment", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": f"rotor_{index}_thrust"} for index in range(1, 9)],
                    "outputs": [{"name": "total_force"}, {"name": "total_moment"}],
                },
                {
                    "id": "six-dof",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "six_dof", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "total_force"}, {"name": "total_moment"}],
                    "outputs": [{"name": "attitude"}, {"name": "body_rate"}, {"name": "altitude"}],
                },
                {
                    "id": "sensor",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "sensor_fault_injection", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "attitude"}, {"name": "body_rate"}, {"name": "altitude"}],
                    "outputs": [{"name": "attitude_feedback"}, {"name": "rate_feedback"}, {"name": "altitude_feedback"}],
                },
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "edge-command-pid", "sourceNodeId": "attitude-command", "sourcePortIndex": 0, "targetNodeId": "pid", "targetPortIndex": 0},
                {"id": "edge-feedback-pid", "sourceNodeId": "attitude-feedback", "sourcePortIndex": 0, "targetNodeId": "pid", "targetPortIndex": 1},
                {"id": "edge-pid-allocation", "sourceNodeId": "pid", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 0},
                {"id": "edge-speed-allocation", "sourceNodeId": "speed-command", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 1},
                {"id": "edge-altitude-allocation", "sourceNodeId": "altitude-command", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 2},
                {"id": "edge-allocation-voltage", "sourceNodeId": "allocation", "sourcePortIndex": 0, "targetNodeId": "voltage", "targetPortIndex": 0},
                {"id": "edge-bus-voltage", "sourceNodeId": "bus-voltage", "sourcePortIndex": 0, "targetNodeId": "voltage", "targetPortIndex": 1},
                {"id": "edge-voltage-actuator", "sourceNodeId": "voltage", "sourcePortIndex": 0, "targetNodeId": "actuator", "targetPortIndex": 0},
                *[
                    {"id": f"edge-actuator-rotor-{index}", "sourceNodeId": "actuator", "sourcePortIndex": index - 1, "targetNodeId": f"rotor-{index}", "targetPortIndex": 0}
                    for index in range(1, 9)
                ],
                *[
                    {"id": f"edge-rotor-aero-{index}", "sourceNodeId": f"rotor-{index}", "sourcePortIndex": 0, "targetNodeId": "aero", "targetPortIndex": index - 1}
                    for index in range(1, 9)
                ],
                {"id": "edge-aero-force", "sourceNodeId": "aero", "sourcePortIndex": 0, "targetNodeId": "six-dof", "targetPortIndex": 0},
                {"id": "edge-aero-moment", "sourceNodeId": "aero", "sourcePortIndex": 1, "targetNodeId": "six-dof", "targetPortIndex": 1},
                {"id": "edge-six-dof-attitude", "sourceNodeId": "six-dof", "sourcePortIndex": 0, "targetNodeId": "sensor", "targetPortIndex": 0},
                {"id": "edge-six-dof-rate", "sourceNodeId": "six-dof", "sourcePortIndex": 1, "targetNodeId": "sensor", "targetPortIndex": 1},
                {"id": "edge-six-dof-altitude", "sourceNodeId": "six-dof", "sourcePortIndex": 2, "targetNodeId": "sensor", "targetPortIndex": 2},
                {"id": "edge-sensor-scope", "sourceNodeId": "sensor", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
        }
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["status"], "success")
        first_step = result["componentOutputs"]["steps"][0]["actual"]
        self.assertIn("moment_command", first_step["pid"])
        self.assertIn("rotor_thrust", first_step["rotor-1"])
        self.assertIn("attitude", first_step["six-dof"])
        self.assertIn("attitude_feedback", first_step["sensor"])
        self.assertGreater(result["curves"]["channels"]["scope-1.ch1.actual"][-1], 0.0)


if __name__ == "__main__":
    unittest.main()
