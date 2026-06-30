import time

from backend.practice_action_protocol import normalize_practice_action
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.practice_actions import PracticeActionRuntime
from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_observation,
    evaluate_physical_measurement_snapshot,
    point_type,
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


def _fault_id(row):
    return _text(row.get("faultId") or row.get("faultTypeId") or row.get("caseId") or row.get("id"))


def _point_code(point):
    return _text(point.get("shortName") or point.get("pointCode") or point.get("pointId"))


def _matrix_cell(row, point_code):
    return next(
        (
            cell
            for cell in _arr(row.get("cells"))
            if _text(cell.get("pointCode")) == point_code or _text(cell.get("pointId")) == point_code
        ),
        None,
    )


def _point_by_code(d_matrix, point_code):
    return next(
        (
            point
            for point in _arr((d_matrix or {}).get("points"))
            if _point_code(point) == point_code
        ),
        {},
    )


def _round_score(value):
    return round(float(value), 3)


def _lifecycle_seconds(config, field):
    value = config.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SimulationBackendError("INVALID_SCHEMA", f"lifecycle.{field}", f"lifecycle.{field} must be a number")
    if value < 0:
        raise SimulationBackendError("INVALID_SCHEMA", f"lifecycle.{field}", f"lifecycle.{field} must be non-negative")
    return float(value)


def _resource_limit_int(config, field, default):
    value = config.get(field)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise SimulationBackendError("INVALID_SCHEMA", f"resourceLimits.{field}", f"resourceLimits.{field} must be an integer")
    if value < 0:
        raise SimulationBackendError("INVALID_SCHEMA", f"resourceLimits.{field}", f"resourceLimits.{field} must be non-negative")
    return value


class PracticeSession:
    def __init__(
        self,
        practice_session_id,
        simulation_session_id,
        simulation_session,
        d_matrix,
        target_fault_id,
        scoring_rules=None,
        lifecycle=None,
        action_rules=None,
        resource_limits=None,
        default_max_actions=200,
    ):
        self.practice_session_id = practice_session_id
        self.simulation_session_id = simulation_session_id
        self.simulation_session = simulation_session
        self.action_runtime = PracticeActionRuntime(simulation_session)
        self.rule_engine = PracticeActionRuleEngine(simulation_session, rules=action_rules)
        self.troubleshooting = TroubleshootingSession(d_matrix, target_fault_id)
        self.target_fault_id = _text(target_fault_id)
        self.scoring_rules = scoring_rules if isinstance(scoring_rules, dict) else {}
        self.started_at = time.time()
        self.submitted_at = None
        self.student_actions = []
        self.simulation_results = []
        self.simulation_action_history = []
        self.recommended_path_history = []
        self.actual_troubleshooting_steps = []
        self.dynamic_reference_history = []
        self.physical_measurement_snapshots = []
        self.virtual_measurements = []
        self.repair_attempts = []
        self.latest_physical_measurement_snapshot = None
        self.initial_physical_measurement_snapshot = None
        self.initial_best_path = self._build_initial_recommended_path(self.troubleshooting.initial_response()["currentPath"])
        lifecycle_config = lifecycle if isinstance(lifecycle, dict) else {}
        self.max_lifetime_seconds = _lifecycle_seconds(lifecycle_config, "maxLifetimeSeconds")
        self.idle_timeout_seconds = _lifecycle_seconds(lifecycle_config, "idleTimeoutSeconds")
        self.lifecycle_state = "active"
        self.created_at = self.started_at
        self.last_activity_at = self.started_at
        self.ended_at = None
        resource_config = resource_limits if isinstance(resource_limits, dict) else {}
        self.max_actions = _resource_limit_int(resource_config, "maxActions", default_max_actions)

    def is_expired(self, now=None):
        if self.lifecycle_state != "active":
            return False
        checked_at = time.time() if now is None else now
        if self.max_lifetime_seconds is not None and checked_at - self.created_at >= self.max_lifetime_seconds:
            return True
        if self.idle_timeout_seconds is not None and checked_at - self.last_activity_at >= self.idle_timeout_seconds:
            return True
        return False

    def close(self, state, now=None):
        self.lifecycle_state = state
        self.ended_at = time.time() if now is None else now
        self.last_activity_at = self.ended_at
        return self.lifecycle_summary(now=self.ended_at)

    def lifecycle_summary(self, now=None):
        checked_at = time.time() if now is None else now
        ended_at = self.ended_at
        duration_until = ended_at if ended_at is not None else checked_at
        return {
            "state": self.lifecycle_state,
            "createdAt": self.created_at,
            "lastActivityAt": self.last_activity_at,
            "submittedAt": self.submitted_at,
            "endedAt": ended_at,
            "durationSeconds": max(0.0, duration_until - self.created_at),
            "idleSeconds": max(0.0, checked_at - self.last_activity_at),
            "actionCount": len(self.student_actions),
            "maxLifetimeSeconds": self.max_lifetime_seconds,
            "idleTimeoutSeconds": self.idle_timeout_seconds,
            "maxActions": self.max_actions,
        }

    def status_response(self):
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "targetFaultId": self.target_fault_id,
            "lifecycle": self.lifecycle_summary(),
            "troubleshootingState": self._build_troubleshooting_state(),
        }

    def _build_troubleshooting_state(self):
        return {
            "physicalMeasurementSnapshot": _clone(self.latest_physical_measurement_snapshot or {}),
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": _clone(self.troubleshooting.remaining_fault_ids),
            "status": "resolved" if not _arr((self.latest_physical_measurement_snapshot or {}).get("abnormalPointCodes")) else "inProgress",
        }

    def _append_measurement_path_step(self, action_record, virtual_measurement):
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": "measurePoint",
            "target": _clone(action_record.get("target") or {}),
            "pointCode": action_record.get("pointCode") or "",
            "observed": virtual_measurement.get("observed") or "unknown",
            "routeRole": "evidenceCollection",
            "virtualMeasurement": _clone(virtual_measurement),
            "candidateFaultsAfterAction": _clone(self.troubleshooting.remaining_fault_ids),
        })

    def _append_repair_path_step(self, action_record, rule_result, action_application, repair_effect):
        action_type = action_record.get("actionType") or ""
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": action_type,
            "target": _clone(action_record.get("target") or {}),
            "faultId": action_record.get("faultId") or "",
            "routeRole": "repairAttempt",
            "ruleResult": _clone(rule_result),
            "appliedAction": _clone(action_application),
            "repairEffect": _clone(repair_effect),
            "candidateFaultsAfterAction": _clone(self.troubleshooting.remaining_fault_ids),
        })

    def _actual_troubleshooting_path(self):
        return {
            "ok": True,
            "basis": "studentActions",
            "faultId": self.target_fault_id,
            "steps": _clone(self.actual_troubleshooting_steps),
        }

    def _build_initial_recommended_path(self, base_path):
        path = _clone(base_path)
        steps = []
        for step in _arr(path.get("steps")):
            point_code = _text(step.get("pointCode"))
            point = _point_by_code(self.troubleshooting.d_matrix, point_code)
            target_id = _text(point.get("channel") or step.get("pointId") or point.get("pointId") or point_code)
            enriched = {
                **_clone(step),
                "index": len(steps) + 1,
                "rank": len(steps) + 1,
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": target_id},
                "routeRole": "evidenceCollection",
                "priority": max(60, 88 - (len(steps) * 6)),
                "recommendationTier": "optimal" if not steps else "acceptable",
                "confidence": 0.8,
            }
            steps.append(enriched)

        for repair_action in self._rank_repair_actions(self._repair_reference_actions()):
            steps.append({
                "index": len(steps) + 1,
                "rank": len(steps) + 1,
                **_clone(repair_action),
            })

        path["basis"] = "initialEvidenceAndFaultModel"
        path["steps"] = steps
        return path

    def _known_point_observations(self):
        observations = {}
        for point in _arr((self.latest_physical_measurement_snapshot or {}).get("points")):
            point_code = _text(point.get("pointCode"))
            observed = _text(point.get("observed")).lower()
            if point_code and observed in {"normal", "abnormal"}:
                observations[point_code] = observed
        for measurement in self.virtual_measurements:
            point_code = _text(measurement.get("pointCode"))
            observed = _text(measurement.get("observed")).lower()
            if point_code and observed in {"normal", "abnormal"}:
                observations[point_code] = observed
        return observations

    def _candidate_rows_from_current_evidence(self):
        rows = _arr(self.troubleshooting.d_matrix.get("rows"))
        observations = self._known_point_observations()
        if not observations:
            return list(rows)

        candidates = []
        for row in rows:
            row_matches = True
            for point_code, observed in observations.items():
                cell = _matrix_cell(row, point_code)
                if cell is None:
                    continue
                expected = "abnormal" if bool(cell.get("detectable")) else "normal"
                if expected != observed:
                    row_matches = False
                    break
            if row_matches:
                candidates.append(row)
        return candidates or list(rows)

    def _candidate_fault_ids_from_current_evidence(self):
        return [_fault_id(row) for row in self._candidate_rows_from_current_evidence() if _fault_id(row)]

    def _expected_information_gain(self, point_code, candidate_rows=None):
        rows = candidate_rows if candidate_rows is not None else self._candidate_rows_from_current_evidence()
        known = self._known_point_observations()
        if point_code in known or len(rows) <= 1:
            return 0.0

        detectable = 0
        non_detectable = 0
        for row in rows:
            cell = _matrix_cell(row, point_code)
            if cell is None:
                continue
            if bool(cell.get("detectable")):
                detectable += 1
            else:
                non_detectable += 1
        total = detectable + non_detectable
        if total <= 1 or detectable == 0 or non_detectable == 0:
            return 0.0
        return _round_score((min(detectable, non_detectable) * 2) / total)

    def _risk_cost(self, risk_level):
        return {
            "none": 0,
            "low": 1,
            "medium": 2,
            "high": 3,
        }.get(_text(risk_level).lower(), 2)

    def _recommendation_tier(self, priority):
        if priority >= 80:
            return "optimal"
        if priority >= 50:
            return "acceptable"
        return "lowValue"

    def _safety_prerequisites(self, action_type):
        rule = self.rule_engine.rules.get(action_type, {})
        prerequisites = []
        if rule.get("requiresPowerOff"):
            prerequisites.append({"type": "powerOff", "required": True})
        return prerequisites

    def _safety_prerequisites_satisfied(self, action_record, candidate):
        prerequisites = _arr(candidate.get("safetyPrerequisites"))
        if not prerequisites:
            return True
        safety_state = action_record.get("safetyState") if isinstance(action_record.get("safetyState"), dict) else {}
        for prerequisite in prerequisites:
            if prerequisite.get("type") == "powerOff" and prerequisite.get("required") and safety_state.get("powerOff") is not True:
                return False
        return True

    def _match_quality_score(self, candidate):
        tier = candidate.get("recommendationTier")
        if tier == "optimal" or int(candidate.get("rank") or 0) == 1:
            return "optimal", 1.0
        if tier == "acceptable":
            return "acceptable", 0.7
        if tier == "lowValue":
            return "lowValue", 0.4
        return "acceptable", 0.7

    def _measurement_reference_actions(self):
        measured_codes = {
            _text(measurement.get("pointCode"))
            for measurement in self.virtual_measurements
            if _text(measurement.get("pointCode"))
        }
        candidate_rows = self._candidate_rows_from_current_evidence()
        actions = []
        for point in _arr(self.troubleshooting.d_matrix.get("points")):
            point_code = _point_code(point)
            if not point_code or point_code in measured_codes:
                continue
            if point_type(self.troubleshooting.d_matrix, point_code) != "virtual":
                continue
            target_id = _text(point.get("channel") or point.get("pointId"))
            information_gain = self._expected_information_gain(point_code, candidate_rows)
            if len(candidate_rows) <= 1:
                priority = 45 + int(information_gain * 10)
            else:
                priority = 70 + int(information_gain * 25)
            actions.append({
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": target_id},
                "pointCode": point_code,
                "routeRole": "evidenceCollection",
                "expectedInformationGain": information_gain,
                "priority": priority,
                "recommendationTier": self._recommendation_tier(priority),
                "confidence": _round_score(0.55 + (information_gain * 0.4)),
                "reason": "virtual point can reduce remaining uncertainty",
            })
        return actions

    def _repair_action_priority(self, candidate_count, best_measurement_gain, observed_count):
        if candidate_count <= 1:
            return 92, 0.9
        if best_measurement_gain > 0:
            return 62, 0.55 if observed_count else 0.45
        return (84, 0.72) if observed_count else (72, 0.58)

    def _repair_reference_actions(self):
        edge_ids = {edge.id for edge in self.simulation_session.graph.edges}
        candidate_rows = self._candidate_rows_from_current_evidence()
        candidate_count = len(candidate_rows)
        best_measurement_gain = max(
            (
                self._expected_information_gain(_point_code(point), candidate_rows)
                for point in _arr(self.troubleshooting.d_matrix.get("points"))
                if point_type(self.troubleshooting.d_matrix, _point_code(point)) == "virtual"
            ),
            default=0.0,
        )
        observed_count = len(self._known_point_observations())
        actions = []
        for fault in self.simulation_session.fault_runtime.fault_instances:
            if not bool(fault.get("enabled", True)):
                continue
            fault_id = _text(fault.get("faultId"))
            target_id = _text(fault.get("targetId"))
            if not fault_id or not target_id:
                continue
            priority, confidence = self._repair_action_priority(candidate_count, best_measurement_gain, observed_count)
            if target_id in self.simulation_session.graph.nodes:
                rule = self.rule_engine.rules.get("replaceComponent", {})
                action = {
                    "actionType": "replaceComponent",
                    "target": {"type": "component", "id": target_id},
                    "faultId": fault_id,
                    "routeRole": "repairAttempt",
                    "priority": priority,
                    "recommendationTier": self._recommendation_tier(priority),
                    "confidence": _round_score(confidence),
                    "timeCostSeconds": rule.get("durationSeconds", 0),
                    "riskCost": self._risk_cost(rule.get("riskLevel", "medium")),
                    "reason": "active fault target is repairable",
                }
                safety_prerequisites = self._safety_prerequisites("replaceComponent")
                if safety_prerequisites:
                    action["safetyPrerequisites"] = safety_prerequisites
                actions.append(action)
            elif target_id in edge_ids:
                rule = self.rule_engine.rules.get("replaceWire", {})
                action = {
                    "actionType": "replaceWire",
                    "target": {"type": "wire", "id": target_id},
                    "faultId": fault_id,
                    "routeRole": "repairAttempt",
                    "priority": priority,
                    "recommendationTier": self._recommendation_tier(priority),
                    "confidence": _round_score(confidence),
                    "timeCostSeconds": rule.get("durationSeconds", 0),
                    "riskCost": self._risk_cost(rule.get("riskLevel", "low")),
                    "reason": "active fault target is repairable",
                }
                safety_prerequisites = self._safety_prerequisites("replaceWire")
                if safety_prerequisites:
                    action["safetyPrerequisites"] = safety_prerequisites
                actions.append(action)
        return actions

    def _rank_repair_actions(self, actions):
        sorted_actions = sorted(
            (_clone(action) for action in actions),
            key=lambda action: (
                -int(action.get("priority") or 0),
                -float(action.get("confidence") or 0),
                int(action.get("riskCost") or 0),
                int(action.get("timeCostSeconds") or 0),
                _text(action.get("faultId") or (action.get("target") or {}).get("id")),
            ),
        )
        for index, action in enumerate(sorted_actions, start=1):
            action["rank"] = index
        return sorted_actions

    def _rank_reference_actions(self, actions):
        role_order = {"evidenceCollection": 0, "repairAttempt": 1, "recoveryVerification": 2}
        sorted_actions = sorted(
            (_clone(action) for action in actions),
            key=lambda action: (
                -int(action.get("priority") or 0),
                -float(action.get("confidence") or 0),
                int(action.get("riskCost") or 0),
                int(action.get("timeCostSeconds") or 0),
                role_order.get(action.get("routeRole"), 9),
                _text(action.get("pointCode") or action.get("faultId") or (action.get("target") or {}).get("id")),
            ),
        )
        for index, action in enumerate(sorted_actions, start=1):
            action["rank"] = index
        return sorted_actions

    def _build_dynamic_reference(self):
        observations = self._known_point_observations()
        return {
            "basis": "currentEvidenceAndActiveFaults",
            "candidateFaultIds": self._candidate_fault_ids_from_current_evidence(),
            "observedPointStates": [
                {"pointCode": point_code, "observed": observed}
                for point_code, observed in sorted(observations.items())
            ],
            "recommendedActionSet": self._rank_reference_actions(self._measurement_reference_actions() + self._repair_reference_actions()),
        }

    def _match_dynamic_reference(self, action_record, reference):
        for candidate in _arr(reference.get("recommendedActionSet")):
            if candidate.get("actionType") != action_record.get("actionType"):
                continue
            if candidate.get("actionType") == "measurePoint" and candidate.get("pointCode") == action_record.get("pointCode"):
                match_quality, score = self._match_quality_score(candidate)
                return {
                    "matched": True,
                    "matchType": "exactMeasurement",
                    "matchQuality": match_quality,
                    "score": score,
                    "safetyPrerequisiteSatisfied": True,
                    "matchedAction": _clone(candidate),
                }
            if candidate.get("actionType") in {"replaceComponent", "replaceWire"}:
                if (
                    candidate.get("faultId") == action_record.get("faultId")
                    and (candidate.get("target") or {}).get("id") == (action_record.get("target") or {}).get("id")
                ):
                    safety_satisfied = self._safety_prerequisites_satisfied(action_record, candidate)
                    if not safety_satisfied:
                        return {
                            "matched": True,
                            "matchType": "unsafeRepair",
                            "matchQuality": "unsafe",
                            "score": 0.0,
                            "safetyPrerequisiteSatisfied": False,
                            "matchedAction": _clone(candidate),
                        }
                    match_quality, score = self._match_quality_score(candidate)
                    return {
                        "matched": True,
                        "matchType": "exactRepair",
                        "matchQuality": match_quality,
                        "score": score,
                        "safetyPrerequisiteSatisfied": True,
                        "matchedAction": _clone(candidate),
                    }
        return {
            "matched": False,
            "matchType": "unmatched",
            "matchQuality": "unmatched",
            "score": 0.0,
            "safetyPrerequisiteSatisfied": None,
            "matchedAction": None,
        }

    def _student_action_summary(self, action_record):
        summary = {
            "actionType": action_record.get("actionType") or "",
            "target": _clone(action_record.get("target") or {}),
        }
        if action_record.get("operationId"):
            summary["operationId"] = action_record.get("operationId")
        if action_record.get("pointCode"):
            summary["pointCode"] = action_record.get("pointCode")
        if action_record.get("faultId"):
            summary["faultId"] = action_record.get("faultId")
        if action_record.get("observed"):
            summary["observed"] = action_record.get("observed")
        if action_record.get("safetyViolation"):
            summary["safetyViolation"] = True
        return summary

    def _append_dynamic_reference_record(self, action_record, reference_before):
        self.dynamic_reference_history.append({
            "stepIndex": len(self.dynamic_reference_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.dynamic_reference_history) + 1}",
            "referenceBeforeAction": _clone(reference_before),
            "studentAction": self._student_action_summary(action_record),
            "matchResult": self._match_dynamic_reference(action_record, reference_before),
            "referenceAfterAction": self._build_dynamic_reference(),
        })

    def _evaluate_path_quality(self):
        steps = self.actual_troubleshooting_steps
        measurement_count = sum(1 for step in steps if step.get("actionType") == "measurePoint")
        component_repairs = [step for step in steps if step.get("actionType") == "replaceComponent"]
        wire_repairs = [step for step in steps if step.get("actionType") == "replaceWire"]
        repairs = component_repairs + wire_repairs
        effective_repairs = [step for step in repairs if (step.get("repairEffect") or {}).get("effective")]
        ineffective_repairs = [step for step in repairs if not (step.get("repairEffect") or {}).get("effective")]
        safety_violations = sum(1 for action in self.student_actions if action.get("safetyViolation"))
        first_repair_index = min((step.get("stepIndex", 0) for step in repairs), default=0)
        evidence_before_first_repair = bool(first_repair_index and any(
            step.get("actionType") == "measurePoint" and step.get("stepIndex", 0) < first_repair_index
            for step in steps
        ))
        has_repair = bool(repairs)
        has_effective_repair = bool(effective_repairs)
        repair_statuses = {(step.get("repairEffect") or {}).get("status") for step in repairs}
        has_recovery_signal = bool({"recovered", "improved"} & repair_statuses)
        dynamic_matches = [entry for entry in self.dynamic_reference_history if (entry.get("matchResult") or {}).get("matched")]
        dynamic_unmatched = [entry for entry in self.dynamic_reference_history if not (entry.get("matchResult") or {}).get("matched")]
        dynamic_scores = [
            float((entry.get("matchResult") or {}).get("score") or 0)
            for entry in self.dynamic_reference_history
        ]
        dynamic_score_total = _round_score(sum(dynamic_scores))
        dynamic_average_score = (
            _round_score(dynamic_score_total / len(self.dynamic_reference_history))
            if self.dynamic_reference_history
            else 0
        )
        dynamic_match_score = dynamic_average_score
        dynamic_quality_counts = {
            "optimal": 0,
            "acceptable": 0,
            "lowValue": 0,
            "unsafe": 0,
            "unmatched": 0,
        }
        for entry in self.dynamic_reference_history:
            quality = (entry.get("matchResult") or {}).get("matchQuality") or "unmatched"
            if quality not in dynamic_quality_counts:
                quality = "unmatched"
            dynamic_quality_counts[quality] += 1
        first_repair_dynamic_match = False
        if repairs:
            first_repair_operation_id = next(
                (
                    step.get("operationId")
                    for step in sorted(repairs, key=lambda item: item.get("stepIndex", 0))
                    if step.get("operationId")
                ),
                "",
            )
            first_repair_dynamic_match = any(
                entry.get("operationId") == first_repair_operation_id
                and (entry.get("matchResult") or {}).get("matched")
                and (entry.get("matchResult") or {}).get("matchQuality") != "unsafe"
                for entry in self.dynamic_reference_history
            )
        physical_evidence_available = bool(
            _arr((self.initial_physical_measurement_snapshot or {}).get("abnormalPointCodes"))
            or _arr((self.initial_physical_measurement_snapshot or {}).get("normalPointCodes"))
        )
        evidence_credited = bool(measurement_count) or (has_repair and first_repair_dynamic_match and physical_evidence_available)
        if not steps:
            breakdown = {
                "evidenceCollection": 0,
                "pathOrder": 0,
                "repairLocalization": 0,
                "recoveryVerification": 0,
                "operationControl": 0,
            }
        else:
            breakdown = {
                "evidenceCollection": 10 if evidence_credited else 0,
                "pathOrder": 8 if (not has_repair or evidence_before_first_repair or first_repair_dynamic_match) else 0,
                "repairLocalization": 12 if has_effective_repair else (6 if has_repair and not ineffective_repairs else 0),
                "recoveryVerification": 6 if has_recovery_signal else 0,
                "operationControl": max(
                    0,
                    4 - min(
                        4,
                        (len(ineffective_repairs) * 2)
                        + (max(safety_violations, dynamic_quality_counts["unsafe"]) * 2),
                    ),
                ),
            }
        score = sum(breakdown.values())
        score = max(0, min(40, score))
        return {
            "totalStepCount": len(steps),
            "measuredVirtualPointCount": measurement_count,
            "componentRepairAttemptCount": len(component_repairs),
            "wireRepairAttemptCount": len(wire_repairs),
            "repairAttemptCount": len(repairs),
            "effectiveRepairCount": len(effective_repairs),
            "ineffectiveRepairCount": len(ineffective_repairs),
            "safetyViolationCount": safety_violations,
            "evidenceBeforeFirstRepair": evidence_before_first_repair,
            "dynamicReferenceMatchedCount": len(dynamic_matches),
            "dynamicReferenceUnmatchedCount": len(dynamic_unmatched),
            "dynamicReferenceMatchScore": dynamic_match_score,
            "dynamicReferenceScoreTotal": dynamic_score_total,
            "dynamicReferenceAverageScore": dynamic_average_score,
            "dynamicReferenceOptimalCount": dynamic_quality_counts["optimal"],
            "dynamicReferenceAcceptableCount": dynamic_quality_counts["acceptable"],
            "dynamicReferenceLowValueCount": dynamic_quality_counts["lowValue"],
            "dynamicReferenceUnsafeCount": dynamic_quality_counts["unsafe"],
            "routeQualityBreakdown": breakdown,
            "routeQualityScore": score,
        }

    def initial_response(self):
        simulation_result = self.simulation_session.step(1)
        simulation_result["sessionId"] = self.simulation_session_id
        self.simulation_results.append(_clone(simulation_result))
        snapshot = evaluate_physical_measurement_snapshot(self.troubleshooting.d_matrix, simulation_result)
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.initial_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "physicalMeasurementSnapshot": snapshot,
            "troubleshootingState": self._build_troubleshooting_state(),
            "lifecycle": self.lifecycle_summary(),
        }

    def record_action(self, action, steps=1):
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")
        if len(self.student_actions) >= self.max_actions:
            raise SimulationBackendError(
                "SIMULATION_LIMIT_EXCEEDED",
                "resourceLimits.maxActions",
                "practice action count is outside the allowed range",
            )
        action_record = normalize_practice_action(action)
        normalized_action = _clone(action_record)
        action_record.setdefault("recordedAt", time.time())
        reference_before = self._build_dynamic_reference()
        if action_record.get("actionType") == "measurePoint":
            return self._record_measure_point_action(action_record, normalized_action, steps, reference_before)

        rule_result = self.rule_engine.evaluate(action_record)
        if rule_result.get("allowed"):
            action_application = self.action_runtime.apply(action_record)
        else:
            action_application = self.action_runtime.skipped(action_record)
        action_record["ruleResult"] = _clone(rule_result)
        action_record["simulationActionResult"] = _clone(action_application)
        if rule_result.get("safetyViolation"):
            action_record["safetyViolation"] = True
            normalized_action["safetyViolation"] = True
        self.student_actions.append(action_record)
        self.last_activity_at = action_record["recordedAt"]
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": _clone(action_application),
        })
        previous_snapshot = _clone(self.latest_physical_measurement_snapshot or {})
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        snapshot = evaluate_physical_measurement_snapshot(self.troubleshooting.d_matrix, simulation_result)
        repair_effect = compare_physical_snapshots(previous_snapshot, snapshot)
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        repair_attempt = {
            "operationId": action_record.get("operationId") or f"operation-{len(self.repair_attempts) + 1}",
            "actionType": action_record.get("actionType") or "",
            "target": _clone(action_record.get("target") or {}),
            "faultId": action_record.get("faultId") or "",
            "ruleResult": _clone(rule_result),
            "appliedAction": _clone(action_application),
            "repairEffect": _clone(repair_effect),
        }
        self.repair_attempts.append(repair_attempt)
        action_record["repairEffect"] = _clone(repair_effect)
        action_record["physicalMeasurementSnapshot"] = _clone(snapshot)
        self._append_repair_path_step(action_record, rule_result, action_application, repair_effect)
        self._append_dynamic_reference_record(action_record, reference_before)
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "ruleResult": _clone(rule_result),
            "appliedAction": action_application,
            "repairEffect": repair_effect,
            "physicalMeasurementSnapshot": snapshot,
            "troubleshootingState": self._build_troubleshooting_state(),
            "simulationResult": simulation_result,
        }

    def _record_measure_point_action(self, action_record, normalized_action, steps, reference_before):
        measured_point_type = point_type(self.troubleshooting.d_matrix, action_record.get("pointCode"))
        if measured_point_type != "virtual":
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "pointCode",
                "measurePoint can only be used for virtual measurement points",
            )
        simulation_result = self.simulation_session.step(steps)
        simulation_result["sessionId"] = self.simulation_session_id
        virtual_measurement = evaluate_observation(self.troubleshooting.d_matrix, action_record, simulation_result)
        action_record["observed"] = virtual_measurement["observed"]
        action_record["virtualMeasurement"] = _clone(virtual_measurement)
        self.student_actions.append(action_record)
        self.last_activity_at = action_record["recordedAt"]
        self.virtual_measurements.append(_clone(virtual_measurement))
        self._append_measurement_path_step(action_record, virtual_measurement)
        self._append_dynamic_reference_record(action_record, reference_before)
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": {"status": "measured", "virtualMeasurement": _clone(virtual_measurement)},
        })
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "virtualMeasurement": virtual_measurement,
            "troubleshootingState": self._build_troubleshooting_state(),
            "simulationResult": simulation_result,
        }

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "submission", "submission must be an object")
        final_fault_id = _text(payload.get("finalFaultId") or payload.get("faultId"))
        if not final_fault_id:
            raise SimulationBackendError("INVALID_SCHEMA", "finalFaultId", "finalFaultId is required")
        self.submitted_at = time.time()
        self.close("submitted", now=self.submitted_at)
        correct = final_fault_id == self.target_fault_id
        elapsed_seconds = max(0.0, self.submitted_at - self.started_at)
        path_evaluation = self._evaluate_path_quality()
        route_quality = path_evaluation["routeQualityScore"]
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
            "initialRecommendedPath": _clone(self.initial_best_path),
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
                "initialPhysicalMeasurementSnapshot": _clone(self.initial_physical_measurement_snapshot or {}),
                "physicalMeasurementSnapshots": _clone(self.physical_measurement_snapshots),
                "virtualMeasurements": _clone(self.virtual_measurements),
                "repairAttempts": _clone(self.repair_attempts),
                "troubleshootingState": self._build_troubleshooting_state(),
                "actualTroubleshootingPath": self._actual_troubleshooting_path(),
                "pathEvaluation": _clone(path_evaluation),
                "recommendedPathHistory": _clone(self.recommended_path_history),
                "dynamicReferenceHistory": _clone(self.dynamic_reference_history),
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
