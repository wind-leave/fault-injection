import itertools
import math

from backend.schemas import SimulationBackendError


ALLOWED_ACTIONS = {"measure", "replaceWire", "replaceComponent"}


def _arr(value):
    return value if isinstance(value, list) else []


def _text(value, fallback=""):
    if value is None:
        return fallback
    result = str(value).strip()
    return result or fallback


def _fault_id(row):
    return _text(row.get("faultId") or row.get("faultTypeId") or row.get("caseId") or row.get("id"))


def _fault_name(row):
    return _text(row.get("faultName") or row.get("faultDisplayName") or row.get("name"), _fault_id(row))


def _point_code(point):
    return _text(point.get("shortName") or point.get("pointCode") or point.get("pointId") or point.get("id"))


def _is_physical_point(point):
    # Legacy matrices omitted pointType and used every point as an active
    # measurement. Current matrices explicitly mark physical/virtual points.
    return _text((point or {}).get("pointType")).lower() == "physical"


def _target_kind(row):
    value = _text(row.get("targetKind")).lower()
    if value in {"edge", "wire", "line", "connection"} or _text(row.get("targetEdgeId")):
        return "edge"
    return "node"


def _target_id(row):
    if _target_kind(row) == "edge":
        return _text(row.get("targetEdgeId") or row.get("targetId") or row.get("targetLabel"))
    return _text(row.get("targetNodeId") or row.get("targetId") or row.get("targetLabel"))


def _validate_d_matrix(d_matrix):
    if not isinstance(d_matrix, dict):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix", "dMatrix must be an object")
    if not isinstance(d_matrix.get("points"), list):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.points", "dMatrix.points must be an array")
    if not isinstance(d_matrix.get("rows"), list):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.rows", "dMatrix.rows must be an array")
    fault_ids = [_fault_id(row) for row in d_matrix["rows"]]
    if any(not fault_id for fault_id in fault_ids):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.rows", "every D-matrix row must identify one concrete fault")
    if len(set(fault_ids)) != len(fault_ids):
        raise SimulationBackendError("INVALID_SCHEMA", "dMatrix.rows", "D-matrix concrete fault ids must be unique")
    return d_matrix


def _graph_payload(model_graph):
    graph = model_graph if isinstance(model_graph, dict) else {}
    snapshot = graph.get("workbenchSnapshot")
    return snapshot if isinstance(snapshot, dict) else graph


def _node_label(node):
    props = node.get("props") if isinstance(node.get("props"), dict) else {}
    return _text(node.get("label") or node.get("name") or props.get("name"), node.get("id"))


def _repair_targets(row):
    targets = []
    seen = set()

    def add(kind, target_id, label):
        normalized_kind = "edge" if _text(kind).lower() in {"edge", "wire", "line", "connection"} else "node"
        normalized_id = _text(target_id)
        key = (normalized_kind, normalized_id)
        if not normalized_id or key in seen:
            return
        seen.add(key)
        targets.append({"kind": normalized_kind, "id": normalized_id, "label": _text(label, normalized_id)})

    for target in _arr(row.get("repairTargets")):
        if isinstance(target, dict):
            add(
                target.get("kind") or target.get("targetKind"),
                target.get("id") or target.get("targetId"),
                target.get("label") or target.get("targetLabel") or target.get("name"),
            )
    if not targets:
        add(_target_kind(row), _target_id(row), row.get("targetLabel"))
    return targets


def build_diagnostic_knowledge_graph(d_matrix, model_graph=None):
    """Compile canvas structure plus the manually authored D matrix into a graph.

    D-matrix rows remain concrete fault locations.  Topology never changes a
    manually authored detectability value; it only contributes structural
    component/signal relations.
    """
    d_matrix = _validate_d_matrix(d_matrix)
    payload = _graph_payload(model_graph)
    graph_nodes = {}
    relations = []
    relation_keys = set()

    def add_node(kind, node_id, label="", **properties):
        normalized_id = _text(node_id)
        if not normalized_id:
            return
        key = f"{kind}:{normalized_id}"
        current = graph_nodes.get(key, {"id": normalized_id, "kind": kind, "label": _text(label, normalized_id)})
        current.update({name: value for name, value in properties.items() if value is not None and value != ""})
        graph_nodes[key] = current

    def add_relation(relation_type, source_kind, source_id, target_kind, target_id, **properties):
        source = _text(source_id)
        target = _text(target_id)
        if not source or not target:
            return
        property_key = tuple(sorted((name, repr(value)) for name, value in properties.items()))
        key = (relation_type, source_kind, source, target_kind, target, property_key)
        if key in relation_keys:
            return
        relation_keys.add(key)
        relations.append(
            {
                "type": relation_type,
                "source": {"kind": source_kind, "id": source},
                "target": {"kind": target_kind, "id": target},
                **properties,
            }
        )

    canvas_nodes = _arr(payload.get("nodes")) or _arr(payload.get("modelNodes"))
    canvas_edges = _arr(payload.get("edges")) or _arr(payload.get("modelEdges"))
    for node in canvas_nodes:
        if not isinstance(node, dict):
            continue
        add_node("component", node.get("id"), _node_label(node), componentType=node.get("type"))
    for edge in canvas_edges:
        if not isinstance(edge, dict):
            continue
        edge_id = _text(edge.get("id"))
        add_node("signalEdge", edge_id, edge.get("label") or edge.get("signalId") or edge_id, signalId=edge.get("signalId"), lineType=edge.get("lineType"))
        add_relation("OUTPUTS_TO", "component", edge.get("sourceNodeId"), "signalEdge", edge_id)
        add_relation("INPUTS_TO", "signalEdge", edge_id, "component", edge.get("targetNodeId"))

    for point in d_matrix["points"]:
        if not isinstance(point, dict):
            continue
        point_id = _text(point.get("pointId") or point.get("id") or point.get("shortName"))
        add_node(
            "measurementPoint",
            point_id,
            point.get("name") or point.get("shortName") or point_id,
            pointCode=_point_code(point),
            pointType=point.get("pointType"),
            edgeId=point.get("edgeId"),
            nodeId=point.get("nodeId") or point.get("targetNodeId"),
            inputIndex=point.get("inputIndex"),
            inputKey=point.get("inputKey"),
            displayConsoleInput=bool(point.get("displayConsoleInput")),
        )
        if point.get("edgeId"):
            add_relation("OBSERVES", "measurementPoint", point_id, "signalEdge", point.get("edgeId"))
        point_node_id = point.get("nodeId") or point.get("targetNodeId")
        if point_node_id:
            add_node("component", point_node_id, point.get("targetName") or point_node_id)
            add_relation(
                "OBSERVES",
                "measurementPoint",
                point_id,
                "component",
                point_node_id,
                inputIndex=point.get("inputIndex"),
                inputKey=point.get("inputKey"),
                observationSource="display-console-input" if point.get("displayConsoleInput") else "component-input",
            )

    for row in d_matrix["rows"]:
        fault_id = _fault_id(row)
        add_node(
            "fault",
            fault_id,
            _fault_name(row),
            layer=row.get("layer"),
            targetKind=_target_kind(row),
            targetId=_target_id(row),
            slotId=row.get("slotId"),
        )
        target_kind = "signalEdge" if _target_kind(row) == "edge" else "component"
        target_id = _target_id(row)
        add_node(target_kind, target_id, row.get("targetLabel") or target_id)
        add_relation("OCCURS_ON", "fault", fault_id, target_kind, target_id)

        for cell in _arr(row.get("cells")):
            if not isinstance(cell, dict):
                continue
            point_id = _text(cell.get("pointId") or cell.get("id") or cell.get("pointCode"))
            add_relation(
                "DETECTABILITY",
                "fault",
                fault_id,
                "measurementPoint",
                point_id,
                detectable=bool(cell.get("detectable")),
                evidenceSource="manual-d-matrix",
                reason=_text(cell.get("reason")),
            )

        for target in _repair_targets(row):
            repair_kind = "signalEdge" if target["kind"] == "edge" else "component"
            action = "replaceWire" if target["kind"] == "edge" else "replaceComponent"
            add_node(repair_kind, target["id"], target["label"])
            add_relation("RESOLVED_BY_REPLACING", "fault", fault_id, repair_kind, target["id"], action=action)

    point_ids_by_code = {
        _point_code(point): _text(point.get("pointId") or point.get("id") or point.get("shortName"))
        for point in d_matrix["points"]
        if isinstance(point, dict) and _point_code(point)
    }
    for constraint in _manual_fault_relations(d_matrix):
        constraint_type = _text(constraint.get("type") or constraint.get("relationType")).lower()
        fault_ids = sorted(_relation_fault_ids(constraint))
        if constraint_type in {"mutex", "mutuallyexclusive", "mutually_exclusive", "互斥"} and len(fault_ids) >= 2:
            add_relation(
                "MUTEX_WITH",
                "fault",
                fault_ids[0],
                "fault",
                fault_ids[1],
                requiredFaultIds=fault_ids,
                evidenceSource="manual-fault-relation",
            )
        elif constraint_type in {"masks", "mask", "掩盖"} and fault_ids:
            point_codes = [
                _text(value)
                for value in (_arr(constraint.get("pointIds")) or [constraint.get("pointId") or constraint.get("pointCode")])
                if _text(value)
            ]
            for point_code in point_codes:
                point_id = point_ids_by_code.get(point_code, point_code)
                add_relation(
                    "MASKS_AT",
                    "fault",
                    fault_ids[0],
                    "measurementPoint",
                    point_id,
                    requiredFaultIds=fault_ids,
                    pointCode=point_code,
                    evidenceSource="manual-fault-relation",
                )

    return {
        "nodes": list(graph_nodes.values()),
        "relations": relations,
        "summary": {
            "nodeCount": len(graph_nodes),
            "relationCount": len(relations),
            "faultCount": len(d_matrix["rows"]),
            "measurementPointCount": len(d_matrix["points"]),
            "manualDetectabilityCount": sum(
                1 for relation in relations if relation["type"] == "DETECTABILITY" and relation.get("detectable")
            ),
        },
        "source": "canvas-and-manual-d-matrix",
    }


def _graph_reference(relation, name):
    reference = relation.get(name)
    return reference if isinstance(reference, dict) else {}


def _knowledge_graph_diagnostic_data(knowledge_graph):
    if not isinstance(knowledge_graph, dict):
        raise SimulationBackendError("INVALID_SCHEMA", "knowledgeGraph", "knowledgeGraph must be an object")
    nodes = _arr(knowledge_graph.get("nodes"))
    relations = _arr(knowledge_graph.get("relations"))
    node_by_key = {
        (_text(node.get("kind")), _text(node.get("id"))): node
        for node in nodes
        if isinstance(node, dict) and _text(node.get("kind")) and _text(node.get("id"))
    }
    point_nodes = [node for node in nodes if isinstance(node, dict) and node.get("kind") == "measurementPoint"]
    fault_nodes = [node for node in nodes if isinstance(node, dict) and node.get("kind") == "fault"]
    if not fault_nodes:
        raise SimulationBackendError("INVALID_SCHEMA", "knowledgeGraph.nodes", "knowledge graph must contain concrete fault nodes")

    points = []
    point_code_by_id = {}
    for node in point_nodes:
        point_id = _text(node.get("id"))
        point_code = _text(node.get("pointCode"), point_id)
        point_code_by_id[point_id] = point_code
        points.append(
            {
                "pointId": point_id,
                "id": point_id,
                "shortName": point_code,
                "pointCode": point_code,
                "name": _text(node.get("label"), point_code),
                "pointType": node.get("pointType"),
                "role": node.get("role"),
            }
        )

    point_codes = [_point_code(point) for point in points]
    signatures = {
        _text(node.get("id")): {point_code: False for point_code in point_codes}
        for node in fault_nodes
    }
    for relation in relations:
        if not isinstance(relation, dict) or relation.get("type") != "DETECTABILITY":
            continue
        source = _graph_reference(relation, "source")
        target = _graph_reference(relation, "target")
        if source.get("kind") != "fault" or target.get("kind") != "measurementPoint":
            continue
        fault_id = _text(source.get("id"))
        point_code = point_code_by_id.get(_text(target.get("id")), _text(target.get("id")))
        if fault_id in signatures and point_code in signatures[fault_id]:
            signatures[fault_id][point_code] = bool(relation.get("detectable"))

    faults = {
        _text(node.get("id")): {
            "faultId": _text(node.get("id")),
            "faultName": _text(node.get("label"), _text(node.get("id"))),
            "faultDisplayName": _text(node.get("label"), _text(node.get("id"))),
            "layer": node.get("layer"),
        }
        for node in fault_nodes
    }
    constraints = []
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        relation_type = relation.get("type")
        if relation_type == "MUTEX_WITH":
            source = _graph_reference(relation, "source")
            target = _graph_reference(relation, "target")
            fault_ids = _arr(relation.get("requiredFaultIds")) or [source.get("id"), target.get("id")]
            constraints.append({"type": "mutex", "faultIds": [_text(value) for value in fault_ids if _text(value)]})
        elif relation_type == "MASKS_AT":
            source = _graph_reference(relation, "source")
            target = _graph_reference(relation, "target")
            fault_ids = _arr(relation.get("requiredFaultIds")) or [source.get("id")]
            point_code = _text(relation.get("pointCode"), point_code_by_id.get(_text(target.get("id")), _text(target.get("id"))))
            constraints.append(
                {
                    "type": "masks",
                    "faultIds": [_text(value) for value in fault_ids if _text(value)],
                    "pointIds": [point_code] if point_code else [],
                }
            )

    return {
        "nodes": node_by_key,
        "relations": relations,
        "points": points,
        "pointCodes": point_codes,
        "pointCodeById": point_code_by_id,
        "faults": faults,
        "faultOrder": [_text(node.get("id")) for node in fault_nodes],
        "signatures": signatures,
        "constraints": constraints,
    }


def _manual_fault_relations(d_matrix):
    return [relation for relation in _arr(d_matrix.get("faultRelations")) if isinstance(relation, dict)]


def _relation_fault_ids(relation):
    values = relation.get("faultIds")
    if isinstance(values, list):
        return {_text(value) for value in values if _text(value)}
    return {
        _text(relation.get("sourceFaultId") or relation.get("source")),
        _text(relation.get("targetFaultId") or relation.get("target")),
    } - {""}


def _is_mutex(combo_ids, relations):
    combo_set = set(combo_ids)
    for relation in relations:
        relation_type = _text(relation.get("type") or relation.get("relationType")).lower()
        if relation_type in {"mutex", "mutuallyexclusive", "mutually_exclusive", "互斥"}:
            related = _relation_fault_ids(relation)
            if len(related) >= 2 and related.issubset(combo_set):
                return True
    return False


def _apply_manual_combination_relations(signature, combo_ids, relations):
    combined = dict(signature)
    combo_set = set(combo_ids)
    for relation in relations:
        relation_type = _text(relation.get("type") or relation.get("relationType")).lower()
        if relation_type not in {"masks", "mask", "掩盖"}:
            continue
        if not _relation_fault_ids(relation).issubset(combo_set):
            continue
        point_ids = _arr(relation.get("pointIds")) or [_text(relation.get("pointId") or relation.get("pointCode"))]
        for point_id in point_ids:
            normalized = _text(point_id)
            if normalized:
                combined[normalized] = False
    return combined


def _normalize_observations(observations):
    if observations is None:
        return {}
    if isinstance(observations, dict):
        source = [{"pointCode": key, "observed": value} for key, value in observations.items()]
    elif isinstance(observations, list):
        source = observations
    else:
        raise SimulationBackendError("INVALID_SCHEMA", "observations", "observations must be an array or object")
    result = {}
    for index, observation in enumerate(source):
        if not isinstance(observation, dict):
            raise SimulationBackendError("INVALID_SCHEMA", f"observations[{index}]", "observation must be an object")
        point_code = _text(observation.get("pointCode") or observation.get("shortName") or observation.get("pointId"))
        if not point_code:
            raise SimulationBackendError("INVALID_SCHEMA", f"observations[{index}].pointId", "observation point is required")
        raw = observation.get("observed", observation.get("state", observation.get("detectable")))
        if isinstance(raw, bool):
            result[point_code] = raw
            continue
        value = _text(raw).lower()
        if value in {"abnormal", "fault", "faulty", "1", "true", "yes", "异常"}:
            result[point_code] = True
        elif value in {"normal", "healthy", "0", "false", "no", "正常"}:
            result[point_code] = False
        elif value in {"", "unknown", "uncertain", "未知"}:
            result[point_code] = None
        else:
            raise SimulationBackendError("INVALID_SCHEMA", f"observations[{index}].observed", "observed must be normal, abnormal, or unknown")
    return result


def _build_candidate(combo, point_codes, row_signatures, row_names, manual_relations, normalized_observations):
    fault_ids = [_fault_id(row) for row in combo]
    signature = {
        point_code: any(row_signatures[fault_id][point_code] for fault_id in fault_ids)
        for point_code in point_codes
    }
    signature = _apply_manual_combination_relations(signature, fault_ids, manual_relations)
    matches = 0
    contradictions = 0
    compared = 0
    for point_code, observed in normalized_observations.items():
        if observed is None or point_code not in signature:
            continue
        compared += 1
        if signature[point_code] == observed:
            matches += 1
        else:
            contradictions += 1
    agreement = matches / compared if compared else 1.0
    complexity_penalty = 0.04 * (len(fault_ids) - 1)
    score = max(0.0, agreement - complexity_penalty - (0.25 * contradictions))
    return {
        "faultIds": fault_ids,
        "faultNames": [row_names[fault_id] for fault_id in fault_ids],
        "mode": "single" if len(fault_ids) == 1 else "multiple",
        "signature": signature,
        "matches": matches,
        "contradictions": contradictions,
        "comparedPointCount": compared,
        "score": round(score, 6),
    }


def build_fault_candidates_from_knowledge_graph(knowledge_graph, observations=None, max_faults=None):
    graph_data = _knowledge_graph_diagnostic_data(knowledge_graph)
    point_codes = graph_data["pointCodes"]
    rows = [graph_data["faults"][fault_id] for fault_id in graph_data["faultOrder"]]
    if max_faults is None:
        max_faults = len(rows)
    if isinstance(max_faults, bool) or not isinstance(max_faults, int) or max_faults < 1:
        raise SimulationBackendError("INVALID_SCHEMA", "maxFaults", "maxFaults must be a positive integer")
    row_signatures = graph_data["signatures"]
    row_names = {fault_id: _fault_name(row) for fault_id, row in graph_data["faults"].items()}
    manual_relations = graph_data["constraints"]
    normalized_observations = {
        graph_data["pointCodeById"].get(point_key, point_key): observed
        for point_key, observed in _normalize_observations(observations).items()
    }
    candidates = []

    for size in range(1, min(max_faults, len(rows)) + 1):
        for combo in itertools.combinations(rows, size):
            fault_ids = [_fault_id(row) for row in combo]
            if _is_mutex(fault_ids, manual_relations):
                continue
            candidates.append(
                _build_candidate(combo, point_codes, row_signatures, row_names, manual_relations, normalized_observations)
            )
    candidates.sort(key=lambda candidate: (candidate["contradictions"], -candidate["score"], len(candidate["faultIds"]), candidate["faultIds"]))
    return candidates


def build_fault_candidates(d_matrix, observations=None, max_faults=None):
    knowledge_graph = build_diagnostic_knowledge_graph(_validate_d_matrix(d_matrix))
    return build_fault_candidates_from_knowledge_graph(knowledge_graph, observations=observations, max_faults=max_faults)


def _candidate_key(candidate):
    return tuple(sorted(candidate.get("faultIds") or []))


def _candidate_names(candidate):
    return "+".join(candidate.get("faultNames") or candidate.get("faultIds") or [])


def _entropy(true_count, false_count):
    total = true_count + false_count
    if total <= 0 or true_count == 0 or false_count == 0:
        return 0.0
    probability = true_count / total
    return -(probability * math.log2(probability) + (1 - probability) * math.log2(1 - probability))


def _rank_points(points, candidates, used_codes):
    ranked = []
    for point in points:
        point_code = _point_code(point)
        if not point_code or point_code in used_codes or _is_physical_point(point):
            continue
        abnormal = [candidate for candidate in candidates if bool(candidate["signature"].get(point_code, False))]
        normal = [candidate for candidate in candidates if not bool(candidate["signature"].get(point_code, False))]
        information_gain = _entropy(len(abnormal), len(normal))
        if information_gain <= 0:
            continue
        name = f"{point.get('name', '')} {point.get('role', '')}"
        priority = 20 if any(token in name.lower() for token in ["residual", "diagnostic", "残差", "诊断"]) else 0
        ranked.append(
            {
                "point": point,
                "score": (information_gain * 100) + priority,
                "abnormal": abnormal,
                "normal": normal,
            }
        )
    return sorted(ranked, key=lambda item: (-item["score"], _point_code(item["point"])))


def _replacement_steps_from_knowledge_graph(knowledge_graph, target_fault_ids, start_index):
    graph_data = _knowledge_graph_diagnostic_data(knowledge_graph)
    target_set = set(target_fault_ids)
    steps = []
    seen = set()
    for relation in graph_data["relations"]:
        if not isinstance(relation, dict) or relation.get("type") != "RESOLVED_BY_REPLACING":
            continue
        source = _graph_reference(relation, "source")
        target = _graph_reference(relation, "target")
        fault_id = _text(source.get("id"))
        if source.get("kind") != "fault" or fault_id not in target_set:
            continue
        action = _text(relation.get("action"))
        if action not in {"replaceWire", "replaceComponent"}:
            action = "replaceWire" if target.get("kind") == "signalEdge" else "replaceComponent"
        target_id = _text(target.get("id"))
        if not target_id:
            continue
        key = (action, target_id)
        if key in seen:
            existing = next(step for step in steps if (step["action"], step["targetId"]) == key)
            if fault_id not in existing["relatedFaultIds"]:
                existing["relatedFaultIds"].append(fault_id)
            continue
        seen.add(key)
        target_node = graph_data["nodes"].get((_text(target.get("kind")), target_id), {})
        target_label = _text(target_node.get("label"), target_id)
        steps.append(
            {
                "index": start_index + len(steps),
                "action": action,
                "targetId": target_id,
                "targetLabel": target_label,
                "relatedFaultIds": [fault_id],
                "text": f"{'更换连线' if action == 'replaceWire' else '更换设备'}：{target_label}。",
            }
        )
    return steps


def _target_labels_from_knowledge_graph(knowledge_graph, target_fault_ids):
    graph_data = _knowledge_graph_diagnostic_data(knowledge_graph)
    target_set = set(target_fault_ids)
    labels = []
    for relation in graph_data["relations"]:
        if not isinstance(relation, dict) or relation.get("type") != "OCCURS_ON":
            continue
        source = _graph_reference(relation, "source")
        target = _graph_reference(relation, "target")
        if source.get("kind") != "fault" or _text(source.get("id")) not in target_set:
            continue
        target_id = _text(target.get("id"))
        target_node = graph_data["nodes"].get((_text(target.get("kind")), target_id), {})
        label = _text(target_node.get("label"), target_id)
        if label and label not in labels:
            labels.append(label)
    return labels


def build_multi_fault_troubleshooting_plan(
    d_matrix,
    target_fault_ids,
    observations=None,
    max_faults=None,
    max_steps=4,
    model_graph=None,
):
    knowledge_graph = build_diagnostic_knowledge_graph(_validate_d_matrix(d_matrix), model_graph=model_graph)
    return build_multi_fault_troubleshooting_plan_from_knowledge_graph(
        knowledge_graph,
        target_fault_ids,
        observations=observations,
        max_faults=max_faults,
        max_steps=max_steps,
    )


def build_multi_fault_troubleshooting_plan_from_knowledge_graph(
    knowledge_graph,
    target_fault_ids,
    observations=None,
    max_faults=None,
    max_steps=4,
):
    graph_data = _knowledge_graph_diagnostic_data(knowledge_graph)
    if not isinstance(target_fault_ids, list) or not target_fault_ids:
        raise SimulationBackendError("INVALID_SCHEMA", "targetFaultIds", "targetFaultIds must be a non-empty array")
    normalized_target_ids = []
    for index, fault_id in enumerate(target_fault_ids):
        normalized = _text(fault_id)
        if not normalized:
            raise SimulationBackendError("INVALID_SCHEMA", f"targetFaultIds[{index}]", "fault id is required")
        if normalized not in normalized_target_ids:
            normalized_target_ids.append(normalized)
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 0 <= max_steps <= 12:
        raise SimulationBackendError("INVALID_SCHEMA", "maxSteps", "maxSteps must be an integer from 0 to 12")
    if max_faults is None:
        max_faults = len(graph_data["faults"])
    if isinstance(max_faults, bool) or not isinstance(max_faults, int) or max_faults < 1:
        raise SimulationBackendError("INVALID_SCHEMA", "maxFaults", "maxFaults must be a positive integer")
    max_faults = max(max_faults, len(normalized_target_ids))

    rows_by_id = graph_data["faults"]
    missing = [fault_id for fault_id in normalized_target_ids if fault_id not in rows_by_id]
    if missing:
        raise SimulationBackendError("INVALID_SCHEMA", "targetFaultIds", f"unknown concrete fault ids: {', '.join(missing)}")
    target_rows = [rows_by_id[fault_id] for fault_id in normalized_target_ids]
    manual_relations = graph_data["constraints"]
    if _is_mutex(normalized_target_ids, manual_relations):
        raise SimulationBackendError("INVALID_SCHEMA", "targetFaultIds", "the selected faults violate the manual fault constraints")
    candidate_depth = min(max_faults, len(graph_data["faults"]))
    candidates = build_fault_candidates_from_knowledge_graph(
        knowledge_graph,
        observations=observations,
        max_faults=candidate_depth,
    )
    target_key = tuple(sorted(normalized_target_ids))
    target_candidate = next((candidate for candidate in candidates if _candidate_key(candidate) == target_key), None)
    if target_candidate is None:
        point_codes = graph_data["pointCodes"]
        row_signatures = graph_data["signatures"]
        row_names = {fault_id: _fault_name(row) for fault_id, row in graph_data["faults"].items()}
        target_candidate = _build_candidate(
            target_rows,
            point_codes,
            row_signatures,
            row_names,
            manual_relations,
            _normalize_observations(observations),
        )
        candidates.append(target_candidate)
        candidates.sort(key=lambda candidate: (candidate["contradictions"], -candidate["score"], len(candidate["faultIds"]), candidate["faultIds"]))

    normalized_observations = {
        graph_data["pointCodeById"].get(point_key, point_key): observed
        for point_key, observed in _normalize_observations(observations).items()
    }
    comparable = [candidate for candidate in candidates if candidate["contradictions"] == 0]
    remaining = comparable if comparable else candidates[: max(1, min(32, len(candidates)))]
    if not any(_candidate_key(candidate) == target_key for candidate in remaining):
        remaining.append(target_candidate)
    points_by_code = {_point_code(point): point for point in graph_data["points"]}
    known_conditions = []
    physical_states = {}
    for point_code, point in points_by_code.items():
        if not _is_physical_point(point):
            continue
        explicit_state = normalized_observations.get(point_code)
        observed = explicit_state if explicit_state is not None else bool(target_candidate["signature"].get(point_code, False))
        physical_states[point_code] = observed
        known_conditions.append(
            {
                "pointId": point.get("pointId") or point.get("id") or point_code,
                "pointCode": point_code,
                "pointName": _text(point.get("name"), point_code),
                "pointType": "physical",
                "observed": "abnormal" if observed else "normal",
                "expectedState": "abnormal" if observed else "normal",
                "source": "observation" if explicit_state is not None else "target-signature",
            }
        )
    if physical_states:
        remaining = [
            candidate
            for candidate in remaining
            if all(bool(candidate["signature"].get(point_code, False)) == observed for point_code, observed in physical_states.items())
        ]
    used_codes = {
        point_code for point_code, value in normalized_observations.items() if value is not None
    } | set(physical_states)
    measurement_steps = []

    while len({_candidate_key(candidate) for candidate in remaining}) > 1 and len(measurement_steps) < max_steps:
        ranked = _rank_points(graph_data["points"], remaining, used_codes)
        if not ranked:
            break
        selected = ranked[0]
        point = selected["point"]
        point_code = _point_code(point)
        expected_abnormal = bool(target_candidate["signature"].get(point_code, False))
        used_codes.add(point_code)
        abnormal_candidates = selected["abnormal"]
        normal_candidates = selected["normal"]
        remaining = abnormal_candidates if expected_abnormal else normal_candidates
        point_name = _text(point.get("name"), point_code)
        measurement_steps.append(
            {
                "index": len(measurement_steps) + 1,
                "action": "measure",
                "pointId": point.get("pointId") or point.get("id") or point_code,
                "pointCode": point_code,
                "pointName": point_name,
                "expectedState": "abnormal" if expected_abnormal else "normal",
                "expected": f"检测结果应为{'异常' if expected_abnormal else '正常'}。",
                "reason": "该测点能够最大程度区分当前单故障和多故障候选。",
                "branches": {
                    "abnormal": {
                        "remainingFaultSets": [candidate["faultIds"] for candidate in abnormal_candidates],
                        "remainingFaultSetNames": [_candidate_names(candidate) for candidate in abnormal_candidates],
                    },
                    "normal": {
                        "remainingFaultSets": [candidate["faultIds"] for candidate in normal_candidates],
                        "remainingFaultSetNames": [_candidate_names(candidate) for candidate in normal_candidates],
                    },
                    "unknown": {
                        "remainingFaultSets": [candidate["faultIds"] for candidate in selected["abnormal"] + selected["normal"]],
                    },
                },
                "remainingFaultIds": sorted({fault_id for candidate in remaining for fault_id in candidate["faultIds"]}),
                "remainingFaultNames": [_candidate_names(candidate) for candidate in remaining],
            }
        )

    fault_names = [_fault_name(row) for row in target_rows]
    target_labels = _target_labels_from_knowledge_graph(knowledge_graph, normalized_target_ids)
    unique_remaining = {_candidate_key(candidate) for candidate in remaining}
    isolated = unique_remaining == {target_key}
    replacement_steps = (
        _replacement_steps_from_knowledge_graph(knowledge_graph, normalized_target_ids, len(measurement_steps) + 1)
        if isolated
        else []
    )
    steps = [*measurement_steps, *replacement_steps]
    invalid_actions = [step.get("action") for step in steps if step.get("action") not in ALLOWED_ACTIONS]
    if invalid_actions:
        raise AssertionError(f"unsupported troubleshooting actions: {invalid_actions}")
    return {
        "ok": True,
        "faultId": "+".join(normalized_target_ids),
        "faultIds": normalized_target_ids,
        "faultName": " + ".join(fault_names),
        "faultNames": fault_names,
        "mode": "single" if len(normalized_target_ids) == 1 else "multiple",
        "layer": " + ".join(dict.fromkeys(_text(row.get("layer"), "故障") for row in target_rows)),
        "targetLabel": "、".join(target_labels),
        "isolated": isolated,
        "knownConditions": known_conditions,
        "remainingCandidateFaultSets": [candidate["faultIds"] for candidate in remaining],
        "remainingCandidateFaultSetNames": [_candidate_names(candidate) for candidate in remaining],
        "steps": steps,
        "keySteps": [
            *[
                {
                    "id": f"measure-{step['index']}-{step['pointId']}",
                    "action": "measure",
                    "pointId": step["pointId"],
                    "pointCode": step["pointCode"],
                    "text": f"检测测点：{step['pointCode']} {step['pointName']}，预期结果为{'异常' if step['expectedState'] == 'abnormal' else '正常'}。",
                }
                for step in measurement_steps
            ],
            *[
                {
                    "id": f"{step['action']}-{step['targetId']}",
                    "action": step["action"],
                    "targetId": step["targetId"],
                    "targetLabel": step["targetLabel"],
                    "text": step["text"],
                }
                for step in replacement_steps
            ],
        ],
        "summary": (
            f"已通过人工 D 矩阵区分并定位{'单故障' if len(normalized_target_ids) == 1 else '多故障组合'}，按顺序执行检测和更换。"
            if isolated
            else f"当前测点不足以唯一隔离该{'单故障' if len(normalized_target_ids) == 1 else '多故障组合'}；路径停止在检测步骤，不给出未经唯一定位的更换动作。"
        ),
    }
