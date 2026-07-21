# 三维实践任务包 JSON 导出格式

本文说明故障注入平台点击顶部“保存仿真结果”后导出的 JSON 文件格式。

当前导出物已由工作台仿真快照调整为三维实践任务包，单个文件同时包含：

- `publicData`：三维端可见任务数据。
- `privateData`：后端私有任务数据。

本阶段只负责将两部分一并导出，不处理权限拆分、后端保存或三维端下发控制。

## 导出行为

- 只有仿真已经产生结果后才允许导出。
- 文件为 UTF-8 JSON，使用两空格缩进。
- 文件名继续使用 `{datasetName}-{YYYY-MM-DD}.json`。
- 数据集名称为空时使用 `simulation-result`。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "kind": "3d-practice-task-package",
  "exportedAt": "2026-07-16T08:00:00.000Z",
  "taskId": "practice-1780000000000",
  "meta": {},
  "publicData": {},
  "privateData": {}
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | number | 格式版本，当前为 `1` |
| `kind` | string | 固定为 `3d-practice-task-package` |
| `exportedAt` | string | ISO 8601 导出时间 |
| `taskId` | string | 本次三维实践任务标识 |
| `meta` | object | 数据集、模型和初始仿真的基础元信息 |
| `publicData` | object | 三维端可见数据 |
| `privateData` | object | 后端重算、诊断和评分所需私有数据 |

## `meta`

```json
{
  "resultId": "sim-1780000000000",
  "datasetName": "test",
  "duration": 10,
  "stepSize": 0.1,
  "status": "completed",
  "modelId": "evtol-small",
  "modelName": "eVTOL Small Nonlinear"
}
```

## `publicData`

```json
{
  "modelRevision": 0,
  "renderData": {
    "devices": [],
    "connections": []
  },
  "initialSimulationResult": {
    "status": "completed",
    "simulationConfig": {
      "duration": 10,
      "stepSize": 0.1
    },
    "physicalMeasurements": [],
    "virtualMeasurements": [],
    "summary": {}
  }
}
```

字段说明：

- `modelRevision`：初始导出为 `0`，后续维修重算可按模型版本递增。
- `renderData`：供三维端展示使用的设备、设备通道和连接数据，直接位于 `publicData` 下；测量仪器及其连接不会导出。
- `initialSimulationResult`：当前含故障模型的静态初始仿真数据，其中物理测点以 `physicalMeasurements` 提供，虚拟测点以 `virtualMeasurements` 提供；每个测点含来源设备 `sourceDeviceId`、来源端口 `sourcePort` 和完整的逐时间步 `samples`（仅时间和实际值），不导出组件输出轨迹或状态汇总。

## `privateData`

```json
{
  "executableModel": {
    "schemaVersion": 1,
    "packageId": "evtol-small",
    "simulationConfig": {
      "duration": 10,
      "stepSize": 0.1
    },
    "nodes": [],
    "edges": [],
    "faultInstances": [],
    "measurementPoints": []
  },
  "rerunConfig": {
    "startTime": 0,
    "duration": 10,
    "stepSize": 0.1,
    "randomSeed": null,
    "initialConditions": {},
    "inputScenario": {},
    "resetPolicy": "full-reset"
  },
  "targetFaultId": "fault-001",
  "dMatrix": {},
  "initialRecommendedPath": {}
}
```

字段说明：

- `executableModel`：维修后供后端重新运行的标准可执行模型包。
- `rerunConfig`：每次基于最新模型从 `t=0` 全量重跑的配置。
- `targetFaultId`：当前实践选中的目标故障；没有选择实践故障时为 `null`。
- `dMatrix`：完整故障—测点检测矩阵。
- `initialRecommendedPath`：目标故障的初始推荐排故路径。

## 当前占位字段

以下字段已经进入稳定导出契约，但当前没有完整工作台配置来源：

- `privateData.rerunConfig.randomSeed`
- `privateData.rerunConfig.initialConditions`
- `privateData.rerunConfig.inputScenario`

它们分别导出为 `null` 或 `{}`，后续可在不改变顶层格式的情况下补充数据来源。

## 与后端仿真响应的区别

任务包用于初始化三维实践，包含公开展示数据和后端重算数据。后端 `/api/simulations/run` 的响应仍是单次计算结果，核心字段为：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "curves": {},
  "componentOutputs": {},
  "events": [],
  "metrics": {},
  "warnings": []
}
```

两者用途不同：任务包定义一次实践任务，仿真响应表示某个模型版本从零重跑后的结果。
