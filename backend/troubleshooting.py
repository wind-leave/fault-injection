import copy
import re

from backend.schemas import SimulationBackendError


def _arr(value):
    return value if isinstance(value, list) else []


def _text(value, fallback=""):
    if value is None:
        return fallback
    result = str(value).strip()
    return result or fallback


def _clone(value):
    return copy.deepcopy(value)


def _fault_id(row):
    return _text(row.get("faultId") or row.get("faultTypeId") or row.get("caseId") or row.get("id"))


def _target_kind(row):
    value = _text(row.get("targetKind")).lower()
    if value in {"edge", "wire", "line", "connection"}:
        return "edge"
    if _text(row.get("targetEdgeId")):
        return "edge"
    return "node"


def _repair_targets(row):
    targets = []
    seen = set()

    def add_target(kind, target_id, label):
        normalized_kind = "edge" if _text(kind).lower() in {"edge", "wire", "line", "connection"} else "node"
        normalized_id = _text(target_id)
        if not normalized_id or (normalized_kind, normalized_id) in seen:
            return
        seen.add((normalized_kind, normalized_id))
        targets.append({"kind": normalized_kind, "id": normalized_id, "label": _text(label, normalized_id)})

    for target in _arr(row.get("repairTargets")):
        if isinstance(target, dict):
            add_target(target.get("kind") or target.get("targetKind"), target.get("id") or target.get("targetId"), target.get("label") or target.get("targetLabel") or target.get("name"))

    if not targets:
        target_kind = _target_kind(row)
        target_id = row.get("targetEdgeId") if target_kind == "edge" else row.get("targetNodeId")
        target_id = target_id or row.get("targetId")
        target_label = row.get("targetLabel")
        add_target(target_kind, target_id or target_label, target_label)
    return targets


def _point_code_from_operation(operation):
    return _text(operation.get("pointCode") or operation.get("shortName") or operation.get("pointId"))


def _normalize_observed(value):
    normalized = _text(value).lower()
    if normalized in {"abnormal", "fault", "faulty", "1", "true", "yes", "y", "异常"}:
        return "abnormal"
    if normalized in {"normal", "healthy", "0", "false", "no", "n", "正常"}:
        return "normal"
    if normalized in {"unknown", "uncertain", "", "未知"}:
        return "unknown"
    raise SimulationBackendError("INVALID_SCHEMA", "observed", "observed must be normal, abnormal, or unknown")


def _observed_to_detectable(observed):
    if observed == "abnormal":
        return True
    if observed == "normal":
        return False
    return None


def _validate_d_matrix(d_matrix):
    if not isinstance(d_matrix, dict):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix", "dMatrix must be an object")
    if not isinstance(d_matrix.get("points"), list):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.points", "dMatrix.points must be an array")
    if not isinstance(d_matrix.get("rows"), list):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.rows", "dMatrix.rows must be an array")
    return d_matrix


def get_matrix_cell_for_point(row, point_code):
    return next(
        (
            cell
            for cell in _arr(row.get("cells"))
            if _text(cell.get("pointCode")) == point_code or _text(cell.get("pointId")) == point_code
        ),
        None,
    )


def compact_diagnostic_point_name(name):
    point_name = _text(name, "测点")
    return point_name[:-2] if point_name.endswith("测点") else point_name


def get_point_priority_bonus(point, cell):
    name = f"{point.get('name', '') if point else ''} {cell.get('pointName', '') if cell else ''} {point.get('role', '') if point else ''}"
    bonus = 0
    if re.search(r"残差|诊断|residual|diagnostic", name, re.IGNORECASE):
        bonus += 120
    if re.search(r"频谱|spectrum", name, re.IGNORECASE):
        bonus += 80
    if re.search(r"误差|反馈|IMU|控制", name, re.IGNORECASE):
        bonus += 24
    point_index_match = re.sub(r"^\D+", "", _text(cell.get("pointCode") or (point or {}).get("shortName")))
    try:
        point_index = int(point_index_match)
    except (TypeError, ValueError):
        point_index = 99
    bonus += max(0, 18 - point_index)
    return bonus


def _is_virtual_point(point):
    point_type = _text((point or {}).get("pointType")).lower()
    # Existing task packages predating point types used active measurements as
    # path steps. Treat the omitted legacy value as virtual; current exports
    # always send an explicit physical or virtual type.
    return point_type in {"", "virtual"}


def is_directly_diagnosable_from_physical_points(d_matrix, target_row, candidate_rows=None):
    """Whether the target fault has a unique abnormal physical-point signature.

    Physical points are available before the student takes any virtual
    measurement.  When every physical point that is abnormal for the target is
    not jointly abnormal for any other candidate fault, the fault can already
    be localized and virtual measurements add no diagnostic value.
    """
    points_by_code = {
        _text(point.get("shortName") or point.get("pointId")): point
        for point in _arr(d_matrix.get("points"))
    }
    abnormal_physical_codes = {
        point_code
        for cell in _arr(target_row.get("cells"))
        for point_code in [_text(cell.get("pointCode") or cell.get("pointId"))]
        if point_code
        and bool(cell.get("detectable"))
        and not _is_virtual_point(points_by_code.get(point_code))
    }
    if not abnormal_physical_codes:
        return False

    candidates = _arr(candidate_rows) if candidate_rows is not None else _arr(d_matrix.get("rows"))
    target_fault_id = _fault_id(target_row)
    for row in candidates:
        if _fault_id(row) == target_fault_id:
            continue
        if all(bool((get_matrix_cell_for_point(row, point_code) or {}).get("detectable")) for point_code in abnormal_physical_codes):
            return False
    return True


def rank_troubleshooting_cells(d_matrix, target_row, remaining_rows, used_point_codes=None):
    used = set(used_point_codes or [])
    points_by_code = {_text(point.get("shortName")): point for point in _arr(d_matrix.get("points"))}
    ranked = []
    for cell in _arr(target_row.get("cells")):
        point_code = _text(cell.get("pointCode"))
        if not cell.get("detectable") or not point_code or point_code in used:
            continue
        point = points_by_code.get(point_code)
        # Physical measurements are already available on the console. They
        # inform diagnosis but are not operations in the troubleshooting path.
        if not _is_virtual_point(point):
            continue
        other_detecting_rows = [
            row
            for row in _arr(d_matrix.get("rows"))
            if _fault_id(row) != _fault_id(target_row) and bool((get_matrix_cell_for_point(row, point_code) or {}).get("detectable"))
        ]
        separates_remaining = [
            row
            for row in _arr(remaining_rows)
            if bool((get_matrix_cell_for_point(row, point_code) or {}).get("detectable")) != bool(cell.get("detectable"))
        ]
        ranked.append(
            {
                "cell": cell,
                "score": get_point_priority_bonus(point, cell) + (len(separates_remaining) * 10) - len(other_detecting_rows),
            }
        )
    return sorted(ranked, key=lambda item: (-item["score"], _text(item["cell"].get("pointCode"))))


def build_troubleshooting_path(d_matrix, target_fault_id, remaining_rows=None, used_point_codes=None, max_steps=4):
    d_matrix = _validate_d_matrix(d_matrix)
    rows = _arr(d_matrix.get("rows"))
    target_row = next((row for row in rows if _fault_id(row) == target_fault_id), None)
    if target_row is None:
        return {"ok": False, "error": "unknown-fault", "faultId": target_fault_id, "steps": [], "summary": "未找到该故障的 D 矩阵行。"}

    remaining = list(remaining_rows) if remaining_rows is not None else list(rows)
    used = set(used_point_codes or [])
    steps = []
    directly_diagnosable = is_directly_diagnosable_from_physical_points(d_matrix, target_row, remaining)
    while not directly_diagnosable and len(steps) < max_steps:
        ranked = rank_troubleshooting_cells(d_matrix, target_row, remaining, used)
        if not ranked:
            break
        cell = ranked[0]["cell"]
        point_code = _text(cell.get("pointCode"))
        used.add(point_code)
        remaining = [
            row
            for row in remaining
            if bool((get_matrix_cell_for_point(row, point_code) or {}).get("detectable")) == bool(cell.get("detectable"))
        ]
        steps.append(
            {
                "index": len(steps) + 1,
                "pointId": cell.get("pointId"),
                "pointCode": point_code,
                "pointName": compact_diagnostic_point_name(cell.get("pointName")),
                "expected": cell.get("reason") or "该测点应显示可检测异常",
                "remainingFaultIds": [_fault_id(row) for row in remaining],
                "remainingFaultNames": [row.get("faultName") or _fault_id(row) for row in remaining],
                "reason": f"该测点对 {target_row.get('faultName') or target_fault_id} 为可检测，可排除不匹配故障。",
            }
        )
        if len(remaining) <= 1:
            break

    repair_targets = _repair_targets(target_row)
    repair_steps = [
        {
            "index": len(steps) + index,
            "action": "replaceWire",
            "targetId": target["id"],
            "targetLabel": target["label"],
            "text": f"更换线路：{target['label']}。",
        }
        for index, target in enumerate(
            (target for target in repair_targets if target["kind"] == "edge"),
            start=1,
        )
    ]
    repair_steps.extend(
        {
            "index": len(steps) + len(repair_steps) + 1,
            "action": "replaceComponent",
            "targetId": target["id"],
            "targetLabel": target["label"],
            "text": f"更换组件：{target['label']}。",
        }
        for target in repair_targets
        if target["kind"] == "node"
    )

    path = {
        "ok": True,
        "faultId": _fault_id(target_row),
        "faultName": target_row.get("faultName") or _fault_id(target_row),
        "targetLabel": target_row.get("targetLabel") or "",
        "layer": target_row.get("layer") or "",
        "steps": [*steps, *repair_steps],
        "summary": (
            "现有物理测点已可唯一定位该故障，可直接执行修复。"
            if directly_diagnosable
            else f"优先检查 {steps[0]['pointCode']} {steps[0]['pointName']}，再按剩余候选继续确认。" if steps else "该故障暂无可检测测点。"
        ),
    }
    path["keySteps"] = [
        *[
            {
                "id": f"measure-{step['index']}-{step.get('pointId') or step['pointCode']}",
                "action": "measure",
                "pointId": step.get("pointId"),
                "pointCode": step["pointCode"],
                "text": f"测量关键测点：{step['pointCode']} {step['pointName']}。",
            }
            for step in steps
        ],
        *[
            {
                "id": f"replace-wire-{target['id']}",
                "action": "replaceWire",
                "targetId": target["id"],
                "targetLabel": target["label"],
                "text": f"更换关键连线：{target['label']}。",
            }
            for target in repair_targets
            if target["kind"] == "edge"
        ],
        *[
            {
                "id": f"replace-device-{target['id']}",
                "action": "replaceComponent",
                "targetId": target["id"],
                "targetLabel": target["label"],
                "text": f"更换组件：{target['label']}。",
            }
            for target in repair_targets
            if target["kind"] == "node"
        ],
    ]
    return path


def build_troubleshooting_plan(d_matrix, target_fault_id, max_steps=4):
    path = build_troubleshooting_path(d_matrix, target_fault_id, max_steps=max_steps)
    return {
        **path,
        "source": "backend-algorithm",
        "isCustomized": False,
    }


class TroubleshootingSession:
    def __init__(self, d_matrix, target_fault_id, max_steps=4):
        self.d_matrix = _clone(_validate_d_matrix(d_matrix))
        self.target_fault_id = _text(target_fault_id)
        if not self.target_fault_id:
            raise SimulationBackendError("INVALID_SCHEMA", "targetFaultId", "targetFaultId is required")
        self.max_steps = max_steps
        self.target_row = next((row for row in _arr(self.d_matrix.get("rows")) if _fault_id(row) == self.target_fault_id), None)
        if self.target_row is None:
            raise SimulationBackendError("INVALID_SCHEMA", "targetFaultId", "targetFaultId is not present in dMatrix.rows")
        self.remaining_rows = list(_arr(self.d_matrix.get("rows")))
        self.used_point_codes = set()
        self.operations = []
        self.path_steps = []

    @property
    def remaining_fault_ids(self):
        return [_fault_id(row) for row in self.remaining_rows]

    def _next_path(self):
        return build_troubleshooting_path(
            self.d_matrix,
            self.target_fault_id,
            remaining_rows=self.remaining_rows,
            used_point_codes=self.used_point_codes,
            max_steps=self.max_steps,
        )

    def initial_response(self):
        path = self._next_path()
        return {
            "status": "success",
            "targetFaultId": self.target_fault_id,
            "currentPath": path,
            "nextRecommendedStep": path["steps"][0] if path.get("steps") else None,
            "remainingFaultIds": self.remaining_fault_ids,
            "operations": [],
        }

    def _current_path(self):
        return {
            "ok": True,
            "faultId": _fault_id(self.target_row),
            "faultName": self.target_row.get("faultName") or _fault_id(self.target_row),
            "targetLabel": self.target_row.get("targetLabel") or "",
            "layer": self.target_row.get("layer") or "",
            "steps": _clone(self.path_steps),
        }

    def record_operation(self, operation):
        if not isinstance(operation, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "operation", "operation must be an object")

        before_path = self._next_path()
        recommended = before_path["steps"][0] if before_path.get("steps") else None
        point_code = _point_code_from_operation(operation)
        observed = _normalize_observed(operation.get("observed"))
        detectable = _observed_to_detectable(observed)
        target_cell = get_matrix_cell_for_point(self.target_row, point_code) if point_code else None
        expected_detectable = bool(target_cell.get("detectable")) if target_cell else None

        if point_code:
            self.used_point_codes.add(point_code)
        if detectable is not None and point_code:
            self.remaining_rows = [
                row
                for row in self.remaining_rows
                if bool((get_matrix_cell_for_point(row, point_code) or {}).get("detectable")) == detectable
            ]

        matched_recommended = bool(recommended and point_code and recommended.get("pointCode") == point_code)
        route_step = {
            "index": len(self.path_steps) + 1,
            "operationId": operation.get("operationId") or f"operation-{len(self.path_steps) + 1}",
            "actionType": operation.get("actionType") or "",
            "pointId": operation.get("pointId") or (target_cell or {}).get("pointId"),
            "pointCode": point_code,
            "pointName": compact_diagnostic_point_name(operation.get("pointName") or (target_cell or {}).get("pointName")),
            "studentObserved": observed,
            "expectedForTarget": "unknown" if expected_detectable is None else ("abnormal" if expected_detectable else "normal"),
            "routeMatched": matched_recommended,
            "remainingFaultIds": self.remaining_fault_ids,
            "remainingFaultNames": [row.get("faultName") or _fault_id(row) for row in self.remaining_rows],
            "rawAction": _clone(operation.get("rawAction") or {}),
        }
        self.path_steps.append(route_step)
        self.operations.append(_clone(operation))

        next_path = self._next_path()
        next_step = None if len(self.remaining_rows) <= 1 else (next_path["steps"][0] if next_path.get("steps") else None)
        return {
            "status": "success",
            "targetFaultId": self.target_fault_id,
            "currentPath": self._current_path(),
            "nextRecommendedStep": next_step,
            "remainingFaultIds": self.remaining_fault_ids,
            "operations": _clone(self.operations),
            "routeQuality": {
                "matchedRecommendedStep": matched_recommended,
                "unnecessaryOperation": target_cell is None,
                "remainingFaultCount": len(self.remaining_rows),
            },
        }
