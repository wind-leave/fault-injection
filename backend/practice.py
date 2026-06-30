import time

from backend.practice_action_protocol import normalize_practice_action
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.practice_actions import PracticeActionRuntime
from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_observation,
    evaluate_physical_measurement_snapshot,
)
from backend.schemas import SimulationBackendError
from backend.troubleshooting import TroubleshootingSession


def _clone(value):
    if isinstance(value, dict):
        return {key: _clone(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone(item) for item in value]
    return value


def _arr(value):
    return value if isinstance(value, list) else []


def _text(value, fallback=""):
    if value is None:
        return fallback
    result = str(value).strip()
    return result or fallback


class PracticeSession:
    def __init__(self, practice_session_id, simulation_session_id, simulation_session, d_matrix, target_fault_id, scoring_rules=None):
        self.practice_session_id = practice_session_id
        self.simulation_session_id = simulation_session_id
        self.simulation_session = simulation_session
        self.action_runtime = PracticeActionRuntime(simulation_session)
        self.rule_engine = PracticeActionRuleEngine(simulation_session)
        self.troubleshooting = TroubleshootingSession(d_matrix, target_fault_id)
        self.target_fault_id = _text(target_fault_id)
        self.scoring_rules = scoring_rules if isinstance(scoring_rules, dict) else {}
        self.started_at = time.time()
        self.submitted_at = None
        self.student_actions = []
        self.simulation_results = []
        self.simulation_action_history = []
        self.recommended_path_history = []
        self.initial_best_path = self.troubleshooting.initial_response()["currentPath"]
        self.physical_measurement_snapshots = []
        self.virtual_measurements = []
        self.repair_attempts = []
        self.latest_physical_measurement_snapshot = None

    def _build_troubleshooting_state(self):
        return {
            "physicalMeasurementSnapshot": _clone(self.latest_physical_measurement_snapshot or {}),
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": _clone(self.troubleshooting.remaining_fault_ids),
            "status": "resolved" if not _arr((self.latest_physical_measurement_snapshot or {}).get("abnormalPointCodes")) else "inProgress",
        }

    def initial_response(self):
        simulation_result = self.simulation_session.step(1)
        simulation_result["sessionId"] = self.simulation_session_id
        self.simulation_results.append(_clone(simulation_result))
        snapshot = evaluate_physical_measurement_snapshot(self.troubleshooting.d_matrix, simulation_result)
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "physicalMeasurementSnapshot": snapshot,
            "troubleshootingState": self._build_troubleshooting_state(),
        }

    def record_action(self, action, steps=1):
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")
        action_record = normalize_practice_action(action)
        normalized_action = _clone(action_record)
        action_record.setdefault("recordedAt", time.time())
        if action_record.get("actionType") == "measurePoint":
            return self._record_measure_point_action(action_record, normalized_action, steps)

        rule_result = self.rule_engine.evaluate(action_record)
        if rule_result.get("allowed"):
            action_application = self.action_runtime.apply(action_record)
        else:
            action_application = self.action_runtime.skipped(action_record)
        action_record["ruleResult"] = _clone(rule_result)
        action_record["simulationActionResult"] = _clone(action_application)
        self.student_actions.append(action_record)
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": _clone(action_application),
        })
        recommendation_record = self._build_recommendation_record(action_record)
        troubleshooting_result = self.troubleshooting.record_operation(action_record)
        recommendation_record["nextRecommendedStepAfterAction"] = _clone(troubleshooting_result.get("nextRecommendedStep"))
        recommendation_record["remainingFaultIdsAfterAction"] = _clone(troubleshooting_result.get("remainingFaultIds"))
        recommendation_record["routeQuality"] = _clone(troubleshooting_result.get("routeQuality"))
        self.recommended_path_history.append(recommendation_record)
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "ruleResult": _clone(rule_result),
            "appliedAction": action_application,
            "simulationResult": simulation_result,
        }

    def _record_measure_point_action(self, action_record, normalized_action, steps):
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        observation_result = evaluate_observation(self.troubleshooting.d_matrix, action_record, simulation_result)
        action_record["observed"] = observation_result["observed"]
        action_record["observationResult"] = _clone(observation_result)
        self.student_actions.append(action_record)
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": {"status": "observed", "observationResult": _clone(observation_result)},
        })
        recommendation_record = self._build_recommendation_record(action_record)
        troubleshooting_result = self.troubleshooting.record_operation(action_record)
        recommendation_record["nextRecommendedStepAfterAction"] = _clone(troubleshooting_result.get("nextRecommendedStep"))
        recommendation_record["remainingFaultIdsAfterAction"] = _clone(troubleshooting_result.get("remainingFaultIds"))
        recommendation_record["routeQuality"] = _clone(troubleshooting_result.get("routeQuality"))
        self.recommended_path_history.append(recommendation_record)
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "observationResult": observation_result,
            "troubleshootingResult": troubleshooting_result,
            "simulationResult": simulation_result,
        }

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "submission", "submission must be an object")
        final_fault_id = _text(payload.get("finalFaultId") or payload.get("faultId"))
        if not final_fault_id:
            raise SimulationBackendError("INVALID_SCHEMA", "finalFaultId", "finalFaultId is required")
        self.submitted_at = time.time()
        correct = final_fault_id == self.target_fault_id
        elapsed_seconds = max(0.0, self.submitted_at - self.started_at)
        matched_steps = sum(1 for step in self.troubleshooting.path_steps if step.get("routeMatched"))
        total_steps = len(self.troubleshooting.path_steps)
        route_quality = 40 if total_steps == 0 else round(40 * (matched_steps / total_steps))
        safety_violations = sum(1 for action in self.student_actions if action.get("safetyViolation"))
        safety = max(0, 10 - (safety_violations * 5))
        efficiency = 10 if elapsed_seconds <= float(self.scoring_rules.get("fullEfficiencySeconds", 600)) else 5
        fault_detection = 40 if correct else 0
        score_breakdown = {
            "faultDetection": fault_detection,
            "routeQuality": route_quality,
            "efficiency": efficiency,
            "safety": safety,
        }
        score = sum(score_breakdown.values())
        deductions = []
        if not correct:
            deductions.append({"reason": "最终故障判断错误", "points": -40})
        if safety_violations:
            deductions.append({"reason": "存在安全违规操作", "points": -(10 - safety)})
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "score": score,
            "grade": self._grade(score),
            "scoreBreakdown": score_breakdown,
            "deductions": deductions,
            "initialBestPath": _clone(self.initial_best_path),
            "record": {
                "sessionId": self.practice_session_id,
                "simulationSessionId": self.simulation_session_id,
                "targetFaultId": self.target_fault_id,
                "finalFaultId": final_fault_id,
                "correct": correct,
                "startedAt": self.started_at,
                "submittedAt": payload.get("submittedAt") or self.submitted_at,
                "durationSeconds": elapsed_seconds,
                "studentActions": _clone(self.student_actions),
                "simulationActionHistory": _clone(self.simulation_action_history),
                "actualTroubleshootingPath": self.troubleshooting._current_path(),
                "recommendedPathHistory": _clone(self.recommended_path_history),
            },
        }

    def _build_recommendation_record(self, action_record):
        before_path = self.troubleshooting._next_path()
        recommended_step = before_path["steps"][0] if before_path.get("steps") else None
        actual_point_code = _text(action_record.get("pointCode") or action_record.get("shortName") or action_record.get("pointId"))
        return {
            "stepIndex": len(self.recommended_path_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.recommended_path_history) + 1}",
            "actionType": action_record.get("actionType") or "",
            "recommendedStep": _clone(recommended_step),
            "recommendedPath": _clone(before_path),
            "actualPointCode": actual_point_code,
            "actualPointId": action_record.get("pointId"),
            "observed": action_record.get("observed"),
            "matchedRecommendedStep": bool(
                recommended_step and actual_point_code and recommended_step.get("pointCode") == actual_point_code
            ),
        }

    @staticmethod
    def _grade(score):
        if score >= 90:
            return "优秀"
        if score >= 80:
            return "良好"
        if score >= 70:
            return "中等"
        if score >= 60:
            return "合格"
        return "不合格"
