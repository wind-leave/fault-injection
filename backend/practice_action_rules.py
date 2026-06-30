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
        self.rules = self._merge_rules(rules)

    def _merge_rules(self, rules):
        merged = {key: dict(value) for key, value in DEFAULT_RULES.items()}
        if isinstance(rules, dict):
            for action_type, rule in rules.items():
                if isinstance(rule, dict):
                    merged.setdefault(action_type, {}).update(rule)
        return merged

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
        safety_state = action.get("safetyState") if isinstance(action.get("safetyState"), dict) else {}
        if rule.get("requiresPowerOff") and safety_state.get("powerOff") is not True:
            return {
                "allowed": False,
                "ruleCode": "POWER_NOT_OFF",
                "durationSeconds": 0,
                "riskLevel": rule.get("riskLevel", "high"),
                "repeatAction": False,
                "safetyViolation": True,
                "warnings": ["power must be off before this repair action"],
            }
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
