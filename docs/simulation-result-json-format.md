# 仿真结果 JSON 导出格式说明

本文说明故障注入平台点击顶部按钮“保存仿真结果”后导出的 JSON 文件格式。当前导出逻辑在前端运行时中完成，入口为 `src/services/legacy-runtime.txt` 中的 `doSaveRes()`，实际数据由 `buildSimulationResultSnapshot()` 组装。

## 导出行为

- 只有仿真已经产生样本后才允许导出。
- 导出文件为 UTF-8 JSON，使用 `JSON.stringify(result, null, 2)` 格式化。
- 文件名格式为 `{datasetName}-{YYYY-MM-DD}.json`。
- 若数据集名为空或包含不适合文件名的字符，会被转换为安全名称；兜底名称为 `simulation-result`。

示例文件名：

```text
test-2026-07-07.json
evtol-small-nonlinear-2026-07-07.json
```

## 顶层结构

导出的 JSON 是一个快照对象，顶层字段如下：

```json
{
  "schemaVersion": 1,
  "kind": "simulation-result",
  "exportedAt": "2026-07-07T08:00:00.000Z",
  "meta": {},
  "model": {},
  "samples": {},
  "componentOutputs": {},
  "dMatrix": {},
  "practiceFaults": [],
  "renderData": {},
  "summary": {},
  "logs": []
}
```

字段含义：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | number | 导出格式版本。当前为 `1`。 |
| `kind` | string | 固定为 `simulation-result`，用于区分模型包、故障库等其它 JSON。 |
| `exportedAt` | string | 导出时间，ISO 8601 字符串。 |
| `meta` | object | 本次仿真的运行元信息。 |
| `model` | object | 导出时工作台上的模型、连线、画布和故障配置快照。 |
| `samples` | object | 实际链路和参考链路的示波器、仪表采样数据。 |
| `componentOutputs` | object | 每个仿真步中各节点输出值的跟踪数据。 |
| `dMatrix` | object/null | 当前检测矩阵模型快照。无构建函数时可能为 `null`。 |
| `practiceFaults` | array | 训练实践中选中的故障及其排故路径信息。 |
| `renderData` | object | 供结果展示或外部系统渲染使用的设备、连接、通道数据。 |
| `summary` | object | 节点数、连线数、故障数、样本数量等摘要。 |
| `logs` | array | 底部日志区当前可见日志行。 |

## `meta`

```json
{
  "resultId": "sim-1780000000000",
  "datasetName": "test",
  "duration": 10,
  "stepSize": 0.1,
  "stepIndex": 100,
  "elapsedTime": 10,
  "realtime": true,
  "hasSamples": true,
  "status": "completed",
  "modelId": "evtol-small",
  "modelName": "eVTOL Small Nonlinear"
}
```

主要字段：

| 字段 | 含义 |
| --- | --- |
| `resultId` | 本次导出的结果 ID，格式为 `sim-{Date.now()}`。 |
| `datasetName` | 仿真数据集名称，用于文件名。 |
| `duration` | 仿真总时长，单位为秒。 |
| `stepSize` | 仿真步长，单位为秒。 |
| `stepIndex` | 已推进的仿真步数。 |
| `elapsedTime` | 当前仿真时间。 |
| `realtime` | 是否使用实时模式运行。 |
| `hasSamples` | 是否已经产生采样数据。 |
| `status` | 当前状态，可能为 `idle`、`initialized`、`running`、`paused`、`completed`、`stopped`。 |
| `modelId` | 当前导入模型包 ID，无模型包时为 `null`。 |
| `modelName` | 当前导入模型包名称，无模型包时为 `null`。 |

## `model`

```json
{
  "nodes": [],
  "edges": [],
  "canvases": {},
  "rootCanvasId": null,
  "activeCanvasId": null,
  "faultInstances": [],
  "importedFaultModels": [],
  "snapshot": {}
}
```

说明：

- `nodes` 保存当前工作台节点。
- `edges` 保存当前工作台连线。
- `canvases`、`rootCanvasId`、`activeCanvasId` 保存分层画布信息。
- `faultInstances` 保存已注入或配置的故障实例。
- `importedFaultModels` 保存已导入的故障模型。
- `snapshot` 是 `createSystemModelSnapshot()` 生成的完整系统模型快照，用于恢复工作台状态。

## `samples`

`samples` 分为 `actual` 和 `reference` 两套数据：

```json
{
  "actual": {
    "scopeSamples": {},
    "instrumentSamples": {}
  },
  "reference": {
    "scopeSamples": {},
    "instrumentSamples": {}
  }
}
```

- `actual` 表示含故障注入、链路扰动、节点故障后的实际仿真结果。
- `reference` 表示无故障或基准状态下的参考仿真结果。

### 示波器采样

当前双通道示波器形态通常如下：

```json
{
  "scope-node-id": {
    "ch1": [
      { "t": 0, "actual": 1.23 },
      { "t": 0.1, "actual": 1.31 }
    ],
    "ch2": [
      { "t": 0, "actual": 2.34 },
      { "t": 0.1, "actual": 2.41 }
    ]
  }
}
```

当信号在实际链路中被丢包或断连时，样本可能为：

```json
{
  "t": 1.2,
  "actual": null,
  "dropped": true
}
```

早期运行时曾使用旧形态：

```json
{
  "scope-node-id": [
    { "t": 0, "v": 1.23 }
  ]
}
```

因此读取导出文件时建议同时兼容数组形态和 `{ ch1, ch2 }` 形态。

### 仪表采样

辅助仪表采样通常如下：

```json
{
  "instrument-node-id": [
    { "t": 0, "actual": 1.23, "reference": 1.0 },
    { "t": 0.1, "actual": 1.31, "reference": 1.05 }
  ]
}
```

实际链路丢包时可能出现：

```json
{
  "t": 1.2,
  "actual": null,
  "reference": 1.0,
  "dropped": true
}
```

## `componentOutputs`

`componentOutputs` 记录每个仿真步中各节点的输出映射：

```json
{
  "time": [0, 0.1],
  "steps": [
    {
      "time": 0,
      "actual": {
        "node-id": {
          "output": 1.23
        }
      },
      "reference": {
        "node-id": {
          "output": 1.0
        }
      }
    }
  ]
}
```

说明：

- `time` 为采样时间数组。
- `steps` 与 `time` 对应。
- 每个 `step.actual` 和 `step.reference` 都按节点 ID 保存输出端口值。
- 节点可能有多个输出端口，键名取决于节点端口定义，例如 `output`、`out1`、`motorCommand` 等。

## `dMatrix`

`dMatrix` 是当前检测矩阵模型快照，来源于 `window.buildDetectionMatrixModel()`。该字段用于故障诊断、测点判断和排故路径关联。

常见内容包括：

- 故障行。
- 测点列。
- 故障与测点之间的异常关系。
- 故障名称、显示名称、目标对象、层级等元数据。

如果当前运行环境没有检测矩阵构建函数，该字段为 `null`。

## `practiceFaults`

`practiceFaults` 保存训练实践中选中的故障：

```json
[
  {
    "faultId": "fault-001",
    "faultName": "IMU gyro bias",
    "faultDisplayName": "IMU 陀螺仪零偏",
    "targetLabel": "IMU",
    "layer": "sensor",
    "selected": true,
    "troubleshootingPath": {}
  }
]
```

其中 `troubleshootingPath` 来自 `buildTroubleshootingPathForFault(faultId)`，用于记录该故障对应的标准排故路径。

## `renderData`

`renderData` 面向结果展示和外部系统渲染：

```json
{
  "devices": [
    {
      "id": "node-1",
      "displayName": "Controller",
      "type": "simulation_block",
      "channels": {}
    }
  ],
  "connections": [
    {
      "id": "edge-1",
      "sourceDeviceId": "node-1",
      "targetDeviceId": "node-2",
      "sourcePort": "output1",
      "targetPort": "input1",
      "label": "Controller -> Motor"
    }
  ]
}
```

说明：

- `devices` 只包含可展示的设备节点，不包含故障标签、边故障标签、中间变量赋值等辅助节点。
- `channels` 会把示波器或仪表采样归一化为 `{ t, value }` 序列。
- `connections` 记录设备之间的可视化连接关系。

## `summary`

```json
{
  "nodeCount": 12,
  "edgeCount": 14,
  "faultCount": 3,
  "actualScopeSampleCount": 200,
  "referenceScopeSampleCount": 200,
  "actualInstrumentSampleCount": 100,
  "referenceInstrumentSampleCount": 100
}
```

说明：

- `nodeCount` 为当前模型节点数量。
- `edgeCount` 为当前模型连线数量。
- `faultCount` 为当前已配置故障数量，统计故障实例、导入故障模型、节点绑定故障和边绑定故障。
- 采样数量字段会同时兼容示波器旧数组形态和新双通道形态。

## `logs`

`logs` 保存底部日志区中带 `data-log-entry` 的行：

```json
[
  {
    "level": "info",
    "view": "log",
    "cells": ["12:00:00", "仿真完成"]
  }
]
```

说明：

- `level` 为日志级别，默认 `info`。
- `view` 为日志所属视图，默认 `log`。
- `cells` 为该行各单元格的文本内容。

## 完整示例

```json
{
  "schemaVersion": 1,
  "kind": "simulation-result",
  "exportedAt": "2026-07-07T08:00:00.000Z",
  "meta": {
    "resultId": "sim-1780000000000",
    "datasetName": "test",
    "duration": 10,
    "stepSize": 0.1,
    "stepIndex": 2,
    "elapsedTime": 0.2,
    "realtime": true,
    "hasSamples": true,
    "status": "stopped",
    "modelId": null,
    "modelName": null
  },
  "model": {
    "nodes": [],
    "edges": [],
    "canvases": {},
    "rootCanvasId": null,
    "activeCanvasId": null,
    "faultInstances": [],
    "importedFaultModels": [],
    "snapshot": {}
  },
  "samples": {
    "actual": {
      "scopeSamples": {
        "scope-1": {
          "ch1": [
            { "t": 0, "actual": 1.23 },
            { "t": 0.1, "actual": 1.31 }
          ],
          "ch2": []
        }
      },
      "instrumentSamples": {}
    },
    "reference": {
      "scopeSamples": {
        "scope-1": {
          "ch1": [
            { "t": 0, "actual": 1.0 },
            { "t": 0.1, "actual": 1.05 }
          ],
          "ch2": []
        }
      },
      "instrumentSamples": {}
    }
  },
  "componentOutputs": {
    "time": [0, 0.1],
    "steps": [
      {
        "time": 0,
        "actual": {
          "node-source": { "output": 1.23 }
        },
        "reference": {
          "node-source": { "output": 1.0 }
        }
      }
    ]
  },
  "dMatrix": null,
  "practiceFaults": [],
  "renderData": {
    "devices": [],
    "connections": []
  },
  "summary": {
    "nodeCount": 0,
    "edgeCount": 0,
    "faultCount": 0,
    "actualScopeSampleCount": 2,
    "referenceScopeSampleCount": 2,
    "actualInstrumentSampleCount": 0,
    "referenceInstrumentSampleCount": 0
  },
  "logs": []
}
```

## 与后端仿真 API 返回结构的区别

前端“保存仿真结果”导出的 JSON 是工作台级别快照，包含模型、样本、组件输出、检测矩阵、训练故障、渲染数据、摘要和日志。

后端 `/api/simulations/run` 或 `/api/simulations/session/{id}/step` 返回的是仿真计算结果，核心结构为：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "curves": {
    "time": [0, 0.1],
    "channels": {
      "scope-1.actual": [1.23],
      "scope-1.reference": [1.0]
    }
  },
  "componentOutputs": {
    "time": [0, 0.1],
    "steps": []
  },
  "events": [],
  "metrics": {
    "sampleCount": 2,
    "stepIndex": 2,
    "time": 0.2,
    "done": false
  },
  "warnings": []
}
```

也就是说，后端结果偏计算输出，前端导出文件偏完整归档。若外部系统需要复盘一次仿真，应优先读取前端导出的 `simulation-result` 文件；若只需要曲线数据，可直接读取后端返回中的 `curves`。

