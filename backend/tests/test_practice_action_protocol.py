import unittest

from backend.practice_action_protocol import normalize_practice_action
from backend.schemas import SimulationBackendError


class PracticeActionProtocolTests(unittest.TestCase):
    def test_normalizes_replace_component_action(self):
        normalized = normalize_practice_action({
            "protocolVersion": "1.0",
            "operationId": "op-001",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "faultId": "fault-bias",
            "clientTime": "2026-06-29T15:30:00+08:00",
            "rawAction": {"sceneObjectId": "3d-sim-1"},
        })

        self.assertEqual(normalized["protocolVersion"], "1.0")
        self.assertEqual(normalized["operationId"], "op-001")
        self.assertEqual(normalized["actionType"], "replaceComponent")
        self.assertEqual(normalized["target"], {"type": "component", "id": "sim-1"})
        self.assertEqual(normalized["targetId"], "sim-1")
        self.assertEqual(normalized["faultId"], "fault-bias")
        self.assertEqual(normalized["steps"], 1)
        self.assertEqual(normalized["rawAction"], {"sceneObjectId": "3d-sim-1"})

    def test_normalizes_replace_wire_action(self):
        normalized = normalize_practice_action({
            "protocolVersion": "1.0",
            "operationId": "op-002",
            "actionType": "replaceWire",
            "sourceComponentId": "source-1",
            "sourcePortId": "out",
            "targetComponentId": "passthrough",
            "targetPortId": "input",
            "faultId": "fault-wire-open",
            "steps": 2,
        })

        self.assertEqual(normalized["actionType"], "replaceWire")
        self.assertEqual(normalized["target"], {"type": "wire"})
        self.assertNotIn("targetId", normalized)
        self.assertEqual(normalized["sourceComponentId"], "source-1")
        self.assertEqual(normalized["sourcePortId"], "out")
        self.assertEqual(normalized["targetComponentId"], "passthrough")
        self.assertEqual(normalized["targetPortId"], "input")
        self.assertEqual(normalized["faultId"], "fault-wire-open")
        self.assertEqual(normalized["steps"], 2)

    def test_keeps_legacy_replace_wire_target_compatible(self):
        normalized = normalize_practice_action({
            "actionType": "replaceWire",
            "target": {"type": "wire", "id": "edge-source-sim"},
        })

        self.assertEqual(normalized["targetId"], "edge-source-sim")

    def test_accepts_public_connection_field_names_for_replace_wire(self):
        normalized = normalize_practice_action({
            "actionType": "replaceWire",
            "sourceDeviceId": "external-device",
            "sourcePort": "output",
            "targetDeviceId": "subsystem-1",
            "targetPort": "input",
        })

        self.assertEqual(normalized["sourceComponentId"], "external-device")
        self.assertEqual(normalized["sourcePortId"], "output")
        self.assertEqual(normalized["targetComponentId"], "subsystem-1")
        self.assertEqual(normalized["targetPortId"], "input")

    def test_rejects_incomplete_replace_wire_endpoints(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "actionType": "replaceWire",
                "sourceComponentId": "source-1",
                "sourcePortId": "out",
                "targetComponentId": "passthrough",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "targetPortId")

    def test_normalizes_measure_point_without_fault_id(self):
        normalized = normalize_practice_action({
            "protocolVersion": "1.0",
            "operationId": "op-measure",
            "actionType": "measurePoint",
            "componentId": "sim-1",
            "portId": "socket03",
            "elementName": "输出",
            "steps": 2,
            "observed": "normal",
        })

        self.assertEqual(normalized["actionType"], "measurePoint")
        self.assertEqual(normalized["target"], {"type": "testPoint", "id": "sim-1::socket03"})
        self.assertEqual(normalized["targetId"], "sim-1::socket03")
        self.assertEqual(normalized["componentId"], "sim-1")
        self.assertEqual(normalized["portId"], "socket03")
        self.assertEqual(normalized["elementName"], "输出")
        self.assertNotIn("pointCode", normalized)
        self.assertNotIn("faultId", normalized)
        self.assertNotIn("observed", normalized)

    def test_rejects_nested_measurement_endpoint_without_top_level_fields(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "operationId": "op-measure-endpoint",
                "actionType": "measurePoint",
                "measurementEndpoint": {"componentId": "sim-1", "portId": "socket03"},
                "elementName": "输出",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "componentId")

    def test_normalizes_top_level_measurement_endpoint(self):
        normalized = normalize_practice_action({
            "operationId": "op-measure-top-level-endpoint",
            "actionType": "measurePoint",
            "componentId": "scope-1",
            "portId": "CH1",
            "elementName": "俯仰",
        })

        self.assertEqual(normalized["componentId"], "scope-1")
        self.assertEqual(normalized["portId"], "CH1")
        self.assertEqual(normalized["elementName"], "俯仰")

    def test_does_not_keep_legacy_directional_vector_element_fields(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "actionType": "measurePoint",
                "componentId": "scope-1",
                "portId": "CH1",
                "sourceVectorElementName": "俯仰",
                "targetVectorElementName": "俯仰输入",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "elementName")

    def test_rejects_measure_point_without_component_id(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": "scope-1.ch1"},
                "portId": "CH1",
                "elementName": "输入",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "componentId")

    def test_rejects_measure_point_without_port_id(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "actionType": "measurePoint",
                "componentId": "scope-1",
                "elementName": "输入",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "portId")

    def test_rejects_measure_point_without_element_name(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "actionType": "measurePoint",
                "componentId": "scope-1",
                "portId": "CH1",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "elementName")

    def test_rejects_measure_point_with_wrong_target_type(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-measure",
                "actionType": "measurePoint",
                "target": {"type": "component", "id": "sim-1"},
                "componentId": "sim-1",
                "portId": "socket03",
                "elementName": "输出",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "target.type")

    def test_normalizes_replacement_without_fault_id(self):
        normalized = normalize_practice_action({
            "protocolVersion": "1.0",
            "operationId": "op-003",
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
        })

        self.assertEqual(normalized["targetId"], "sim-1")
        self.assertNotIn("faultId", normalized)

    def test_rejects_wrong_target_type_for_action(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-004",
                "actionType": "replaceWire",
                "target": {"type": "component", "id": "sim-1"},
                "faultId": "fault-wire-open",
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "target.type")

    def test_rejects_unsupported_action_type(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-005",
                "actionType": "measure",
                "target": {"type": "testPoint", "id": "point-M1"},
                "faultId": "fault-bias",
            })

        self.assertEqual(context.exception.error_code, "UNSUPPORTED_ACTION_TYPE")
        self.assertEqual(context.exception.field, "actionType")

    def test_normalizes_display_console_parameter_action(self):
        normalized = normalize_practice_action({
            "operationId": "op-console-1",
            "actionType": "adjustDisplayConsoleParameter",
            "target": {"type": "displayConsole", "id": "console-1"},
            "componentId": "source-1",
            "parameters": {"value": 2.5},
        })

        self.assertEqual(normalized["targetId"], "console-1")
        self.assertEqual(normalized["componentId"], "source-1")
        self.assertEqual(normalized["parameters"], {"value": 2.5})

    def test_rejects_multiple_display_console_parameters_in_one_action(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "operationId": "op-console-many",
                "actionType": "adjustDisplayConsoleParameter",
                "target": {"type": "displayConsole", "id": "console-1"},
                "componentId": "source-1",
                "parameters": {"value": 2.5, "frequency": 100.0},
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "parameters")


if __name__ == "__main__":
    unittest.main()
