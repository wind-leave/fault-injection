import copy
import unittest

from backend.diagnostic_knowledge import (
    build_diagnostic_knowledge_graph,
    build_fault_candidates,
    build_multi_fault_troubleshooting_plan,
    build_multi_fault_troubleshooting_plan_from_knowledge_graph,
)


def sample_concrete_fault_matrix():
    points = [
        {"pointId": "tp-1", "shortName": "M1", "name": "测点一", "edgeId": "edge-1"},
        {"pointId": "tp-2", "shortName": "M2", "name": "测点二", "edgeId": "edge-2"},
        {"pointId": "tp-3", "shortName": "M3", "name": "测点三", "edgeId": "edge-3"},
    ]

    def row(fault_id, name, target_kind, target_id, signature):
        return {
            "faultId": fault_id,
            "faultName": name,
            "targetKind": target_kind,
            "targetId": target_id,
            "targetLabel": target_id,
            "cells": [
                {
                    "pointId": point["pointId"],
                    "pointCode": point["shortName"],
                    "pointName": point["name"],
                    "detectable": detectable,
                    "value": 1 if detectable else 0,
                    "reason": "人工 D 矩阵判定",
                }
                for point, detectable in zip(points, signature)
            ],
        }

    return {
        "points": points,
        "rows": [
            row("fault-device-a", "设备A故障", "node", "node-a", [True, False, False]),
            row("fault-wire-b", "连线B故障", "edge", "edge-b", [False, True, False]),
            row("fault-device-a-secondary", "设备A第二故障", "node", "node-a", [False, False, True]),
        ],
    }


class DiagnosticKnowledgeTests(unittest.TestCase):
    def test_compiles_canvas_and_every_manual_d_matrix_cell(self):
        matrix = sample_concrete_fault_matrix()
        graph = build_diagnostic_knowledge_graph(
            matrix,
            model_graph={
                "modelNodes": [
                    {
                        "id": "node-a",
                        "type": "simulation_block",
                        "props": {"name": "设备A"},
                        "outputs": [{"name": "控制输出"}],
                    },
                    {
                        "id": "node-b",
                        "type": "simulation_block",
                        "props": {"name": "设备B"},
                        "inputs": [{"name": "控制输入"}],
                    },
                ],
                "modelEdges": [
                    {
                        "id": "edge-b",
                        "sourceNodeId": "node-a",
                        "sourcePortIndex": 0,
                        "targetNodeId": "node-b",
                        "targetPortIndex": 0,
                        "label": "连线B",
                    },
                ],
            },
        )

        relations = graph["relations"]
        detectability = [relation for relation in relations if relation["type"] == "DETECTABILITY"]
        repairs = [relation for relation in relations if relation["type"] == "RESOLVED_BY_REPLACING"]

        self.assertEqual(len(detectability), 9)
        self.assertEqual(sum(1 for relation in detectability if relation["detectable"]), 3)
        self.assertTrue(all(isinstance(relation["source"], dict) for relation in detectability))
        self.assertTrue(all(relation["evidenceSource"] == "manual-d-matrix" for relation in detectability))
        self.assertIn("replaceWire", [relation["action"] for relation in repairs])
        self.assertIn("replaceComponent", [relation["action"] for relation in repairs])
        edge_node = next(node for node in graph["nodes"] if node["kind"] == "signalEdge" and node["id"] == "edge-b")
        self.assertEqual(edge_node["label"], "设备A · 控制输出 → 设备B · 控制输入")
        self.assertEqual(graph["source"], "canvas-and-manual-d-matrix")

    def test_builds_single_and_multiple_fault_candidates_from_manual_rows(self):
        candidates = build_fault_candidates(
            sample_concrete_fault_matrix(),
            observations={"M1": "abnormal", "M2": "abnormal", "M3": "normal"},
            max_faults=2,
        )

        best = candidates[0]
        self.assertEqual(best["faultIds"], ["fault-device-a", "fault-wire-b"])
        self.assertEqual(best["mode"], "multiple")
        self.assertEqual(best["contradictions"], 0)

    def test_candidate_generation_uses_every_fault_combination_when_depth_is_omitted(self):
        candidates = build_fault_candidates(sample_concrete_fault_matrix())

        self.assertEqual(len(candidates), 7)
        self.assertEqual(max(len(candidate["faultIds"]) for candidate in candidates), 3)

    def test_links_display_console_physical_inputs_to_the_console_component(self):
        matrix = sample_concrete_fault_matrix()
        matrix["points"][0].update({
            "pointType": "physical",
            "nodeId": "console-1",
            "targetName": "显控台 1",
            "inputIndex": 0,
            "inputKey": "centerFrequency",
            "displayConsoleInput": True,
        })

        graph = build_diagnostic_knowledge_graph(
            matrix,
            model_graph={"modelNodes": [{"id": "console-1", "type": "display_console", "name": "显控台 1"}]},
        )

        point_node = next(
            node for node in graph["nodes"]
            if node["kind"] == "measurementPoint" and node["id"] == "tp-1"
        )
        self.assertEqual(point_node["pointType"], "physical")
        self.assertTrue(point_node["displayConsoleInput"])
        self.assertIn(
            {
                "type": "OBSERVES",
                "source": {"kind": "measurementPoint", "id": "tp-1"},
                "target": {"kind": "component", "id": "console-1"},
                "inputIndex": 0,
                "inputKey": "centerFrequency",
                "observationSource": "display-console-input",
            },
            graph["relations"],
        )

    def test_multi_fault_plan_only_uses_the_three_supported_actions(self):
        plan = build_multi_fault_troubleshooting_plan(
            sample_concrete_fault_matrix(),
            ["fault-device-a", "fault-wire-b"],
            max_faults=2,
            max_steps=3,
        )

        self.assertTrue(plan["ok"])
        self.assertEqual(plan["mode"], "multiple")
        self.assertEqual(plan["faultIds"], ["fault-device-a", "fault-wire-b"])
        self.assertTrue({step["action"] for step in plan["steps"]}.issubset({"measure", "replaceWire", "replaceComponent"}))
        self.assertEqual(
            {(step["action"], step["targetId"]) for step in plan["steps"] if step["action"] != "measure"},
            {("replaceComponent", "node-a"), ("replaceWire", "edge-b")},
        )
        self.assertNotIn("knowledgeGraph", plan)

    def test_deduplicates_replacement_of_the_same_device(self):
        plan = build_multi_fault_troubleshooting_plan(
            sample_concrete_fault_matrix(),
            ["fault-device-a", "fault-device-a-secondary"],
            max_faults=2,
            max_steps=3,
        )

        replacements = [step for step in plan["steps"] if step["action"] == "replaceComponent"]
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["targetId"], "node-a")
        self.assertEqual(set(replacements[0]["relatedFaultIds"]), {"fault-device-a", "fault-device-a-secondary"})

    def test_deduplicates_different_wire_ids_with_the_same_public_endpoints(self):
        matrix = {
            "points": [],
            "rows": [
                {
                    "faultId": "fault-wire-first",
                    "faultName": "连线故障一",
                    "targetKind": "edge",
                    "targetId": "edge-first",
                    "targetEdgeId": "edge-first",
                    "cells": [],
                },
                {
                    "faultId": "fault-wire-duplicate",
                    "faultName": "连线故障二",
                    "targetKind": "edge",
                    "targetId": "edge-duplicate",
                    "targetEdgeId": "edge-duplicate",
                    "cells": [],
                },
            ],
        }
        model_graph = {
            "modelNodes": [
                {"id": "source-node", "type": "simulation_block"},
                {"id": "target-node", "type": "simulation_block"},
            ],
            "modelEdges": [
                {
                    "id": "edge-first",
                    "sourceNodeId": "source-node",
                    "targetNodeId": "target-node",
                    "sourceDeviceId": "source-device",
                    "sourcePort": "output-1",
                    "targetDeviceId": "target-device",
                    "targetPort": "input-1",
                    "label": "最早出现的连线",
                },
                {
                    "id": "edge-duplicate",
                    "sourceNodeId": "source-node",
                    "targetNodeId": "target-node",
                    "sourceDeviceId": "source-device",
                    "sourcePort": "output-1",
                    "targetDeviceId": "target-device",
                    "targetPort": "input-1",
                    "label": "后出现的重复连线",
                },
            ],
        }

        graph = build_diagnostic_knowledge_graph(matrix, model_graph=model_graph)
        edge_nodes = [node for node in graph["nodes"] if node["kind"] == "signalEdge"]
        repairs = [
            relation
            for relation in graph["relations"]
            if relation["type"] == "RESOLVED_BY_REPLACING"
        ]
        self.assertEqual([node["id"] for node in edge_nodes], ["edge-first"])
        self.assertEqual({relation["target"]["id"] for relation in repairs}, {"edge-first"})

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["fault-wire-first", "fault-wire-duplicate"],
            max_faults=2,
            max_steps=0,
            model_graph=model_graph,
        )
        replacements = [step for step in plan["steps"] if step["action"] == "replaceWire"]
        self.assertEqual(len(replacements), 1)
        self.assertEqual(replacements[0]["targetId"], "edge-first")
        self.assertEqual(
            set(replacements[0]["relatedFaultIds"]),
            {"fault-wire-first", "fault-wire-duplicate"},
        )

    def test_uses_replacement_and_virtual_retest_when_measurements_cannot_isolate_candidates(self):
        matrix = sample_concrete_fault_matrix()
        indistinguishable = copy.deepcopy(matrix["rows"][0])
        indistinguishable.update({
            "faultId": "fault-voltage-drop",
            "faultName": "物理层注入 - 电压跌落",
            "targetId": "node-power",
            "targetLabel": "供电模块",
            "cells": [
                {**cell, "detectable": value, "value": 1 if value else 0}
                for cell, value in zip(indistinguishable["cells"], [True, True, False])
            ],
        })
        matrix["rows"].append(indistinguishable)

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["fault-device-a", "fault-wire-b"],
            max_faults=2,
            max_steps=3,
        )

        self.assertTrue(plan["isolated"])
        self.assertEqual(plan["remainingCandidateFaultSets"], [["fault-device-a", "fault-wire-b"]])
        replacement = next(step for step in plan["steps"] if step["action"] == "replaceComponent")
        retest = next(step for step in plan["steps"] if step.get("purpose") == "postRepairRetest")
        self.assertEqual(replacement["purpose"], "diagnosticIsolation")
        # "node-a" and "node-power" are equally informative replacement
        # probes for this candidate set.  The planner may choose either one,
        # provided it pairs the repair with a discriminating virtual retest.
        self.assertIn(replacement["targetId"], {"node-a", "node-power"})
        self.assertEqual(replacement["requiredRetestPointCode"], retest["pointCode"])
        self.assertEqual(retest["action"], "measure")
        self.assertIn("已通过人工 D 矩阵区分并定位", plan["summary"])
        completed_target_repairs = {
            step["targetId"]
            for step in plan["steps"]
            if step["action"] in {"replaceComponent", "replaceWire"}
            and step["targetId"] in {"node-a", "edge-b"}
        }
        self.assertEqual(completed_target_repairs, {"node-a", "edge-b"})

    def test_replacement_probe_skips_virtual_retest_when_physical_update_is_sufficient(self):
        matrix = {
            "points": [
                {"pointId": "tp-p1", "shortName": "P1", "name": "物理测点", "pointType": "physical"},
                {"pointId": "tp-v1", "shortName": "V1", "name": "虚拟残差", "pointType": "virtual"},
            ],
            "rows": [
                {
                    "faultId": "fault-sensor",
                    "faultName": "传感器故障",
                    "targetKind": "node",
                    "targetId": "sensor-1",
                    "targetLabel": "姿态传感器",
                    "cells": [
                        {"pointId": "tp-p1", "pointCode": "P1", "detectable": True},
                        {"pointId": "tp-v1", "pointCode": "V1", "detectable": True},
                    ],
                },
                {
                    "faultId": "fault-wire",
                    "faultName": "线束故障",
                    "targetKind": "edge",
                    "targetId": "wire-1",
                    "targetLabel": "传感器线束",
                    "cells": [
                        {"pointId": "tp-p1", "pointCode": "P1", "detectable": True},
                        {"pointId": "tp-v1", "pointCode": "V1", "detectable": True},
                    ],
                },
            ],
        }

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["fault-sensor"],
            max_faults=1,
            max_steps=2,
        )

        self.assertTrue(plan["isolated"])
        self.assertEqual(len(plan["steps"]), 1)
        repair = plan["steps"][0]
        self.assertEqual(repair["action"], "replaceComponent")
        self.assertEqual(repair["targetId"], "sensor-1")
        self.assertEqual(repair["invalidatedVirtualPointCodes"], ["V1"])
        self.assertEqual(repair["automaticPhysicalUpdates"], [{
            "pointId": "tp-p1",
            "pointCode": "P1",
            "pointName": "物理测点",
            "observed": "normal",
            "source": "auto-after-repair",
        }])
        self.assertTrue(repair["virtualRetestSkipped"])
        self.assertEqual(repair["virtualRetestSkippedPointCode"], "V1")
        self.assertEqual(repair["virtualRetestSkippedReason"], "修复后的物理测点已足以隔离目标故障组合。")
        self.assertNotIn("requiredRetestPointCode", repair)
        self.assertFalse(any(step["action"] == "measure" for step in plan["steps"]))

    def test_continues_to_the_remaining_component_when_a_physical_point_stays_abnormal_after_wire_replacement(self):
        """A physical post-repair result must advance the path without a measure step."""
        points = [
            {"pointId": "tp-m1", "shortName": "M1", "name": "虚拟测点一", "pointType": "virtual"},
            {"pointId": "tp-m2", "shortName": "M2", "name": "物理测点二", "pointType": "physical"},
            {"pointId": "tp-m3", "shortName": "M3", "name": "物理测点三", "pointType": "physical"},
            {"pointId": "tp-m4", "shortName": "M4", "name": "虚拟测点四", "pointType": "virtual"},
        ]

        def row(fault_id, target_kind, target_id, target_label, signature):
            return {
                "faultId": fault_id,
                "faultName": target_label + "故障",
                "targetKind": target_kind,
                "targetId": target_id,
                "targetLabel": target_label,
                "cells": [
                    {
                        "pointId": point["pointId"],
                        "pointCode": point["shortName"],
                        "detectable": detectable,
                    }
                    for point, detectable in zip(points, signature)
                ],
            }

        matrix = {
            "points": points,
            "rows": [
                row("fault-limiter", "node", "limiter-1", "限幅组件", [False, True, False, False]),
                row("fault-downconverter", "node", "downconverter-1", "下变频组件", [True, False, False, False]),
                row("fault-filter", "node", "filter-1", "滤波组件", [True, False, True, False]),
                row("fault-edge", "edge", "edge-1", "edge-1", [False, True, True, True]),
            ],
        }

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["fault-limiter", "fault-edge"],
            max_faults=2,
            max_steps=4,
        )

        replacements = [
            (step["action"], step["targetId"])
            for step in plan["steps"]
            if step["action"] in {"replaceComponent", "replaceWire"}
        ]
        self.assertEqual(replacements, [
            ("replaceWire", "edge-1"),
            ("replaceComponent", "limiter-1"),
        ])
        wire_step = next(step for step in plan["steps"] if step.get("targetId") == "edge-1")
        self.assertEqual(wire_step["automaticObservationPointCode"], "M2")
        self.assertNotIn("requiredRetestPointCode", wire_step)
        self.assertFalse(any(
            step["action"] == "measure" and step.get("purpose") == "postRepairRetest"
            for step in plan["steps"]
        ))

    def test_uses_physical_point_states_as_known_conditions_without_measurement_actions(self):
        matrix = sample_concrete_fault_matrix()
        matrix["points"][0]["pointType"] = "physical"
        matrix["points"][1]["pointType"] = "physical"
        matrix["points"][2]["pointType"] = "virtual"

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["fault-device-a", "fault-device-a-secondary"],
            max_faults=2,
            max_steps=3,
        )

        self.assertEqual(
            [(condition["pointCode"], condition["observed"]) for condition in plan["knownConditions"]],
            [("M1", "abnormal"), ("M2", "normal")],
        )
        measured_codes = [step["pointCode"] for step in plan["steps"] if step["action"] == "measure"]
        self.assertEqual(measured_codes, ["M3"])
        self.assertNotIn("M1", measured_codes)
        self.assertNotIn("M2", measured_codes)
        self.assertTrue(plan["isolated"])

    def test_generates_one_path_for_all_enabled_faults_beyond_candidate_search_depth(self):
        matrix = sample_concrete_fault_matrix()
        for index in range(4, 7):
            extra = copy.deepcopy(matrix["rows"][0])
            extra.update({
                "faultId": f"fault-device-{index}",
                "faultName": f"设备{index}故障",
                "targetId": f"node-{index}",
                "targetLabel": f"设备{index}",
            })
            matrix["rows"].append(extra)
        enabled_fault_ids = [row["faultId"] for row in matrix["rows"]]

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            enabled_fault_ids,
            max_faults=len(enabled_fault_ids),
            max_steps=3,
        )

        self.assertEqual(plan["faultIds"], enabled_fault_ids)
        self.assertEqual(plan["mode"], "multiple")
        self.assertNotIn("candidateFaultSets", plan)
        self.assertTrue({step["action"] for step in plan["steps"]}.issubset({"measure", "replaceWire", "replaceComponent"}))

    def test_detectability_relations_in_the_knowledge_graph_drive_candidate_isolation(self):
        graph = build_diagnostic_knowledge_graph(sample_concrete_fault_matrix())
        for relation in graph["relations"]:
            if (
                relation["type"] == "DETECTABILITY"
                and relation["source"] == {"kind": "fault", "id": "fault-device-a"}
            ):
                relation["detectable"] = False

        plan = build_multi_fault_troubleshooting_plan_from_knowledge_graph(
            graph,
            ["fault-device-a", "fault-wire-b"],
            max_faults=2,
            max_steps=3,
        )

        self.assertFalse(plan["isolated"])
        self.assertIn(["fault-wire-b"], plan["remainingCandidateFaultSets"])
        self.assertIn(["fault-device-a", "fault-wire-b"], plan["remainingCandidateFaultSets"])
        self.assertTrue(plan["componentLocalized"])
        self.assertTrue(plan["confirmedRepairTargets"])
        self.assertTrue(any(step["action"] in {"replaceComponent", "replaceWire"} for step in plan["steps"]))
        self.assertNotIn("pathGeneration", plan)
        self.assertNotIn("source", plan)
        self.assertNotIn("isCustomized", plan)

    def test_confirms_a_shared_component_when_its_fault_types_remain_indistinguishable(self):
        matrix = {
            "points": [
                {"pointId": "tp-m1", "shortName": "M1", "name": "电压测点", "pointType": "physical"},
            ],
            "rows": [
                {
                    "faultId": "physical-voltage-drop",
                    "faultName": "物理层电压跌落",
                    "targetKind": "node",
                    "targetId": "voltage-drop-module",
                    "targetLabel": "电压跌落组件",
                    "cells": [{"pointId": "tp-m1", "pointCode": "M1", "detectable": True}],
                },
                {
                    "faultId": "electrical-voltage-drop",
                    "faultName": "电气层电压跌落",
                    "targetKind": "node",
                    "targetId": "voltage-drop-module",
                    "targetLabel": "电压跌落组件",
                    "cells": [{"pointId": "tp-m1", "pointCode": "M1", "detectable": True}],
                },
            ],
        }

        plan = build_multi_fault_troubleshooting_plan(
            matrix,
            ["physical-voltage-drop", "electrical-voltage-drop"],
            max_faults=2,
            max_steps=2,
        )

        self.assertTrue(plan["isolated"])
        self.assertFalse(plan["faultTypeIsolated"])
        self.assertTrue(plan["repairTargetIsolated"])
        self.assertTrue(plan["componentLocalized"])
        self.assertEqual(plan["confirmedRepairTargets"], [
            {
                "action": "replaceComponent",
                "targetId": "voltage-drop-module",
                "targetKind": "node",
                "targetLabel": "电压跌落组件",
                "relatedFaultIds": ["electrical-voltage-drop", "physical-voltage-drop"],
                "supportingCandidateCount": 3,
            }
        ])
        repair_steps = [step for step in plan["steps"] if step.get("action") == "replaceComponent"]
        self.assertEqual([(step["action"], step["targetId"]) for step in repair_steps], [
            ("replaceComponent", "voltage-drop-module"),
        ])
        self.assertIn("故障类型无需继续区分", plan["summary"])

    def test_repair_relations_in_the_knowledge_graph_drive_replacement_steps(self):
        graph = build_diagnostic_knowledge_graph(sample_concrete_fault_matrix())
        graph["nodes"].append({
            "kind": "component",
            "id": "node-graph-repair",
            "label": "图谱指定维修设备",
        })
        graph["relations"] = [
            relation
            for relation in graph["relations"]
            if not (
                relation["type"] == "RESOLVED_BY_REPLACING"
                and relation["source"] == {"kind": "fault", "id": "fault-device-a"}
            )
        ]
        graph["relations"].append({
            "type": "RESOLVED_BY_REPLACING",
            "source": {"kind": "fault", "id": "fault-device-a"},
            "target": {"kind": "component", "id": "node-graph-repair"},
            "action": "replaceComponent",
        })

        plan = build_multi_fault_troubleshooting_plan_from_knowledge_graph(
            graph,
            ["fault-device-a"],
            max_faults=2,
            max_steps=3,
        )

        replacements = [step for step in plan["steps"] if step["action"] == "replaceComponent"]
        self.assertEqual([(step["targetId"], step["targetLabel"]) for step in replacements], [
            ("node-graph-repair", "图谱指定维修设备"),
        ])


if __name__ == "__main__":
    unittest.main()
