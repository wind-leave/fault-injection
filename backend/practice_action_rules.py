from backend.schemas import SimulationBackendError


DEFAULT_RULES = {
    "replaceComponent": {"durationSeconds": 120, "riskLevel": "medium"},
    "replaceWire": {"durationSeconds": 90, "riskLevel": "low"},
}


def _text(value):
    if value is None:
        return ""
    return str(value).strip()


class PracticeActionRuleEngine:
    def __init__(self, simulation_session, rules=None):
        self.simulation_session = simulation_session
        self.rules = rules if isinstance(rules, dict) else DEFAULT_RULES

    def evaluate(self, action):
        action_type = _text(action.get("actionType"))
        target_id = _text(action.get("targetId"))
        fault_id = _text(action.get("faultId"))
        fault = self._find_fault(fault_id)
        if fault is None:
            raise SimulationBackendError("TARGET_NOT_FOUND", "faultId", f"fault not found: {fault_id}")

        fault_target_id = _text(fault.get("targetId"))
        if target_id and fault_target_id != target_id:
            raise SimulationBackendError(
                "TARGET_MISMATCH",
                "target.id",
                f"faultId {fault_id} does not match target {target_id}",
            )

        if not bool(fault.get("enabled", True)):
            return {
                "allowed": False,
                "ruleCode": "REPEAT_REPAIR",
                "durationSeconds": 0,
                "riskLevel": "none",
                "repeatAction": True,
                "warnings": ["fault is already repaired"],
            }

        rule = self.rules.get(action_type, {})
        return {
            "allowed": True,
            "ruleCode": "ACTION_ALLOWED",
            "durationSeconds": rule.get("durationSeconds", 0),
            "riskLevel": rule.get("riskLevel", "none"),
            "repeatAction": False,
            "warnings": [],
        }

    def _find_fault(self, fault_id):
        for fault in self.simulation_session.fault_runtime.fault_instances:
            if _text(fault.get("faultId")) == fault_id:
                return fault
        return None
