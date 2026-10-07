import copy
import threading
import time
from datetime import datetime, timezone
from itertools import combinations

from backend.diagnostic_knowledge import (
    build_diagnostic_knowledge_graph,
    build_multi_fault_troubleshooting_plan,
    edge_endpoint_display_name,
)
from backend.practice_action_protocol import normalize_practice_action
from backend.practice_action_rules import PracticeActionRuleEngine
from backend.practice_actions import PracticeActionRuntime
from backend.practice_observation import (
    compare_physical_snapshots,
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
PRACTICE_TYPE_TROUBLESHOOTING = "troubleshooting"
PRACTICE_TYPE_INSPECTION_1 = "inspection1"
PRACTICE_TYPE_INSPECTION_2 = "inspection2"
PRACTICE_TYPE_INSPECTION_3 = "inspection3"
PRACTICE_TYPE_INSPECTION_4 = "inspection4"
SUPPORTED_PRACTICE_TYPES = {
    PRACTICE_TYPE_TROUBLESHOOTING,
    PRACTICE_TYPE_INSPECTION_1,
    PRACTICE_TYPE_INSPECTION_2,
    PRACTICE_TYPE_INSPECTION_3,
    PRACTICE_TYPE_INSPECTION_4,
}
INTERNAL_OPTIMAL_ACTION_SEQUENCES = {
    PRACTICE_TYPE_INSPECTION_2: (1, 2, 3, 4, 5),
    PRACTICE_TYPE_INSPECTION_4: (1, 2, 3, 4, 5),
}
FIXED_SCORE_PRACTICE_TYPES = {
    PRACTICE_TYPE_INSPECTION_1,
    PRACTICE_TYPE_INSPECTION_3,
}


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


def _fault_target_id(row):
    """Return the canvas component or wire id on which a fault occurs."""
    target_kind = _text(row.get("targetKind")).lower()
    if target_kind in {"edge", "wire", "line", "connection"} or _text(row.get("targetEdgeId")):
        return _text(row.get("targetEdgeId") or row.get("targetId"))
    return _text(row.get("targetNodeId") or row.get("targetId"))


def _component_module_id(node):
    """Return the public component ID declared by a compiled node."""
    return _text(
        getattr(getattr(node, "module", None), "module_id", "")
        or getattr(node, "component_id", "")
    )


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


def normalize_practice_type(value):
    practice_type = _text(value, PRACTICE_TYPE_TROUBLESHOOTING)
    if practice_type not in SUPPORTED_PRACTICE_TYPES:
        raise SimulationBackendError(
            "INVALID_SCHEMA",
            "practiceType",
            "practiceType must be troubleshooting, inspection1, inspection2, inspection3, or inspection4",
        )
    return practice_type


class SequencePracticeSession:
    """Lightweight practice session for the four inspection task types."""

    is_sequence_practice = True

    def __init__(
        self,
        practice_session_id,
        practice_type,
        lifecycle=None,
        resource_limits=None,
        default_max_actions=200,
        studentid="",
        jobid="",
    ):
        self.practice_session_id = practice_session_id
        self.simulation_session_id = ""
        self.practice_type = normalize_practice_type(practice_type)
        if self.practice_type == PRACTICE_TYPE_TROUBLESHOOTING:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "practiceType",
                "sequence practice requires inspection1, inspection2, inspection3, or inspection4",
            )
        self.student_action_sequence = []
        self.studentid = _text(studentid)
        self.jobid = _text(jobid)
        self.lock = threading.RLock()
        self.started_at = time.time()
        self.created_at = self.started_at
        self.last_activity_at = self.started_at
        self.submitted_at = None
        self.ended_at = None
        self.lifecycle_state = "active"
        lifecycle_config = lifecycle if isinstance(lifecycle, dict) else {}
        self.max_lifetime_seconds = _lifecycle_seconds(
            lifecycle_config, "maxLifetimeSeconds", DEFAULT_MAX_LIFETIME_SECONDS
        )
        self.idle_timeout_seconds = _lifecycle_seconds(
            lifecycle_config, "idleTimeoutSeconds", DEFAULT_IDLE_TIMEOUT_SECONDS
        )
        resource_config = resource_limits if isinstance(resource_limits, dict) else {}
        self.max_actions = _resource_limit_int(resource_config, "maxActions", default_max_actions)

    def is_expired(self, now=None):
        if self.lifecycle_state != "active":
            return False
        checked_at = time.time() if now is None else float(now)
        if self.max_lifetime_seconds is not None and checked_at - self.created_at >= self.max_lifetime_seconds:
            return True
        if self.idle_timeout_seconds is not None and checked_at - self.last_activity_at >= self.idle_timeout_seconds:
            return True
        return False

    def close(self, state, now=None):
        self.lifecycle_state = state
        self.ended_at = time.time() if now is None else float(now)
        self.last_activity_at = self.ended_at
        return self.lifecycle_summary(now=self.ended_at)

    def lifecycle_summary(self, now=None):
        checked_at = time.time() if now is None else float(now)
        duration_until = self.ended_at if self.ended_at is not None else checked_at
        return {
            "state": self.lifecycle_state,
            "actionCount": len(self.student_action_sequence),
            "maxActions": self.max_actions,
            "durationSeconds": max(0.0, duration_until - self.created_at),
        }

    def initial_response(self):
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "practiceType": self.practice_type,
        }

    def status_response(self):
        return {
            "status": "success",
            "practiceSessionId": self.practice_session_id,
            "practiceType": self.practice_type,
            "lifecycle": self.lifecycle_summary(),
        }

    def record_action(self, action, steps=1):
        if self.practice_type in FIXED_SCORE_PRACTICE_TYPES:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "actionNumber",
                f"{self.practice_type} does not accept practice actions",
            )
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")
        action_number = action.get("actionNumber")
        if isinstance(action_number, bool) or not isinstance(action_number, int) or action_number < 1:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "actionNumber",
                "actionNumber must be a positive integer",
            )
        if len(self.student_action_sequence) >= self.max_actions:
            raise SimulationBackendError(
                "SIMULATION_LIMIT_EXCEEDED",
                "resourceLimits.maxActions",
                "practice action count is outside the allowed range",
            )
        self.student_action_sequence.append(action_number)
        self.last_activity_at = time.time()
        return {"status": "success"}

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "submission", "submission must be an object")
        if self.practice_type in FIXED_SCORE_PRACTICE_TYPES:
            self.submitted_at = time.time()
            self.close("submitted", now=self.submitted_at)
            return {"studentId": self.studentid, "jobId": self.jobid, "totalScore": 100.0}
        expected = INTERNAL_OPTIMAL_ACTION_SEQUENCES[self.practice_type]
        actual = self.student_action_sequence
        if len(actual) != len(expected):
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "actionNumber",
                f"inspection practice requires exactly {len(expected)} actions before submission",
            )
        mismatch_count = sum(1 for expected_number, actual_number in zip(expected, actual) if expected_number != actual_number)
        deduction_per_step = 100.0 / len(expected)
        total_score = _round_score(max(0.0, 100.0 - (mismatch_count * deduction_per_step)))
        self.submitted_at = time.time()
        self.close("submitted", now=self.submitted_at)
        return {"studentId": self.studentid, "jobId": self.jobid, "totalScore": total_score}


def _normalize_connection_bindings(bindings):
    grouped = {}
    for binding in _arr(bindings):
        if not isinstance(binding, dict):
            continue
        endpoints = (
            _text(binding.get("sourceDeviceId")),
            _text(binding.get("sourcePort")),
            _text(binding.get("targetDeviceId")),
            _text(binding.get("targetPort")),
        )
        if not all(endpoints):
            continue
        current = grouped.setdefault(endpoints, {
            "sourceDeviceId": endpoints[0],
            "sourcePort": endpoints[1],
            "targetDeviceId": endpoints[2],
            "targetPort": endpoints[3],
            "backingEdgeIds": [],
        })
        for candidate in _arr(binding.get("backingEdgeIds")):
            edge_id = _text(candidate)
            if edge_id and edge_id not in current["backingEdgeIds"]:
                current["backingEdgeIds"].append(edge_id)
    return [binding for binding in grouped.values() if binding["backingEdgeIds"]]


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
        scoring_rules=None,
        lifecycle=None,
        action_rules=None,
        resource_limits=None,
        display_console_controls=None,
        connection_bindings=None,
        diagnostic_conditions=None,
        model_graph=None,
        default_max_actions=200,
        studentid="",
        jobid="",
    ):
        self.practice_session_id = practice_session_id
        self.simulation_session_id = simulation_session_id
        self.simulation_session = simulation_session
        self.model_graph = _clone(model_graph) if isinstance(model_graph, dict) else {}
        self.connection_bindings = _normalize_connection_bindings(connection_bindings)
        self.studentid = _text(studentid)
        self.jobid = _text(jobid)
        # Practice actions and direct simulation steps touch the same runtime.
        # Sharing one lock prevents the two endpoints from mutating it at once.
        self.lock = simulation_session.lock
        self.action_runtime = PracticeActionRuntime(
            simulation_session,
            display_console_controls=display_console_controls,
        )
        self.display_console_controls = _clone(_arr(display_console_controls))
        self.diagnostic_conditions = self._normalize_diagnostic_conditions(diagnostic_conditions, d_matrix)
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
        self.max_candidate_fault_count = len(matrix_fault_ids)
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
        self.latest_simulation_result = None
        self.initial_physical_measurement_snapshot = None
        generated_initial_path = self._build_initial_recommended_path(self.troubleshooting.initial_response()["currentPath"])
        self.initial_best_path = (
            _clone(initial_recommended_path)
            if isinstance(initial_recommended_path, dict)
            else generated_initial_path
        )
        self.initial_best_path = self._ensure_path_step_texts(self.initial_best_path)
        # `keySteps` is part of the authored initial path.  Derive scoring
        # nodes from it instead of accepting a second, duplicative keyNodes
        # payload from the client.  Older paths without usable keySteps retain
        # the automatic fault-tree fallback.
        self.fault_tree_key_nodes = (
            self._build_key_nodes_from_initial_path(self.initial_best_path)
            if isinstance(initial_recommended_path, dict)
            else []
        ) or self._build_fault_tree_key_nodes()
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
        dynamic_reference = self._build_dynamic_reference()
        return {
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": self._flatten_candidate_fault_ids(candidate_combinations),
            "faultCandidateCombinations": _clone(candidate_combinations),
            "continuousPath": _clone(dynamic_reference.get("continuousPath")),
            "nextContinuousAction": _clone(dynamic_reference.get("nextContinuousAction")),
            "diagnosticContext": {
                "values": _clone(self._current_condition_values()),
            },
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

        source_candidates = [
            _text(point.get("measurementSourceNodeId")),
            _text(point.get("sourceNodeId")),
            _text(point.get("nodeId")),
            _text(edge.source_node_id) if edge is not None else "",
            # `sourceDeviceId` is a legacy display field and may contain a
            # canvas ID. Use it only after component-node identifiers.
            _text(point.get("sourceDeviceId")),
        ]
        source_node_id = next(
            (candidate for candidate in source_candidates if candidate in graph.nodes),
            "",
        )
        if not source_node_id:
            source_node_id = _text(edge.source_node_id) if edge is not None else ""
        if not source_node_id:
            source_node_id = next((candidate for candidate in source_candidates if candidate), "")
        source_device_id = self._simulation_result_device_id(source_node_id)
        source_port = _text(point.get("sourcePortId") or point.get("portId") or point.get("sourcePort"))
        if not source_port and edge is not None:
            node = graph.nodes.get(edge.source_node_id)
            if node is not None and edge.source_port_index < len(node.output_port_ids):
                source_port = node.output_port_ids[edge.source_port_index]
            else:
                source_port = "output" if edge.source_port_index == 0 else f"output-{edge.source_port_index + 1}"
        return source_node_id, source_device_id, source_port, channel, edge

    def _measurement_endpoint_pairs_by_direction(self, point):
        source_node_id, source_device_id, source_port, channel, edge = self._measurement_source_for_point(point)
        graph = self.simulation_session.graph
        source_pairs = {
            (source_node_id, source_port),
            (source_device_id, source_port),
            (_text(point.get("sourceDeviceId")), _text(point.get("sourcePort"))),
        }
        target_pairs = {
            (_text(point.get("targetDeviceId")), _text(point.get("targetPort"))),
        }
        channel_component, separator, channel_port = channel.rpartition(".")
        if separator and channel_component and channel_port:
            channel_port_id = channel_port.upper() if channel_port.lower().startswith("ch") else channel_port
            target_pairs.add((channel_component, channel_port_id))
        if edge is not None:
            source_node = graph.nodes.get(edge.source_node_id)
            if source_node is not None and edge.source_port_index < len(source_node.output_port_ids):
                source_port_id = _text(source_node.output_port_ids[edge.source_port_index])
                source_pairs.add((_text(edge.source_node_id), source_port_id))
                source_pairs.add((self._simulation_result_device_id(_text(edge.source_node_id)), source_port_id))

            target_node = graph.nodes.get(edge.target_node_id)
            target_port = ""
            if target_node is not None and edge.target_port_index < len(target_node.input_ports):
                target_port = _text(target_node.input_ports[edge.target_port_index].get("id"))
            if not target_port:
                target_port = "input" if edge.target_port_index == 0 else f"input-{edge.target_port_index + 1}"
            target_node_id = _text(edge.target_node_id)
            target_pairs.add((target_node_id, target_port))
            target_pairs.add((self._simulation_result_device_id(target_node_id), target_port))
        return {
            "source": {(component_id, port_id) for component_id, port_id in source_pairs if component_id and port_id},
            "target": {(component_id, port_id) for component_id, port_id in target_pairs if component_id and port_id},
        }

    def _measurement_endpoint_pairs_for_point(self, point):
        directional_pairs = self._measurement_endpoint_pairs_by_direction(point)
        return directional_pairs["source"] | directional_pairs["target"]

    def _measurement_element_names_for_point(self, point, requested_pair):
        names = []

        def add(value):
            name = _text(value)
            if name and name not in names:
                names.append(name)

        add(point.get("elementName"))
        directional_pairs = self._measurement_endpoint_pairs_by_direction(point)
        uses_source = requested_pair in directional_pairs["source"]
        uses_target = requested_pair in directional_pairs["target"]
        if uses_source:
            add(point.get("sourceElementName"))
            add(point.get("sourceVectorElementName"))
        if uses_target:
            add(point.get("targetElementName"))
            add(point.get("targetVectorElementName"))

        vector_index = point.get("vectorIndex", 0)
        if isinstance(vector_index, bool) or not isinstance(vector_index, int) or vector_index < 0:
            vector_index = 0

        def add_port_names(port):
            if not isinstance(port, dict):
                return
            element_names = port.get("elementNames")
            if isinstance(element_names, list):
                for name in element_names:
                    add(name)
            else:
                add(port.get("elementName"))
            vector_names = port.get("vectorElementNames")
            if isinstance(vector_names, list) and vector_index < len(vector_names):
                add(vector_names[vector_index])

        _source_node_id, _source_device_id, _source_port, _channel, edge = self._measurement_source_for_point(point)
        if edge is not None:
            nodes = {
                _text(node.get("id")): node
                for node in _arr(self.model_graph.get("nodes"))
                if isinstance(node, dict) and _text(node.get("id"))
            }
            source_node = nodes.get(_text(edge.source_node_id), {})
            target_node = nodes.get(_text(edge.target_node_id), {})
            source_ports = _arr(source_node.get("outputs")) + _arr(source_node.get("powerOutputs"))
            target_ports = _arr(target_node.get("inputs")) + _arr(target_node.get("powerInputs"))
            if uses_source and edge.source_port_index < len(source_ports):
                add_port_names(source_ports[edge.source_port_index])
            if uses_target and edge.target_port_index < len(target_ports):
                add_port_names(target_ports[edge.target_port_index])
        return names

    def _resolve_measurement_point_action(self, action_record):
        requested_element_name = _text(action_record.get("elementName"))

        candidates = [
            point
            for point in _arr((self.troubleshooting.d_matrix or {}).get("points"))
            if point_type(self.troubleshooting.d_matrix, _point_code(point)) == "virtual"
        ]

        component_id = _text(action_record.get("componentId"))
        port_id = _text(action_record.get("portId"))
        requested_pair = (component_id, port_id)
        candidates = [
            point for point in candidates
            if requested_pair in self._measurement_endpoint_pairs_for_point(point)
            and requested_element_name in self._measurement_element_names_for_point(point, requested_pair)
        ]

        if not candidates:
            raise SimulationBackendError(
                "TARGET_NOT_FOUND",
                "elementName",
                f"no virtual measurement point matches {component_id}:{port_id}:{requested_element_name}",
            )
        if len(candidates) > 1:
            raise SimulationBackendError(
                "INVALID_ACTION_SCHEMA",
                "elementName",
                (
                    "measurement endpoint and element name map to multiple virtual measurement points: "
                    f"{component_id}:{port_id}:{requested_element_name}"
                ),
            )

        point = candidates[0]
        resolved = _clone(action_record)
        resolved_point_code = _point_code(point)
        resolved["pointCode"] = resolved_point_code
        resolved["target"] = {
            "type": "testPoint",
            "id": _text(point.get("channel") or point.get("pointId") or resolved_point_code),
        }
        resolved["targetId"] = resolved["target"]["id"]
        resolved["resolvedMeasurementPoint"] = {
            "pointCode": resolved_point_code,
            "pointId": _text(point.get("pointId")),
            "elementName": requested_element_name,
        }
        return resolved

    def _simulation_result_device_id(self, node_id):
        graph = self.simulation_session.graph
        node = graph.nodes.get(node_id)
        module_id = _component_module_id(node)
        if not module_id:
            return node_id
        module_count = sum(
            1
            for candidate in graph.nodes.values()
            if _component_module_id(candidate) == module_id
        )
        return module_id if module_count == 1 else node_id

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
            source_node_id, source_device_id, source_port, channel, edge = self._measurement_source_for_point(point)
            samples = [
                {
                    "time": time_value,
                    "actual": self._measurement_actual_value(
                        simulation_result, index, channel, source_node_id, source_port, edge
                    ),
                }
                for index, time_value in enumerate(times)
            ]
            source_vector_element_name = _text(point.get("sourceVectorElementName"))
            target_vector_element_name = _text(point.get("targetVectorElementName"))
            points_by_type[point_type(self.troubleshooting.d_matrix, point_code)].append({
                "pointCode": point_code,
                "pointId": _text(point.get("pointId")),
                "pointName": _text(point.get("name")),
                "channel": channel,
                "sourceDeviceId": source_device_id,
                "sourcePort": source_port,
                "samples": samples,
                **(
                    {"sourceVectorElementName": source_vector_element_name}
                    if source_vector_element_name
                    else {}
                ),
                **(
                    {"targetVectorElementName": target_vector_element_name}
                    if target_vector_element_name
                    else {}
                ),
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
            "diagnosticContext": {
                "values": _clone(self._current_condition_values()),
            },
        }

    def _component_display_name(self, component_id):
        component_id = _text(component_id)
        for node in _arr(self.model_graph.get("nodes")):
            if _text(node.get("id")) == component_id:
                return _text(node.get("name"), component_id)
        return component_id

    def _wire_display_name(self, wire_id):
        wire_id = _text(wire_id)
        return edge_endpoint_display_name(self.model_graph, wire_id)

    def _path_step_text(self, action_type, target=None, point_code="", component_id="", parameter="", value=None):
        action_type = _text(action_type)
        target = target if isinstance(target, dict) else {}
        target_id = _text(target.get("id"))
        if action_type in {"measure", "measurePoint"}:
            point = _point_by_code(self.troubleshooting.d_matrix, point_code)
            point_name = _text(point.get("name") or point.get("pointName"))
            return f"检测测点：{_text(point_code)}{f' {point_name}' if point_name else ''}。"
        if action_type == "replaceWire":
            return f"更换连线：{self._wire_display_name(target_id)}。"
        if action_type == "replaceComponent":
            return f"更换设备：{self._component_display_name(target_id)}。"
        if action_type == "adjustDisplayConsoleParameter":
            component_name = self._component_display_name(component_id)
            return f"调整显控台参数：{component_name} 的 {_text(parameter)} 设置为 {value}。"
        return "执行排故操作。"

    def _ensure_path_step_texts(self, path):
        normalized_path = _clone(path) if isinstance(path, dict) else {}
        normalized_steps = []
        for step in _arr(normalized_path.get("steps")):
            if not isinstance(step, dict):
                continue
            enriched = _clone(step)
            if not _text(enriched.get("text")):
                action_type = _text(enriched.get("actionType") or enriched.get("action"))
                target = enriched.get("target") if isinstance(enriched.get("target"), dict) else {
                    "id": _text(enriched.get("targetId")),
                }
                enriched["text"] = self._path_step_text(
                    action_type,
                    target=target,
                    point_code=_text(enriched.get("pointCode")),
                    component_id=_text(enriched.get("componentId")),
                    parameter=_text(enriched.get("parameter") or enriched.get("parameterKey")),
                    value=enriched.get("value"),
                )
            normalized_steps.append(enriched)
        normalized_path["steps"] = normalized_steps
        return normalized_path

    def _append_measurement_path_step(self, action_record, virtual_measurement):
        candidate_fault_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": "measurePoint",
            "target": _clone(action_record.get("target") or {}),
            "pointCode": action_record.get("pointCode") or "",
            "text": self._path_step_text(
                "measurePoint",
                target=action_record.get("target"),
                point_code=action_record.get("pointCode") or "",
            ),
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
            "text": self._path_step_text(
                action_type,
                target=action_record.get("target"),
                component_id=action_record.get("componentId") or "",
                parameter=_text(action_record.get("parameter")),
                value=(action_record.get("parameters") or {}).get(action_record.get("parameter")),
            ),
            "routeRole": "conditionConfiguration" if action_type == "adjustDisplayConsoleParameter" else "repairAttempt",
            "appliedAction": _clone(action_application),
            "repairEffect": _clone(repair_effect),
            **({
                "componentId": action_record.get("componentId") or "",
                "parameters": _clone(action_record.get("parameters") or {}),
            } if action_type == "adjustDisplayConsoleParameter" else {}),
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
            action = _text(step.get("actionType") or step.get("action"))
            if action in {"replaceComponent", "replaceWire"}:
                continue
            if action == "adjustDisplayConsoleParameter":
                component_id = _text(step.get("componentId") or step.get("targetComponentId"))
                parameter = _text(step.get("parameter") or step.get("parameterKey"))
                enriched = {
                    **_clone(step),
                    "index": len(steps) + 1,
                    "rank": len(steps) + 1,
                    "actionType": "adjustDisplayConsoleParameter",
                    "routeRole": "conditionConfiguration",
                    "priority": 96,
                    "recommendationTier": "optimal",
                    "confidence": 0.96,
                    "text": _text(step.get("text")) or self._path_step_text(
                        action,
                        component_id=component_id,
                        parameter=parameter,
                        value=step.get("value"),
                    ),
                }
                steps.append(enriched)
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
                "text": _text(step.get("text")) or self._path_step_text(
                    "measurePoint", target={"id": target_id}, point_code=point_code
                ),
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

    def _build_key_nodes_from_initial_path(self, initial_path):
        """Convert authored initial-path key steps into scoring key nodes."""
        if not isinstance(initial_path, dict):
            return []

        nodes = []
        seen_node_ids = set()
        for step in _arr(initial_path.get("keySteps")):
            if not isinstance(step, dict):
                continue

            action = _text(step.get("actionType") or step.get("action"))
            if action in {"measure", "measurePoint"}:
                point_code = _text(step.get("pointCode"))
                if (
                    not point_code
                    or point_type(self.troubleshooting.d_matrix, point_code) != "virtual"
                ):
                    continue
                node_id = f"measure-{point_code}"
                node = {
                    "nodeId": node_id,
                    "type": "measurePoint",
                    "pointCode": point_code,
                    "label": _text(step.get("text")) or self._key_node_label_for_point("测量虚拟测点", point_code),
                    "text": _text(step.get("text")) or self._path_step_text(
                        "measurePoint", point_code=point_code
                    ),
                    "score": 0,
                }
            elif action in {"replaceComponent", "replaceWire"}:
                supplied_target = step.get("target") if isinstance(step.get("target"), dict) else {}
                target_id = _text(supplied_target.get("id") or step.get("targetId"))
                target_type = _text(supplied_target.get("type")) or (
                    "wire" if action == "replaceWire" else "component"
                )
                if not target_id or target_type not in {"component", "wire"}:
                    continue
                node_id = f"repair-{target_type}-{target_id}"
                node = {
                    "nodeId": node_id,
                    "type": "repairTarget",
                    "target": {"type": target_type, "id": target_id},
                    "faultIds": _clone(self.target_fault_ids),
                    "label": _text(step.get("targetLabel") or step.get("text")) or (
                        "更换故障线路" if target_type == "wire" else "更换故障组件"
                    ),
                    "text": _text(step.get("text")) or self._path_step_text(
                        action, target={"id": target_id}
                    ),
                    "score": 0,
                }
            elif action == "adjustDisplayConsoleParameter":
                component_id = _text(step.get("componentId") or step.get("targetComponentId"))
                parameter = _text(step.get("parameter") or step.get("parameterKey"))
                if not component_id or not parameter:
                    continue
                node_id = f"condition-{component_id}-{parameter}"
                node = {
                    "nodeId": node_id,
                    "type": "displayConsoleParameter",
                    "target": _clone(step.get("target") or {}),
                    "componentId": component_id,
                    "parameter": parameter,
                    "value": step.get("value"),
                    "label": _text(step.get("text")) or "调整显控台参数",
                    "text": _text(step.get("text")) or self._path_step_text(
                        action,
                        component_id=component_id,
                        parameter=parameter,
                        value=step.get("value"),
                    ),
                    "score": 0,
                }
            else:
                continue

            if node_id not in seen_node_ids:
                seen_node_ids.add(node_id)
                nodes.append(node)

        if not nodes:
            return []

        score_per_node = 12.0 / len(nodes)
        allocated_score = 0.0
        for index, node in enumerate(nodes):
            node_score = (
                12.0 - allocated_score
                if index == len(nodes) - 1
                else _round_score(score_per_node)
            )
            node["score"] = _round_score(node_score)
            allocated_score += node["score"]
        return nodes

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
                "text": self._path_step_text("measurePoint", point_code=point_code),
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
                    "text": self._path_step_text(
                        "replaceWire" if target["type"] == "wire" else "replaceComponent",
                        target=target,
                    ),
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

    def _enabled_fault_ids(self):
        enabled = {
            _text(fault.get("faultId"))
            for fault in _arr(self.simulation_session.fault_runtime.fault_instances)
            if _text(fault.get("faultId")) and bool(fault.get("enabled", True))
        }
        return enabled or {
            _fault_id(row)
            for row in _arr(self.troubleshooting.d_matrix.get("rows"))
            if _fault_id(row)
        }

    @staticmethod
    def _normalize_diagnostic_conditions(conditions, d_matrix):
        context = (d_matrix or {}).get("diagnosticContext") if isinstance(d_matrix, dict) else {}
        context_values = context.get("values") if isinstance(context, dict) and isinstance(context.get("values"), dict) else {}
        normalized = []
        for raw in _arr(conditions):
            if not isinstance(raw, dict):
                continue
            key = _text(raw.get("key"))
            if not key:
                continue
            key_parts = key.split(":", 2)
            component_id = _text(raw.get("componentId")) or (key_parts[1] if len(key_parts) == 3 and key_parts[0] == "component" else "")
            parameter_key = _text(raw.get("parameterKey")) or (key_parts[2] if len(key_parts) == 3 and key_parts[0] == "component" else "")
            options = []
            for option in _arr(raw.get("options")):
                if isinstance(option, dict):
                    value = option.get("value", option.get("id", option.get("key")))
                    label = _text(option.get("label") or option.get("name"), _text(value))
                else:
                    value = option
                    label = _text(option)
                if value is not None and _text(value):
                    options.append({"value": value, "label": label})
            normalized.append({
                "key": key,
                "componentId": component_id,
                "parameterKey": parameter_key,
                "label": _text(raw.get("label"), key),
                "options": options,
                "currentValue": context_values.get(key, raw.get("currentValue")),
            })
        return normalized

    def _current_condition_values(self):
        values = {}
        for condition in self.diagnostic_conditions:
            component_id = _text(condition.get("componentId"))
            parameter_key = _text(condition.get("parameterKey"))
            node = self.simulation_session.graph.nodes.get(component_id) if component_id else None
            values[condition["key"]] = (
                node.parameters.get(parameter_key)
                if node is not None and parameter_key in node.parameters
                else condition.get("currentValue")
            )
        return values

    @staticmethod
    def _condition_values_equal(left, right):
        if isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool):
            return float(left) == float(right)
        return str(left) == str(right)

    @staticmethod
    def _condition_detectability(point, row, values):
        condition_keys = [_text(key) for key in _arr(point.get("conditionKeys")) if _text(key)]
        if not condition_keys:
            return None
        fault_id = _fault_id(row)
        matching_rules = []
        for rule in _arr(point.get("detectabilityRules")):
            if _text(rule.get("faultId") or rule.get("faultTypeId")) != fault_id:
                continue
            when = rule.get("when") if isinstance(rule.get("when"), dict) else {}
            if all(key in when and PracticeSession._condition_values_equal(when[key], values.get(key)) for key in condition_keys):
                matching_rules.append(rule)
        if not matching_rules:
            return None
        matching_rules.sort(key=lambda rule: len(rule.get("when") or {}), reverse=True)
        return bool(matching_rules[0].get("detectable"))

    def _matrix_for_current_conditions(self, matrix):
        if not self.diagnostic_conditions:
            return matrix
        values = self._current_condition_values()
        for point in _arr(matrix.get("points")):
            point_code = _point_code(point)
            if not point_code:
                continue
            for row in _arr(matrix.get("rows")):
                detectable = self._condition_detectability(point, row, values)
                if detectable is None:
                    continue
                cell = _matrix_cell(row, point_code)
                if cell is not None:
                    cell["detectable"] = detectable
                    cell["value"] = 1 if detectable else 0
        matrix["diagnosticContext"] = {
            **(matrix.get("diagnosticContext") if isinstance(matrix.get("diagnosticContext"), dict) else {}),
            "values": values,
        }
        return matrix

    def _condition_controller(self, condition):
        component_id = _text(condition.get("componentId"))
        parameter_key = _text(condition.get("parameterKey"))
        return next((
            control for control in self.display_console_controls
            if _text(control.get("targetComponentId") or control.get("componentId")) == component_id
            and parameter_key in {_text(key) for key in _arr(control.get("parameterKeys"))}
        ), None)

    def _single_parameter_condition_action(self, matrix, target_fault_ids):
        if len(target_fault_ids) != 1 or not self.diagnostic_conditions:
            return None
        target_row = next((row for row in _arr(matrix.get("rows")) if _fault_id(row) == target_fault_ids[0]), None)
        if target_row is None:
            return None
        conditions_by_key = {condition["key"]: condition for condition in self.diagnostic_conditions}
        current_values = self._current_condition_values()
        candidates = [row for row in _arr(matrix.get("rows")) if _fault_id(row) != _fault_id(target_row)]
        actions = []
        for point in _arr(matrix.get("points")):
            if _text(point.get("pointType")).lower() != "physical":
                continue
            point_code = _point_code(point)
            for condition_key in _arr(point.get("conditionKeys")):
                condition = conditions_by_key.get(_text(condition_key))
                controller = self._condition_controller(condition or {})
                if condition is None or controller is None:
                    continue
                values = list(condition.get("options") or [])
                values.extend(
                    {"value": rule.get("when", {}).get(condition_key), "label": _text(rule.get("when", {}).get(condition_key))}
                    for rule in _arr(point.get("detectabilityRules"))
                    if isinstance(rule.get("when"), dict) and condition_key in rule["when"]
                )
                option_by_value = {}
                for option in values:
                    value = option.get("value") if isinstance(option, dict) else option
                    if value is not None:
                        option_by_value.setdefault(str(value), option)
                before = self._condition_detectability(point, target_row, current_values)
                if before is None:
                    continue
                for value, option in option_by_value.items():
                    if self._condition_values_equal(current_values.get(condition_key), option.get("value") if isinstance(option, dict) else option):
                        continue
                    scenario_values = {**current_values, condition_key: option.get("value") if isinstance(option, dict) else option}
                    after = self._condition_detectability(point, target_row, scenario_values)
                    if after is None or after == before:
                        continue
                    if any(
                        self._condition_detectability(point, row, current_values) == before
                        and self._condition_detectability(point, row, scenario_values) == after
                        for row in candidates
                    ):
                        continue
                    next_value = scenario_values[condition_key]
                    actions.append({
                        "action": "adjustDisplayConsoleParameter",
                        "actionType": "adjustDisplayConsoleParameter",
                        "target": {"type": "displayConsole", "id": _text(controller.get("displayConsoleId") or controller.get("consoleId"))},
                        "componentId": condition["componentId"],
                        "parameter": condition["parameterKey"],
                        "value": next_value,
                        "routeRole": "conditionConfiguration",
                        "priority": 96,
                        "recommendationTier": "optimal",
                        "confidence": 0.96,
                        "reason": f"切换 {condition['label']} 后，物理测点 {point_code} 的前后状态可唯一定位目标故障。",
                        "text": self._path_step_text(
                            "adjustDisplayConsoleParameter",
                            component_id=condition["componentId"],
                            parameter=condition["parameterKey"],
                            value=next_value,
                        ),
                    })
        return actions[0] if actions else None

    def _current_diagnostic_matrix(self):
        """D matrix for faults which are still present after student repairs."""
        enabled_fault_ids = self._enabled_fault_ids()
        matrix = _clone(self.troubleshooting.d_matrix)
        matrix["rows"] = [
            row for row in _arr(matrix.get("rows"))
            if _fault_id(row) in enabled_fault_ids
        ]
        return self._matrix_for_current_conditions(matrix)

    def _current_target_fault_ids(self):
        enabled_fault_ids = self._enabled_fault_ids()
        return [fault_id for fault_id in self.target_fault_ids if fault_id in enabled_fault_ids]

    def _report_target_name(self, target_type, target_id):
        expected_kind = "signalEdge" if target_type == "wire" else "component"
        normalized_id = _text(target_id)
        for node in _arr(self.diagnostic_knowledge_graph.get("nodes")):
            if node.get("kind") == expected_kind and _text(node.get("id")) == normalized_id:
                return _text(node.get("label"), normalized_id)
        return normalized_id

    def _replace_report_repair_target_ids_with_names(self, evaluation_report):
        for evaluation in _arr(evaluation_report.get("stepEvaluations")):
            student_action = evaluation.get("studentAction")
            if not isinstance(student_action, dict):
                continue
            if student_action.get("actionType") not in {"replaceComponent", "replaceWire"}:
                continue
            target = student_action.get("target")
            if not isinstance(target, dict):
                continue
            target_type = _text(target.get("type"))
            target_id = _text(target.get("id"))
            if target_type not in {"component", "wire"} or not target_id:
                continue
            student_action["target"] = {
                "type": target_type,
                "name": self._report_target_name(target_type, target_id),
            }

    def _continuous_dynamic_path(self):
        target_fault_ids = self._current_target_fault_ids()
        matrix = self._current_diagnostic_matrix()
        if not target_fault_ids or not _arr(matrix.get("rows")):
            return {
                "ok": True,
                "isolated": True,
                "faultIds": target_fault_ids,
                "remainingCandidateFaultSets": [[]],
                "steps": [],
                "summary": "目标故障均已通过实践操作清除。",
            }
        try:
            plan = build_multi_fault_troubleshooting_plan(
                matrix,
                target_fault_ids,
                observations=self._known_point_observations(),
                max_faults=len(_arr(matrix.get("rows"))),
                max_steps=4,
                model_graph=self.model_graph,
            )
            return plan
        except SimulationBackendError:
            # Keep the legacy recommendation engine available for incomplete
            # older task packages that do not contain a usable D matrix.
            return None

    def _continuous_path_next_actions(self, path):
        if not isinstance(path, dict):
            return []
        step = next((item for item in _arr(path.get("steps")) if isinstance(item, dict)), None)
        if step is None:
            return []
        action = _text(step.get("action"))
        if action == "measure":
            point_code = _text(step.get("pointCode"))
            point = _point_by_code(self.troubleshooting.d_matrix, point_code)
            return [{
                "actionType": "measurePoint",
                "target": {"type": "testPoint", "id": _text(point.get("channel") or step.get("pointId") or point_code)},
                "pointCode": point_code,
                "routeRole": "postRepairRetest" if step.get("purpose") == "postRepairRetest" else "evidenceCollection",
                "expectedState": step.get("expectedState"),
                "expectedInformationGain": 1.0 if step.get("purpose") == "postRepairRetest" else 0.8,
                "priority": 95,
                "recommendationTier": "optimal",
                "confidence": 0.95,
                "reason": _text(step.get("reason") or step.get("expected") or "continuous diagnostic path next measurement"),
                "text": _text(step.get("text")) or self._path_step_text(
                    "measurePoint", point_code=point_code
                ),
            }]
        if action in {"replaceComponent", "replaceWire"}:
            action_type = action
            result = {
                "actionType": action_type,
                "target": {
                    "type": "wire" if action_type == "replaceWire" else "component",
                    "id": _text(step.get("targetId")),
                },
                "faultIds": _clone(_arr(step.get("relatedFaultIds"))),
                "routeRole": "diagnosticIsolation" if step.get("purpose") == "diagnosticIsolation" else "repairAttempt",
                "priority": 94,
                "recommendationTier": "optimal",
                "confidence": 0.95,
                "candidateSupportRatio": 1.0,
                "reason": _text(step.get("text"), "continuous diagnostic path next repair"),
                "text": _text(step.get("text")) or self._path_step_text(
                    action_type, target={"id": _text(step.get("targetId"))}
                ),
            }
            prerequisites = self._safety_prerequisites(action_type)
            if prerequisites:
                result["safetyPrerequisites"] = prerequisites
            return [result]
        if action == "adjustDisplayConsoleParameter":
            return [{
                "actionType": "adjustDisplayConsoleParameter",
                "target": _clone(step.get("target") or {}),
                "componentId": _text(step.get("componentId")),
                "parameter": _text(step.get("parameter")),
                "value": step.get("value"),
                "routeRole": "conditionConfiguration",
                "priority": 96,
                "recommendationTier": "optimal",
                "confidence": 0.96,
                "reason": _text(step.get("reason"), "switch display-console condition and rerun simulation"),
                "text": _text(step.get("text")) or self._path_step_text(
                    "adjustDisplayConsoleParameter",
                    component_id=_text(step.get("componentId")),
                    parameter=_text(step.get("parameter")),
                    value=step.get("value"),
                ),
            }]
        return []

    def _invalidated_virtual_point_codes_from_repair(self, action_application):
        cleared_fault_ids = {
            _text(change.get("faultId"))
            for change in _arr((action_application or {}).get("changes"))
            if change.get("type") == "fault_disabled" and _text(change.get("faultId"))
        }
        if not cleared_fault_ids:
            return []
        invalidated = set()
        for row in _arr(self.troubleshooting.d_matrix.get("rows")):
            if _fault_id(row) not in cleared_fault_ids:
                continue
            for cell in _arr(row.get("cells")):
                point_code = _text(cell.get("pointCode") or cell.get("pointId"))
                if point_code and point_type(self.troubleshooting.d_matrix, point_code) == "virtual":
                    invalidated.add(point_code)
        return sorted(invalidated)

    def _invalidate_virtual_measurements_after_repair(self, action_application):
        invalidated = self._invalidated_virtual_point_codes_from_repair(action_application)
        if not invalidated:
            return []
        invalidated_set = set(invalidated)
        self.virtual_measurements = [
            measurement for measurement in self.virtual_measurements
            if _text(measurement.get("pointCode")) not in invalidated_set
        ]
        # The legacy working matrix removes a column after it is measured.
        # Rebuild it so an invalidated virtual point can be selected again.
        self.active_d_matrix = _clone(self.troubleshooting.d_matrix)
        for measurement in self.virtual_measurements:
            self._apply_virtual_measurement_to_active_d_matrix(
                measurement.get("pointCode"), measurement.get("observed")
            )
        return invalidated

    def _initial_point_states_from_d_matrix(self):
        """Legacy fallback when an older task does not provide saved results."""
        return self._point_states_from_d_matrix(use_target_when_no_enabled_faults=True)

    def _point_states_from_d_matrix(self, use_target_when_no_enabled_faults=False):
        """Build current normal/abnormal point states from enabled faults and the D matrix."""
        matrix = self._matrix_for_current_conditions(_clone(self.troubleshooting.d_matrix))
        enabled_fault_ids = {
            _text(fault.get("faultId"))
            for fault in self.simulation_session.fault_runtime.fault_instances
            if bool(fault.get("enabled", True)) and _text(fault.get("faultId"))
        }
        rows = [
            row for row in _arr(matrix.get("rows"))
            if _fault_id(row) in enabled_fault_ids
        ]
        if not rows and (enabled_fault_ids or use_target_when_no_enabled_faults):
            target_row = next(
                (
                    row for row in _arr(matrix.get("rows"))
                    if _fault_id(row) == self.troubleshooting.target_fault_id
                ),
                None,
            )
            rows = [target_row] if target_row is not None else []

        def point_state(point):
            point_code = _point_code(point)
            states = [
                bool((_matrix_cell(row, point_code) or {}).get("detectable"))
                for row in rows
                if _matrix_cell(row, point_code) is not None
            ]
            observed = (
                "abnormal"
                if any(states)
                else "normal"
                if states or not rows
                else "unknown"
            )
            return {
                "pointCode": point_code,
                "observed": observed,
            }

        points = _arr(matrix.get("points"))
        return [point_state(point) for point in points]

    def _d_matrix_measurement_for_point(self, point_code):
        measurement = next(
            (
                item for item in self._point_states_from_d_matrix()
                if _text(item.get("pointCode")) == _text(point_code)
            ),
            None,
        )
        point = _point_by_code(self.troubleshooting.d_matrix, point_code)
        return {
            "pointCode": _text(point_code),
            "pointId": _text(point.get("pointId")),
            "pointName": _text(point.get("name")),
            "channel": _text(point.get("channel")),
            **(
                {"sourceVectorElementName": _text(point.get("sourceVectorElementName"))}
                if _text(point.get("sourceVectorElementName"))
                else {}
            ),
            **(
                {"targetVectorElementName": _text(point.get("targetVectorElementName"))}
                if _text(point.get("targetVectorElementName"))
                else {}
            ),
            "observed": _text((measurement or {}).get("observed"), "unknown"),
            "source": "d-matrix",
        }

    def _physical_snapshot_from_d_matrix(self):
        points = [
            self._d_matrix_measurement_for_point(_point_code(point))
            for point in _arr(self.troubleshooting.d_matrix.get("points"))
            if point_type(self.troubleshooting.d_matrix, _point_code(point)) == "physical"
        ]
        return {
            "source": "d-matrix",
            "points": points,
            "abnormalPointCodes": [point["pointCode"] for point in points if point["observed"] == "abnormal"],
            "normalPointCodes": [point["pointCode"] for point in points if point["observed"] == "normal"],
            "unknownPointCodes": [point["pointCode"] for point in points if point["observed"] == "unknown"],
        }

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
                "text": self._path_step_text("measurePoint", point_code=point_code),
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
                "text": self._path_step_text(action_type, target=target_support["target"]),
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
        continuous_path = self._continuous_dynamic_path()
        continuous_actions = self._continuous_path_next_actions(continuous_path)
        observations = self._known_point_observations()
        candidate_fault_combinations = self._candidate_fault_id_combinations_from_current_evidence()
        reference = {
            "basis": "currentEvidenceAndFaultCombinations",
            "candidateFaultIds": self._flatten_candidate_fault_ids(candidate_fault_combinations),
            "candidateFaultCombinations": candidate_fault_combinations,
            "observedPointStates": [
                {"pointCode": point_code, "observed": observed}
                for point_code, observed in sorted(observations.items())
            ],
            "recommendedActionSet": self._rank_reference_actions(
                self._measurement_reference_actions() + self._repair_reference_actions() + continuous_actions
            ),
        }
        # Preserve the broad candidate action set used by existing practice
        # scoring, while attaching the stricter stateful path that the UI can
        # follow step-by-step after each operation.
        if continuous_path is not None:
            reference["continuousPath"] = _clone(continuous_path)
            reference["nextContinuousAction"] = _clone(continuous_actions[0]) if continuous_actions else None
        return reference

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
            "latest_simulation_result",
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

    def _resolve_component_module_target(self, action_record):
        """Resolve a public component ID to its model node instance.

        Three-dimensional clients identify a component replacement with its
        module ID or declared component ID. The simulator itself still needs the
        executable node ID to disable the matching fault and to evaluate the
        repair, so retain the public ID and rewrite only the runtime action.
        Node IDs remain accepted for existing clients during the transition.
        """
        requested_module_id = _text((action_record.get("target") or {}).get("id"))
        matched_node_ids = sorted(
            node_id
            for node_id, node in self.simulation_session.graph.nodes.items()
            if _component_module_id(node) == requested_module_id
        )
        if not matched_node_ids:
            # Backward compatibility for existing practice clients that still
            # send the executable node ID.
            if requested_module_id in self.simulation_session.graph.nodes:
                return action_record, requested_module_id
            raise SimulationBackendError(
                "TARGET_NOT_FOUND",
                "target.id",
                f"component module not found: {requested_module_id}",
            )
        if len(matched_node_ids) > 1:
            raise SimulationBackendError(
                "AMBIGUOUS_COMPONENT_MODULE_ID",
                "target.id",
                f"component module matches multiple nodes: {requested_module_id}",
            )

        resolved_node_id = matched_node_ids[0]
        resolved_action = _clone(action_record)
        resolved_action["target"] = {"type": "component", "id": resolved_node_id}
        resolved_action["targetId"] = resolved_node_id
        resolved_action["componentModuleId"] = requested_module_id
        return resolved_action, resolved_node_id

    def _wire_endpoint_port_id(self, edge, direction):
        if direction == "source":
            node_id = _text(edge.source_node_id)
            port_index = edge.source_port_index
            fallback = "output" if port_index == 0 else f"output-{port_index + 1}"
            node = self.simulation_session.graph.nodes.get(node_id)
            ports = tuple(getattr(node, "output_ports", ()) or ()) + tuple(
                getattr(node, "power_output_ports", ()) or ()
            )
        else:
            node_id = _text(edge.target_node_id)
            port_index = edge.target_port_index
            fallback = "input" if port_index == 0 else f"input-{port_index + 1}"
            node = self.simulation_session.graph.nodes.get(node_id)
            ports = tuple(getattr(node, "input_ports", ()) or ()) + tuple(
                getattr(node, "power_input_ports", ()) or ()
            )
        if 0 <= port_index < len(ports):
            return _text(ports[port_index].get("id"), fallback)
        return fallback

    def _resolve_wire_endpoint_target(self, action_record):
        endpoint_fields = (
            "sourceComponentId",
            "sourcePortId",
            "targetComponentId",
            "targetPortId",
        )
        if not all(_text(action_record.get(field)) for field in endpoint_fields):
            return action_record

        source_component_id = _text(action_record.get("sourceComponentId"))
        source_port_id = _text(action_record.get("sourcePortId"))
        target_component_id = _text(action_record.get("targetComponentId"))
        target_port_id = _text(action_record.get("targetPortId"))

        binding_matches = [
            binding
            for binding in self.connection_bindings
            if binding["sourceDeviceId"] == source_component_id
            and binding["sourcePort"] == source_port_id
            and binding["targetDeviceId"] == target_component_id
            and binding["targetPort"] == target_port_id
        ]
        if binding_matches:
            edge_ids = []
            graph_edge_ids = {edge.id for edge in self.simulation_session.graph.edges}
            for binding in binding_matches:
                for edge_id in binding["backingEdgeIds"]:
                    if edge_id in graph_edge_ids and edge_id not in edge_ids:
                        edge_ids.append(edge_id)
            if not edge_ids:
                raise SimulationBackendError(
                    "TARGET_NOT_FOUND",
                    "sourceComponentId",
                    "wire binding does not reference an executable edge",
                )
            resolved_action = _clone(action_record)
            resolved_action["target"] = {"type": "wire", "id": edge_ids[0]}
            resolved_action["targetId"] = edge_ids[0]
            resolved_action["targetIds"] = edge_ids
            return resolved_action

        def component_matches(requested_id, node_id):
            return requested_id in {node_id, self._simulation_result_device_id(node_id)}

        matches = [
            edge
            for edge in self.simulation_session.graph.edges
            if component_matches(source_component_id, _text(edge.source_node_id))
            and self._wire_endpoint_port_id(edge, "source") == source_port_id
            and component_matches(target_component_id, _text(edge.target_node_id))
            and self._wire_endpoint_port_id(edge, "target") == target_port_id
        ]
        if not matches:
            raise SimulationBackendError(
                "TARGET_NOT_FOUND",
                "sourceComponentId",
                (
                    "wire not found for endpoints: "
                    f"{source_component_id}:{source_port_id} -> {target_component_id}:{target_port_id}"
                ),
            )
        resolved_action = _clone(action_record)
        resolved_action["target"] = {"type": "wire", "id": matches[0].id}
        resolved_action["targetId"] = matches[0].id
        resolved_action["targetIds"] = [edge.id for edge in matches]
        return resolved_action

    def record_action(self, action, steps=1):
        if not isinstance(action, dict):
            raise SimulationBackendError("INVALID_SCHEMA", "action", "action must be an object")
        action_record = normalize_practice_action(action)
        if action_record.get("actionType") == "measurePoint":
            action_record = self._resolve_measurement_point_action(action_record)
        if action_record.get("actionType") == "replaceWire":
            action_record = self._resolve_wire_endpoint_target(action_record)
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
        resolved_component_node_id = ""
        if action_record.get("actionType") == "replaceComponent":
            action_record, resolved_component_node_id = self._resolve_component_module_target(action_record)
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
            # Every model-changing practice action reruns only the current
            # actual path. Measurement actions return before reaching here.
            simulation_result = self.simulation_session.run_actual_from_zero()
            simulation_result["sessionId"] = self.simulation_session_id
            self.latest_simulation_result = _clone(simulation_result)
            snapshot = self._physical_snapshot_from_d_matrix()
            repair_effect = compare_physical_snapshots(previous_snapshot, snapshot)
            invalidated_virtual_point_codes = self._invalidate_virtual_measurements_after_repair(action_application)
            self.latest_physical_measurement_snapshot = _clone(snapshot)
            self.physical_measurement_snapshots.append(_clone(snapshot))
            repair_attempt = {
                "operationId": action_record.get("operationId") or f"operation-{len(self.repair_attempts) + 1}",
                "actionType": action_record.get("actionType") or "",
                "target": _clone(action_record.get("target") or {}),
                "faultId": action_record.get("faultId") or "",
                "appliedAction": _clone(action_application),
                "repairEffect": _clone(repair_effect),
                "invalidatedVirtualPointCodes": _clone(invalidated_virtual_point_codes),
            }
            if action_record.get("safetyViolation"):
                repair_attempt["safetyViolation"] = True
            self.repair_attempts.append(repair_attempt)
            action_record["repairEffect"] = _clone(repair_effect)
            action_record["physicalMeasurementSnapshot"] = _clone(snapshot)
            action_record["invalidatedVirtualPointCodes"] = _clone(invalidated_virtual_point_codes)
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
            if resolved_component_node_id:
                result["normalizedAction"]["resolvedTarget"] = {
                    "type": "component",
                    "id": resolved_component_node_id,
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
        point_code = action_record.get("pointCode")
        if isinstance(self.latest_simulation_result, dict):
            virtual_measurement = self._d_matrix_measurement_for_point(point_code)
        else:
            virtual_measurement = self._initial_measurement_for_point(point_code, "virtual")
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
        final_target_inputs = payload.get("finalTargetIds")
        if not isinstance(final_target_inputs, list) or not final_target_inputs:
            raise SimulationBackendError(
                "INVALID_SCHEMA",
                "finalTargetIds",
                "finalTargetIds must be a non-empty array",
            )

        submitted_target_ids = []
        for value in final_target_inputs:
            target_id = _text(value)
            if not target_id:
                raise SimulationBackendError(
                    "INVALID_SCHEMA",
                    "finalTargetIds",
                    "each finalTargetIds item must be a non-empty string",
                )
            if target_id not in submitted_target_ids:
                submitted_target_ids.append(target_id)

        rows_by_fault_id = {
            _fault_id(row): row
            for row in _arr(self.troubleshooting.d_matrix.get("rows"))
            if _fault_id(row)
        }
        canonical_target_by_fault_id = {}
        for relation in _arr(self.diagnostic_knowledge_graph.get("relations")):
            if relation.get("type") != "OCCURS_ON":
                continue
            source = relation.get("source") if isinstance(relation.get("source"), dict) else {}
            target = relation.get("target") if isinstance(relation.get("target"), dict) else {}
            fault_id = _text(source.get("id"))
            target_id = _text(target.get("id"))
            if source.get("kind") == "fault" and target_id:
                canonical_target_by_fault_id.setdefault(fault_id, target_id)

        canonical_target_by_submitted_id = {}
        for fault_id, row in rows_by_fault_id.items():
            raw_target_id = _fault_target_id(row)
            canonical_target_id = canonical_target_by_fault_id.get(fault_id, raw_target_id)
            if raw_target_id and canonical_target_id:
                canonical_target_by_submitted_id.setdefault(raw_target_id, canonical_target_id)
                canonical_target_by_submitted_id.setdefault(canonical_target_id, canonical_target_id)

        final_target_ids = []
        for submitted_target_id in submitted_target_ids:
            canonical_target_id = canonical_target_by_submitted_id.get(submitted_target_id, submitted_target_id)
            if canonical_target_id not in final_target_ids:
                final_target_ids.append(canonical_target_id)

        expected_target_ids = []
        for target_fault_id in self.target_fault_ids:
            raw_target_id = _fault_target_id(rows_by_fault_id.get(target_fault_id, {}))
            target_id = canonical_target_by_fault_id.get(target_fault_id, raw_target_id)
            if not target_id:
                raise SimulationBackendError(
                    "INVALID_SCHEMA",
                    "dMatrix.rows",
                    f"target fault {target_fault_id} must declare targetNodeId or targetEdgeId for final target scoring",
                )
            if target_id not in expected_target_ids:
                expected_target_ids.append(target_id)

        expected_target_id_set = set(expected_target_ids)
        final_target_id_set = set(final_target_ids)
        matched_target_ids = [target_id for target_id in expected_target_ids if target_id in final_target_id_set]
        missed_target_ids = [target_id for target_id in expected_target_ids if target_id not in final_target_id_set]
        extra_target_ids = [target_id for target_id in final_target_ids if target_id not in expected_target_id_set]
        intersection_count = len(expected_target_id_set & final_target_id_set)
        union_count = len(expected_target_id_set | final_target_id_set)
        set_accuracy = intersection_count / union_count if union_count else 1.0
        precision = intersection_count / len(final_target_id_set) if final_target_id_set else 0.0
        recall = intersection_count / len(expected_target_id_set) if expected_target_id_set else 0.0
        correct = expected_target_id_set == final_target_id_set
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
            correct=correct,
            expected_target_ids=expected_target_ids,
            final_target_ids=final_target_ids,
            set_accuracy=set_accuracy,
            precision=precision,
            recall=recall,
            matched_target_ids=matched_target_ids,
            missed_target_ids=missed_target_ids,
            extra_target_ids=extra_target_ids,
            initial_optimal_path=self.initial_best_path,
            actual_steps=self.actual_troubleshooting_steps,
            dynamic_reference_history=self.dynamic_reference_history,
            path_evaluation=path_evaluation,
            elapsed_seconds=elapsed_seconds,
            scoring_rules=self.scoring_rules,
        )
        evaluation_report["studentId"] = self.studentid
        evaluation_report["jobId"] = self.jobid
        evaluation_report["submittedAt"] = (
            datetime.fromtimestamp(self.submitted_at, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
        evaluation_report["totalDurationSeconds"] = round(elapsed_seconds)
        self._replace_report_repair_target_ids_with_names(evaluation_report)
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
