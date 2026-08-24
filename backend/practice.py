import copy
import time
from itertools import combinations

from backend.diagnostic_knowledge import build_diagnostic_knowledge_graph
from backend.practice_action_protocol import normalize_practice_action
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.practice_actions import PracticeActionRuntime
from backend.practice_observation import (
    compare_physical_snapshots,
    evaluate_physical_measurement_snapshot,
    point_type,
)
from backend.practice_scoring import (
    evaluate_path_quality,
    evaluate_practice_submission_score,
    grade_for_score,
)
from backend.practice_report import build_practice_evaluation_report
from backend.schemas import SimulationBackendError
from backend.troubleshooting import (
    TroubleshootingSession,
    _fault_id,
)


DEFAULT_MAX_LIFETIME_SECONDS = 3600.0
DEFAULT_IDLE_TIMEOUT_SECONDS = 900.0


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


def _lifecycle_seconds(config, field, default):
    value = config.get(field)
    if value is None:
        return default
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
        target_fault_ids=None,
        initial_point_states=None,
        initial_recommended_path=None,
        key_nodes=None,
        scoring_rules=None,
        lifecycle=None,
        action_rules=None,
        resource_limits=None,
        display_console_controls=None,
        model_graph=None,
        default_max_actions=200,
    ):
        self.practice_session_id = practice_session_id
        self.simulation_session_id = simulation_session_id
        self.simulation_session = simulation_session
        # Practice actions and direct simulation steps touch the same runtime.
        # Sharing one lock prevents the two endpoints from mutating it at once.
        self.lock = simulation_session.lock
        self.action_runtime = PracticeActionRuntime(
            simulation_session,
            display_console_controls=display_console_controls,
        )
        self.rule_engine = PracticeActionRuleEngine(simulation_session, rules=action_rules)
        normalized_target_fault_ids = []
        for fault_id in _arr(target_fault_ids) or [target_fault_id]:
            normalized_fault_id = _text(fault_id)
            if normalized_fault_id and normalized_fault_id not in normalized_target_fault_ids:
                normalized_target_fault_ids.append(normalized_fault_id)
        primary_target_fault_id = _text(target_fault_id) or (
            normalized_target_fault_ids[0] if normalized_target_fault_ids else ""
        )
        self.troubleshooting = TroubleshootingSession(d_matrix, primary_target_fault_id)
        matrix_fault_ids = {
            _fault_id(row)
            for row in _arr(self.troubleshooting.d_matrix.get("rows"))
            if _fault_id(row)
        }
        missing_target_fault_ids = [
            fault_id for fault_id in normalized_target_fault_ids if fault_id not in matrix_fault_ids
        ]
        if missing_target_fault_ids:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "targetFaultIds",
                f"targetFaultIds contains faults that are not present in dMatrix.rows: {', '.join(missing_target_fault_ids)}",
            )
        self.target_fault_ids = normalized_target_fault_ids or [primary_target_fault_id]
        self.max_candidate_fault_count = max(1, len(self.target_fault_ids))
        self.diagnostic_knowledge_graph = build_diagnostic_knowledge_graph(
            self.troubleshooting.d_matrix,
            model_graph=model_graph,
        )
        self._knowledge_graph_measurement_points = {}
        self._knowledge_graph_detectability = {}
        self._index_diagnostic_knowledge_graph()
        # Keep the original matrix for final-fault validation and retain a
        # session-local working matrix for the iterative diagnosis process.
        # Each virtual measurement consumes one point column. Single-fault
        # sessions retain the legacy row filtering, while multi-fault sessions
        # evaluate the saved evidence against fault-row combinations.
        self.active_d_matrix = _clone(self.troubleshooting.d_matrix)
        self.initial_point_states = (
            _clone(initial_point_states)
            if isinstance(initial_point_states, list)
            else self._initial_point_states_from_d_matrix()
        )
        self.target_fault_id = primary_target_fault_id
        self.scoring_rules = scoring_rules if isinstance(scoring_rules, dict) else {}
        self.started_at = time.time()
        self.submitted_at = None
        self.student_actions = []
        self.simulation_action_history = []
        self.recommended_path_history = []
        self.actual_troubleshooting_steps = []
        self.dynamic_reference_history = []
        self.physical_measurement_snapshots = []
        self.virtual_measurements = []
        self.repair_attempts = []
        self.operation_results = {}
        self.latest_physical_measurement_snapshot = None
        self.initial_physical_measurement_snapshot = None
        generated_initial_path = self._build_initial_recommended_path(self.troubleshooting.initial_response()["currentPath"])
        generated_key_nodes = self._build_fault_tree_key_nodes()
        self.initial_best_path = (
            _clone(initial_recommended_path)
            if isinstance(initial_recommended_path, dict)
            else generated_initial_path
        )
        self.fault_tree_key_nodes = (
            _clone(key_nodes)
            if isinstance(key_nodes, list)
            else generated_key_nodes
        )
        lifecycle_config = lifecycle if isinstance(lifecycle, dict) else {}
        self.max_lifetime_seconds = _lifecycle_seconds(
            lifecycle_config, "maxLifetimeSeconds", DEFAULT_MAX_LIFETIME_SECONDS
        )
        self.idle_timeout_seconds = _lifecycle_seconds(
            lifecycle_config, "idleTimeoutSeconds", DEFAULT_IDLE_TIMEOUT_SECONDS
        )
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
        candidate_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        return {
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": self._flatten_candidate_fault_ids(candidate_combinations),
            "faultCandidateCombinations": _clone(candidate_combinations),
            "status": "resolved" if not _arr((self.latest_physical_measurement_snapshot or {}).get("abnormalPointCodes")) else "inProgress",
        }

    def _measurement_source_for_point(self, point):
        graph = self.simulation_session.graph
        edge_id = _text(point.get("edgeId") or point.get("edgeID") or point.get("targetEdgeId") or point.get("targetId"))
        channel = _text(point.get("channel"), edge_id)
        edge = next((item for item in graph.edges if item.id == edge_id), None)

        if edge is None and channel:
            binding = next((item for item in graph.measurements if item.id == channel), None)
            if binding is not None:
                edge = next(
                    (
                        item
                        for item in graph.edges
                        if item.target_node_id == binding.scope_node_id and item.target_port_index == binding.target_port_index
                    ),
                    None,
                )

        source_device_id = _text(point.get("sourceDeviceId") or point.get("sourceNodeId") or point.get("nodeId"))
        if not source_device_id and edge is not None:
            source_device_id = edge.source_node_id
        source_port = _text(point.get("sourcePortId") or point.get("portId") or point.get("sourcePort"))
        if not source_port and edge is not None:
            node = graph.nodes.get(edge.source_node_id)
            if node is not None and edge.source_port_index < len(node.output_port_ids):
                source_port = node.output_port_ids[edge.source_port_index]
            else:
                source_port = "output" if edge.source_port_index == 0 else f"output-{edge.source_port_index + 1}"
        return source_device_id, source_port, channel, edge

    def _measurement_actual_value(self, simulation_result, sample_index, channel, source_device_id, source_port, edge):
        channels = ((simulation_result or {}).get("curves") or {}).get("channels") or {}
        curve_values = channels.get(f"{channel}.actual")
        if isinstance(curve_values, list) and sample_index < len(curve_values):
            value = curve_values[sample_index]
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return value

        steps = ((simulation_result or {}).get("componentOutputs") or {}).get("steps") or []
        if sample_index >= len(steps) or not source_device_id:
            return None
        outputs = ((steps[sample_index].get("actual") or {}).get(source_device_id) or {})
        keys = [source_port]
        if edge is not None:
            source_node = self.simulation_session.graph.nodes.get(edge.source_node_id)
            if source_node is not None and edge.source_port_index < len(source_node.outputs):
                keys.append(source_node.outputs[edge.source_port_index])
            keys.extend([
                "output" if edge.source_port_index == 0 else f"output-{edge.source_port_index + 1}",
                f"output-{edge.source_port_index}",
            ])
        for key in keys:
            value = outputs.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
        return next(
            (value for value in outputs.values() if isinstance(value, (int, float)) and not isinstance(value, bool)),
            None,
        )

    def _build_measurement_result(self, simulation_result):
        times = _arr(((simulation_result or {}).get("curves") or {}).get("time"))
        points_by_type = {"physical": [], "virtual": []}
        for point in _arr((self.troubleshooting.d_matrix or {}).get("points")):
            point_code = _point_code(point)
            source_device_id, source_port, channel, edge = self._measurement_source_for_point(point)
            samples = [
                {
                    "time": time_value,
                    "actual": self._measurement_actual_value(
                        simulation_result, index, channel, source_device_id, source_port, edge
                    ),
                }
                for index, time_value in enumerate(times)
            ]
            points_by_type[point_type(self.troubleshooting.d_matrix, point_code)].append({
                "pointCode": point_code,
                "pointId": _text(point.get("pointId")),
                "pointName": _text(point.get("name")),
                "channel": channel,
                "sourceDeviceId": source_device_id,
                "sourcePort": source_port,
                "samples": samples,
            })
        metrics = (simulation_result or {}).get("metrics") or {}
        return {
            "status": "completed" if metrics.get("done") else _text((simulation_result or {}).get("status"), "completed"),
            "simulationConfig": {
                "duration": self.simulation_session.graph.duration,
                "stepSize": self.simulation_session.graph.step_size,
            },
            "physicalMeasurements": points_by_type["physical"],
            "virtualMeasurements": points_by_type["virtual"],
            "summary": {
                "sampleCount": metrics.get("sampleCount", len(times)),
                "done": bool(metrics.get("done")),
            },
        }

    def _append_measurement_path_step(self, action_record, virtual_measurement):
        candidate_fault_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": "measurePoint",
            "target": _clone(action_record.get("target") or {}),
            "pointCode": action_record.get("pointCode") or "",
            "observed": virtual_measurement.get("observed") or "unknown",
            "routeRole": "evidenceCollection",
            "virtualMeasurement": _clone(virtual_measurement),
            "candidateFaultsAfterAction": self._flatten_candidate_fault_ids(candidate_fault_combinations),
            "candidateFaultCombinationsAfterAction": candidate_fault_combinations,
        })

    def _append_repair_path_step(self, action_record, action_application, repair_effect):
        action_type = action_record.get("actionType") or ""
        candidate_fault_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": action_type,
            "target": _clone(action_record.get("target") or {}),
            "faultId": action_record.get("faultId") or "",
            "routeRole": "repairAttempt",
            "appliedAction": _clone(action_application),
            "repairEffect": _clone(repair_effect),
            "candidateFaultsAfterAction": self._flatten_candidate_fault_ids(candidate_fault_combinations),
            "candidateFaultCombinationsAfterAction": candidate_fault_combinations,
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
            if step.get("action") in {"replaceComponent", "replaceWire"}:
                continue
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

    def _key_node_label_for_point(self, prefix, point_code):
        point = _point_by_code(self.troubleshooting.d_matrix, point_code)
        name = _text(point.get("name") or point.get("pointName") or point_code, point_code)
        return f"{prefix} {point_code} {name}".strip()

    def _build_fault_tree_key_nodes(self):
        target_row = self.troubleshooting.target_row
        if not isinstance(target_row, dict):
            return []

        nodes = []
        measurement_node = None
        cells = [
            cell
            for cell in _arr(target_row.get("cells"))
            if cell.get("detectable") and _text(cell.get("pointCode"))
        ]
        virtual_cells = [
            cell
            for cell in cells
            if point_type(self.troubleshooting.d_matrix, _text(cell.get("pointCode"))) == "virtual"
        ]
        if virtual_cells:
            ranked_virtual = sorted(
                virtual_cells,
                key=lambda item: (-self._expected_information_gain(_text(item.get("pointCode"))), _text(item.get("pointCode"))),
            )
            point_code = _text(ranked_virtual[0].get("pointCode"))
            measurement_node = {
                "nodeId": f"measure-{point_code}",
                "type": "measurePoint",
                "pointCode": point_code,
                "label": self._key_node_label_for_point("测量虚拟测点", point_code),
                "score": 0,
            }
            nodes.append(measurement_node)

        edge_ids = {edge.id for edge in self.simulation_session.graph.edges}
        repair_nodes_by_target = {}
        for fault in self.simulation_session.fault_runtime.fault_instances:
            if not bool(fault.get("enabled", True)):
                continue
            fault_id = _text(fault.get("faultId"))
            target_id = _text(fault.get("targetId"))
            if not fault_id or not target_id:
                continue
            if target_id in self.simulation_session.graph.nodes:
                target = {"type": "component", "id": target_id}
                label = "更换故障组件"
            elif target_id in edge_ids:
                target = {"type": "wire", "id": target_id}
                label = "更换故障线路"
            else:
                continue
            target_identity = (target["type"], target["id"])
            repair_node = repair_nodes_by_target.get(target_identity)
            if repair_node is None:
                repair_node = {
                    "nodeId": f"repair-{fault_id}",
                    "type": "repairTarget",
                    "target": target,
                    "faultId": fault_id,
                    "faultIds": [fault_id],
                    "label": label,
                    "score": 0,
                }
                repair_nodes_by_target[target_identity] = repair_node
                nodes.append(repair_node)
            elif fault_id not in repair_node["faultIds"]:
                repair_node["faultIds"].append(fault_id)

        repair_nodes = list(repair_nodes_by_target.values())
        measurement_budget = 6.0 if measurement_node and repair_nodes else 12.0 if measurement_node else 0.0
        repair_budget = 12.0 - measurement_budget
        if measurement_node:
            measurement_node["score"] = _round_score(measurement_budget)
        if repair_nodes:
            repair_score = repair_budget / len(repair_nodes)
            allocated_repair_score = 0.0
            for index, repair_node in enumerate(repair_nodes):
                node_score = (
                    repair_budget - allocated_repair_score
                    if index == len(repair_nodes) - 1
                    else _round_score(repair_score)
                )
                repair_node["score"] = _round_score(node_score)
                allocated_repair_score += repair_node["score"]
        return nodes

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

    def _initial_point_states_from_d_matrix(self):
        """Legacy fallback when an older task does not provide saved results."""
        enabled_fault_ids = {
            _text(fault.get("faultId"))
            for fault in self.simulation_session.fault_runtime.fault_instances
            if bool(fault.get("enabled", True)) and _text(fault.get("faultId"))
        }
        rows = [
            row for row in _arr(self.troubleshooting.d_matrix.get("rows"))
            if _fault_id(row) in enabled_fault_ids
        ]
        if not rows:
            rows = [self.troubleshooting.target_row]

        def point_state(point):
            point_code = _point_code(point)
            states = [
                bool((_matrix_cell(row, point_code) or {}).get("detectable"))
                for row in rows
                if _matrix_cell(row, point_code) is not None
            ]
            observed = "abnormal" if any(states) else "normal" if states else "unknown"
            return {
                "pointCode": point_code,
                "observed": observed,
            }

        points = _arr(self.troubleshooting.d_matrix.get("points"))
        return [point_state(point) for point in points]

    def _initial_measurement_for_point(self, point_code, measurement_type):
        measurement = next(
            (
                item
                for item in _arr(self.initial_point_states)
                if _text(item.get("pointCode") or item.get("pointId")) == _text(point_code)
            ),
            None,
        )
        if measurement is None:
            point = _point_by_code(self.troubleshooting.d_matrix, point_code)
            return {
                "pointCode": _text(point_code),
                "pointId": _text(point.get("pointId")),
                "pointName": _text(point.get("name")),
                "channel": _text(point.get("channel")),
                "observed": "unknown",
                "source": "initial-point-states",
            }
        observed = _text(measurement.get("observed")).lower()
        return {
            "pointCode": _text(measurement.get("pointCode") or point_code),
            "pointId": _text(measurement.get("pointId")),
            "pointName": _text(measurement.get("pointName")),
            "channel": _text(measurement.get("channel")),
            "observed": observed if observed in {"normal", "abnormal", "unknown"} else "unknown",
            "source": "initial-point-states",
        }

    def _initial_physical_snapshot(self):
        points = [
            self._initial_measurement_for_point(_point_code(point), "physical")
            for point in _arr(self.troubleshooting.d_matrix.get("points"))
            if point_type(self.troubleshooting.d_matrix, _point_code(point)) == "physical"
        ]
        return {
            "source": "initial-point-states",
            "points": points,
            "abnormalPointCodes": [point["pointCode"] for point in points if point["observed"] == "abnormal"],
            "normalPointCodes": [point["pointCode"] for point in points if point["observed"] == "normal"],
            "unknownPointCodes": [point["pointCode"] for point in points if point["observed"] == "unknown"],
        }

    def _apply_virtual_measurement_to_active_d_matrix(self, point_code, observed):
        """Apply a measured virtual-point state to the working D matrix."""
        point_code = _text(point_code)
        if not point_code:
            return

        normalized_observed = _text(observed).lower()
        if self.max_candidate_fault_count == 1 and normalized_observed in {"normal", "abnormal"}:
            expected_detectable = normalized_observed == "abnormal"
            self.active_d_matrix["rows"] = [
                row
                for row in _arr(self.active_d_matrix.get("rows"))
                if bool((_matrix_cell(row, point_code) or {}).get("detectable")) == expected_detectable
            ]

        self.active_d_matrix["points"] = [
            point
            for point in _arr(self.active_d_matrix.get("points"))
            if _point_code(point) != point_code
        ]
        for row in _arr(self.active_d_matrix.get("rows")):
            row["cells"] = [
                cell
                for cell in _arr(row.get("cells"))
                if _text(cell.get("pointCode") or cell.get("pointId")) != point_code
            ]

    def _index_diagnostic_knowledge_graph(self):
        self._knowledge_graph_measurement_points = {}
        self._knowledge_graph_detectability = {}
        measurement_point_codes_by_id = {}
        for node in _arr(self.diagnostic_knowledge_graph.get("nodes")):
            if node.get("kind") != "measurementPoint":
                continue
            point_code = _text(node.get("pointCode") or node.get("id"))
            point_id = _text(node.get("id"))
            if not point_code or not point_id:
                continue
            measurement_point_codes_by_id[point_id] = point_code
            self._knowledge_graph_measurement_points[point_code] = _clone(node)

        for relation in _arr(self.diagnostic_knowledge_graph.get("relations")):
            if relation.get("type") != "DETECTABILITY":
                continue
            source = relation.get("source") if isinstance(relation.get("source"), dict) else {}
            target = relation.get("target") if isinstance(relation.get("target"), dict) else {}
            fault_id = _text(source.get("id"))
            point_code = measurement_point_codes_by_id.get(_text(target.get("id")))
            if fault_id and point_code:
                self._knowledge_graph_detectability[(fault_id, point_code)] = bool(
                    relation.get("detectable")
                )

    def _combined_expected_observation(self, candidate_rows, point_code):
        detectable_states = [
            self._knowledge_graph_detectability[(fault_id, point_code)]
            for row in candidate_rows
            for fault_id in [_fault_id(row)]
            if (fault_id, point_code) in self._knowledge_graph_detectability
        ]
        if not detectable_states:
            return None
        return "abnormal" if any(detectable_states) else "normal"

    def _all_candidate_fault_combinations(self):
        rows = [row for row in _arr(self.troubleshooting.d_matrix.get("rows")) if _fault_id(row)]
        max_fault_count = min(self.max_candidate_fault_count, len(rows))
        return [
            list(candidate_rows)
            for fault_count in range(1, max_fault_count + 1)
            for candidate_rows in combinations(rows, fault_count)
        ]

    def _candidate_fault_combinations_from_current_evidence(self):
        all_combinations = self._all_candidate_fault_combinations()
        observations = self._known_point_observations()
        if not observations:
            return all_combinations

        candidates = []
        for candidate_rows in all_combinations:
            matches = True
            for point_code, observed in observations.items():
                expected = self._combined_expected_observation(candidate_rows, point_code)
                if expected is not None and expected != observed:
                    matches = False
                    break
            if matches:
                candidates.append(candidate_rows)
        return candidates or all_combinations

    def _candidate_rows_from_current_evidence(self):
        rows = []
        seen_fault_ids = set()
        for candidate_rows in self._candidate_fault_combinations_from_current_evidence():
            for row in candidate_rows:
                fault_id = _fault_id(row)
                if fault_id and fault_id not in seen_fault_ids:
                    seen_fault_ids.add(fault_id)
                    rows.append(row)
        return rows

    def _candidate_fault_id_combinations_from_current_evidence(self):
        return [
            [_fault_id(row) for row in candidate_rows if _fault_id(row)]
            for candidate_rows in self._candidate_fault_combinations_from_current_evidence()
        ]

    def _flatten_candidate_fault_ids(self, candidate_fault_combinations):
        fault_ids = []
        for candidate_fault_ids in candidate_fault_combinations:
            for fault_id in candidate_fault_ids:
                if fault_id and fault_id not in fault_ids:
                    fault_ids.append(fault_id)
        return fault_ids

    def _candidate_fault_ids_from_current_evidence(self):
        return self._flatten_candidate_fault_ids(
            self._candidate_fault_id_combinations_from_current_evidence()
        )

    def _expected_information_gain(self, point_code, candidate_combinations=None):
        candidate_combinations = (
            candidate_combinations
            if candidate_combinations is not None
            else self._candidate_fault_combinations_from_current_evidence()
        )
        known = self._known_point_observations()
        if point_code in known or len(candidate_combinations) <= 1:
            return 0.0

        detectable = 0
        non_detectable = 0
        for candidate_rows in candidate_combinations:
            expected = self._combined_expected_observation(candidate_rows, point_code)
            if expected is None:
                continue
            if expected == "abnormal":
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
        if tier == "optimal":
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
        candidate_combinations = self._candidate_fault_combinations_from_current_evidence()
        active_point_codes = {
            _point_code(point)
            for point in _arr(self.active_d_matrix.get("points"))
            if _point_code(point)
        }
        actions = []
        for point_code, graph_point in self._knowledge_graph_measurement_points.items():
            if point_code not in active_point_codes or point_code in measured_codes:
                continue
            graph_point_type = _text(graph_point.get("pointType")).lower()
            if (graph_point_type or point_type(self.active_d_matrix, point_code)) != "virtual":
                continue
            if not any(
                (fault_id, point_code) in self._knowledge_graph_detectability
                for candidate_rows in candidate_combinations
                for fault_id in [_fault_id(row) for row in candidate_rows]
            ):
                continue
            point = _point_by_code(self.troubleshooting.d_matrix, point_code)
            target_id = _text(point.get("channel") or point.get("pointId"))
            information_gain = self._expected_information_gain(point_code, candidate_combinations)
            if len(candidate_combinations) <= 1:
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

    def _repair_action_priority(
        self,
        candidate_count,
        best_measurement_gain,
        observed_count,
        support_ratio,
    ):
        if candidate_count <= 1 and support_ratio > 0:
            return 92, 0.9
        if best_measurement_gain > 0:
            priority = 35 + int(round(35 * support_ratio))
        else:
            priority = 45 + int(round(40 * support_ratio))
        confidence = 0.35 + (0.5 * support_ratio) + (0.05 if observed_count else 0)
        return priority, min(0.9, confidence)

    def _knowledge_graph_repair_relations_by_fault(self):
        relations_by_fault = {}
        graph_node_ids = set(self.simulation_session.graph.nodes)
        graph_edge_ids = {edge.id for edge in self.simulation_session.graph.edges}
        for relation in _arr(self.diagnostic_knowledge_graph.get("relations")):
            if relation.get("type") != "RESOLVED_BY_REPLACING":
                continue
            source = relation.get("source") if isinstance(relation.get("source"), dict) else {}
            target = relation.get("target") if isinstance(relation.get("target"), dict) else {}
            fault_id = _text(source.get("id"))
            target_id = _text(target.get("id"))
            target_kind = _text(target.get("kind"))
            action_type = _text(relation.get("action"))
            if action_type not in {"replaceComponent", "replaceWire"}:
                action_type = "replaceWire" if target_kind == "signalEdge" else "replaceComponent"
            if action_type == "replaceComponent":
                target_type = "component"
                if target_id not in graph_node_ids:
                    continue
            else:
                target_type = "wire"
                if target_id not in graph_edge_ids:
                    continue
            if fault_id and target_id:
                relations_by_fault.setdefault(fault_id, []).append({
                    "actionType": action_type,
                    "target": {"type": target_type, "id": target_id},
                })
        return relations_by_fault

    def _candidate_repair_target_support(self, candidate_combinations):
        relations_by_fault = self._knowledge_graph_repair_relations_by_fault()
        support_by_target = {}
        for candidate_rows in candidate_combinations:
            combination_targets = {}
            for row in candidate_rows:
                fault_id = _fault_id(row)
                for relation in relations_by_fault.get(fault_id, []):
                    target = relation["target"]
                    identity = (relation["actionType"], target["type"], target["id"])
                    item = combination_targets.setdefault(identity, {
                        **_clone(relation),
                        "faultIds": [],
                    })
                    if fault_id not in item["faultIds"]:
                        item["faultIds"].append(fault_id)
            for identity, combination_target in combination_targets.items():
                support = support_by_target.setdefault(identity, {
                    **_clone(combination_target),
                    "faultIds": [],
                    "supportingCombinationCount": 0,
                })
                support["supportingCombinationCount"] += 1
                for fault_id in combination_target["faultIds"]:
                    if fault_id not in support["faultIds"]:
                        support["faultIds"].append(fault_id)
        return list(support_by_target.values())

    def _repair_reference_actions(self):
        candidate_combinations = self._candidate_fault_combinations_from_current_evidence()
        candidate_count = len(candidate_combinations)
        best_measurement_gain = max(
            (
                self._expected_information_gain(_point_code(point), candidate_combinations)
                for point in _arr(self.active_d_matrix.get("points"))
                if point_type(self.active_d_matrix, _point_code(point)) == "virtual"
            ),
            default=0.0,
        )
        observed_count = len(self._known_point_observations())
        actions = []
        for target_support in self._candidate_repair_target_support(candidate_combinations):
            support_count = int(target_support.get("supportingCombinationCount") or 0)
            support_ratio = support_count / candidate_count if candidate_count else 0.0
            priority, confidence = self._repair_action_priority(
                candidate_count,
                best_measurement_gain,
                observed_count,
                support_ratio,
            )
            action_type = target_support["actionType"]
            rule = self.rule_engine.rules.get(action_type, {})
            fault_ids = _arr(target_support.get("faultIds"))
            action = {
                "actionType": action_type,
                "target": _clone(target_support["target"]),
                "faultId": fault_ids[0] if fault_ids else "",
                "faultIds": _clone(fault_ids),
                "routeRole": "repairAttempt",
                "candidateSupportRatio": _round_score(support_ratio),
                "supportingCombinationCount": support_count,
                "candidateCombinationCount": candidate_count,
                "priority": priority,
                "recommendationTier": self._recommendation_tier(priority),
                "confidence": _round_score(confidence),
                "timeCostSeconds": rule.get("durationSeconds", 0),
                "riskCost": self._risk_cost(
                    rule.get("riskLevel", "low" if action_type == "replaceWire" else "medium")
                ),
                "reason": (
                    f"knowledge-graph repair target is supported by {support_count} "
                    f"of {candidate_count} candidate fault combinations"
                ),
            }
            safety_prerequisites = self._safety_prerequisites(action_type)
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
        candidate_fault_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        return {
            "basis": "currentEvidenceAndFaultCombinations",
            "candidateFaultIds": self._flatten_candidate_fault_ids(candidate_fault_combinations),
            "candidateFaultCombinations": candidate_fault_combinations,
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
                    (candidate.get("target") or {}).get("id") == (action_record.get("target") or {}).get("id")
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
        return evaluate_path_quality(
            actual_troubleshooting_steps=self.actual_troubleshooting_steps,
            student_actions=self.student_actions,
            dynamic_reference_history=self.dynamic_reference_history,
            initial_physical_measurement_snapshot=self.initial_physical_measurement_snapshot,
            fault_tree_key_nodes=self.fault_tree_key_nodes,
        )

    def initial_response(self):
        snapshot = self._initial_physical_snapshot()
        self.latest_physical_measurement_snapshot = _clone(snapshot)
        self.initial_physical_measurement_snapshot = _clone(snapshot)
        self.physical_measurement_snapshots.append(_clone(snapshot))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "lifecycle": self.lifecycle_summary(),
        }

    def _create_action_transaction_snapshot(self):
        session_fields = (
            "active_d_matrix",
            "student_actions",
            "simulation_action_history",
            "recommended_path_history",
            "actual_troubleshooting_steps",
            "dynamic_reference_history",
            "physical_measurement_snapshots",
            "virtual_measurements",
            "repair_attempts",
            "latest_physical_measurement_snapshot",
            "last_activity_at",
        )
        return {
            "simulation": self.simulation_session.create_state_snapshot(),
            "practice": {
                field: copy.deepcopy(getattr(self, field))
                for field in session_fields
            },
        }

    def _restore_action_transaction_snapshot(self, snapshot):
        self.simulation_session.restore_state_snapshot(snapshot["simulation"])
        for field, value in snapshot["practice"].items():
            setattr(self, field, copy.deepcopy(value))

    def _cached_operation_result(self, normalized_action):
        operation_id = normalized_action.get("operationId") or ""
        if not operation_id:
            return None
        existing = self.operation_results.get(operation_id)
        if existing is None:
            return None
        if existing["action"] != normalized_action:
            raise SimulationBackendError(
                "OPERATION_ID_CONFLICT",
                "operationId",
                f"operationId has already been used with a different action: {operation_id}",
            )
        return copy.deepcopy(existing["result"])

    def _remember_operation_result(self, normalized_action, result):
        operation_id = normalized_action.get("operationId") or ""
        if operation_id:
            self.operation_results[operation_id] = {
                "action": copy.deepcopy(normalized_action),
                "result": copy.deepcopy(result),
            }
        return result

    def record_action(self, action, steps=1):
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")
        action_record = normalize_practice_action(action)
        normalized_action = _clone(action_record)
        cached_result = self._cached_operation_result(normalized_action)
        if cached_result is not None:
            return cached_result
        if len(self.student_actions) >= self.max_actions:
            raise SimulationBackendError(
                "SIMULATION_LIMIT_EXCEEDED",
                "resourceLimits.maxActions",
                "practice action count is outside the allowed range",
            )
        action_record.setdefault("recordedAt", time.time())
        reference_before = self._build_dynamic_reference()
        if action_record.get("actionType") == "measurePoint":
            result = self._record_measure_point_action(action_record, normalized_action, steps, reference_before)
            return self._remember_operation_result(normalized_action, result)

        transaction_snapshot = self._create_action_transaction_snapshot()
        try:
            safety_check = self.rule_engine.evaluate(action_record)
            action_application = self.action_runtime.apply(action_record)
            action_record["simulationActionResult"] = _clone(action_application)
            if safety_check.get("safetyViolation"):
                action_record["safetyViolation"] = True
            self.student_actions.append(action_record)
            self.last_activity_at = action_record["recordedAt"]
            self.simulation_action_history.append({
                "index": len(self.simulation_action_history) + 1,
                "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
                "recordedAt": action_record["recordedAt"],
                "result": _clone(action_application),
            })
            previous_snapshot = _clone(self.latest_physical_measurement_snapshot or {})
            simulation_result = self.simulation_session.run_from_zero()
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
                "appliedAction": _clone(action_application),
                "repairEffect": _clone(repair_effect),
            }
            if action_record.get("safetyViolation"):
                repair_attempt["safetyViolation"] = True
            self.repair_attempts.append(repair_attempt)
            action_record["repairEffect"] = _clone(repair_effect)
            action_record["physicalMeasurementSnapshot"] = _clone(snapshot)
            self._append_repair_path_step(action_record, action_application, repair_effect)
            self._append_dynamic_reference_record(action_record, reference_before)
            result = {
                "status": "success",
                "sessionId": self.practice_session_id,
                "practiceSessionId": self.practice_session_id,
                "simulationSessionId": self.simulation_session_id,
                "normalizedAction": normalized_action,
                "simulationResult": self._build_measurement_result(simulation_result),
                **(
                    {"appliedParameters": _clone(action_application.get("changes") or [])}
                    if action_record.get("actionType") == "adjustDisplayConsoleParameter"
                    else {}
                ),
            }
            return self._remember_operation_result(normalized_action, result)
        except Exception:
            self._restore_action_transaction_snapshot(transaction_snapshot)
            raise

    def _record_measure_point_action(self, action_record, normalized_action, steps, reference_before):
        measured_point_type = point_type(self.troubleshooting.d_matrix, action_record.get("pointCode"))
        if measured_point_type != "virtual":
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "pointCode",
                "measurePoint can only be used for virtual measurement points",
            )
        virtual_measurement = self._initial_measurement_for_point(action_record.get("pointCode"), "virtual")
        action_record["observed"] = virtual_measurement["observed"]
        action_record["virtualMeasurement"] = _clone(virtual_measurement)
        self.student_actions.append(action_record)
        self.last_activity_at = action_record["recordedAt"]
        self.virtual_measurements.append(_clone(virtual_measurement))
        self._apply_virtual_measurement_to_active_d_matrix(
            action_record.get("pointCode"),
            virtual_measurement.get("observed"),
        )
        self._append_measurement_path_step(action_record, virtual_measurement)
        self._append_dynamic_reference_record(action_record, reference_before)
        self.simulation_action_history.append({
            "index": len(self.simulation_action_history) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.simulation_action_history) + 1}",
            "recordedAt": action_record["recordedAt"],
            "result": {"status": "measured", "virtualMeasurement": _clone(virtual_measurement)},
        })
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
        }

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "submission", "submission must be an object")
        final_fault_inputs = payload.get("finalFaultIds")
        if final_fault_inputs is not None:
            if not isinstance(final_fault_inputs, list) or not final_fault_inputs:
                raise SimulationBackendError(
                    "INVALID_SCHEMA",
                    "finalFaultIds",
                    "finalFaultIds must be a non-empty array",
                )
        else:
            legacy_final_fault = _text(
                payload.get("finalFaultName")
                or payload.get("faultName")
                or payload.get("finalFaultId")
                or payload.get("faultId")
            )
            final_fault_inputs = [legacy_final_fault] if legacy_final_fault else []
        normalized_final_fault_inputs = []
        for value in final_fault_inputs:
            normalized_value = _text(value)
            if normalized_value and normalized_value not in normalized_final_fault_inputs:
                normalized_final_fault_inputs.append(normalized_value)
        if not normalized_final_fault_inputs:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "finalFaultIds",
                "finalFaultIds or finalFaultId is required",
            )

        matrix_rows = _arr(self.troubleshooting.d_matrix.get("rows"))
        final_faults = []
        for final_fault_input in normalized_final_fault_inputs:
            matched_row = next(
                (
                    row
                    for row in matrix_rows
                    if _fault_id(row) == final_fault_input
                    or _text(row.get("faultName")) == final_fault_input
                ),
                None,
            )
            final_fault_id = _fault_id(matched_row) if matched_row else final_fault_input
            if any(item["faultId"] == final_fault_id for item in final_faults):
                continue
            final_faults.append({
                "faultId": final_fault_id,
                "faultName": (
                    _text(matched_row.get("faultName"), final_fault_id)
                    if matched_row
                    else final_fault_input
                ),
            })

        target_faults = []
        for target_fault_id in self.target_fault_ids:
            target_row = next((row for row in matrix_rows if _fault_id(row) == target_fault_id), None)
            target_faults.append({
                "faultId": target_fault_id,
                "faultName": _text((target_row or {}).get("faultName"), target_fault_id),
            })

        target_fault_id_set = {item["faultId"] for item in target_faults}
        final_fault_id_set = {item["faultId"] for item in final_faults}
        matched_fault_ids = [
            item["faultId"] for item in target_faults if item["faultId"] in final_fault_id_set
        ]
        missed_fault_ids = [
            item["faultId"] for item in target_faults if item["faultId"] not in final_fault_id_set
        ]
        extra_fault_ids = [
            item["faultId"] for item in final_faults if item["faultId"] not in target_fault_id_set
        ]
        intersection_count = len(target_fault_id_set & final_fault_id_set)
        union_count = len(target_fault_id_set | final_fault_id_set)
        set_accuracy = intersection_count / union_count if union_count else 1.0
        precision = intersection_count / len(final_fault_id_set) if final_fault_id_set else 0.0
        recall = intersection_count / len(target_fault_id_set) if target_fault_id_set else 0.0
        correct = target_fault_id_set == final_fault_id_set
        target_fault_name = target_faults[0]["faultName"]
        final_fault_id = final_faults[0]["faultId"]
        final_fault_name = final_faults[0]["faultName"]
        self.submitted_at = time.time()
        self.close("submitted", now=self.submitted_at)
        elapsed_seconds = max(0.0, self.submitted_at - self.started_at)
        path_evaluation = self._evaluate_path_quality()
        scoring_result = evaluate_practice_submission_score(
            correct=correct,
            elapsed_seconds=elapsed_seconds,
            scoring_rules=self.scoring_rules,
            student_actions=self.student_actions,
            path_evaluation=path_evaluation,
            fault_set_accuracy=set_accuracy,
        )
        evaluation_report = build_practice_evaluation_report(
            score=scoring_result["score"],
            grade=scoring_result["grade"],
            score_breakdown=scoring_result["scoreBreakdown"],
            target_fault_id=self.target_fault_id,
            target_fault_name=target_fault_name,
            final_fault_id=final_fault_id,
            final_fault_name=final_fault_name,
            correct=correct,
            target_faults=target_faults,
            final_faults=final_faults,
            set_accuracy=set_accuracy,
            precision=precision,
            recall=recall,
            matched_fault_ids=matched_fault_ids,
            missed_fault_ids=missed_fault_ids,
            extra_fault_ids=extra_fault_ids,
            initial_optimal_path=self.initial_best_path,
            actual_steps=self.actual_troubleshooting_steps,
            dynamic_reference_history=self.dynamic_reference_history,
            path_evaluation=path_evaluation,
            elapsed_seconds=elapsed_seconds,
            scoring_rules=self.scoring_rules,
        )
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "evaluationReport": evaluation_report,
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
        return grade_for_score(score)
