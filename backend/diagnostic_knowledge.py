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


def _port_label(port, fallback=""):
    if isinstance(port, dict):
        return _text(
            port.get("displayName")
            or port.get("name")
            or port.get("label")
            or port.get("varName")
            or port.get("key")
            or port.get("id"),
            fallback,
        )
    return _text(port, fallback)


def _edge_endpoint_label(edge, node_by_id, direction):
    is_source = direction == "source"
    node_id = _text(edge.get("sourceNodeId") if is_source else edge.get("targetNodeId"))
    port_index = edge.get("sourcePortIndex") if is_source else edge.get("targetPortIndex")
    try:
        port_index = max(0, int(port_index or 0))
    except (TypeError, ValueError):
        port_index = 0
    node = node_by_id.get(node_id, {})
    ports = _arr(node.get("outputs") if is_source else node.get("inputs"))
    if not ports:
        ports = _arr(node.get("outputPorts") if is_source else node.get("inputPorts"))
    edge_port = edge.get("sourcePort") if is_source else edge.get("targetPort")
    port = _port_label(edge_port, _port_label(ports[port_index] if port_index < len(ports) else None, f"#{port_index + 1}"))
    return f"{_node_label(node) if node else node_id or '未命名组件'} · {port}"


def _edge_endpoint_port_id(edge, node_by_id, direction):
    is_source = direction == "source"
    direct_port = edge.get("sourcePortId" if is_source else "targetPortId")
    if not _text(direct_port):
        direct_port = edge.get("sourcePort" if is_source else "targetPort")
    if isinstance(direct_port, dict):
        direct_port = (
            direct_port.get("id")
            or direct_port.get("portId")
            or direct_port.get("key")
            or direct_port.get("varName")
            or direct_port.get("name")
        )
    if _text(direct_port):
        return _text(direct_port)

    node_id = _text(edge.get("sourceNodeId") if is_source else edge.get("targetNodeId"))
    node = node_by_id.get(node_id, {})
    ports = _arr(node.get("outputs") if is_source else node.get("inputs"))
    if not ports:
        ports = _arr(node.get("outputPorts") if is_source else node.get("inputPorts"))
    port_index = edge.get("sourcePortIndex") if is_source else edge.get("targetPortIndex")
    try:
        port_index = max(0, int(port_index or 0))
    except (TypeError, ValueError):
        port_index = 0
    port = ports[port_index] if port_index < len(ports) else None
    if isinstance(port, dict):
        port_id = port.get("id") or port.get("portId") or port.get("key") or port.get("varName") or port.get("name")
        if _text(port_id):
            return _text(port_id)
    return f"{'output' if is_source else 'input'}-{port_index}"


def _canonical_canvas_edges(canvas_edges, node_by_id):
    """Merge different edge IDs that describe the same public endpoints."""
    canonical_edges = []
    canonical_id_by_edge_id = {}
    canonical_id_by_endpoint = {}
    for edge in canvas_edges:
        if not isinstance(edge, dict):
            continue
        edge_id = _text(edge.get("id"))
        source_device_id = _text(edge.get("sourceDeviceId") or edge.get("sourceNodeId"))
        target_device_id = _text(edge.get("targetDeviceId") or edge.get("targetNodeId"))
        endpoint_key = (
            source_device_id,
            _edge_endpoint_port_id(edge, node_by_id, "source"),
            target_device_id,
            _edge_endpoint_port_id(edge, node_by_id, "target"),
        )
        canonical_id = canonical_id_by_endpoint.get(endpoint_key)
        if canonical_id is None:
            canonical_id = edge_id
            canonical_id_by_endpoint[endpoint_key] = canonical_id
            canonical_edges.append(edge)
        if edge_id:
            canonical_id_by_edge_id[edge_id] = canonical_id
    return canonical_edges, canonical_id_by_edge_id


def edge_endpoint_display_name(model_graph, edge_id, fallback=""):
    """Return a stable, human-readable label for a connection's two endpoints."""
    payload = _graph_payload(model_graph)
    nodes = _arr(payload.get("nodes")) or _arr(payload.get("modelNodes"))
    edges = _arr(payload.get("edges")) or _arr(payload.get("modelEdges"))
    edge = next((item for item in edges if isinstance(item, dict) and _text(item.get("id")) == _text(edge_id)), None)
    if edge is None:
        return _text(fallback, _text(edge_id))
    node_by_id = {
        _text(node.get("id")): node
        for node in nodes
        if isinstance(node, dict) and _text(node.get("id"))
    }
    return f"{_edge_endpoint_label(edge, node_by_id, 'source')} → {_edge_endpoint_label(edge, node_by_id, 'target')}"


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
    canvas_nodes_by_id = {
        _text(node.get("id")): node
        for node in canvas_nodes
        if isinstance(node, dict) and _text(node.get("id"))
    }
    canvas_edges, canonical_edge_ids = _canonical_canvas_edges(canvas_edges, canvas_nodes_by_id)

    def canonical_edge_id(edge_id):
        normalized_id = _text(edge_id)
        return canonical_edge_ids.get(normalized_id, normalized_id)

    for node in canvas_nodes:
        if not isinstance(node, dict):
            continue
        add_node("component", node.get("id"), _node_label(node), componentType=node.get("type"))
    for edge in canvas_edges:
        if not isinstance(edge, dict):
            continue
        edge_id = _text(edge.get("id"))
        edge_label = f"{_edge_endpoint_label(edge, canvas_nodes_by_id, 'source')} → {_edge_endpoint_label(edge, canvas_nodes_by_id, 'target')}"
        add_node("signalEdge", edge_id, edge_label, signalId=edge.get("signalId"), lineType=edge.get("lineType"))
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
            edgeId=canonical_edge_id(point.get("edgeId")),
            nodeId=point.get("nodeId") or point.get("targetNodeId"),
            inputIndex=point.get("inputIndex"),
            inputKey=point.get("inputKey"),
            displayConsoleInput=bool(point.get("displayConsoleInput")),
        )
        if point.get("edgeId"):
            add_relation("OBSERVES", "measurementPoint", point_id, "signalEdge", canonical_edge_id(point.get("edgeId")))
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
        target_kind = "signalEdge" if _target_kind(row) == "edge" else "component"
        target_id = canonical_edge_id(_target_id(row)) if target_kind == "signalEdge" else _target_id(row)
        add_node(
            "fault",
            fault_id,
            _fault_name(row),
            layer=row.get("layer"),
            targetKind=_target_kind(row),
            targetId=target_id,
            slotId=row.get("slotId"),
        )
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
            repair_id = canonical_edge_id(target["id"]) if repair_kind == "signalEdge" else target["id"]
            add_node(repair_kind, repair_id, target["label"])
            add_relation("RESOLVED_BY_REPLACING", "fault", fault_id, repair_kind, repair_id, action=action)

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


def _repair_targets_from_knowledge_graph(graph_data):
    """Return every repair target and the concrete faults it removes."""
    targets = {}
    for relation in graph_data["relations"]:
        if not isinstance(relation, dict) or relation.get("type") != "RESOLVED_BY_REPLACING":
            continue
        source = _graph_reference(relation, "source")
        target = _graph_reference(relation, "target")
        fault_id = _text(source.get("id"))
        target_id = _text(target.get("id"))
        if source.get("kind") != "fault" or not fault_id or not target_id:
            continue
        action = _text(relation.get("action"))
        if action not in {"replaceWire", "replaceComponent"}:
            action = "replaceWire" if target.get("kind") == "signalEdge" else "replaceComponent"
        key = (action, target_id)
        current = targets.setdefault(
            key,
            {
                "action": action,
                "targetId": target_id,
                "targetKind": "edge" if target.get("kind") == "signalEdge" else "node",
                "targetLabel": _text(graph_data["nodes"].get((_text(target.get("kind")), target_id), {}).get("label"), target_id),
                "resolvedFaultIds": set(),
            },
        )
        current["resolvedFaultIds"].add(fault_id)
    return list(targets.values())


def _confirmed_repair_targets(graph_data, candidates):
    """Find repair targets implicated by every remaining fault hypothesis.

    A D-matrix can leave several *fault types* indistinguishable while still
    proving that they all occur on the same replaceable component or wire.
    Treat that target as confirmed so the plan can make useful progress
    without requiring the exact fault-type combination to be unique.
    """
    active_candidates = [candidate for candidate in candidates if _active_fault_ids(candidate)]
    if not active_candidates:
        return []
    confirmed = []
    for target in _repair_targets_from_knowledge_graph(graph_data):
        resolved_fault_ids = set(target["resolvedFaultIds"])
        supporting_fault_ids = [
            sorted(resolved_fault_ids & set(_active_fault_ids(candidate)))
            for candidate in active_candidates
        ]
        if not all(supporting_fault_ids):
            continue
        confirmed.append({
            **target,
            "supportingFaultIds": sorted({fault_id for fault_ids in supporting_fault_ids for fault_id in fault_ids}),
            "supportingCandidateCount": len(active_candidates),
            "resolvesEveryCandidateFault": all(
                set(_active_fault_ids(candidate)).issubset(resolved_fault_ids)
                for candidate in active_candidates
            ),
        })
    return sorted(confirmed, key=lambda item: (item["action"], item["targetId"]))


def _confirmed_repair_steps(confirmed_targets, start_index):
    steps = []
    for target in confirmed_targets:
        action_label = "更换连线" if target["action"] == "replaceWire" else "更换设备"
        steps.append({
            "index": start_index + len(steps),
            "action": target["action"],
            "purpose": "confirmedRepairTarget",
            "targetId": target["targetId"],
            "targetKind": target["targetKind"],
            "targetLabel": target["targetLabel"],
            "relatedFaultIds": target["supportingFaultIds"],
            "supportingCandidateCount": target["supportingCandidateCount"],
            "text": f"当前候选均指向{target['targetLabel']}，可确认该对象存在故障；{action_label}：{target['targetLabel']}。",
        })
    return steps


def _signature_after_repair(graph_data, fault_ids, resolved_fault_ids):
    active_fault_ids = [fault_id for fault_id in fault_ids if fault_id not in resolved_fault_ids]
    signature = {
        point_code: any(graph_data["signatures"].get(fault_id, {}).get(point_code, False) for fault_id in active_fault_ids)
        for point_code in graph_data["pointCodes"]
    }
    return _apply_manual_combination_relations(signature, active_fault_ids, graph_data["constraints"])


def _active_fault_ids(candidate):
    """Faults still present in a candidate after earlier diagnostic repairs."""
    return candidate.get("activeFaultIds", candidate.get("faultIds", []))


def _project_candidate_after_repair(graph_data, candidate, resolved_fault_ids):
    """Keep the original diagnosis identity while updating its post-repair state."""
    projected = dict(candidate)
    active_fault_ids = [
        fault_id for fault_id in _active_fault_ids(candidate)
        if fault_id not in resolved_fault_ids
    ]
    projected["activeFaultIds"] = active_fault_ids
    projected["signature"] = _signature_after_repair(graph_data, active_fault_ids, set())
    return projected


def _measurement_steps_for_target(graph_data, candidates, target_candidate, used_codes, max_steps, start_index):
    """Follow the target combination through the best remaining virtual measurements."""
    remaining = list(candidates)
    selected_steps = []
    used = set(used_codes)
    while len({_candidate_key(candidate) for candidate in remaining}) > 1 and len(selected_steps) < max_steps:
        ranked = _rank_points(graph_data["points"], remaining, used)
        if not ranked:
            break
        selected = ranked[0]
        point = selected["point"]
        point_code = _point_code(point)
        expected_abnormal = bool(target_candidate["signature"].get(point_code, False))
        used.add(point_code)
        abnormal_candidates = selected["abnormal"]
        normal_candidates = selected["normal"]
        remaining = abnormal_candidates if expected_abnormal else normal_candidates
        point_name = _text(point.get("name"), point_code)
        selected_steps.append(
            {
                "index": start_index + len(selected_steps),
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
    return selected_steps, remaining, used


def _diagnostic_replacement_probe_steps(graph_data, candidates, target_candidate, start_index):
    """Choose one diagnostic replacement that can split unresolved candidates.

    Replacement is a diagnostic probe here, not a final repair conclusion.  A
    replacement automatically updates physical point states.  A changed
    physical point can therefore advance the path without adding a measurement
    action; every affected virtual point still requires an explicit retest.
    """
    if len({_candidate_key(candidate) for candidate in candidates}) < 2:
        return []

    probes = []
    for target in _repair_targets_from_knowledge_graph(graph_data):
        resolved_fault_ids = target["resolvedFaultIds"]
        after_signatures = {
            _candidate_key(candidate): _signature_after_repair(graph_data, _active_fault_ids(candidate), resolved_fault_ids)
            for candidate in candidates
        }
        target_key = _candidate_key(target_candidate)
        target_signature = after_signatures.get(target_key)
        if target_signature is None:
            continue

        invalidated_virtual_points = []
        physical_updates = []
        for point in graph_data["points"]:
            point_code = _point_code(point)
            if not point_code:
                continue
            changed = any(
                bool(candidate["signature"].get(point_code, False))
                != bool(after_signatures[_candidate_key(candidate)].get(point_code, False))
                for candidate in candidates
            )
            if _is_physical_point(point):
                if changed:
                    physical_updates.append(
                        {
                            "pointId": point.get("pointId") or point.get("id") or point_code,
                            "pointCode": point_code,
                            "pointName": _text(point.get("name"), point_code),
                            "observed": "abnormal" if target_signature.get(point_code, False) else "normal",
                            "source": "auto-after-repair",
                        }
                    )
                continue
            if changed:
                invalidated_virtual_points.append(point_code)

        for point in graph_data["points"]:
            point_code = _point_code(point)
            if not point_code:
                continue
            abnormal = [
                candidate
                for candidate in candidates
                if bool(after_signatures[_candidate_key(candidate)].get(point_code, False))
            ]
            normal = [candidate for candidate in candidates if candidate not in abnormal]
            information_gain = _entropy(len(abnormal), len(normal))
            if information_gain <= 0:
                continue
            if _is_physical_point(point):
                probes.append(
                    {
                        "target": target,
                        "point": point,
                        "pointCode": point_code,
                        "probeType": "physical",
                        "abnormal": abnormal,
                        "normal": normal,
                        "expectedAbnormal": bool(target_signature.get(point_code, False)),
                        "invalidatedVirtualPointCodes": invalidated_virtual_points,
                        "automaticPhysicalUpdates": physical_updates,
                        # A physical result is available automatically after
                        # replacement.  Keep its score comparable to a virtual
                        # retest so an already more-informative virtual probe
                        # still wins when one exists.
                        "score": information_gain * 100,
                    }
                )
                continue
            probes.append(
                {
                    "target": target,
                    "point": point,
                    "pointCode": point_code,
                    "probeType": "virtual",
                    "abnormal": abnormal,
                    "normal": normal,
                    "expectedAbnormal": bool(target_signature.get(point_code, False)),
                    "invalidatedVirtualPointCodes": invalidated_virtual_points,
                    "automaticPhysicalUpdates": physical_updates,
                    "score": (information_gain * 100) + (len(invalidated_virtual_points) * 2),
                }
            )

    if not probes:
        return []
    probe = sorted(
        probes,
        key=lambda item: (-item["score"], item["target"]["action"], item["target"]["targetId"], item["pointCode"]),
    )[0]
    target = probe["target"]
    point = probe["point"]
    repair_index = start_index
    is_physical_probe = probe["probeType"] == "physical"
    retest_index = start_index + 1
    replacement_label = "更换连线" if target["action"] == "replaceWire" else "更换设备"
    retest_point_name = _text(point.get("name"), probe["pointCode"])
    branches = {
        "abnormal": {
            "remainingFaultSets": [candidate["faultIds"] for candidate in probe["abnormal"]],
            "remainingFaultSetNames": [_candidate_names(candidate) for candidate in probe["abnormal"]],
        },
        "normal": {
            "remainingFaultSets": [candidate["faultIds"] for candidate in probe["normal"]],
            "remainingFaultSetNames": [_candidate_names(candidate) for candidate in probe["normal"]],
        },
    }
    repair_step = {
        "index": repair_index,
        "action": target["action"],
        "purpose": "diagnosticIsolation",
        "targetId": target["targetId"],
        "targetKind": target["targetKind"],
        "targetLabel": target["targetLabel"],
        "relatedFaultIds": sorted(target["resolvedFaultIds"]),
        "invalidatedVirtualPointCodes": probe["invalidatedVirtualPointCodes"],
        "automaticPhysicalUpdates": probe["automaticPhysicalUpdates"],
        "text": f"{replacement_label}：{target['targetLabel']}。",
    }
    if is_physical_probe:
        repair_step["automaticObservationPointId"] = point.get("pointId") or point.get("id") or probe["pointCode"]
        repair_step["automaticObservationPointCode"] = probe["pointCode"]
        repair_step["automaticObservationPointName"] = retest_point_name
        repair_step["automaticObservationExpectedState"] = "abnormal" if probe["expectedAbnormal"] else "normal"
        return [repair_step]

    repair_step["requiredRetestPointId"] = point.get("pointId") or point.get("id") or probe["pointCode"]
    repair_step["requiredRetestPointCode"] = probe["pointCode"]
    retest_step = {
        "index": retest_index,
        "action": "measure",
        "purpose": "postRepairRetest",
        "afterRepairStepIndex": repair_index,
        "pointId": point.get("pointId") or point.get("id") or probe["pointCode"],
        "pointCode": probe["pointCode"],
        "pointName": retest_point_name,
        "expectedState": "abnormal" if probe["expectedAbnormal"] else "normal",
        "expected": f"更换后重新测量；目标故障组合下结果应为{'异常' if probe['expectedAbnormal'] else '正常'}。",
        "reason": f"该虚拟测点可根据更换 {target['targetLabel']} 后的结果继续区分剩余候选。",
        "branches": branches,
        "remainingFaultIds": sorted({fault_id for candidate in (probe["abnormal"] if probe["expectedAbnormal"] else probe["normal"]) for fault_id in candidate["faultIds"]}),
        "remainingFaultNames": [_candidate_names(candidate) for candidate in (probe["abnormal"] if probe["expectedAbnormal"] else probe["normal"])],
    }
    return [repair_step, retest_step]


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
    measurement_steps, remaining, used_codes = _measurement_steps_for_target(
        graph_data,
        remaining,
        target_candidate,
        used_codes,
        max_steps,
        1,
    )

    fault_names = [_fault_name(row) for row in target_rows]
    target_labels = _target_labels_from_knowledge_graph(knowledge_graph, normalized_target_ids)
    unique_remaining = {_candidate_key(candidate) for candidate in remaining}
    isolated = unique_remaining == {target_key}
    steps = list(measurement_steps)
    diagnostic_replacement_steps = []
    repaired_target_fault_ids = set()
    diagnostic_rounds = 0

    # A replacement used to distinguish candidates is only one diagnostic
    # state transition.  Follow its target-result branch and continue planning
    # until the original target combination is isolated, rather than ending at
    # the mandatory virtual retest.
    while not isolated and diagnostic_rounds < len(graph_data["faults"]):
        probe_steps = _diagnostic_replacement_probe_steps(
            graph_data,
            remaining,
            target_candidate,
            len(steps) + 1,
        )
        if not probe_steps:
            break
        repair_step = probe_steps[0]
        retest_step = probe_steps[1] if len(probe_steps) > 1 else None
        diagnostic_replacement_steps.extend(probe_steps)
        steps.extend(probe_steps)
        diagnostic_rounds += 1

        resolved_fault_ids = set(repair_step["relatedFaultIds"])
        repaired_target_fault_ids.update(resolved_fault_ids & set(normalized_target_ids))
        remaining = [
            _project_candidate_after_repair(graph_data, candidate, resolved_fault_ids)
            for candidate in remaining
        ]
        target_candidate = next(
            candidate for candidate in remaining if _candidate_key(candidate) == target_key
        )

        # A repair changes affected physical point states immediately.  They
        # are therefore known evidence, but virtual point states are invalid
        # until their explicit post-repair retest.
        automatic_physical_states = {
            update["pointCode"]: update["observed"] == "abnormal"
            for update in repair_step["automaticPhysicalUpdates"]
        }
        if automatic_physical_states:
            remaining = [
                candidate
                for candidate in remaining
                if all(
                    bool(candidate["signature"].get(point_code, False)) == observed
                    for point_code, observed in automatic_physical_states.items()
                )
            ]
            for condition in known_conditions:
                point_code = condition["pointCode"]
                if point_code in automatic_physical_states:
                    observed = automatic_physical_states[point_code]
                    condition.update({
                        "observed": "abnormal" if observed else "normal",
                        "expectedState": "abnormal" if observed else "normal",
                        "source": "auto-after-repair",
                    })

        # Re-evaluate the candidate set before requiring an explicit virtual
        # retest. A replacement can make physical observations sufficient to
        # isolate the target, in which case the pre-planned virtual probe no
        # longer adds diagnostic information.
        isolated_after_physical_update = (
            {_candidate_key(candidate) for candidate in remaining} == {target_key}
        )
        if retest_step is not None and isolated_after_physical_update:
            steps.remove(retest_step)
            diagnostic_replacement_steps.remove(retest_step)
            repair_step.pop("requiredRetestPointId", None)
            repair_step.pop("requiredRetestPointCode", None)
            repair_step["virtualRetestSkipped"] = True
            repair_step["virtualRetestSkippedPointId"] = retest_step["pointId"]
            repair_step["virtualRetestSkippedPointCode"] = retest_step["pointCode"]
            repair_step["virtualRetestSkippedReason"] = "修复后的物理测点已足以隔离目标故障组合。"
            retest_step = None

        if retest_step is not None:
            expected_retest_abnormal = retest_step["expectedState"] == "abnormal"
            remaining = [
                candidate
                for candidate in remaining
                if bool(candidate["signature"].get(retest_step["pointCode"], False)) == expected_retest_abnormal
            ]
            if not any(_candidate_key(candidate) == target_key for candidate in remaining):
                remaining.append(target_candidate)
        used_codes.difference_update(repair_step["invalidatedVirtualPointCodes"])
        if retest_step is not None:
            used_codes.add(retest_step["pointCode"])

        unique_remaining = {_candidate_key(candidate) for candidate in remaining}
        isolated = unique_remaining == {target_key}
        if isolated:
            break

        ordinary_measurement_count = sum(
            1 for step in steps
            if step["action"] == "measure" and step.get("purpose") != "postRepairRetest"
        )
        next_measurement_steps, remaining, used_codes = _measurement_steps_for_target(
            graph_data,
            remaining,
            target_candidate,
            used_codes,
            max(0, max_steps - ordinary_measurement_count),
            len(steps) + 1,
        )
        steps.extend(next_measurement_steps)
        unique_remaining = {_candidate_key(candidate) for candidate in remaining}
        isolated = unique_remaining == {target_key}

    fault_type_isolated = isolated
    confirmed_repair_targets = _confirmed_repair_targets(graph_data, remaining) if not fault_type_isolated else []
    repair_target_isolated = any(
        target["resolvesEveryCandidateFault"]
        for target in confirmed_repair_targets
    )
    # Exact fault type is not needed once one repair target resolves every
    # fault in every remaining hypothesis.  The component/line is then the
    # actionable isolation result.
    isolated = fault_type_isolated or repair_target_isolated
    active_target_fault_ids = [
        fault_id for fault_id in normalized_target_ids
        if fault_id not in repaired_target_fault_ids
    ]
    final_replacement_steps = (
        _replacement_steps_from_knowledge_graph(knowledge_graph, active_target_fault_ids, len(steps) + 1)
        if isolated and active_target_fault_ids
        else []
    )
    steps.extend(final_replacement_steps)
    confirmed_repair_steps = _confirmed_repair_steps(confirmed_repair_targets, len(steps) + 1) if not isolated else []
    steps.extend(confirmed_repair_steps)
    replacement_steps = [
        step for step in steps
        if step["action"] in {"replaceComponent", "replaceWire"}
    ]
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
        "faultTypeIsolated": fault_type_isolated,
        "repairTargetIsolated": repair_target_isolated,
        "componentLocalized": bool(confirmed_repair_targets),
        "confirmedRepairTargets": [
            {
                "action": target["action"],
                "targetId": target["targetId"],
                "targetKind": target["targetKind"],
                "targetLabel": target["targetLabel"],
                "relatedFaultIds": target["supportingFaultIds"],
                "supportingCandidateCount": target["supportingCandidateCount"],
            }
            for target in confirmed_repair_targets
        ],
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
            for step in steps
            if step["action"] == "measure"
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
            if step["action"] != "measure"
            ],
        ],
        "summary": (
            f"已通过人工 D 矩阵区分并定位{'单故障' if len(normalized_target_ids) == 1 else '多故障组合'}，按顺序执行检测和更换。"
            if fault_type_isolated
            else f"故障类型无需继续区分：所有剩余候选均可通过更换{'、'.join(target['targetLabel'] for target in confirmed_repair_targets if target['resolvesEveryCandidateFault'])}解决，可直接执行更换。"
            if repair_target_isolated
            else f"当前测点尚不能区分具体故障组合，但已确认{'、'.join(target['targetLabel'] for target in confirmed_repair_targets)}存在故障；可先执行对应更换，再继续排查其余候选。"
            if confirmed_repair_targets
            else f"当前测点不足以唯一隔离该{'单故障' if len(normalized_target_ids) == 1 else '多故障组合'}；建议先执行替换验证并复测受影响的虚拟测点。"
            if diagnostic_replacement_steps
            else f"当前测点不足以唯一隔离该{'单故障' if len(normalized_target_ids) == 1 else '多故障组合'}；没有可区分候选的替换验证动作。"
        ),
    }
