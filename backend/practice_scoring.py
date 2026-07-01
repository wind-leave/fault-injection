def _clone(value):
    if isinstance(value, dict):
        return {key: _clone(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone(item) for item in value]
    return value


def _arr(value):
    return value if isinstance(value, list) else []


def _round_score(value):
    return round(float(value), 3)


def _text(value, fallback=""):
    if value is None:
        return fallback
    result = str(value).strip()
    return result or fallback


def _repair_identity(step):
    target = step.get("target") if isinstance(step.get("target"), dict) else {}
    return (
        _text(step.get("actionType")),
        _text(step.get("faultId")),
        _text(target.get("type")),
        _text(target.get("id")),
    )


def _duplicate_repair_count(repairs):
    seen = set()
    duplicate_count = 0
    for repair in repairs:
        identity = _repair_identity(repair)
        if identity in seen:
            duplicate_count += 1
        else:
            seen.add(identity)
    return duplicate_count


def _step_target(step):
    return step.get("target") if isinstance(step.get("target"), dict) else {}


def _covers_physical_evidence(node, initial_physical_measurement_snapshot):
    point_code = _text(node.get("pointCode"))
    if not point_code:
        return False
    for point in _arr((initial_physical_measurement_snapshot or {}).get("points")):
        observed = _text(point.get("observed")).lower()
        if _text(point.get("pointCode")) == point_code and observed in {"normal", "abnormal"}:
            return True
    return False


def _covers_measure_point(node, steps):
    point_code = _text(node.get("pointCode"))
    return bool(point_code and any(
        step.get("actionType") == "measurePoint"
        and _text(step.get("pointCode")) == point_code
        for step in steps
    ))


def _covers_repair_target(node, steps):
    expected_target = node.get("target") if isinstance(node.get("target"), dict) else {}
    expected_fault_id = _text(node.get("faultId"))
    for step in steps:
        if step.get("actionType") not in {"replaceComponent", "replaceWire"}:
            continue
        target = _step_target(step)
        if _text(target.get("type")) != _text(expected_target.get("type")):
            continue
        if _text(target.get("id")) != _text(expected_target.get("id")):
            continue
        if expected_fault_id and _text(step.get("faultId")) != expected_fault_id:
            continue
        return True
    return False


def _evaluate_key_node_coverage(fault_tree_key_nodes, steps, initial_physical_measurement_snapshot):
    nodes = _arr(fault_tree_key_nodes)
    covered_node_ids = []
    missed_node_ids = []
    score = 0
    max_score = 0
    for node in nodes:
        node_id = _text(node.get("nodeId"))
        node_score = float(node.get("score") or 0)
        max_score += node_score
        node_type = node.get("type")
        if node_type == "physicalEvidence":
            covered = _covers_physical_evidence(node, initial_physical_measurement_snapshot)
        elif node_type == "measurePoint":
            covered = _covers_measure_point(node, steps)
        elif node_type == "repairTarget":
            covered = _covers_repair_target(node, steps)
        else:
            covered = False
        if covered:
            score += node_score
            covered_node_ids.append(node_id)
        else:
            missed_node_ids.append(node_id)
    return {
        "score": _round_score(min(12, score)),
        "maxScore": _round_score(min(12, max_score)),
        "coveredNodeIds": covered_node_ids,
        "missedNodeIds": missed_node_ids,
    }


def _sequence_reasonability_score(steps, repairs, evidence_before_first_repair, first_repair_dynamic_match, dynamic_history):
    if not steps:
        return 0
    score = 0
    if not repairs or evidence_before_first_repair or first_repair_dynamic_match:
        score += 4
    if dynamic_history:
        non_unsafe_matches = [
            entry
            for entry in dynamic_history
            if (entry.get("matchResult") or {}).get("matched")
            and (entry.get("matchResult") or {}).get("matchQuality") != "unsafe"
        ]
        unmatched = [
            entry
            for entry in dynamic_history
            if (entry.get("matchResult") or {}).get("matchQuality") == "unmatched"
        ]
        score += (len(non_unsafe_matches) / len(dynamic_history)) * 3
        score += ((len(dynamic_history) - len(unmatched)) / len(dynamic_history)) * 3
    return _round_score(min(10, score))


def _path_efficiency_score(ineffective_repairs, repairs, unmatched_count):
    deductions = (len(ineffective_repairs) * 2) + _duplicate_repair_count(repairs) + unmatched_count
    return max(0, 8 - min(8, deductions))


FAULT_DETECTION_SCORE = 30
ROUTE_QUALITY_SCORE = 50
DIAGNOSTIC_TREE_PATH_SCORE = 30
INFORMATION_GAIN_SCORE = 20
EFFICIENCY_SCORE = 5
SAFETY_SCORE = 15

ROUTE_QUALITY_BREAKDOWN = {
    "evidenceCollection": 12,
    "pathOrder": 10,
    "repairLocalization": 15,
    "recoveryVerification": 8,
    "operationControl": 5,
}


def grade_for_score(score):
    if score >= 90:
        return "优秀"
    if score >= 80:
        return "良好"
    if score >= 70:
        return "中等"
    if score >= 60:
        return "合格"
    return "不合格"


def evaluate_path_quality(
    actual_troubleshooting_steps,
    student_actions,
    dynamic_reference_history,
    initial_physical_measurement_snapshot,
    fault_tree_key_nodes=None,
):
    steps = _arr(actual_troubleshooting_steps)
    measurement_count = sum(1 for step in steps if step.get("actionType") == "measurePoint")
    component_repairs = [step for step in steps if step.get("actionType") == "replaceComponent"]
    wire_repairs = [step for step in steps if step.get("actionType") == "replaceWire"]
    repairs = component_repairs + wire_repairs
    effective_repairs = [step for step in repairs if (step.get("repairEffect") or {}).get("effective")]
    ineffective_repairs = [step for step in repairs if not (step.get("repairEffect") or {}).get("effective")]
    safety_violations = sum(1 for action in _arr(student_actions) if action.get("safetyViolation"))
    first_repair_index = min((step.get("stepIndex", 0) for step in repairs), default=0)
    evidence_before_first_repair = bool(first_repair_index and any(
        step.get("actionType") == "measurePoint" and step.get("stepIndex", 0) < first_repair_index
        for step in steps
    ))
    has_repair = bool(repairs)
    repair_statuses = {(step.get("repairEffect") or {}).get("status") for step in repairs}
    has_recovery_signal = bool({"recovered", "improved"} & repair_statuses)
    dynamic_history = _arr(dynamic_reference_history)
    dynamic_matches = [entry for entry in dynamic_history if (entry.get("matchResult") or {}).get("matched")]
    dynamic_unmatched = [entry for entry in dynamic_history if not (entry.get("matchResult") or {}).get("matched")]
    dynamic_scores = [
        float((entry.get("matchResult") or {}).get("score") or 0)
        for entry in dynamic_history
    ]
    dynamic_score_total = _round_score(sum(dynamic_scores))
    dynamic_average_score = (
        _round_score(dynamic_score_total / len(dynamic_history))
        if dynamic_history
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
    for entry in dynamic_history:
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
            for entry in dynamic_history
        )
    physical_evidence_available = bool(
        _arr((initial_physical_measurement_snapshot or {}).get("abnormalPointCodes"))
        or _arr((initial_physical_measurement_snapshot or {}).get("normalPointCodes"))
    )
    evidence_credited = bool(measurement_count) or (has_repair and first_repair_dynamic_match and physical_evidence_available)
    operation_control_deductions = (
        (len(ineffective_repairs) * 2)
        + _duplicate_repair_count(repairs)
        + dynamic_quality_counts["unmatched"]
    )
    key_node_coverage = _evaluate_key_node_coverage(
        fault_tree_key_nodes,
        steps,
        initial_physical_measurement_snapshot,
    )
    sequence_reasonability = _sequence_reasonability_score(
        steps,
        repairs,
        evidence_before_first_repair,
        first_repair_dynamic_match,
        dynamic_history,
    )
    path_efficiency = _path_efficiency_score(
        ineffective_repairs,
        repairs,
        dynamic_quality_counts["unmatched"],
    )
    diagnostic_tree_path_breakdown = {
        "keyNodeCoverage": key_node_coverage["score"],
        "sequenceReasonability": sequence_reasonability,
        "pathEfficiency": path_efficiency,
    }
    diagnostic_tree_path_score = _round_score(sum(diagnostic_tree_path_breakdown.values()))
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
            "evidenceCollection": ROUTE_QUALITY_BREAKDOWN["evidenceCollection"] if evidence_credited else 0,
            "pathOrder": ROUTE_QUALITY_BREAKDOWN["pathOrder"] if (
                not has_repair or evidence_before_first_repair or first_repair_dynamic_match
            ) else 0,
            "repairLocalization": ROUTE_QUALITY_BREAKDOWN["repairLocalization"] if effective_repairs else (
                8 if has_repair and not ineffective_repairs else 0
            ),
            "recoveryVerification": ROUTE_QUALITY_BREAKDOWN["recoveryVerification"] if has_recovery_signal else 0,
            "operationControl": max(
                0,
                ROUTE_QUALITY_BREAKDOWN["operationControl"] - min(
                    ROUTE_QUALITY_BREAKDOWN["operationControl"],
                    operation_control_deductions,
                ),
            ),
        }
    score = sum(breakdown.values())
    score = max(0, min(ROUTE_QUALITY_SCORE, score))
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
        "faultTreeKeyNodes": _clone(_arr(fault_tree_key_nodes)),
        "keyNodeCoverage": key_node_coverage,
        "diagnosticTreePathBreakdown": diagnostic_tree_path_breakdown,
        "diagnosticTreePathScore": min(DIAGNOSTIC_TREE_PATH_SCORE, diagnostic_tree_path_score),
        "routeQualityBreakdown": breakdown,
        "routeQualityScore": score,
    }


def evaluate_practice_submission_score(
    correct,
    elapsed_seconds,
    scoring_rules,
    student_actions,
    path_evaluation,
):
    scoring_config = scoring_rules if isinstance(scoring_rules, dict) else {}
    safe_path_evaluation = path_evaluation if isinstance(path_evaluation, dict) else {}
    route_quality_score = float(safe_path_evaluation.get("routeQualityScore") or 0)
    diagnostic_tree_path = safe_path_evaluation.get("diagnosticTreePathScore")
    if diagnostic_tree_path is None:
        diagnostic_tree_path = min(DIAGNOSTIC_TREE_PATH_SCORE, route_quality_score * DIAGNOSTIC_TREE_PATH_SCORE / ROUTE_QUALITY_SCORE)
    information_gain = safe_path_evaluation.get("informationGainScore")
    if information_gain is None:
        information_gain = min(INFORMATION_GAIN_SCORE, route_quality_score * INFORMATION_GAIN_SCORE / ROUTE_QUALITY_SCORE)
    safety_violations = sum(1 for action in _arr(student_actions) if action.get("safetyViolation"))
    safety = max(0, SAFETY_SCORE - (safety_violations * 5))
    efficiency = EFFICIENCY_SCORE if elapsed_seconds <= float(scoring_config.get("fullEfficiencySeconds", 600)) else EFFICIENCY_SCORE / 2
    fault_detection = FAULT_DETECTION_SCORE if correct else 0
    score_breakdown = {
        "faultLocalization": fault_detection,
        "diagnosticTreePath": _round_score(diagnostic_tree_path),
        "informationGain": _round_score(information_gain),
        "efficiency": efficiency,
        "safetyCompliance": safety,
    }
    score = sum(score_breakdown.values())
    deductions = []
    if not correct:
        deductions.append({"reason": "最终故障判断错误", "points": -FAULT_DETECTION_SCORE})
    if safety_violations:
        deductions.append({"reason": "存在安全违规操作", "points": -(SAFETY_SCORE - safety)})
    return {
        "score": score,
        "grade": grade_for_score(score),
        "scoreBreakdown": score_breakdown,
        "deductions": deductions,
    }
