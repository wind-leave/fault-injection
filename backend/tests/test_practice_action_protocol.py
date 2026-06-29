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
            "target": {"type": "wire", "id": "edge-source-sim"},
            "faultId": "fault-wire-open",
            "steps": 2,
        })

        self.assertEqual(normalized["actionType"], "replaceWire")
        self.assertEqual(normalized["target"], {"type": "wire", "id": "edge-source-sim"})
        self.assertEqual(normalized["targetId"], "edge-source-sim")
        self.assertEqual(normalized["faultId"], "fault-wire-open")
        self.assertEqual(normalized["steps"], 2)

    def test_rejects_missing_fault_id(self):
        with self.assertRaises(SimulationBackendError) as context:
            normalize_practice_action({
                "protocolVersion": "1.0",
                "operationId": "op-003",
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
            })

        self.assertEqual(context.exception.error_code, "INVALID_ACTION_SCHEMA")
        self.assertEqual(context.exception.field, "faultId")

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


if __name__ == "__main__":
    unittest.main()
