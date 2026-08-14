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
        rule = self.rules.get(action_type, {})
        safety_state = action.get("safetyState") if isinstance(action.get("safetyState"), dict) else {}
        return {
            "safetyPrerequisiteSatisfied": not (
                rule.get("requiresPowerOff") and safety_state.get("powerOff") is not True
            ),
            "safetyViolation": bool(
                rule.get("requiresPowerOff") and safety_state.get("powerOff") is not True
            ),
        }
        return None
