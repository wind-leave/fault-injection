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
                    {"id": "node-a", "type": "simulation_block", "props": {"name": "设备A"}},
                    {"id": "node-b", "type": "simulation_block", "props": {"name": "设备B"}},
                ],
                "modelEdges": [
                    {"id": "edge-b", "sourceNodeId": "node-a", "targetNodeId": "node-b", "label": "连线B"},
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

    def test_does_not_recommend_replacement_when_an_unselected_fault_has_the_same_signature(self):
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

        self.assertFalse(plan["isolated"])
        self.assertIn(["fault-voltage-drop"], plan["remainingCandidateFaultSets"])
        self.assertIn(["fault-device-a", "fault-wire-b"], plan["remainingCandidateFaultSets"])
        self.assertTrue(all(step["action"] == "measure" for step in plan["steps"]))
        self.assertIn("不给出未经唯一定位的更换动作", plan["summary"])

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
        self.assertTrue(all(step["action"] == "measure" for step in plan["steps"]))
        self.assertNotIn("pathGeneration", plan)
        self.assertNotIn("source", plan)
        self.assertNotIn("isCustomized", plan)

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
