import unittest

from backend.practice_report import _deduction_reason


class PracticeReportTests(unittest.TestCase):
    def test_diagnostic_path_deduction_uses_readable_missed_key_node_descriptions(self):
        reason, _ = _deduction_reason(
            "diagnosticTreePath",
            correct=True,
            path_evaluation={
                "keyNodeCoverage": {
                    "missedNodeIds": ["measure-M3", "measure-M4", "repair-wire-edge-2"],
                },
                "faultTreeKeyNodes": [
                    {"nodeId": "measure-M3", "type": "measurePoint", "pointCode": "M3"},
                    {"nodeId": "measure-M4", "type": "measurePoint", "pointCode": "M4"},
                    {
                        "nodeId": "repair-wire-edge-2",
                        "type": "repairTarget",
                        "target": {"type": "wire", "id": "edge-2"},
                    },
                ],
            },
            elapsed_seconds=0,
            scoring_rules={},
        )

        self.assertEqual(reason, "未覆盖关键节点：测量M3, 测量M4, 更换连线edge-2")

    def test_diagnostic_path_deduction_describes_missed_display_console_parameter(self):
        reason, _ = _deduction_reason(
            "diagnosticTreePath",
            correct=True,
            path_evaluation={
                "keyNodeCoverage": {"missedNodeIds": ["condition-filter-cutoff"]},
                "faultTreeKeyNodes": [{
                    "nodeId": "condition-filter-cutoff",
                    "type": "displayConsoleParameter",
                    "text": "调整显控台参数：滤波组件 的 截止频率 设置为 1000。",
                }],
            },
            elapsed_seconds=0,
            scoring_rules={},
        )

        self.assertEqual(reason, "未覆盖关键节点：调整显控台参数：滤波组件 的 截止频率 设置为 1000")


if __name__ == "__main__":
    unittest.main()
