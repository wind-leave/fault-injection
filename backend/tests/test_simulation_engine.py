import copy
import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry, RegisteredModule
from backend.simulation_engine import (
    MAX_FULL_RUN_SAMPLES,
    SimulationSession,
    _edge_value,
    _source_value,
    _validate_full_run_sample_count,
    run_simulation,
)
from backend.schemas import SimulationBackendError
from backend.tests.fixtures import valid_package


class SimulationEngineTests(unittest.TestCase):
    def assertFloatSeriesEqual(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for actual_value, expected_value in zip(actual, expected):
            self.assertAlmostEqual(actual_value, expected_value, places=10)

    def test_mutating_component_input_does_not_change_other_branches(self):
        envelope = {"i": 1.0, "q": 0.5, "referenceFrequencyHz": 1e9}
        cases = [
            ({"dataType": "scalar"}, 1.0),
            ({"dataType": "vector", "vectorLength": 2}, [1.0, 2.0]),
            ({"dataType": "rf_complex_envelope"}, envelope),
            ({"dataType": "rf_complex_envelope", "vectorLength": 2}, [envelope, envelope]),
        ]

        def mutate(input):
            if isinstance(input, dict):
                input["i"] = 99.0
            elif isinstance(input, list):
                if isinstance(input[0], dict):
                    input[0]["i"] = 99.0
                else:
                    input[0] = 99.0
            else:
                input = 99.0
            return {"output": input}

        def observe(input):
            return {"output": input}

        registry = ModuleRegistry([
            RegisteredModule(name, name, "process", ("input",), ("output",), {})
            for name in ("mutate", "observe")
        ])
        for port, value in cases:
            for paths in (("actual",), ("actual", "reference")):
                with self.subTest(port=port, paths=paths):
                    expected = copy.deepcopy(value)
                    package = {
                        "schemaVersion": 1, "packageId": "branch-copy",
                        "simulationConfig": {"duration": 0.2, "stepSize": 0.1},
                        "nodes": [{
                            "id": "source", "type": "signal_source",
                            "parameters": {"value": copy.deepcopy(value)},
                            "outputs": [{"name": "out", **port}],
                        }] + [{
                            "id": name, "type": "simulation_block",
                            "pythonBinding": {"moduleId": name},
                            "inputs": [{"name": "input", **port}],
                            "outputs": [{"name": "output", **port}],
                        } for name in ("mutate", "observe")],
                        "edges": [{
                            "id": name, "sourceNodeId": "source", "sourcePortIndex": 0,
                            "targetNodeId": name, "targetPortIndex": 0,
                        } for name in ("mutate", "observe")],
                        "faultInstances": [], "measurementPoints": [],
                        "reportedNodeIds": ["source", "mutate", "observe"],
                    }
                    session = SimulationSession(compile_graph(package, registry))
                    with patch("backend.module_registry._load_module_entry", side_effect=lambda path, entry: {
                        "mutate": mutate, "observe": observe,
                    }[path]):
                        result = session.step(2, paths=paths)

                    for step in result["componentOutputs"]["steps"]:
                        for mode in paths:
                            self.assertEqual(step[mode]["source"]["out"], expected)
                            self.assertEqual(step[mode]["observe"]["output"], expected)
                            self.assertNotEqual(step[mode]["mutate"]["output"], expected)
                    for outputs in session.previous_values.values():
                        if "out" in outputs:
                            self.assertEqual(outputs["out"], expected)

    def test_legacy_output_without_port_metadata_keeps_nested_copy_isolation(self):
        original = {"nested": {"samples": [1.0, 2.0]}}
        package = valid_package()
        package["nodes"][0]["outputs"] = []
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        edge = graph.edges[0]
        runtime = SimpleNamespace(fault_instances=[], disconnected_edge_ids=set())
        with patch("backend.simulation_engine._evaluate_node", return_value={"output": original}):
            received = _edge_value(
                graph, edge, "actual", 0.0, {}, runtime, {}, 0.1, set(), {}, {}, {},
            )
        received["nested"]["samples"][0] = 99.0
        self.assertEqual(original["nested"]["samples"], [1.0, 2.0])

    def test_compiled_bindings_route_sparse_ports_and_refresh_for_a_new_graph(self):
        package = {
            "schemaVersion": 1, "packageId": "compiled-port-bindings",
            "simulationConfig": {"duration": 0.2, "stepSize": 0.1},
            "nodes": [
                {"id": "left", "type": "signal_source", "parameters": {"value": 3}, "outputs": [{"name": "out"}]},
                {"id": "right", "type": "signal_source", "parameters": {"value": 7}, "outputs": [{"name": "out"}]},
                {
                    "id": "sim", "type": "simulation_block", "pythonBinding": {"moduleId": "split"},
                    "inputs": [{"name": "left"}, {"name": "unconnected"}, {"name": "right"}],
                    "outputs": [{"name": "displayA"}, {"name": "displayB"}],
                },
                {"id": "scope", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
                {"id": "console", "type": "display_console", "inputs": [{"name": "rowA"}, {"name": "rowB"}]},
            ],
            "edges": [
                {"id": "right-sim", "sourceNodeId": "right", "sourcePortIndex": 0, "targetNodeId": "sim", "targetPortIndex": 2},
                {"id": "sim-scope", "sourceNodeId": "sim", "sourcePortIndex": 1, "targetNodeId": "scope", "targetPortIndex": 0},
                {"id": "left-sim", "sourceNodeId": "left", "sourcePortIndex": 0, "targetNodeId": "sim", "targetPortIndex": 0},
                {"id": "sim-console", "sourceNodeId": "sim", "sourcePortIndex": 0, "targetNodeId": "console", "targetPortIndex": 1},
            ],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1"}],
            "reportedNodeIds": ["left"], "faultInstances": [],
        }
        registry = ModuleRegistry([RegisteredModule(
            "split", "split", "process", ("x", "y", "z"), ("a", "b"), {},
        )])

        def split(x, y, z):
            return {"a": x + y, "b": z + y}

        with patch("backend.module_registry._load_module_entry", return_value=split):
            graph = compile_graph(package, registry)
            session = SimulationSession(graph)
            first = session.step(1, paths=("actual",))
            graph.nodes["right"].parameters["value"] = 11
            second = session.step(1, paths=("actual",))

            package["nodes"][2]["outputs"][1]["name"] = "renamedB"
            package["nodes"][0]["parameters"]["value"] = 6
            package["reportedNodeIds"] = ["right"]
            rebuilt = SimulationSession(compile_graph(package, registry)).step(1, paths=("actual",))

        self.assertEqual(first["curves"]["channels"]["scope.ch1.actual"], [7.0])
        self.assertEqual(second["curves"]["channels"]["scope.ch1.actual"], [11.0])
        outputs = first["componentOutputs"]["steps"][0]["actual"]
        self.assertEqual(set(outputs), {"left", "sim", "console"})
        self.assertEqual(outputs["sim"], {"displayA": 3.0, "displayB": 7.0})
        self.assertEqual(outputs["console"], {"rowA": 0.0, "rowB": 3.0})
        rebuilt_outputs = rebuilt["componentOutputs"]["steps"][0]["actual"]
        self.assertEqual(set(rebuilt_outputs), {"right", "sim", "console"})
        self.assertEqual(rebuilt_outputs["sim"], {"displayA": 6.0, "renamedB": 7.0})
        self.assertEqual(rebuilt_outputs["console"], {"rowA": 0.0, "rowB": 6.0})
        self.assertEqual(rebuilt["curves"]["channels"]["scope.ch1.actual"], [7.0])

    def test_full_run_sample_limit_accepts_boundary_and_rejects_one_more(self):
        _validate_full_run_sample_count(MAX_FULL_RUN_SAMPLES)

        with self.assertRaises(SimulationBackendError) as context:
            _validate_full_run_sample_count(MAX_FULL_RUN_SAMPLES + 1)

        self.assertEqual(context.exception.error_code, "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(context.exception.field, "simulationConfig.samples")

    def test_actual_only_full_run_does_not_evaluate_reference_path(self):
        graph = compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest())
        session = SimulationSession(graph)

        result = session.run_actual_from_zero()

        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.0, 1.0, 1.0])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [])
        self.assertTrue(all(step["reference"] == {} for step in result["componentOutputs"]["steps"]))
        self.assertEqual(session.module_states["reference"], {})

    def test_actual_only_full_run_retains_all_samples_above_100000(self):
        graph = SimpleNamespace(
            duration=0.002,
            step_size=1e-8,
            fault_instances=[],
            measurements=[SimpleNamespace(id="point-1")],
            nodes={},
            edges=[],
            reported_node_ids=frozenset(),
            recorded_node_ids=frozenset(),
        )
        session = SimulationSession(graph)

        with patch("backend.simulation_engine._evaluate_measurement", side_effect=lambda *args: args[3]):
            result = session.run_actual_from_zero()

        times = result["curves"]["time"]
        actual = result["curves"]["channels"]["point-1.actual"]
        self.assertEqual(result["metrics"]["sampleCount"], 200_000)
        self.assertEqual(len(times), 200_000)
        self.assertEqual(len(actual), 200_000)
        self.assertEqual(times[0], 0.0)
        self.assertEqual(times[-1], 0.00199999)
        self.assertEqual(actual[0], times[0])
        self.assertEqual(actual[-1], times[-1])

    def test_transports_rf_complex_envelope_through_a_matching_port_chain(self):
        package = {
            "schemaVersion": 1,
            "packageId": "rf-complex-envelope-chain",
            "simulationConfig": {"duration": 0.2, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "source",
                    "type": "signal_source",
                    "parameters": {"value": {"i": 1, "q": -0.25, "referenceFrequencyHz": 20e9, "impedanceOhm": 50}},
                    "outputs": [{"name": "rf", "dataType": "rf_complex_envelope", "referenceFrequencyHz": 20e9, "impedanceOhm": 50}],
                },
                {
                    "id": "pass",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "input", "dataType": "rf_complex_envelope"}],
                    "outputs": [{"name": "output", "dataType": "rf_complex_envelope"}],
                },
                {
                    "id": "scope",
                    "type": "instrument_scope",
                    "parameters": {},
                    "inputs": [{"name": "CH1", "dataType": "rf_complex_envelope"}],
                    "outputs": [],
                },
            ],
            "edges": [
                {"id": "source-pass", "sourceNodeId": "source", "sourcePortIndex": 0, "targetNodeId": "pass", "targetPortIndex": 0},
                {"id": "pass-scope", "sourceNodeId": "pass", "sourcePortIndex": 0, "targetNodeId": "scope", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1"}],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        expected = {"i": 1.0, "q": -0.25, "referenceFrequencyHz": 20e9, "impedanceOhm": 50.0}
        self.assertEqual(result["curves"]["channels"]["scope.ch1.actual"], [expected, expected])
        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"]["pass"]["output"], expected)

    def test_unconnected_rf_envelope_inputs_keep_scalar_and_vector_shapes(self):
        scalar_port = {
            "name": "input", "dataType": "rf_complex_envelope",
            "referenceFrequencyHz": 20e9, "impedanceOhm": 50, "unit": "V",
        }
        vector_port = {
            "name": "input_envelope_vector", "dataType": "rf_complex_envelope",
            "collectionKind": "vector", "vectorLength": 4,
            "referenceFrequencyHz": 20e9, "impedanceOhm": 50, "unit": "V",
        }
        package = {
            "schemaVersion": 1,
            "packageId": "unconnected-rf-envelope-inputs",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "scalar", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                    "inputs": [scalar_port],
                    "outputs": [{"name": "output", "dataType": "rf_complex_envelope"}],
                },
                {
                    "id": "vector", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "rf_complex_envelope_vector4_dual_output_receiver", "entryFunction": "process"},
                    "inputs": [vector_port],
                    "outputs": [
                        {"name": "output_envelope_vector_1", "dataType": "rf_complex_envelope", "collectionKind": "vector", "vectorLength": 4},
                        {"name": "output_envelope_vector_2", "dataType": "rf_complex_envelope", "collectionKind": "vector", "vectorLength": 4},
                    ],
                },
            ],
            "edges": [],
            "faultInstances": [],
            "measurementPoints": [],
            "reportedNodeIds": ["scalar", "vector"],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        outputs = result["componentOutputs"]["steps"][0]["actual"]
        zero_envelope = {"i": 0.0, "q": 0.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50.0, "unit": "V"}
        self.assertEqual(outputs["scalar"]["output"], zero_envelope)
        self.assertEqual(outputs["vector"]["output_envelope_vector_1"], [zero_envelope] * 4)
        self.assertEqual(outputs["vector"]["output_envelope_vector_2"], [zero_envelope] * 4)

    def test_rf_complex_envelope_source_generates_an_ideal_rectangular_pulse(self):
        package = {
            "schemaVersion": 1,
            "packageId": "rf-complex-envelope-pulse",
            "simulationConfig": {"duration": 3.0, "stepSize": 0.25},
            "nodes": [
                {
                    "id": "source",
                    "type": "signal_source",
                    "parameters": {
                        "signalDomain": "rf", "rfComplexEnvelopeOutput": 1, "rfModulation": "pulse",
                        "amplitude": 1, "centerFrequencyHz": 20e9, "impedanceOhm": 50,
                        "pulseWidthSeconds": 2, "pulsePeriodSeconds": 3,
                        "riseTimeSeconds": 0.5, "fallTimeSeconds": 0.5,
                    },
                    "outputs": [{"name": "rf", "dataType": "rf_complex_envelope", "referenceFrequencyHz": 20e9, "impedanceOhm": 50}],
                },
                {
                    "id": "scope", "type": "instrument_scope", "parameters": {},
                    "inputs": [{"name": "CH1", "dataType": "rf_complex_envelope"}], "outputs": [],
                },
            ],
            "edges": [{"id": "source-scope", "sourceNodeId": "source", "sourcePortIndex": 0, "targetNodeId": "scope", "targetPortIndex": 0}],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1"}],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        values = result["curves"]["channels"]["scope.ch1.actual"]
        self.assertEqual(
            [value["i"] for value in values],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
        )
        self.assertTrue(all(value["q"] == 0.0 for value in values))
        self.assertTrue(all(value["referenceFrequencyHz"] == 20e9 for value in values))

    def test_rf_complex_envelope_source_repeats_one_configuration_as_a_vector(self):
        node = SimpleNamespace(
            id="rf-vector-source",
            parameters={
                "rfComplexEnvelopeOutput": 1,
                "rfComplexEnvelopeVectorLength": 3,
                "amplitude": 1,
                "centerFrequencyHz": 20e9,
                "pulseWidthSeconds": 2,
                "pulsePeriodSeconds": 3,
            },
            output_ports=({"name": "rf", "dataType": "rf_complex_envelope", "vectorLength": 3},),
        )
        active = _source_value(node, 0)
        inactive = _source_value(node, 2.5)

        self.assertEqual(len(active), 3)
        self.assertEqual(active[0], active[1])
        self.assertIsNot(active[0], active[1])
        self.assertEqual([item["i"] for item in active], [1.0, 1.0, 1.0])
        self.assertEqual([item["i"] for item in inactive], [0.0, 0.0, 0.0])

        package = {
            "schemaVersion": 1,
            "packageId": "rf-shared-vector-source",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [{
                "id": node.id,
                "type": "signal_source",
                "parameters": node.parameters,
                "outputs": [{
                    "name": "rf", "dataType": "rf_complex_envelope",
                    "collectionKind": "vector", "vectorLength": 3,
                }],
            }],
            "edges": [],
            "faultInstances": [],
            "measurementPoints": [],
            "reportedNodeIds": [node.id],
        }
        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"][node.id]["rf"], active)

    def test_simulation_component_requires_matching_power_connection(self):
        package = {
            "schemaVersion": 1,
            "packageId": "power-gating",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {"id": "signal", "type": "signal_source", "parameters": {"value": 5}, "outputs": [{"name": "out"}]},
                {"id": "supply", "type": "signal_source", "parameters": {"value": 220}, "outputs": [{"name": "out", "unit": "VDC"}]},
                {
                    "id": "component", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                    "inputs": [{"name": "input"}], "outputs": [{"name": "output"}],
                    "powerInputs": [{"name": "supply", "voltage": "220VDC", "supplyType": "DC"}], "powerOutputs": [],
                },
            ],
            "edges": [
                {"id": "signal-edge", "sourceNodeId": "signal", "sourcePortIndex": 0, "targetNodeId": "component", "targetPortIndex": 0},
            ],
            "faultInstances": [], "measurementPoints": [],
        }
        registry = ModuleRegistry.from_builtin_manifest()
        unpowered = run_simulation(compile_graph(package, registry))
        self.assertEqual(unpowered["componentOutputs"]["steps"][0]["actual"], {})

        package["edges"].append(
            {"id": "supply-edge", "sourceNodeId": "supply", "sourcePortIndex": 0, "targetNodeId": "component", "targetPortIndex": 1}
        )
        powered = run_simulation(compile_graph(package, registry))
        self.assertEqual(powered["componentOutputs"]["steps"][0]["actual"], {})

        package["nodes"][1]["parameters"]["value"] = 200
        mismatched = run_simulation(compile_graph(package, registry))
        self.assertEqual(mismatched["componentOutputs"]["steps"][0]["actual"], {})

        package["nodes"][1]["parameters"]["value"] = 220
        package["nodes"][1]["outputs"][0]["unit"] = "VAC"
        wrong_supply_type = run_simulation(compile_graph(package, registry))
        self.assertEqual(wrong_supply_type["componentOutputs"]["steps"][0]["actual"], {})

    def test_dc_matching_and_boost_output_can_power_a_simulation_component_at_its_rated_voltage(self):
        package = {
            "schemaVersion": 1,
            "packageId": "matched-dc-power",
            "simulationConfig": {"duration": 0.04, "stepSize": 0.01},
            "nodes": [
                {"id": "signal", "type": "signal_source", "parameters": {"value": 5}, "outputs": [{"name": "out"}]},
                {
                    "id": "ac-source", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "electrical_ac_power_source", "entryFunction": "process"},
                    "parameters": {"voltage_rms": 220, "frequency_hz": 50, "phase_deg": 0},
                    "inputs": [], "outputs": [{"name": "ac_phase_a", "unit": "VAC"}],
                },
                {
                    "id": "dc-matcher", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "electrical_ac_dc_matching", "entryFunction": "process"},
                    "parameters": {"conversion_gain": 1},
                    "inputs": [{"name": "ac_input", "unit": "VAC"}],
                    "outputs": [{"name": "dc_output", "unit": "VDC"}],
                },
                {
                    "id": "dc-boost", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "electrical_dc_boost", "entryFunction": "process"},
                    "parameters": {"boost_ratio": 2, "efficiency": 0.95},
                    "inputs": [{"name": "dc_input", "unit": "VDC"}],
                    "outputs": [{"name": "dc_output"}],
                },
                {
                    "id": "component", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                    "inputs": [{"name": "input"}], "outputs": [{"name": "output"}],
                    "powerInputs": [{"name": "supply", "voltage": "418V", "supplyType": "DC"}], "powerOutputs": [],
                },
            ],
            "edges": [
                {"id": "signal-edge", "sourceNodeId": "signal", "sourcePortIndex": 0, "targetNodeId": "component", "targetPortIndex": 0},
                {"id": "ac-edge", "sourceNodeId": "ac-source", "sourcePortIndex": 0, "targetNodeId": "dc-matcher", "targetPortIndex": 0},
                {"id": "dc-boost-input", "sourceNodeId": "dc-matcher", "sourcePortIndex": 0, "targetNodeId": "dc-boost", "targetPortIndex": 0},
                {"id": "dc-supply-edge", "sourceNodeId": "dc-boost", "sourcePortIndex": 0, "targetNodeId": "component", "targetPortIndex": 1},
            ],
            "faultInstances": [], "measurementPoints": [],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        for step in result["componentOutputs"]["steps"]:
            self.assertEqual(step["actual"], {})

    def test_unpowered_vector_component_returns_a_shape_correct_zero_output(self):
        package = {
            "schemaVersion": 1,
            "packageId": "unpowered-vector-component",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {"id": "signal", "type": "signal_source", "parameters": {"value": 2}, "outputs": [{"name": "out"}]},
                {
                    "id": "vectorizer", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "scalar_to_vector4", "entryFunction": "process"},
                    "inputs": [{"name": "scalar_input"}],
                    "outputs": [{"name": "vector_output", "dataType": "vector", "vectorLength": 4}],
                    "powerInputs": [{"name": "supply", "voltage": "28V", "supplyType": "DC"}],
                },
            ],
            "edges": [
                {"id": "signal-vectorizer", "sourceNodeId": "signal", "sourcePortIndex": 0, "targetNodeId": "vectorizer", "targetPortIndex": 0},
            ],
            "faultInstances": [], "measurementPoints": [],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"], {})

    def test_routes_a_fixed_length_vector_through_component_input_and_output_ports(self):
        package = {
            "schemaVersion": 1,
            "packageId": "vector-port-package",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "vector-source",
                    "type": "signal_source",
                    "parameters": {"value": [1, 2, 3, 4]},
                    "outputs": [{"id": "out", "name": "out", "dataType": "vector", "vectorLength": 4}],
                },
                {
                    "id": "imu",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"id": "imu-input", "name": "input", "dataType": "vector", "vectorLength": 4}],
                    "outputs": [{"id": "imu-output", "name": "output", "dataType": "vector", "vectorLength": 4}],
                },
                {
                    "id": "scope",
                    "type": "instrument_scope",
                    "inputs": [{"id": "ch1", "name": "CH1", "dataType": "vector", "vectorLength": 4}],
                },
            ],
            "edges": [
                {"id": "source-imu", "sourceNodeId": "vector-source", "sourcePortIndex": 0, "targetNodeId": "imu", "targetPortIndex": 0},
                {"id": "imu-scope", "sourceNodeId": "imu", "sourcePortIndex": 0, "targetNodeId": "scope", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1", "vectorIndex": 2}],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"]["imu"]["output"], [1.0, 2.0, 3.0, 4.0])
        self.assertEqual(result["curves"]["channels"]["scope.ch1.actual"], [3.0])

    def test_display_console_receives_one_seven_element_vector(self):
        package = {
            "schemaVersion": 1,
            "packageId": "display-console-vector-input",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {
                    "id": "vector-source", "type": "signal_source",
                    "parameters": {"value": [1, 2, 3, 4, 5, 6, 7]},
                    "outputs": [{"id": "out", "name": "out", "dataType": "vector", "vectorLength": 7}],
                },
                {
                    "id": "console", "type": "display_console",
                    "inputs": [{"id": "console-input", "name": "七路参数输入", "dataType": "vector", "vectorLength": 7}],
                    "outputs": [],
                },
            ],
            "edges": [{"id": "source-console", "sourceNodeId": "vector-source", "sourcePortIndex": 0,
                       "targetNodeId": "console", "targetPortIndex": 0}],
            "faultInstances": [], "measurementPoints": [],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"]["console"]["七路参数输入"],
                         [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])

    def test_legacy_signal_source_without_port_metadata_feeds_scalar_to_vector4(self):
        package = {
            "schemaVersion": 1,
            "packageId": "implicit-signal-source-port",
            "simulationConfig": {"duration": 0.2, "stepSize": 0.1},
            "nodes": [
                {"id": "source", "type": "signal_source", "parameters": {"value": 2}, "outputs": []},
                {
                    "id": "vectorizer", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "scalar_to_vector4", "entryFunction": "process"},
                    "inputs": [{"name": "scalar_input"}],
                    "outputs": [{"name": "vector_output", "dataType": "vector", "vectorLength": 4}],
                },
            ],
            "edges": [{"id": "source-vectorizer", "sourceNodeId": "source", "sourcePortIndex": 0, "targetNodeId": "vectorizer", "targetPortIndex": 0, "lineType": "normal"}],
            "faultInstances": [], "measurementPoints": [],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertEqual(result["componentOutputs"]["steps"][0]["actual"], {})

    def test_returns_reference_and_actual_curves(self):
        graph = compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["curves"]["time"], [0.0, 0.1, 0.2])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.0, 1.0, 1.0])
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [1.0, 1.0, 1.0])

    def test_measurement_curves_preserve_points_within_the_response_limit(self):
        package = valid_package()
        package["simulationConfig"] = {"duration": 100.2, "stepSize": 0.1}

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        times = result["curves"]["time"]
        samples = result["curves"]["channels"]["scope-1.ch1.actual"]
        self.assertEqual(result["metrics"]["sampleCount"], 1002)
        self.assertEqual(len(times), 1002)
        self.assertEqual(len(samples), 1002)
        self.assertEqual(times[0], 0.0)
        self.assertAlmostEqual(times[-1], 100.1)
        self.assertEqual(samples, [1.0] * 1002)

    def test_records_each_component_output_for_every_step(self):
        graph = compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertEqual(result["componentOutputs"]["time"], [0.0, 0.1, 0.2])
        self.assertEqual(len(result["componentOutputs"]["steps"]), 3)
        first_step = result["componentOutputs"]["steps"][0]
        self.assertEqual(first_step["time"], 0.0)
        self.assertEqual(first_step["actual"]["sim-1"]["output"], 1.0)
        self.assertEqual(first_step["reference"]["sim-1"]["output"], 1.0)
        self.assertNotIn("source-1", first_step["actual"])

    def test_component_output_trace_contains_instrument_sources_and_display_console_only(self):
        package = valid_package()
        package["nodes"].append({
            "id": "console-1",
            "type": "display_console",
            "parameters": {},
            "inputs": [{"name": "中心频率"}],
            "outputs": [],
        })
        package["edges"].append({
            "id": "sim-console",
            "sourceNodeId": "sim-1",
            "sourcePortIndex": 0,
            "targetNodeId": "console-1",
            "targetPortIndex": 0,
        })

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        outputs = result["componentOutputs"]["steps"][0]["actual"]
        self.assertEqual(set(outputs), {"sim-1", "console-1"})
        self.assertEqual(outputs["console-1"]["中心频率"], 1.0)

    def test_component_output_trace_keeps_explicit_diagnostic_test_point_source(self):
        package = {
            "schemaVersion": 1,
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {"id": "source", "type": "signal_source", "parameters": {"value": 2}, "inputs": [], "outputs": [{"name": "out"}]},
                {"id": "sim", "type": "simulation_block", "pythonBinding": {"moduleId": "passthrough"}, "parameters": {}, "inputs": [{"name": "in"}], "outputs": [{"name": "out"}]},
            ],
            "edges": [{"id": "source-sim", "sourceNodeId": "source", "sourcePortIndex": 0, "targetNodeId": "sim", "targetPortIndex": 0}],
            "faultInstances": [],
            "measurementPoints": [],
            "reportedNodeIds": ["source"],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertEqual(set(result["componentOutputs"]["steps"][0]["actual"]), {"source"})

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

    def test_electrical_faults_transform_edge_input_and_output_in_order(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"] = {"moduleId": "gain", "entryFunction": "process"}
        package["nodes"][1]["parameters"] = {"gain": 2.0}
        package["faultInstances"] = [
            {
                "faultId": "edge-bias",
                "faultType": "sensor_bias",
                "targetId": "edge-source-sim",
                "injectionForm": "signal-edge",
                "parameters": {"bias": 0.25},
            },
            {
                "faultId": "input-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "targetField": "inputs.input",
                "injectionForm": "signal-transform",
                "parameters": {"bias": 0.5},
            },
            {
                "faultId": "output-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "targetField": "outputs.output",
                "injectionForm": "signal-transform",
                "parameters": {"bias": 1.0},
            },
        ]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [2.0, 2.0, 2.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [4.5, 4.5, 4.5])

    def test_parameter_bias_uses_the_manifest_default_when_node_omits_the_parameter(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"] = {"moduleId": "barometer_sensor", "entryFunction": "process"}
        package["nodes"][1]["inputs"] = [{"name": "true_altitude"}]
        package["nodes"][1]["outputs"] = [{"name": "measured_altitude"}]
        package["nodes"][1]["parameters"] = {}
        package["faultInstances"] = [{
            "faultId": "barometer-bias",
            "faultType": "parameter_bias",
            "targetId": "sim-1",
            "targetField": "params.bias",
            "injectionForm": "module-variable",
            "parameters": {"bias": 0.1},
        }]

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.reference"], [1.0, 1.0, 1.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.1, 1.1, 1.1])

    def test_component_output_trace_reflects_parameter_step_faults(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "fault-parameter-step",
            "faultType": "parameter_step",
            "targetId": "sim-1",
            "enabled": True,
            "startTime": 0.1,
            "duration": 0.2,
            "parameters": {"targetValue": -0.35},
        }]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(
            [step["actual"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, -0.35, -0.35],
        )
        self.assertFloatSeriesEqual(
            [step["reference"]["sim-1"]["output"] for step in result["componentOutputs"]["steps"]],
            [1.0, 1.0, 1.0],
        )

    def test_module_parameter_bias_changes_control_allocation_output_only_in_actual_mode(self):
        package = {
            "schemaVersion": 1,
            "packageId": "control-allocation-parameter-fault",
            "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
            "nodes": [
                {"id": "moment", "type": "signal_source", "parameters": {"value": 0.5}, "outputs": [{"name": "out"}]},
                {"id": "speed", "type": "signal_source", "parameters": {"value": 0.0}, "outputs": [{"name": "out"}]},
                {"id": "altitude", "type": "signal_source", "parameters": {"value": 0.0}, "outputs": [{"name": "out"}]},
                {
                    "id": "allocation",
                    "type": "simulation_block",
                    "pythonBinding": {"moduleId": "control_allocation", "entryFunction": "process"},
                    "parameters": {},
                    "inputs": [{"name": "moment_command"}, {"name": "speed_command"}, {"name": "altitude_command"}],
                    "outputs": [{"name": "actuator_command"}],
                },
                {"id": "scope", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "moment-allocation", "sourceNodeId": "moment", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 0},
                {"id": "speed-allocation", "sourceNodeId": "speed", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 1},
                {"id": "altitude-allocation", "sourceNodeId": "altitude", "sourcePortIndex": 0, "targetNodeId": "allocation", "targetPortIndex": 2},
                {"id": "allocation-scope", "sourceNodeId": "allocation", "sourcePortIndex": 0, "targetNodeId": "scope", "targetPortIndex": 0},
            ],
            "faultInstances": [{
                "faultId": "allocation-gain-bias",
                "faultType": "parameter_bias",
                "targetId": "allocation",
                "injectionForm": "module-variable",
                "parameterKey": "allocationGain",
                "enabled": True,
                "startTime": 0.0,
                "duration": 0.0,
                "parameters": {"bias": 0.1},
            }],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1"}],
        }
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope.ch1.reference"], [0.36, 0.36, 0.36])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope.ch1.actual"], [0.396, 0.396, 0.396])

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

    def test_fault_free_session_reuses_reference_path_for_actual_path(self):
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
        session = SimulationSession(compile_graph(package, registry))

        result = session.step(3)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [0.1, 0.2, 0.3])
        self.assertEqual(session.module_states["actual"], {})
        self.assertAlmostEqual(session.module_states["reference"]["sim-1"]["total"], 0.3)

    def test_manual_disconnect_switches_a_shared_session_back_to_dual_path(self):
        session = SimulationSession(compile_graph(valid_package(), ModuleRegistry.from_builtin_manifest()))

        shared = session.step(1)
        session.fault_runtime.disconnect_edge("edge-source-sim")
        disconnected = session.step(1)

        self.assertFloatSeriesEqual(shared["curves"]["channels"]["scope-1.ch1.actual"], [1.0])
        self.assertFloatSeriesEqual(disconnected["curves"]["channels"]["scope-1.ch1.reference"], [1.0])
        self.assertFloatSeriesEqual(disconnected["curves"]["channels"]["scope-1.ch1.actual"], [0.0])

    def test_run_from_zero_clears_state_and_runs_the_full_duration(self):
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
        session = SimulationSession(compile_graph(package, registry))
        session.step(2)

        result = session.run_from_zero()

        self.assertEqual(result["curves"]["time"], [0.0, 0.1, 0.2])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [0.1, 0.2, 0.3])
        self.assertTrue(result["metrics"]["done"])

    def test_prepared_module_call_observes_parameter_changes_between_steps(self):
        package = valid_package()
        package["nodes"][1]["pythonBinding"]["moduleId"] = "gain"
        package["nodes"][1]["parameters"] = {"gain": 2.0}
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        session = SimulationSession(graph)

        first = session.step(1, paths=("actual",))
        graph.nodes["sim-1"].parameters["gain"] = 3.0
        second = session.step(1, paths=("actual",))

        self.assertIsNotNone(graph.nodes["sim-1"].prepared_call)
        self.assertEqual(first["curves"]["channels"]["scope-1.ch1.actual"], [2.0])
        self.assertEqual(second["curves"]["channels"]["scope-1.ch1.actual"], [3.0])

    def test_prepared_module_output_checks_late_vector_shape_change(self):
        package = valid_package()
        package["nodes"][1]["outputs"][0].update({"dataType": "vector", "vectorLength": 4})
        package["edges"] = package["edges"][:1]
        package["measurementPoints"] = []
        package["reportedNodeIds"] = ["sim-1"]
        registry = ModuleRegistry([RegisteredModule(
            module_id="passthrough", import_path="backend.tests.stateful_module",
            entry_function="process", inputs=("input",), outputs=("output",), parameters={},
        )])
        graph = compile_graph(package, registry)
        session = SimulationSession(graph)

        def changing_output(input, time=None):
            return {"output": [1.0, 2.0] if time >= 0.2 else [1.0, 2.0, 3.0, 4.0]}

        with patch("backend.module_registry._load_module_entry", return_value=changing_output):
            session.step(2, paths=("actual",))
            with self.assertRaises(SimulationBackendError) as context:
                session.step(1, paths=("actual",))

        self.assertTrue(graph.nodes["sim-1"].prepared_call.trusted_inputs)
        self.assertEqual(context.exception.error_code, "PORT_SHAPE_MISMATCH")

    def test_faulted_module_input_still_checks_late_invalid_value(self):
        package = valid_package()
        package["faultInstances"] = [{
            "faultId": "source-bias", "faultType": "sensor_bias", "targetId": "source-1",
            "enabled": True, "startTime": 0.0, "duration": 0.3,
            "parameters": {"bias": 0.0},
        }]
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        session = SimulationSession(graph)

        def invalid_after_two_steps(runtime, node_id, input_name, value, time):
            return math.nan if time >= 0.2 else value

        with patch("backend.simulation_engine.FaultRuntime.apply_node_input", invalid_after_two_steps):
            session.step(2, paths=("actual",))
            with self.assertRaises(SimulationBackendError) as context:
                session.step(1, paths=("actual",))

        self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
        self.assertEqual(context.exception.field, "inputs.input")

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

        session = SimulationSession(graph)
        first = session.step(1, paths=("actual",))
        first["componentOutputs"]["steps"][0]["actual"]["sim-1"]["output"] = 100.0
        second = session.step(1, paths=("actual",))
        self.assertFloatSeriesEqual(second["curves"]["channels"]["scope-1.ch1.actual"], [2.0])

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

    def test_rf_one_hundred_ghz_carrier_has_nonzero_samples_at_one_picosecond_step(self):
        package = {
            "schemaVersion": 1,
            "packageId": "rf-nanosecond-package",
            "simulationConfig": {"duration": 1e-11, "stepSize": 1e-12},
            "nodes": [
                {
                    "id": "rf-source",
                    "type": "signal_source",
                    "parameters": {
                        "signalDomain": "rf",
                        "rfModulation": "cw",
                        "amplitude": 1,
                        "centerFrequencyHz": 1e11,
                    },
                    "outputs": [{"name": "out"}],
                },
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "edge-rf-scope", "sourceNodeId": "rf-source", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
        }

        session = SimulationSession(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        result = session.step(10)
        samples = result["curves"]["channels"]["scope-1.ch1.actual"]

        self.assertEqual(result["curves"]["time"], [round(index * 1e-12, 15) for index in range(10)])
        self.assertTrue(any(abs(value) > 0.1 for value in samples[1:]))

    def test_backend_simulation_preserves_a_one_hundredth_picosecond_step(self):
        package = {
            "schemaVersion": 1,
            "packageId": "minimum-step-package",
            "simulationConfig": {"duration": 1e-13, "stepSize": 1e-14},
            "nodes": [
                {
                    "id": "source-1",
                    "type": "signal_source",
                    "parameters": {"amplitude": 1, "frequency": 1},
                    "outputs": [{"name": "out"}],
                },
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "edge-source-scope", "sourceNodeId": "source-1", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))

        self.assertEqual(result["curves"]["time"], [round(index * 1e-14, 18) for index in range(10)])

    def test_rf_downconverter_uses_source_phasor_at_interactive_step_sizes(self):
        package = {
            "schemaVersion": 1,
            "packageId": "rf-downconverter-phasor",
            "simulationConfig": {"duration": 0.003, "stepSize": 0.001},
            "nodes": [
                {
                    "id": "rf-source", "type": "signal_source",
                    "parameters": {
                        "signalDomain": "rf", "rfModulation": "cw",
                        "amplitude": 1, "centerFrequencyHz": 1_000_000_000,
                    },
                    "outputs": [{"name": "out"}],
                },
                {
                    "id": "downconverter", "type": "simulation_block",
                    "pythonBinding": {"moduleId": "rf_downconverter", "entryFunction": "process"},
                    "parameters": {"lo_frequency_hz": 980_000_000, "low_pass_cutoff_hz": 20_000_000},
                    "inputs": [{"name": "rf_input"}, {"name": "rf_input_2"}],
                    "outputs": [{"name": "if_i"}, {"name": "if_q"}],
                },
                {"id": "scope", "type": "instrument_scope", "inputs": [{"name": "CH1"}]},
            ],
            "edges": [
                {"id": "rf-input", "sourceNodeId": "rf-source", "sourcePortIndex": 0, "targetNodeId": "downconverter", "targetPortIndex": 0},
                {"id": "if-i", "sourceNodeId": "downconverter", "sourcePortIndex": 0, "targetNodeId": "scope", "targetPortIndex": 0},
            ],
            "faultInstances": [],
            "measurementPoints": [{"id": "scope.ch1", "scopeNodeId": "scope", "channel": "ch1"}],
        }

        result = run_simulation(compile_graph(package, ModuleRegistry.from_builtin_manifest()))
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope.ch1.actual"], [1.0, 1.0, 1.0])

    def test_analog_ramp_noise_and_radian_phase_match_frontend_semantics(self):
        class AnalogNode:
            def __init__(self, parameters):
                self.id = "analog-source"
                self.parameters = parameters

        self.assertAlmostEqual(
            _source_value(AnalogNode({"waveType": "sine", "amplitude": 2, "frequency": 1, "phase": math.pi / 2, "offset": 0}), 0),
            2.0,
        )
        self.assertAlmostEqual(
            _source_value(AnalogNode({"waveType": "ramp", "initialValue": 2, "slope": 3, "startTime": 0.5}), 1),
            3.5,
        )
        noise_node = AnalogNode({"waveType": "noise", "amplitude": 2, "offset": 1, "phase": 0.25})
        pseudo_random = math.sin((0.1 + 0.25) * 12.9898) * 43758.5453
        expected_noise = 1 + 2 * ((pseudo_random - math.floor(pseudo_random)) * 2 - 1)
        self.assertAlmostEqual(_source_value(noise_node, 0.1), expected_noise)
        pulse_node = AnalogNode({"waveType": "pulse", "amplitude": 8, "lowValue": -1, "frequency": 1, "dutyCycle": 25, "phase": 0})
        self.assertEqual(_source_value(pulse_node, 0.1), 8.0)
        self.assertEqual(_source_value(pulse_node, 0.5), -1.0)

    def test_rf_modulation_modes_generate_carrier_based_outputs(self):
        class RfNode:
            def __init__(self, node_id, parameters):
                self.id = node_id
                self.parameters = parameters

        base = {"signalDomain": "rf", "amplitude": 10, "centerFrequencyHz": 1}
        self.assertAlmostEqual(_source_value(RfNode("cw", {**base, "rfModulation": "cw"}), 0.25), 10.0)
        self.assertAlmostEqual(
            _source_value(RfNode("am", {**base, "rfModulation": "am", "modulationDepthRatio": 0.5, "modulationRateHz": 1}), 0.25),
            15.0,
        )
        self.assertAlmostEqual(
            _source_value(RfNode("fm", {**base, "rfModulation": "fm", "frequencyDeviationHz": 1, "modulationRateHz": 1}), 0.25),
            10.0 * math.sin(math.pi / 2.0 + 1.0),
        )
        self.assertAlmostEqual(
            _source_value(RfNode("pm", {**base, "rfModulation": "pm", "phaseDeviationRad": math.pi / 2.0, "modulationRateHz": 1}), 0.25),
            0.0,
        )
        self.assertAlmostEqual(
            _source_value(RfNode("pulse", {**base, "rfModulation": "pulse", "pulseWidthSeconds": 0.5, "pulsePeriodSeconds": 1}), 0.25),
            10.0,
        )
        self.assertEqual(
            _source_value(RfNode("pulse", {**base, "rfModulation": "pulse", "pulseWidthSeconds": 0.5, "pulsePeriodSeconds": 1}), 0.75),
            0.0,
        )
        self.assertAlmostEqual(
            abs(_source_value(RfNode("digital", {**base, "rfModulation": "digital", "symbolRateHz": 1, "sampleRateHz": 2}), 0.25)),
            10.0,
        )
        self.assertNotEqual(
            _source_value(RfNode("noise", {**base, "rfModulation": "noise", "snrDb": 0, "bandwidthHz": 1e6}), 0.25),
            10.0,
        )
        clean_am = _source_value(RfNode("am-clean", {**base, "rfModulation": "am", "modulationDepthRatio": 0}), 0.25)
        noisy_am = _source_value(RfNode("am-noisy", {
            **base,
            "rfModulation": "am",
            "modulationDepthRatio": 0,
            "additiveNoiseEnabled": True,
            "additiveNoiseSnrDb": 0,
            "additiveNoiseBandwidthHz": 1e6,
        }), 0.25)
        self.assertNotEqual(noisy_am, clean_am)

    def test_additive_rf_noise_changes_between_adjacent_rf_samples(self):
        class RfNode:
            def __init__(self, parameters):
                self.id = "wideband-noise-source"
                self.parameters = parameters

        base = {
            "signalDomain": "rf",
            "amplitude": 10,
            "centerFrequencyHz": 1e9,
            "rfModulation": "cw",
        }
        clean = RfNode(base)
        noisy = RfNode({
            **base,
            "additiveNoiseEnabled": True,
            "additiveNoiseSnrDb": 45,
            "additiveNoiseBandwidthHz": 1e6,
        })
        times = [0.0, 20e-12, 40e-12]
        noise_values = [
            _source_value(noisy, time) - _source_value(clean, time)
            for time in times
        ]

        self.assertEqual(noise_values[0], _source_value(noisy, times[0]) - _source_value(clean, times[0]))
        self.assertEqual(len({round(value, 12) for value in noise_values}), len(noise_values))

    def test_additive_noise_is_applied_to_complex_envelope_iq_during_pulse_off_time(self):
        class ComplexRfNode:
            def __init__(self, node_id, parameters):
                self.id = node_id
                self.parameters = parameters
                self.output_ports = ({"dataType": "rf_complex_envelope"},)

        base = {
            "signalDomain": "rf",
            "rfComplexEnvelopeOutput": 1,
            "amplitude": 0.31622776601683794,
            "centerFrequencyHz": 20e9,
            "pulseWidthSeconds": 1e-3,
            "pulsePeriodSeconds": 10e-3,
        }
        clean = ComplexRfNode("complex-clean", base)
        noisy = ComplexRfNode("complex-noisy", {
            **base,
            "additiveNoiseEnabled": 1,
            "additiveNoiseSnrDb": 0,
            "additiveNoiseBandwidthHz": 1e6,
        })

        clean_off_pulse = _source_value(clean, 5e-3)
        noisy_off_pulse = _source_value(noisy, 5e-3)
        noisy_next_sample = _source_value(noisy, 5e-3 + 0.1e-6)

        self.assertEqual(clean_off_pulse["i"], 0.0)
        self.assertEqual(clean_off_pulse["q"], 0.0)
        self.assertEqual(noisy_off_pulse["referenceFrequencyHz"], 20e9)
        self.assertNotEqual((noisy_off_pulse["i"], noisy_off_pulse["q"]), (0.0, 0.0))
        self.assertNotEqual(
            (noisy_off_pulse["i"], noisy_off_pulse["q"]),
            (noisy_next_sample["i"], noisy_next_sample["q"]),
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
        self.assertIn("attitude_feedback", first_step["sensor"])
        self.assertEqual(set(first_step), {"sensor"})
        # The source port index is now honored.  With equal rotor thrust, the
        # symmetric configuration has zero attitude feedback but positive altitude.
        self.assertEqual(result["curves"]["channels"]["scope-1.ch1.actual"][-1], 0.0)


if __name__ == "__main__":
    unittest.main()
