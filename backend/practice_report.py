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


def _clone(value):
    if isinstance(value, dict):
        return {key: _clone(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clone(item) for item in value]
    return value


def _arr(value):
    return value if isinstance(value, list) else []


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


def _step_evaluations(actual_steps, dynamic_reference_history):
    actual_by_operation = {
        step.get("operationId"): step
        for step in _arr(actual_steps)
        if isinstance(step, dict) and step.get("operationId")
    }
    result = []
    for entry in _arr(dynamic_reference_history):
        operation_id = entry.get("operationId") or ""
        recommendations = _arr((entry.get("referenceBeforeAction") or {}).get("recommendedActionSet"))
        recommended_action = recommendations[0] if recommendations else None
        result.append({
            "stepIndex": entry.get("stepIndex"),
            "operationId": operation_id,
            "studentAction": _clone(actual_by_operation.get(operation_id) or entry.get("studentAction") or {}),
            "studentRating": _student_rating(entry.get("matchResult")),
            "systemRecommendedAction": _clone(recommended_action),
            "systemRecommendationRating": _system_rating(recommended_action),
            "matchResult": _clone(entry.get("matchResult") or {}),
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
        return "学生最终判断与目标故障不一致", "结合测点证据和候选故障范围重新核对最终故障结论。"
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
        },
        "scoreDetails": score_details,
        "initialOptimalPath": _clone(initial_optimal_path),
        "stepEvaluations": _step_evaluations(actual_steps, dynamic_reference_history),
        "keyNodeCoverage": _key_node_report(path_evaluation),
        "deductionAnalysis": deduction_analysis,
        "improvementSuggestions": suggestions,
    }
