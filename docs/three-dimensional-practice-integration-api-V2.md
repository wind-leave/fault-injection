# 三维实践联调接口文档

本文档定义故障注入平台、三维端与实践后端之间的数据契约，覆盖以下完整流程：

1. 故障注入平台导出三维实践任务包。
2. 三维端读取公开数据构建场景，并将私有任务数据提交给后端创建实践任务。
3. 三维端提交学员测量、更换线缆和更换组件动作。
4. 三维端提交学员最终故障结论，后端结束任务并返回完整实践评估报告。

## 1. 基础约定

后端默认地址：

```text
https://simulation-aienglearn.phm-ate.com/
```

HTTP 请求和响应均使用 UTF-8 JSON：

```http
Content-Type: application/json; charset=utf-8
```

统一成功字段：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success"
}
```

统一错误结构：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "error",
  "errorCode": "INVALID_SCHEMA",
  "field": "fieldName",
  "message": "error description"
}
```

| 状态码 | 含义 |
| ---: | --- |
| `200` | 请求成功 |
| `400` | 请求结构、动作、目标或仿真数据不合法 |
| `404` | 接口或实践任务不存在 |
| `410` | 实践任务已超过生命周期或空闲超时 |
| `500` | 后端内部错误 |

## 2. 完整业务流程

```text
故障注入平台导出任务包
        ↓
三维端读取 publicData 构建场景
        ↓
三维端将 privateData 映射为创建实践任务请求
        ↓
POST /api/practice/session
        ↓
保存 practiceSessionId
        ↓
反复 POST /api/practice/session/{practiceSessionId}/action
        ↓
POST /api/practice/session/{practiceSessionId}/submit
        ↓
后端评分、返回 evaluationReport 并自动结束任务
```

导出前，平台会针对 D 矩阵中已选为“实践排查”的故障请求后端排故方案，并将返回的路径写入 `privateData.initialRecommendedPath`。未选择实践故障时，`targetFaultId` 和 `initialRecommendedPath` 均为 `null`。

## 3. 仿真结果导出包格式

故障注入平台“保存仿真结果”导出 UTF-8 JSON 文件，文件类型固定为三维实践任务包。

### 3.1 顶层结构

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
| `schemaVersion` | number | 任务包格式版本，当前为 `1` |
| `kind` | string | 固定为 `3d-practice-task-package` |
| `exportedAt` | string | ISO 8601 导出时间 |
| `taskId` | string | 导出任务标识，不等同于后端返回的 `practiceSessionId` |
| `meta` | object | 数据集、模型和初始仿真的元信息 |
| `publicData` | object | 三维端可见数据 |
| `privateData` | object | 创建实践任务时提交给后端的私有数据 |

### 3.2 `meta`

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

### 3.3 `publicData`

```json
{
  "modelRevision": 0,
  "renderData": {
    "devices": [
      {
        "id": "attitude-command",
        "displayName": "姿态指令",
        "type": "simulation_block",
        "channels": {}
      },
      {
        "id": "attitude-pid",
        "displayName": "姿态 PID",
        "type": "simulation_block",
        "channels": {}
      }
    ],
    "connections": [
      {
        "id": "edge-attitude-command-pid",
        "sourceDeviceId": "attitude-command",
        "targetDeviceId": "attitude-pid",
        "sourcePort": "command",
        "targetPort": "setpoint",
        "label": "姿态指令"
      }
    ]
  },
  "initialSimulationResult": {
    "status": "completed",
    "simulationConfig": {
      "duration": 10,
      "stepSize": 0.1
    },
    "physicalMeasurements": [
      {
        "pointCode": "M1",
        "pointId": "tp-edge-attitude-command-pid-1",
        "pointName": "姿态指令",
        "channel": "edge-attitude-command-pid",
        "sourceDeviceId": "attitude-command",
        "sourcePort": "command",
        "samples": [
          { "time": 0.0, "actual": 0.06 },
          { "time": 0.1, "actual": 0.07 }
        ]
      }
    ],
    "virtualMeasurements": [
      {
        "pointCode": "V1",
        "pointId": "tp-edge-attitude-command-pid-2",
        "pointName": "姿态指令虚拟测点",
        "channel": "edge-attitude-command-pid",
        "sourceDeviceId": "attitude-command",
        "sourcePort": "command",
        "samples": [
          { "time": 0.0, "actual": 0.06 },
          { "time": 0.1, "actual": 0.07 }
        ]
      }
    ],
    "summary": {}
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `modelRevision` | 模型版本，初始值为 `0` |
| `renderData.devices` | 三维端用于构建设备的公开数据，不含示波器等测量仪器 |
| `renderData.connections` | 三维端用于构建连接关系的公开数据；不会保留连接到测量仪器的关系 |
| `initialSimulationResult` | 当前含故障模型的静态初始仿真结果 |
| `initialSimulationResult.physicalMeasurements` | 初始物理测点的完整逐时间步数据；测点含 `pointCode`、`pointId`、`pointName`、`channel`、`sourceDeviceId`、`sourcePort` 和 `samples` |
| `initialSimulationResult.virtualMeasurements` | 初始虚拟测点的完整逐时间步数据；字段与物理测点相同 |
| `*.samples[]` | 单个仿真时间步的公开数据，仅含 `time` 和故障模型的 `actual` 值；标量接口的 `actual` 为 number，多路接口为按接口通道顺序排列的完整 number[]（嵌套接口可为嵌套数组）；无效通道值保留位置并写为 null；不含参考值、阈值或状态判定 |

### 3.4 `privateData`

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
  "targetFaultId": "fault-001",
  "dMatrix": {
    "points": [],
    "rows": []
  },
  "displayConsoleControls": [
    {
      "displayConsoleId": "display-console-1",
      "displayConsoleName": "显控台 1",
      "targetComponentId": "rf-source-1",
      "componentType": "rf_four_output_source",
      "parameterKeys": ["center_frequency_hz", "pulse_width_seconds"]
    }
  ],
  "initialRecommendedPath": {
    "steps": [
      {
        "index": 1,
        "action": "measure",
        "actionType": "measurePoint",
        "pointId": "tp-edge-attitude-command-pid-2",
        "pointCode": "V1",
        "target": { "type": "testPoint", "id": "tp-edge-attitude-command-pid-2" }
      }
    ],
    "keySteps": [],
    "summary": "优先检查 V1。"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `executableModel` | 后端可直接编译和运行的完整仿真模型 |
| `executableModel.nodes` | 模型组件与仿真节点 |
| `executableModel.edges` | 模型连接和线缆 |
| `executableModel.faultInstances` | 初始故障实例 |
| `executableModel.measurementPoints` | 后端仿真曲线测量通道定义 |
| `targetFaultId` | 本次实践的真实目标故障，实践过程中属于后端私有答案；没有选择实践故障时为 `null` |
| `targetFaultIds` | 本次实践的真实目标故障集合；单故障时为单元素数组，多故障时保存全部目标故障 |
| `dMatrix` | 故障—测点检测矩阵 |
| `displayConsoleControls` | 显控台到受控组件及允许修改参数的后端白名单 |
| `initialRecommendedPath` | 导出前由后端方案接口生成并标准化的初始最优排故路径；没有选择实践故障时为 `null` |

私有数据与创建请求的映射：

| 导出包字段 | 创建请求字段 |
| --- | --- |
| `privateData.executableModel` | `simulationPackage` |
| `privateData.dMatrix` | `dMatrix` |
| `privateData.targetFaultId` | `targetFaultId` |
| `privateData.targetFaultIds` | `targetFaultIds` |
| `privateData.initialRecommendedPath` | `initialRecommendedPath` |
| `privateData.initialPointStates` | `initialPointStates` |
| `privateData.displayConsoleControls` | `displayConsoleControls` |

三维端在 `targetFaultIds` 为非空数组或 `targetFaultId` 为非空字符串时创建实践任务；未选择实践故障的导出包仍可用于展示仿真结果，但不能直接创建后端实践会话。

## 4. 创建实践任务

### 4.1 接口

```http
POST /api/practice/session
```

### 4.2 请求体

```json
{
  "simulationPackage": {
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
  "initialPointStates": [],
  "dMatrix": {
    "points": [],
    "rows": []
  },
  "targetFaultId": "fault-001",
  "targetFaultIds": ["fault-001"],
  "displayConsoleControls": [],
  "initialRecommendedPath": {
    "steps": [],
    "keySteps": [],
    "summary": ""
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `simulationPackage` | object | 是 | `privateData.executableModel` |
| `dMatrix` | object | 是 | `privateData.dMatrix` |
| `targetFaultId` | string | 单故障兼容字段 | `privateData.targetFaultId`；未提供时后端使用 `targetFaultIds[0]` |
| `targetFaultIds` | array | 是 | `privateData.targetFaultIds`；仅供后端根据 D 矩阵映射出正确的组件、连线 ID 集合并评分。诊断阶段会基于 D 矩阵中的全部故障同时考虑单故障与多故障组合。 |
| `initialRecommendedPath` | object | 否 | `privateData.initialRecommendedPath`；其 `keySteps` 是关键评分步骤，后端会自动据此生成测点与维修动作的关键节点；缺省时后端根据 D 矩阵生成 |
| `initialPointStates` | array | 是 | `privateData.initialPointStates`；后端直接读取各测点的 `observed` 作为初始诊断状态 |
| `displayConsoleControls` | array | 有显控台控制时必填 | `privateData.displayConsoleControls`；用于约束实践动作可修改的组件及参数 |
| `scoringRules` | object | 否 | 可选评分参数，例如 `fullEfficiencySeconds` |
| `lifecycle` | object | 否 | 最大生命周期和空闲超时配置；缺省时分别为 3600 秒和 900 秒 |
| `resourceLimits` | object | 否 | 最大动作数量等资源限制 |
| `actionRules` | object | 否 | 更换动作安全规则，例如是否要求断电 |

创建实践会话时，后端使用 `simulationPackage` 中的组件、连线和测点拓扑，以及 `dMatrix`
中的故障位置、可检测关系和维修目标，重新构建该会话独立持有的知识图谱。客户端不需要提交
预先生成的 `knowledgeGraph`。会话图谱包含 `OUTPUTS_TO`、`INPUTS_TO`、`OBSERVES`、
`DETECTABILITY`、`OCCURS_ON` 和 `RESOLVED_BY_REPLACING` 等关系。

### 4.3 成功响应

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "lifecycle": {
    "state": "active",
    "actionCount": 0,
    "maxActions": 200
  },
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

三维端必须保存 `practiceSessionId`。后续动作和最终提交均使用该 ID。`simulationSessionId` 为后端内部关联的仿真会话 ID。
后端每 30 秒主动扫描过期会话；实践会话过期时会同步删除其关联的仿真会话。新建会话前也会立即执行一次回收，避免过期记录占用容量。

`dMatrix`、`targetFaultId` 和 `initialRecommendedPath` 不在创建响应中返回。

## 5. 提交学生实践动作

### 5.1 接口

```http
POST /api/practice/session/{practiceSessionId}/action
```

### 5.2 公共字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protocolVersion` | string | 否 | 当前为 `1.0` |
| `operationId` | string | 建议必填 | 三维端生成的动作唯一 ID |
| `actionType` | string | 是 | `measurePoint`、`replaceWire`、`replaceComponent` 或 `adjustDisplayConsoleParameter` |
| `target` | object | 是 | 学员操作目标 |
| `target.type` | string | 是 | 分别为 `testPoint`、`wire`、`component` 或 `displayConsole` |
| `target.id` | string | 是 | 后端模型中的测点、线缆或组件 ID |
| `pointCode` | string | 测量必填 | D 矩阵中的虚拟测点编码 |
| `faultId` | string | 否 | 旧客户端兼容字段；更换动作不依赖该字段 |
| `safetyState` | object | 否 | 安全状态，例如 `powerOff` |
| `clientTime` | string | 否 | ISO 8601 客户端动作时间 |
| `rawAction` | object | 否 | 三维端原始交互信息 |

同一实践会话内，后端按 `operationId` 提供幂等保护。相同 `operationId` 和相同动作内容重试时，后端返回首次成功结果且不会重复执行；相同 `operationId` 携带不同动作内容时返回 `409 OPERATION_ID_CONFLICT`。执行失败的动作不会占用该 ID，可以使用原请求重试。

### 5.3 修改显控台受控组件参数并重跑

请求中的参数值使用后端基础单位，与 `executableModel.nodes[].parameters` 保持一致。

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-console-parameter-001",
  "actionType": "adjustDisplayConsoleParameter",
  "target": {
    "type": "displayConsole",
    "id": "display-console-1"
  },
  "componentId": "rf-source-1",
  "parameters": {
    "center_frequency_hz": 250000000,
    "pulse_width_seconds": 0.000002
  },
  "clientTime": "2026-07-16T10:00:00+08:00"
}
```

后端校验 `target.id`、`componentId` 和参数键是否存在于创建实践会话时提交的 `displayConsoleControls` 白名单。校验通过后更新会话内可执行模型参数，清空时间、模块状态及运行时状态，从 `t=0` 完整重跑，并返回：

- `normalizedAction`：标准化后的动作；
- `appliedParameters`：每个参数的旧值、新值、显控台 ID 和受控组件 ID；
- `simulationResult`：重跑后的完整公开测点结果，结构与更换动作响应相同。

也可使用单参数形式：`"parameter": "center_frequency_hz", "value": 250000000`。

### 5.4 测量虚拟测点

物理测点由导出包中的 `initialSimulationResult.physicalMeasurements` 提供。`measurePoint` 仅用于 D 矩阵中 `pointType=virtual` 的虚拟测点。

请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-measure-001",
  "actionType": "measurePoint",
  "target": {
    "type": "testPoint",
    "id": "tp-edge-six-dof-attitude-sensor-1"
  },
  "pointCode": "M7",
  "clientTime": "2026-07-16T10:00:00+08:00"
}
```

当测点没有 `channel` 时，`target.id` 使用测点 `pointId`；`pointCode` 使用测点 `shortName` 或 `pointCode`。

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
    "normalizedAction": {},
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

  测量动作读取当前最新仿真结果，不修改模型，也不会触发从零重跑；响应仅确认已接受的动作，不返回完整 `simulationResult`、测点观测详情或 `troubleshootingState`。

### 5.5 更换线缆

请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-replace-wire-001",
  "actionType": "replaceWire",
  "target": {
    "type": "wire",
    "id": "edge-sim-scope"
  },
  "safetyState": {
    "powerOff": true
  },
  "clientTime": "2026-07-16T10:01:00+08:00"
}
```

### 5.6 更换组件

请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-replace-component-001",
  "actionType": "replaceComponent",
  "target": {
    "type": "component",
    "id": "imu-gyro-001"
  },
  "safetyState": {
    "powerOff": true
  },
  "clientTime": "2026-07-16T10:02:00+08:00"
}
```

### 5.7 更换动作处理规则

- `target.id` 必须对应当前最新模型中存在的线缆或组件。
- 更换动作不要求目标存在故障，也不要求提交 `faultId`。
- 如果目标上存在启用故障，后端自动清除该目标上的全部启用故障。
- 目标没有故障或被重复更换时，动作仍会执行和记录，最终可作为无效或重复操作评分。
- 更换线缆会恢复该连接的连通状态。
- 每次更换后，后端保留最新模型修改，清空时间、模块状态和仿真运行时状态，从时间 `0` 跑完 `simulationConfig` 指定的完整仿真时长。

### 5.8 更换动作成功响应

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "normalizedAction": {},
  "simulationResult": {
    "status": "completed",
    "simulationConfig": {
      "duration": 10,
      "stepSize": 0.1
    },
    "physicalMeasurements": [
      {
        "pointCode": "M1",
        "pointId": "tp-edge-attitude-command-pid-1",
        "pointName": "姿态指令",
        "channel": "edge-attitude-command-pid",
        "sourceDeviceId": "attitude-command",
        "sourcePort": "command",
        "samples": [
          { "time": 0.0, "actual": 0.06 },
          { "time": 0.1, "actual": 0.07 }
        ]
      }
    ],
    "virtualMeasurements": [],
    "summary": {
      "sampleCount": 2,
      "done": true
    }
  },
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

`simulationResult` 与导出包的 `initialSimulationResult` 使用相同结构：按物理、虚拟测点分别返回来源信息和完整的 `{ time, actual }` 时序数据，不返回原始 `curves`、`componentOutputs`、`events` 或 `metrics`。

## 6. 提交最终实践结果

### 6.1 接口

```http
POST /api/practice/session/{practiceSessionId}/submit
```

### 6.2 请求体

```json
{
  "finalTargetIds": ["imu-gyro-001", "edge-imu-controller"],
  "submittedAt": "2026-07-16T10:05:00+08:00"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `finalTargetIds` | array | 是 | 学员最终判定的故障组件和连线 ID 集合；自动去重且不考虑顺序 |
| `submittedAt` | string/number | 否 | 客户端提交时间 |

`finalTargetIds` 中的 ID 必须存在于当前模型的组件或连线中；同一模型内组件 ID 与连线 ID 必须全局唯一。真实 `targetFaultIds` 仅由后端用于生成正确目标集合和评分，客户端不得提交或读取它们。

### 6.3 成功响应

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "evaluationReport": {},
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

提交成功后，后端自动将实践任务标记为已提交，计算评分并移除实践会话及其关联仿真会话。该 `practiceSessionId` 不能再用于动作、查询或重复提交。

## 7. `evaluationReport` 完整评估报告

```json
{
  "totalScore": 85,
  "grade": "良好",
  "targetConclusion": {
    "correct": false,
    "exactMatch": false,
    "expectedTargetIds": ["imu-gyro-001", "edge-imu-controller"],
    "studentTargetIds": ["imu-gyro-001"],
    "setAccuracy": 0.5,
    "precision": 1.0,
    "recall": 0.5,
    "matchedTargetIds": ["imu-gyro-001"],
    "missedTargetIds": ["edge-imu-controller"],
    "extraTargetIds": []
  },
  "scoreDetails": [
    {
      "item": "faultLocalization",
      "label": "故障定位",
      "score": 30,
      "maxScore": 30,
      "deductedPoints": 0
    },
    {
      "item": "diagnosticTreePath",
      "label": "诊断树路径",
      "score": 15,
      "maxScore": 20,
      "deductedPoints": 5
    }
  ],
  "initialOptimalPath": {
    "steps": [],
    "keySteps": [],
    "summary": ""
  },
  "stepEvaluations": [
    {
      "stepIndex": 1,
      "operationId": "op-measure-001",
      "studentAction": {
        "actionType": "measurePoint",
        "target": {
          "type": "testPoint",
          "id": "tp-001"
        },
        "pointCode": "M7"
      },
      "studentRating": {
        "level": "optimal",
        "label": "最优",
        "score": 1.0,
        "reason": "学生动作命中当时的系统推荐动作"
      },
      "systemRecommendedAction": {
        "actionType": "measurePoint",
        "target": {
          "type": "testPoint",
          "id": "tp-001"
        },
        "pointCode": "M7",
        "rank": 1,
        "recommendationTier": "optimal",
        "priority": 90,
        "confidence": 0.9,
        "reason": "virtual point can reduce remaining uncertainty"
      },
      "decisionScore": 1.0,
      "bestAvailableDecisionScore": 1.0,
      "maxDecisionPoints": 15,
      "earnedDecisionPoints": 15,
      "deductedDecisionPoints": 0,
      "deductionReasons": []
    }
  ],
  "keyNodeCoverage": {
    "score": 6,
    "maxScore": 12,
    "coveredNodeIds": ["measure-M7"],
    "missedNodeIds": ["repair-fault-001"],
    "nodes": [
      {
        "nodeId": "measure-M7",
        "type": "measurePoint",
        "pointCode": "M7",
        "score": 6,
        "covered": true,
        "coverageStatus": "covered"
      },
      {
        "nodeId": "repair-fault-001",
        "type": "repairTarget",
        "target": {
          "type": "component",
          "id": "imu-gyro-001"
        },
        "score": 6,
        "covered": false,
        "coverageStatus": "missed"
      }
    ]
  },
  "deductionAnalysis": [
    {
      "item": "diagnosticTreePath",
      "label": "诊断树路径",
      "deductedPoints": 5,
      "reason": "未覆盖关键节点：repair-fault-001",
      "improvementSuggestion": "优先覆盖关键测点和维修目标，减少无效或重复更换。"
    }
  ],
  "improvementSuggestions": [
    "优先覆盖关键测点和维修目标，减少无效或重复更换。"
  ]
}
```

### 7.1 得分明细

| `item` | 中文含义 | 满分 |
| --- | --- | ---: |
| `faultLocalization` | 故障定位 | 30 |
| `diagnosticTreePath` | 诊断树路径 | 20 |
| `informationGain` | 单步决策合理性 | 30 |
| `efficiency` | 排故效率 | 5 |
| `safetyCompliance` | 安全合规 | 15 |

多故障任务的 `faultLocalization` 按集合正确率计分：

```text
setAccuracy = |expectedTargetIds ∩ finalTargetIds| / |expectedTargetIds ∪ finalTargetIds|
faultLocalization = 30 × setAccuracy
```

`exactMatch` 仅在两个定位目标集合完全相同时为 `true`。`precision` 表示学员所选组件、连线中的正确比例，
`recall` 表示真实故障目标被识别出的比例。

### 7.2 学生步骤评级

| `level` | 含义 |
| --- | --- |
| `optimal` | 最优动作 |
| `acceptable` | 合理动作 |
| `lowValue` | 价值较低的动作 |
| `unsafe` | 未满足安全前置条件 |
| `unmatched` | 未匹配当时系统推荐动作集合 |

每个 `stepEvaluations` 元素记录：

- 学员实际执行的动作。
- 学员动作相对当时推荐集合的评级和得分。
- 动作发生前，后端实时计算并排名第一的最佳推荐动作。
- 最佳推荐动作的评级、优先级、置信度和原因。
- 操作前后的候选故障组合、候选数量以及被移除或新增的组合。
- 检测动作的预期信息增益、当前最佳信息增益和实际候选缩减比例。
- 维修动作的候选组合支持率。
- 当前步骤获得与扣除的单步决策分，以及结构化扣分原因和改进建议。

`rank` 只表示推荐集合内部的排序，不直接决定步骤得分。步骤得分由
`recommendationTier` 决定：`optimal`、`acceptable`、`lowValue` 分别对应
1.0、0.7、0.4；不安全或未匹配动作得 0 分。

每次学员操作前，后端都会根据当前证据重新查询会话知识图谱：检测动作依据测点节点、
`OBSERVES` 和 `DETECTABILITY` 关系计算信息增益；更换设备和更换连线依据候选故障组合及
`RESOLVED_BY_REPLACING` 关系生成。操作完成后更新证据并再次生成推荐集合。运行时真实注入
故障不参与操作前推荐和步骤合理性评分，仅用于动作执行后的维修效果与最终答案评估。

`deductionReasons[].code` 使用稳定的机器可读标识，当前包括：

- `LOWER_INFORMATION_GAIN`：所选测点的信息增益低于当前最佳测点。
- `NO_CANDIDATE_REDUCTION`：检测后没有缩小候选故障组合。
- `REPEATED_MEASUREMENT`：重复检测已知测点。
- `UNRECOMMENDED_MEASUREMENT`：测点不在当前知识图谱推荐集合中。
- `LOW_TARGET_SUPPORT`：维修目标只得到部分候选组合支持。
- `PREMATURE_REPAIR`：仍有高价值检测动作时提前维修。
- `WRONG_REPAIR_TARGET`：维修目标不在当前知识图谱维修关系中。
- `SAFETY_PREREQUISITE_MISSING`：未满足安全前置条件。
- `LOW_VALUE_ACTION`、`SUBOPTIMAL_ACTION`、`UNMATCHED_ACTION`：其他低价值、次优或未匹配操作。

### 7.3 关键节点覆盖

`keyNodeCoverage.nodes` 返回全部关键节点，并为每个节点增加：

- `covered`：是否覆盖。
- `coverageStatus`：`covered` 或 `missed`。

多故障任务会为全部启用故障生成维修关键节点；指向同一设备或同一连线的故障合并为一个
维修节点。关键节点分值在 12 分总额内按检测节点与去重后的维修目标动态分配。

### 7.4 扣分分析与改进建议

每个扣分项包含：

- `item`：评分项标识。
- `label`：评分项中文名称。
- `deductedPoints`：扣分值，使用正数表示。
- `reason`：扣分原因。
- `improvementSuggestion`：针对该扣分项的改进建议。

所有 `deductionAnalysis[].deductedPoints` 之和等于：

```text
100 - totalScore
```

`improvementSuggestions` 为全部扣分项建议去重后的汇总。无扣分时，返回保持当前排故策略的建议。

## 8. 数据可见性边界

实践进行期间，三维端只需要展示模型、测量结果、维修结果和公开状态。以下数据属于后端评分私有数据，不应在创建响应或动作响应中返回：

- `targetFaultId`
- `dMatrix`
- `initialRecommendedPath`
- 每一步后端动态推荐动作集合

实践提交完成后，后端可通过 `evaluationReport` 返回目标故障、初始最优路径、逐步推荐与关键节点覆盖结果，用于复盘。

## 9. 常见错误

| `errorCode` | 典型场景 |
| --- | --- |
| `INVALID_SCHEMA` | 创建请求或提交请求字段结构错误 |
| `INVALID_ACTION_SCHEMA` | 动作缺少目标、测点编码或目标类型错误 |
| `UNSUPPORTED_ACTION_TYPE` | 动作不是 `measurePoint`、`replaceWire`、`replaceComponent` 或 `adjustDisplayConsoleParameter` |
| `PARAMETER_NOT_ALLOWED` | 指定参数不在该显控台的控制白名单中 |
| `TARGET_NOT_FOUND` | 组件、线缆或故障目标不存在 |
| `OPERATION_ID_CONFLICT` | 同一实践会话中重复使用 `operationId`，但动作内容与首次请求不同 |
| `SESSION_NOT_FOUND` | 实践任务不存在、已提交或后端已重启 |
| `SESSION_EXPIRED` | 实践任务超过生命周期或空闲超时 |
| `SIMULATION_LIMIT_EXCEEDED` | 动作数、样本数或仿真规模超过限制 |
