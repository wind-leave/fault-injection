# Fault Types

本文件夹用于沉淀无人机飞控系统故障类型、平台实现方案和 Python 故障模型代码。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `uav-flight-control-fault-implementation-plan.md` | 主文档，说明每类故障的定量模型、平台实现方式、仪器展示方式和多信号流图方案。 |
| `fault-type-catalog.json` | 结构化故障库，可作为后续平台故障库导入数据源。 |
| `uav-fault-models.py` | Python 故障模型函数，可用于 Python 绑定仿真块或后端故障运行时。 |
| `full-model-blueprint.json` | 完整无人机飞控故障注入大模型蓝图。 |
| `dataflow-embedding-plan.md` | Fault Types 与平台多信号流图、边级指标和属性栏诊断的嵌入方案。 |

## 使用建议

1. 先阅读 `uav-flight-control-fault-implementation-plan.md`。
2. 用 `fault-type-catalog.json` 作为平台故障库数据源。
3. 将 `uav-fault-models.py` 中的函数接入 Python 绑定仿真块。
4. 依据 `full-model-blueprint.json` 搭建完整 UAV 大模型。
5. 阅读 `dataflow-embedding-plan.md`，将 residual、latency、drop_rate、spectrum_peak 等运行指标作为边的可视化数据。
