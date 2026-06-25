import unittest

from backend.fault_runtime import FaultRuntime


class FaultRuntimeTests(unittest.TestCase):
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
