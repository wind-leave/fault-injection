import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.practice_action_rules import PracticeActionRuleEngine
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

    def test_reports_satisfied_when_no_safety_prerequisite_is_configured(self):
        engine = self._engine(package_with_fault())

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {"safetyPrerequisiteSatisfied": True, "safetyViolation": False})

    def test_reports_satisfied_for_wire_replacement_without_safety_prerequisite(self):
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

        self.assertEqual(result, {"safetyPrerequisiteSatisfied": True, "safetyViolation": False})

    def test_does_not_consider_fault_state_when_checking_safety(self):
        engine = self._engine(package_with_fault(enabled=False))

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "fault-bias",
        })

        self.assertEqual(result, {"safetyPrerequisiteSatisfied": True, "safetyViolation": False})

    def test_ignores_optional_fault_id_when_checking_safety(self):
        engine = self._engine(package_with_fault())

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "faultId": "missing-fault",
        })

        self.assertEqual(result, {"safetyPrerequisiteSatisfied": True, "safetyViolation": False})

    def test_reports_safety_violation_without_blocking_action_execution(self):
        engine = self._engine(package_with_fault())
        engine = PracticeActionRuleEngine(engine.simulation_session, rules={
            "replaceComponent": {"requiresPowerOff": True},
        })

        result = engine.evaluate({
            "actionType": "replaceComponent",
            "target": {"type": "component", "id": "sim-1"},
            "targetId": "sim-1",
            "safetyState": {"powerOff": False},
        })

        self.assertEqual(result, {"safetyPrerequisiteSatisfied": False, "safetyViolation": True})


if __name__ == "__main__":
    unittest.main()
