import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.schemas import SimulationBackendError
from backend.simulation_engine import SimulationSession
from backend.tests.fixtures import valid_package


def package_with_fault(fault_id="fault-bias", target_id="sim-1", enabled=True):
    package = valid_package()
    package["faultInstances"] = [{
        "faultId": fault_id,
        "faultType": "sensor_bias",
        "targetId": target_id,
        "enabled": enabled,
        "startTime": 0.0,
        "duration": 0.3,
        "parameters": {"bias": 0.5},
    }]
    return package


class PracticeActionRuleEngineTests(unittest.TestCase):
    def _engine(self, package):
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        session = SimulationSession(graph, run_id="rule-engine-test")
        return PracticeActionRuleEngine(session)

    def test_allows_enabled_replace_component_fault(self):
        engine = self._engine(package_with_fault())

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {
            "allowed": True,
            "ruleCode": "ACTION_ALLOWED",
            "durationSeconds": 120,
            "riskLevel": "medium",
            "repeatAction": False,
            "warnings": [],
        })

    def test_allows_enabled_replace_wire_fault(self):
        engine = self._engine(package_with_fault(
            fault_id="fault-wire-open",
            target_id="edge-source-sim",
        ))

        result = engine.evaluate({
            "actionType": "replaceWire",
            "target": {"type": "wire", "id": "edge-source-sim"},
            "targetId": "edge-source-sim",
            "faultId": "fault-wire-open",
        })

        self.assertEqual(result["allowed"], True)
        self.assertEqual(result["ruleCode"], "ACTION_ALLOWED")
        self.assertEqual(result["durationSeconds"], 90)
        self.assertEqual(result["riskLevel"], "low")

    def test_returns_repeat_repair_for_disabled_fault(self):
        engine = self._engine(package_with_fault(enabled=False))

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {
            "allowed": False,
            "ruleCode": "REPEAT_REPAIR",
            "durationSeconds": 0,
            "riskLevel": "none",
            "repeatAction": True,
            "warnings": ["fault is already repaired"],
        })

    def test_rejects_unknown_fault_id(self):
        engine = self._engine(package_with_fault())

        with self.assertRaises(SimulationBackendError) as context:
            engine.evaluate({
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "sim-1"},
                "targetId": "sim-1",
                "faultId": "missing-fault",
            })

        self.assertEqual(context.exception.error_code, "TARGET_NOT_FOUND")
        self.assertEqual(context.exception.field, "faultId")

    def test_rejects_target_mismatch(self):
        engine = self._engine(package_with_fault())

        with self.assertRaises(SimulationBackendError) as context:
            engine.evaluate({
                "actionType": "replaceComponent",
                "target": {"type": "component", "id": "source-1"},
                "targetId": "source-1",
                "faultId": "fault-bias",
            })

        self.assertEqual(context.exception.error_code, "TARGET_MISMATCH")
        self.assertEqual(context.exception.field, "target.id")


if __name__ == "__main__":
    unittest.main()
