import unittest

from backend.fault_runtime import FaultRuntime


class FaultRuntimeTests(unittest.TestCase):
    def test_protocol_faults_apply_to_complete_vector_messages(self):
        cases = [
            ("sensor_bias", {"bias": 0.5}, [1.5, 2.5]),
            ("signal_stuck", {}, [1.0, 2.0]),
            ("parameter_drift", {"rate": 0.5}, [1.5, 2.5]),
            ("parameter_step", {"targetValue": 0.5}, [0.5, 0.5]),
        ]
        for fault_type, parameters, expected in cases:
            with self.subTest(fault_type=fault_type):
                runtime = FaultRuntime([{
                    "faultId": "protocol-fault", "faultType": fault_type, "targetId": "wire",
                    "injectionForm": "protocol-bus", "targetField": "can.payload",
                    "vectorInjectionScope": "item", "vectorIndex": 1,
                    "startTime": 1.0, "duration": 2.0, "parameters": parameters,
                }])
                self.assertEqual(runtime.apply_edge_value("wire", [1.0, 2.0], 0), [1.0, 2.0])
                self.assertEqual(runtime.apply_edge_value("wire", [1.0, 2.0], 2), expected)
                if fault_type == "signal_stuck":
                    self.assertEqual(runtime.apply_edge_value("wire", [50.0, 60.0], 2.5), [1.0, 2.0])
                self.assertEqual(runtime.apply_edge_value("wire", [1.0, 2.0], 4), [1.0, 2.0])

    def test_electrical_fault_types_transform_scalars_and_complex_envelopes(self):
        envelope = {"i": 3.0, "q": -4.0, "referenceFrequencyHz": 20e9, "impedanceOhm": 50}
        cases = [
            ("sensor_bias", {"bias": 2.0}, 5.0, -2.0),
            ("signal_stuck", {}, 3.0, -4.0),
            ("parameter_drift", {"rate": 2.0}, 5.0, -2.0),
            ("parameter_step", {"targetValue": 2.0}, 2.0, 2.0),
        ]
        for fault_type, parameters, expected_i, expected_q in cases:
            with self.subTest(fault_type=fault_type):
                runtime = FaultRuntime([{
                    "faultId": "electrical-fault",
                    "faultType": fault_type,
                    "targetId": "rf-module",
                    "targetField": "outputs.envelope",
                    "startTime": 1.0,
                    "duration": 2.0,
                    "parameters": parameters,
                }])
                self.assertEqual(runtime.apply_node_output("rf-module", envelope, 0, "envelope"), envelope)
                actual = runtime.apply_node_output("rf-module", envelope, 2, "envelope")
                self.assertEqual(actual, {**envelope, "i": expected_i, "q": expected_q})
                scalar_runtime = FaultRuntime(runtime.fault_instances)
                self.assertEqual(scalar_runtime.apply_node_output("rf-module", 3.0, 2, "envelope"), expected_i)
                self.assertEqual(runtime.apply_node_output("rf-module", envelope, 4, "envelope"), envelope)
                self.assertEqual(runtime.apply_node_output("rf-module", envelope, 2, "other"), envelope)

    def test_intermittent_physical_parameters_alternate_and_recover(self):
        fault = {
            "faultId": "physical-intermittent",
            "faultType": "intermittent",
            "targetId": "controller",
            "injectionForm": "module-variable",
            "parameterKeys": ["gain", "bias"],
            "startTime": 1.0,
            "duration": 4.0,
            "parameters": {"value": 0.0, "period": 2.0, "duty": 0.25},
        }
        runtime = FaultRuntime([fault])
        nominal = {"gain": 8.0, "bias": 3.0}
        for time, active in [(0, False), (1, True), (1.5, False), (2, False), (3, True), (3.5, False), (5.5, False)]:
            with self.subTest(time=time):
                self.assertEqual(
                    runtime.apply_node_parameters("controller", nominal, time),
                    {"gain": 0.0, "bias": 0.0} if active else nominal,
                )
        self.assertEqual(nominal, {"gain": 8.0, "bias": 3.0})

    def test_intermittent_physical_fault_duty_cycle_extremes(self):
        for duty, expected in [(0.0, 8.0), (1.0, 2.0)]:
            with self.subTest(duty=duty):
                runtime = FaultRuntime([{
                    "faultId": "physical-intermittent",
                    "faultType": "intermittent",
                    "targetId": "controller",
                    "injectionForm": "module-variable",
                    "parameterKey": "gain",
                    "parameters": {"value": 2.0, "period": 1.0, "duty": duty},
                }])
                self.assertEqual(runtime.apply_node_parameters("controller", {"gain": 8.0}, 0.5)["gain"], expected)

    def test_sensor_bias_applies_only_in_active_window(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.1,
                "duration": 0.2,
                "parameters": {"bias": 0.5},
            }
        ])

        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.0), 1.0)
        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.1), 1.5)
        self.assertEqual(runtime.apply_node_output("sim-1", 1.0, 0.4), 1.0)

    def test_motor_efficiency_loss_scales_output(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-motor",
                "faultType": "motor_efficiency_loss",
                "targetId": "motor-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 1.0,
                "parameters": {"efficiency": 0.25},
            }
        ])

        self.assertEqual(runtime.apply_node_output("motor-1", 8.0, 0.1), 2.0)

    def test_signal_attenuation_reduces_signal_amplitude_in_decibels(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-attenuation",
                "faultType": "signal_attenuation",
                "targetId": "rf-1",
                "parameters": {"attenuation_db": 6.0},
            }
        ])

        self.assertAlmostEqual(runtime.apply_node_output("rf-1", 1.0, 0.0), 10.0 ** (-6.0 / 20.0))

    def test_protocol_edge_attenuation_uses_a_coefficient(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-link-attenuation",
                "faultType": "signal_attenuation",
                "targetId": "edge-1",
                "startTime": 2.0,
                "parameters": {"scale": 0.25},
            }
        ])

        self.assertEqual(runtime.apply_edge_value("edge-1", 8.0, 1.9), 8.0)
        self.assertEqual(runtime.apply_edge_value("edge-1", 8.0, 2.0), 2.0)

    def test_signal_cutoff_sets_data_to_zero_from_its_start_time(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-cutoff",
                "faultType": "signal_cutoff",
                "targetId": "rf-1",
                "startTime": 2.0,
                "parameters": {},
            }
        ])

        self.assertEqual(runtime.apply_node_output("rf-1", 3.5, 1.9), 3.5)
        self.assertEqual(runtime.apply_node_output("rf-1", 3.5, 2.0), 0.0)

    def test_frontend_layered_faults_preserve_complex_envelope_frames(self):
        envelope = {
            "i": 3.0,
            "q": -4.0,
            "referenceFrequencyHz": 20e9,
            "impedanceOhm": 50.0,
        }
        attenuation = FaultRuntime([{
            "faultId": "complex-attenuation",
            "faultType": "signal_attenuation",
            "targetId": "complex-edge",
            "parameters": {"scale": 0.5},
        }])
        self.assertEqual(attenuation.apply_edge_value("complex-edge", envelope, 0.0), {
            **envelope, "i": 1.5, "q": -2.0,
        })

        cutoff = FaultRuntime([{
            "faultId": "complex-cutoff",
            "faultType": "signal_cutoff",
            "targetId": "complex-edge",
            "parameters": {},
        }])
        self.assertEqual(cutoff.apply_edge_value("complex-edge", envelope, 0.0), {
            **envelope, "i": 0.0, "q": 0.0,
        })
        self.assertEqual(cutoff.apply_edge_value("complex-edge", [envelope, {
            **envelope, "i": -2.0, "referenceFrequencyHz": 21e9,
        }], 0.1), [{
            **envelope, "i": 0.0, "q": 0.0,
        }, {
            **envelope, "i": 0.0, "q": 0.0, "referenceFrequencyHz": 21e9,
        }])

        frozen = FaultRuntime([{
            "faultId": "complex-freeze",
            "faultType": "signal_stuck",
            "targetId": "complex-edge",
            "parameters": {},
        }])
        first = frozen.apply_edge_value("complex-edge", envelope, 0.0)
        self.assertEqual(first, envelope)
        self.assertEqual(frozen.apply_edge_value("complex-edge", {
            **envelope, "i": 9.0, "q": 8.0,
        }, 0.1), envelope)

    def test_parameter_degradation_scales_a_module_parameter(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-degradation",
                "faultType": "parameter_degradation",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "parameterKey": "scale",
                "parameters": {"scale": 0.8},
            }
        ])

        parameters = runtime.apply_node_parameters("sensor-1", {"scale": 1.25}, 0.0)

        self.assertEqual(parameters["scale"], 1.0)

    def test_parameter_freeze_holds_the_value_at_fault_start(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-freeze",
                "faultType": "parameter_freeze",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "parameterKey": "bias",
                "startTime": 1.0,
                "parameters": {},
            }
        ])

        self.assertEqual(runtime.apply_node_parameters("sensor-1", {"bias": 2.0}, 1.0)["bias"], 2.0)
        self.assertEqual(runtime.apply_node_parameters("sensor-1", {"bias": 8.0}, 2.0)["bias"], 2.0)

    def test_parameter_random_is_repeatable_for_the_same_seed_and_time(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-random",
                "faultType": "parameter_random",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "parameterKey": "bias",
                "parameters": {"seed": 7, "std": 0.5},
            }
        ])

        first = runtime.apply_node_parameters("sensor-1", {"bias": 2.0}, 0.1)["bias"]
        repeated = runtime.apply_node_parameters("sensor-1", {"bias": 2.0}, 0.1)["bias"]
        next_step = runtime.apply_node_parameters("sensor-1", {"bias": 2.0}, 0.2)["bias"]

        self.assertEqual(first, repeated)
        self.assertNotEqual(first, next_step)
        self.assertGreaterEqual(first, 1.5)
        self.assertLessEqual(first, 2.5)

    def test_parameter_step_sets_the_parameter_to_its_target_value(self):
        step_runtime = FaultRuntime([
            {
                "faultId": "step",
                "faultType": "parameter_step",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "targetField": "parameter.bias",
                "parameters": {"targetValue": 0.5},
            }
        ])
        random_runtime = FaultRuntime([
            {
                "faultId": "random",
                "faultType": "parameter_random",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "targetField": "parameters.bias",
                "parameters": {"seed": 1, "std": 1},
            }
        ])

        self.assertEqual(step_runtime.apply_node_parameters("sensor-1", {"bias": 2.0}, 0.0)["bias"], 0.5)
        self.assertNotEqual(random_runtime.apply_node_parameters("sensor-1", {"bias": 0.0}, 0.0)["bias"], 0.0)

    def test_one_parameter_step_fault_can_set_multiple_component_parameters(self):
        runtime = FaultRuntime([
            {
                "faultId": "multi-parameter-step",
                "faultType": "parameter_step",
                "targetId": "sensor-1",
                "injectionForm": "module-variable",
                "parameterKey": "bias",
                "parameterKeys": ["bias", "scale"],
                "parameters": {"targetValue": 0.5},
            }
        ])

        self.assertEqual(
            runtime.apply_node_parameters("sensor-1", {"bias": 2.0, "scale": 1.5}, 0.0),
            {"bias": 0.5, "scale": 0.5},
        )

    def test_electrical_faults_match_named_inputs_outputs_and_edges(self):
        runtime = FaultRuntime([
            {
                "faultId": "input-bias",
                "faultType": "sensor_bias",
                "targetId": "sensor-1",
                "targetField": "inputs.true_altitude",
                "injectionForm": "signal-transform",
                "parameters": {"bias": 2.0},
            },
            {
                "faultId": "output-bias",
                "faultType": "sensor_bias",
                "targetId": "sensor-1",
                "targetField": "outputs.measured_altitude",
                "injectionForm": "signal-transform",
                "parameters": {"bias": 3.0},
            },
            {
                "faultId": "edge-bias",
                "faultType": "sensor_bias",
                "targetId": "edge-source-sensor",
                "injectionForm": "signal-edge",
                "parameters": {"bias": 4.0},
            },
        ])

        self.assertEqual(runtime.apply_node_input("sensor-1", "true_altitude", 10.0, 0.0), 12.0)
        self.assertEqual(runtime.apply_node_input("sensor-1", "other", 10.0, 0.0), 10.0)
        self.assertEqual(
            runtime.apply_node_output("sensor-1", 10.0, 0.0, output_name="measured_altitude"),
            13.0,
        )
        self.assertEqual(runtime.apply_node_output("sensor-1", 10.0, 0.0, output_name="other"), 10.0)
        self.assertEqual(runtime.apply_edge_value("edge-source-sensor", 10.0, 0.0), 14.0)

    def test_vector_fault_can_target_one_item_or_the_complete_vector(self):
        selected_item_runtime = FaultRuntime([
            {
                "faultId": "vector-item-bias",
                "faultType": "sensor_bias",
                "targetId": "sensor-1",
                "targetField": "outputs.gyro",
                "injectionForm": "signal-transform",
                "vectorInjectionScope": "item",
                "vectorIndex": 1,
                "parameters": {"bias": 2.5},
            }
        ])
        all_items_runtime = FaultRuntime([
            {
                "faultId": "vector-all-bias",
                "faultType": "sensor_bias",
                "targetId": "sensor-1",
                "targetField": "outputs.gyro",
                "injectionForm": "signal-transform",
                "parameters": {"bias": 2.5},
            }
        ])

        self.assertEqual(
            selected_item_runtime.apply_node_output("sensor-1", [1.0, 2.0, 3.0], 0.0, output_name="gyro"),
            [1.0, 4.5, 3.0],
        )
        self.assertEqual(
            all_items_runtime.apply_node_output("sensor-1", [1.0, 2.0, 3.0], 0.0, output_name="gyro"),
            [3.5, 4.5, 5.5],
        )

    def test_vector_module_parameter_fault_can_target_one_item(self):
        runtime = FaultRuntime([
            {
                "faultId": "vector-parameter-step",
                "faultType": "parameter_step",
                "targetId": "controller-1",
                "injectionForm": "module-variable",
                "parameterKey": "gains",
                "vectorInjectionScope": "item",
                "vectorIndex": 2,
                "parameters": {"targetValue": 0.5},
            }
        ])

        self.assertEqual(
            runtime.apply_node_parameters("controller-1", {"gains": [1.0, 2.0, 3.0]}, 0.0)["gains"],
            [1.0, 2.0, 0.5],
        )

    def test_vector_fault_can_target_selected_items(self):
        runtime = FaultRuntime([
            {
                "faultId": "vector-selected-bias",
                "faultType": "sensor_bias",
                "targetId": "sensor-1",
                "targetField": "outputs.gyro",
                "injectionForm": "signal-transform",
                "vectorInjectionScope": "items",
                "vectorIndices": [0, 2, 2, 8],
                "parameters": {"bias": 2.5},
            }
        ])

        self.assertEqual(
            runtime.apply_node_output("sensor-1", [1.0, 2.0, 3.0], 0.0, output_name="gyro"),
            [3.5, 2.0, 5.5],
        )

    def test_protocol_edge_fault_applies_to_the_complete_vector_payload(self):
        runtime = FaultRuntime([
            {
                "faultId": "vector-edge-attenuation",
                "faultType": "signal_attenuation",
                "targetId": "edge-command",
                "injectionForm": "protocol-bus",
                # Older records may contain a partial vector selection.  The
                # protocol layer still faults the complete message payload.
                "vectorInjectionScope": "items",
                "vectorIndices": [0, 2],
                "parameters": {"scale": 0.5},
            }
        ])

        self.assertEqual(
            runtime.apply_edge_value("edge-command", [8.0, 4.0, 2.0], 0.0),
            [4.0, 2.0, 1.0],
        )

    def test_electrical_freeze_noise_and_intermittent_faults_transform_signals(self):
        runtime = FaultRuntime([
            {
                "faultId": "output-freeze",
                "faultType": "signal_stuck",
                "targetId": "sensor-1",
                "targetField": "outputs.measured_altitude",
                "injectionForm": "signal-transform",
                "parameters": {},
            },
            {
                "faultId": "input-noise",
                "faultType": "noise_increase",
                "targetId": "sensor-1",
                "targetField": "inputs.true_altitude",
                "injectionForm": "signal-transform",
                "parameters": {"seed": 7, "amplitude": 0.5},
            },
            {
                "faultId": "edge-intermittent",
                "faultType": "intermittent",
                "targetId": "edge-source-sensor",
                "injectionForm": "signal-edge",
                "parameters": {"period": 2.0, "duty": 0.5},
            },
        ])

        self.assertEqual(
            runtime.apply_node_output("sensor-1", 4.0, 0.0, output_name="measured_altitude"),
            4.0,
        )
        self.assertEqual(
            runtime.apply_node_output("sensor-1", 9.0, 0.1, output_name="measured_altitude"),
            4.0,
        )
        first_noise = runtime.apply_node_input("sensor-1", "true_altitude", 10.0, 0.1)
        self.assertEqual(first_noise, runtime.apply_node_input("sensor-1", "true_altitude", 10.0, 0.1))
        self.assertNotEqual(first_noise, 10.0)
        self.assertEqual(runtime.apply_edge_value("edge-source-sensor", 3.0, 0.0), 3.0)
        self.assertEqual(runtime.apply_edge_value("edge-source-sensor", 9.0, 0.2), 3.0)
        self.assertEqual(runtime.apply_edge_value("edge-source-sensor", 9.0, 1.1), 9.0)

    def test_link_loss_holds_previous_edge_value(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-link",
                "faultType": "link_loss",
                "targetId": "edge-1",
                "enabled": True,
                "startTime": 0.0,
                "duration": 1.0,
                "parameters": {},
            }
        ])

        self.assertEqual(runtime.apply_edge_value("edge-1", 4.0, 0.0), 4.0)
        self.assertEqual(runtime.apply_edge_value("edge-1", 9.0, 0.1), 4.0)

    def test_emits_fault_started_event_once(self):
        runtime = FaultRuntime([
            {
                "faultId": "fault-bias",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": True,
                "startTime": 0.1,
                "duration": 0.2,
                "parameters": {"bias": 0.5},
            }
        ])

        self.assertEqual(runtime.collect_events(0.0), [])
        self.assertEqual(runtime.collect_events(0.1)[0]["type"], "fault_started")
        self.assertEqual(runtime.collect_events(0.2), [])

    def test_disabled_fault_does_not_emit_late_ended_event(self):
        runtime = FaultRuntime([
            {
                "faultId": "cleared-fault",
                "faultType": "sensor_bias",
                "targetId": "sim-1",
                "enabled": False,
                "startTime": 0.1,
                "duration": 0.2,
                "parameters": {"bias": 0.5},
            }
        ])

        self.assertEqual(runtime.collect_events(0.4), [])


if __name__ == "__main__":
    unittest.main()
