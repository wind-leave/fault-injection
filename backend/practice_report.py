SCORE_ITEMS = (
    ("faultLocalization", "故障定位", 30),
    ("diagnosticTreePath", "诊断树路径", 20),
    ("informationGain", "单步决策合理性", 30),
    ("efficiency", "排故效率", 5),
    ("safetyCompliance", "安全合规", 15),
)

RATING_LABELS = {
    "optimal": "最优",
    "acceptable": "合理",
    "lowValue": "低价值",
    "unsafe": "不安全",
    "unmatched": "未匹配推荐",
}

STEP_DECISION_MAX_SCORE = 30


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


def _score(value):
    return round(float(value or 0), 3)


def _score_details(score_breakdown):
    details = []
    for item, label, max_score in SCORE_ITEMS:
        actual = _score((score_breakdown or {}).get(item))
        details.append({
            "item": item,
            "label": label,
            "score": actual,
            "maxScore": max_score,
            "deductedPoints": _score(max_score - actual),
        })
    return details


def _student_rating(match_result):
    result = match_result if isinstance(match_result, dict) else {}
    level = result.get("matchQuality") or "unmatched"
    if result.get("matched"):
        reason = ((result.get("matchedAction") or {}).get("reason") or "学生动作命中当时的系统推荐动作")
    else:
        reason = "学生动作未命中当时的系统推荐动作集合"
    if level == "unsafe":
        reason = "动作命中推荐目标，但未满足安全前置条件"
    return {
        "level": level,
        "label": RATING_LABELS.get(level, level),
        "score": _score(result.get("score")),
        "reason": reason,
    }


def _system_rating(action):
    if not isinstance(action, dict):
        return None
    level = action.get("recommendationTier") or "acceptable"
    return {
        "level": level,
        "label": RATING_LABELS.get(level, level),
        "rank": action.get("rank"),
        "priority": action.get("priority"),
        "confidence": action.get("confidence"),
        "reason": action.get("reason") or "",
    }


def _normalized_candidate_combinations(reference):
    combinations = []
    seen = set()
    source = reference if isinstance(reference, dict) else {}
    for candidate in _arr(source.get("candidateFaultCombinations")):
        fault_ids = sorted({_text(fault_id) for fault_id in _arr(candidate) if _text(fault_id)})
        identity = tuple(fault_ids)
        if not fault_ids or identity in seen:
            continue
        seen.add(identity)
        combinations.append(fault_ids)
    return combinations


def _candidate_change(reference_before, reference_after):
    before = _normalized_candidate_combinations(reference_before)
    after = _normalized_candidate_combinations(reference_after)
    before_keys = {tuple(candidate) for candidate in before}
    after_keys = {tuple(candidate) for candidate in after}
    return {
        "candidateFaultCombinationsBefore": before,
        "candidateFaultCombinationsAfter": after,
        "candidateCountBefore": len(before),
        "candidateCountAfter": len(after),
        "removedCandidateCombinations": [candidate for candidate in before if tuple(candidate) not in after_keys],
        "addedCandidateCombinations": [candidate for candidate in after if tuple(candidate) not in before_keys],
    }


def _tier_score(action):
    if not isinstance(action, dict):
        return 0.0
    return {
        "optimal": 1.0,
        "acceptable": 0.7,
        "lowValue": 0.4,
    }.get(action.get("recommendationTier"), 0.0)


def _step_information_gain(student_action, match_result, recommendations, candidate_change):
    matched_action = (match_result or {}).get("matchedAction")
    matched_action = matched_action if isinstance(matched_action, dict) else {}
    measurement_gains = [
        float(action.get("expectedInformationGain") or 0)
        for action in recommendations
        if action.get("actionType") == "measurePoint"
    ]
    before_count = candidate_change["candidateCountBefore"]
    after_count = candidate_change["candidateCountAfter"]
    reduction_count = before_count - after_count
    reduction_ratio = reduction_count / before_count if before_count else 0.0
    return {
        "expectedInformationGain": _score(
            matched_action.get("expectedInformationGain")
            if student_action.get("actionType") == "measurePoint"
            else 0
        ),
        "bestAvailableInformationGain": _score(max(measurement_gains, default=0.0)),
        "candidateReductionCount": reduction_count,
        "candidateReductionRatio": _score(reduction_ratio),
        "candidateSupportRatio": _score(matched_action.get("candidateSupportRatio")),
    }


def _step_deduction_reasons(student_action, match_result, reference_before, information_gain):
    result = match_result if isinstance(match_result, dict) else {}
    action_type = student_action.get("actionType") or ""
    match_quality = result.get("matchQuality") or "unmatched"
    matched_action = result.get("matchedAction") if isinstance(result.get("matchedAction"), dict) else {}
    reasons = []

    def add(code, reason, suggestion):
        if any(item["code"] == code for item in reasons):
            return
        reasons.append({"code": code, "reason": reason, "suggestion": suggestion})

    if match_quality == "unsafe":
        add(
            "SAFETY_PREREQUISITE_MISSING",
            "维修动作命中了候选目标，但未满足断电等安全前置条件。",
            "完成安全前置操作后再执行更换。",
        )
        return reasons

    if not result.get("matched"):
        if action_type == "measurePoint":
            point_code = _text(student_action.get("pointCode"))
            observed_codes = {
                _text(item.get("pointCode"))
                for item in _arr((reference_before or {}).get("observedPointStates"))
            }
            if point_code and point_code in observed_codes:
                add("REPEATED_MEASUREMENT", "重复检测了状态已经确定的测点。", "选择尚未检测且能区分候选故障的测点。")
            else:
                add("UNRECOMMENDED_MEASUREMENT", "所选测点不在当前知识图谱推荐集合中。", "优先选择能够缩小候选故障组合的测点。")
        elif action_type in {"replaceComponent", "replaceWire"}:
            add("WRONG_REPAIR_TARGET", "更换目标不在当前候选故障组合对应的知识图谱维修关系中。", "根据当前证据支持率选择设备或连线。")
        else:
            add("UNMATCHED_ACTION", "该操作未匹配当前动态推荐动作集合。", "按照当前候选故障和知识图谱关系选择下一步操作。")
        return reasons

    if action_type == "measurePoint":
        expected_gain = information_gain["expectedInformationGain"]
        best_gain = information_gain["bestAvailableInformationGain"]
        if expected_gain + 0.001 < best_gain:
            add("LOWER_INFORMATION_GAIN", f"该测点预期信息增益为 {expected_gain}，低于当前最佳值 {best_gain}。", "优先检测信息增益更高的测点。")
        if information_gain["candidateReductionCount"] <= 0 and match_quality != "optimal":
            add("NO_CANDIDATE_REDUCTION", "该检测步骤没有缩小候选故障组合范围。", "选择能将当前候选划分为不同观测结果的测点。")
    elif action_type in {"replaceComponent", "replaceWire"}:
        support_ratio = _score(matched_action.get("candidateSupportRatio"))
        if support_ratio < 1.0:
            add("LOW_TARGET_SUPPORT", f"该维修目标仅得到 {support_ratio} 的候选组合支持率。", "继续收集证据，或选择被更多候选组合共同支持的维修目标。")
        if information_gain["bestAvailableInformationGain"] > 0 and match_quality != "optimal":
            add("PREMATURE_REPAIR", "仍存在具有信息增益的检测动作，当前更换时机偏早。", "先检测高信息增益测点，再决定维修目标。")

    if match_quality == "lowValue" and not reasons:
        add("LOW_VALUE_ACTION", "该操作有效但当前诊断价值较低。", "选择优先级、信息增益或候选支持率更高的动作。")
    elif match_quality == "acceptable" and not reasons:
        add("SUBOPTIMAL_ACTION", "该操作合理，但没有达到当前最优动作的效用。", "优先选择动态推荐集合中评级为最优的动作。")
    return reasons


def _step_evaluations(actual_steps, dynamic_reference_history):
    actual_by_operation = {
        step.get("operationId"): step
        for step in _arr(actual_steps)
        if isinstance(step, dict) and step.get("operationId")
    }
    result = []
    history = _arr(dynamic_reference_history)
    step_max_points = STEP_DECISION_MAX_SCORE / len(history) if history else 0.0
    for entry in history:
        operation_id = entry.get("operationId") or ""
        reference_before = entry.get("referenceBeforeAction") or {}
        reference_after = entry.get("referenceAfterAction") or {}
        recommendations = _arr(reference_before.get("recommendedActionSet"))
        recommended_action = recommendations[0] if recommendations else None
        student_action = _clone(actual_by_operation.get(operation_id) or entry.get("studentAction") or {})
        match_result = entry.get("matchResult") if isinstance(entry.get("matchResult"), dict) else {}
        candidate_change = _candidate_change(reference_before, reference_after)
        information_gain = _step_information_gain(
            student_action,
            match_result,
            recommendations,
            candidate_change,
        )
        decision_score = max(0.0, min(1.0, float(match_result.get("score") or 0)))
        best_available_score = _tier_score(recommended_action)
        result.append({
            "stepIndex": entry.get("stepIndex"),
            "operationId": operation_id,
            "studentAction": student_action,
            "studentRating": _student_rating(match_result),
            "systemRecommendedAction": _clone(recommended_action),
            "systemRecommendationRating": _system_rating(recommended_action),
            "matchResult": _clone(match_result),
            **candidate_change,
            "informationGain": information_gain,
            "decisionScore": _score(decision_score),
            "bestAvailableDecisionScore": _score(best_available_score),
            "maxDecisionPoints": _score(step_max_points),
            "earnedDecisionPoints": _score(step_max_points * decision_score),
            "deductedDecisionPoints": _score(step_max_points * (1 - decision_score)),
            "deductionReasons": _step_deduction_reasons(
                student_action,
                match_result,
                reference_before,
                information_gain,
            ),
        })
    return result


def _key_node_report(path_evaluation):
    evaluation = path_evaluation if isinstance(path_evaluation, dict) else {}
    coverage = evaluation.get("keyNodeCoverage") if isinstance(evaluation.get("keyNodeCoverage"), dict) else {}
    covered_ids = set(_arr(coverage.get("coveredNodeIds")))
    nodes = []
    for node in _arr(evaluation.get("faultTreeKeyNodes")):
        item = _clone(node)
        covered = item.get("nodeId") in covered_ids
        item["covered"] = covered
        item["coverageStatus"] = "covered" if covered else "missed"
        nodes.append(item)
    return {
        "score": _score(coverage.get("score")),
        "maxScore": _score(coverage.get("maxScore")),
        "coveredNodeIds": _clone(_arr(coverage.get("coveredNodeIds"))),
        "missedNodeIds": _clone(_arr(coverage.get("missedNodeIds"))),
        "nodes": nodes,
    }


def _deduction_reason(item, correct, path_evaluation, elapsed_seconds, scoring_rules):
    evaluation = path_evaluation if isinstance(path_evaluation, dict) else {}
    if item == "faultLocalization":
        return "学生最终故障集合与目标故障集合不一致", "结合测点证据和候选故障组合重新核对漏报及多报故障。"
    if item == "diagnosticTreePath":
        missed = _arr((evaluation.get("keyNodeCoverage") or {}).get("missedNodeIds"))
        reason = "关键节点未完全覆盖或路径中存在无效、重复操作"
        if missed:
            reason = f"未覆盖关键节点：{', '.join(str(value) for value in missed)}"
        return reason, "优先覆盖关键测点和维修目标，减少无效或重复更换。"
    if item == "informationGain":
        unmatched = int(evaluation.get("dynamicReferenceUnmatchedCount") or 0)
        return f"部分步骤未采用当时更有价值的诊断动作，未匹配推荐步骤数：{unmatched}", "每一步先选择优先级和信息增益更高的系统推荐动作。"
    if item == "efficiency":
        limit = float((scoring_rules or {}).get("fullEfficiencySeconds", 600))
        return f"实践用时 {round(float(elapsed_seconds), 3)} 秒，超过效率满分阈值 {round(limit, 3)} 秒", "在保证证据充分的前提下减少停顿和重复操作。"
    if item == "safetyCompliance":
        violations = int(evaluation.get("safetyViolationCount") or 0)
        return f"存在 {violations} 次安全违规操作", "执行更换前确认断电等安全前置条件。"
    return "该评分项未获得满分", "复盘对应评分项并优化操作。"


def _deduction_analysis(score_details, correct, path_evaluation, elapsed_seconds, scoring_rules):
    deductions = []
    for detail in score_details:
        if detail["deductedPoints"] <= 0:
            continue
        reason, suggestion = _deduction_reason(
            detail["item"],
            correct,
            path_evaluation,
            elapsed_seconds,
            scoring_rules,
        )
        deductions.append({
            "item": detail["item"],
            "label": detail["label"],
            "deductedPoints": detail["deductedPoints"],
            "reason": reason,
            "improvementSuggestion": suggestion,
        })
    return deductions


def build_practice_evaluation_report(
    *,
    score,
    grade,
    score_breakdown,
    target_fault_id,
    target_fault_name,
    final_fault_id,
    final_fault_name,
    correct,
    target_faults,
    final_faults,
    set_accuracy,
    precision,
    recall,
    matched_fault_ids,
    missed_fault_ids,
    extra_fault_ids,
    initial_optimal_path,
    actual_steps,
    dynamic_reference_history,
    path_evaluation,
    elapsed_seconds,
    scoring_rules,
):
    score_details = _score_details(score_breakdown)
    deduction_analysis = _deduction_analysis(
        score_details,
        correct,
        path_evaluation,
        elapsed_seconds,
        scoring_rules,
    )
    suggestions = []
    for deduction in deduction_analysis:
        suggestion = deduction["improvementSuggestion"]
        if suggestion not in suggestions:
            suggestions.append(suggestion)
    if not suggestions:
        suggestions.append("保持当前排故策略，并继续关注关键证据、操作安全和路径效率。")
    return {
        "totalScore": _score(score),
        "grade": grade,
        "faultConclusion": {
            "target": {"faultId": target_fault_id, "faultName": target_fault_name},
            "student": {"faultId": final_fault_id, "faultName": final_fault_name},
            "correct": bool(correct),
            "exactMatch": bool(correct),
            "targetFaults": _clone(_arr(target_faults)),
            "studentFaults": _clone(_arr(final_faults)),
            "setAccuracy": _score(set_accuracy),
            "precision": _score(precision),
            "recall": _score(recall),
            "matchedFaultIds": _clone(_arr(matched_fault_ids)),
            "missedFaultIds": _clone(_arr(missed_fault_ids)),
            "extraFaultIds": _clone(_arr(extra_fault_ids)),
        },
        "scoreDetails": score_details,
        "initialOptimalPath": _clone(initial_optimal_path),
        "stepEvaluations": _step_evaluations(actual_steps, dynamic_reference_history),
        "keyNodeCoverage": _key_node_report(path_evaluation),
        "deductionAnalysis": deduction_analysis,
        "improvementSuggestions": suggestions,
    }
