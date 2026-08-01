import time

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
    is_directly_diagnosable_from_physical_points,
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
        initial_point_states=None,
        initial_recommended_path=None,
        key_nodes=None,
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
        # Keep the original matrix for final-fault validation and retain a
        # session-local working matrix for the iterative diagnosis process.
        # Each virtual measurement consumes one point column and filters rows
        # whose expected state disagrees with the saved point state.
        self.active_d_matrix = _clone(self.troubleshooting.d_matrix)
        self.initial_point_states = (
            _clone(initial_point_states)
            if isinstance(initial_point_states, list)
            else self._initial_point_states_from_d_matrix()
        )
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
        return {
            "virtualMeasurements": _clone(self.virtual_measurements),
            "repairAttempts": _clone(self.repair_attempts),
            "faultCandidates": _clone(self.troubleshooting.remaining_fault_ids),
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
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": "measurePoint",
            "target": _clone(action_record.get("target") or {}),
            "pointCode": action_record.get("pointCode") or "",
            "observed": virtual_measurement.get("observed") or "unknown",
            "routeRole": "evidenceCollection",
            "virtualMeasurement": _clone(virtual_measurement),
            "candidateFaultsAfterAction": self._candidate_fault_ids_from_current_evidence(),
        })

    def _append_repair_path_step(self, action_record, action_application, repair_effect):
        action_type = action_record.get("actionType") or ""
        self.actual_troubleshooting_steps.append({
            "stepIndex": len(self.actual_troubleshooting_steps) + 1,
            "operationId": action_record.get("operationId") or f"operation-{len(self.actual_troubleshooting_steps) + 1}",
            "actionType": action_type,
            "target": _clone(action_record.get("target") or {}),
            "faultId": action_record.get("faultId") or "",
            "routeRole": "repairAttempt",
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
            nodes.append({
                "nodeId": f"measure-{point_code}",
                "type": "measurePoint",
                "pointCode": point_code,
                "label": self._key_node_label_for_point("测量虚拟测点", point_code),
                "score": 6,
            })

        edge_ids = {edge.id for edge in self.simulation_session.graph.edges}
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
            nodes.append({
                "nodeId": f"repair-{fault_id}",
                "type": "repairTarget",
                "target": target,
                "faultId": fault_id,
                "label": label,
                "score": 6,
            })
            break
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
        if normalized_observed in {"normal", "abnormal"}:
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

    def _candidate_rows_from_current_evidence(self):
        rows = _arr(self.active_d_matrix.get("rows"))
        target_row = next((row for row in rows if _fault_id(row) == self.target_fault_id), None)
        if target_row and is_directly_diagnosable_from_physical_points(self.active_d_matrix, target_row, rows):
            return [target_row]
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
        for point in _arr(self.active_d_matrix.get("points")):
            point_code = _point_code(point)
            if not point_code or point_code in measured_codes:
                continue
            if point_type(self.active_d_matrix, point_code) != "virtual":
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
                for point in _arr(self.active_d_matrix.get("points"))
                if point_type(self.active_d_matrix, _point_code(point)) == "virtual"
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
        self.simulation_results.append(_clone(simulation_result))
        return {
            "status": "success",
            "sessionId": self.practice_session_id,
            "practiceSessionId": self.practice_session_id,
            "simulationSessionId": self.simulation_session_id,
            "normalizedAction": normalized_action,
            "simulationResult": self._build_measurement_result(simulation_result),
        }

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
        final_fault_input = _text(payload.get("finalFaultName") or payload.get("faultName") or payload.get("finalFaultId") or payload.get("faultId"))
        if not final_fault_input:
            raise SimulationBackendError("INVALID_SCHEMA", "finalFaultName", "finalFaultName is required")
        target_fault_name = _text(self.troubleshooting.target_row.get("faultName"), self.target_fault_id)
        matched_final_row = next(
            (
                row
                for row in _arr(self.troubleshooting.d_matrix.get("rows"))
                if _fault_id(row) == final_fault_input or _text(row.get("faultName")) == final_fault_input
            ),
            None,
        )
        final_fault_id = _fault_id(matched_final_row) if matched_final_row else _text(payload.get("finalFaultId") or payload.get("faultId"))
        final_fault_name = (
            _text(matched_final_row.get("faultName"), final_fault_id)
            if matched_final_row
            else _text(payload.get("finalFaultName") or payload.get("faultName"), final_fault_input)
        )
        self.submitted_at = time.time()
        self.close("submitted", now=self.submitted_at)
        correct = bool(matched_final_row and _fault_id(matched_final_row) == self.target_fault_id)
        elapsed_seconds = max(0.0, self.submitted_at - self.started_at)
        path_evaluation = self._evaluate_path_quality()
        scoring_result = evaluate_practice_submission_score(
            correct=correct,
            elapsed_seconds=elapsed_seconds,
            scoring_rules=self.scoring_rules,
            student_actions=self.student_actions,
            path_evaluation=path_evaluation,
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
