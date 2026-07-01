# 故障注入后端服务接口说明

本文档描述当前 `backend.server` 暴露的 HTTP 接口，面向前端、三维训练端和联调脚本使用。

## 基础信息

启动服务：

```powershell
uv run python -m backend.server
```

默认地址：

```text
http://127.0.0.1:8766
```

公共约定：

- 请求和响应均为 JSON。
- POST 请求必须带请求体，且顶层必须是 JSON object。
- 请求头使用 `Content-Type: application/json`。
- 服务端为每次请求生成 `runId`，成功和失败响应都会尽量返回该字段。
- 单次请求体大小上限为 `1_000_000` 字节。

## 公共错误响应

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "error",
  "errorCode": "INVALID_SCHEMA",
  "field": "simulationConfig.duration",
  "message": "duration is outside the allowed range"
}
```

常见错误码：

| errorCode | HTTP | 说明 |
| --- | ---: | --- |
| `INVALID_SCHEMA` | 400 | 请求结构、字段类型或必填字段不符合要求 |
| `SIMULATION_LIMIT_EXCEEDED` | 400 | 超过仿真时长、步数、会话数、请求体大小等限制 |
| `UNSUPPORTED_NODE_TYPE` | 400 | 模型包中存在后端不支持的节点类型 |
| `MODULE_NOT_WHITELISTED` | 400 | `pythonBinding.moduleId` 未在后端内置模块白名单中 |
| `MODULE_SIGNATURE_MISMATCH` | 400 | 后端模块入口或返回结构不符合约定 |
| `TARGET_NOT_FOUND` | 400 | 维修目标、组件、线路或故障实例不存在 |
| `UNSUPPORTED_ACTION_TYPE` | 400 | 练习动作类型不支持 |
| `INVALID_ACTION_SCHEMA` | 400 | 练习动作字段不符合协议 |
| `SESSION_NOT_FOUND` | 404 | 仿真会话或练习会话不存在 |
| `SESSION_EXPIRED` | 410 | 练习会话已过期 |
| `NOT_FOUND` | 404 | 路由不存在 |
| `INTERNAL_ERROR` | 500 | 未捕获的服务端异常 |

## 可执行模型包

以下接口中提到的 `simulationPackage` 或直接提交的模型包，均使用同一结构：

```json
{
  "schemaVersion": 1,
  "packageId": "demo-package",
  "simulationConfig": {
    "duration": 1.0,
    "stepSize": 0.01
  },
  "nodes": [],
  "edges": [],
  "faultInstances": [],
  "measurementPoints": []
}
```

主要限制：

| 字段 | 限制 |
| --- | --- |
| `schemaVersion` | 必须为 `1` |
| `simulationConfig.duration` | `0 < duration <= 1000.0` |
| `simulationConfig.stepSize` | `0.001 <= stepSize <= 1.0` |
| 样本数 | `ceil(duration / stepSize) <= 100000` |
| `nodes` | 最多 200 个 |
| `edges` | 最多 400 条 |
| `faultInstances` | 最多 50 个 |
| `measurementPoints` | 最多 100 个 |

支持的节点类型：

```text
signal_source
flow_block
simulation_block
gain_block
sum_block
mux_block
instrument_scope
```

## 仿真接口

### 一次性运行仿真

```text
POST /api/simulations/run
```

请求体：可执行模型包。

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "curves": {
    "time": [0.0, 0.01],
    "channels": {}
  },
  "componentOutputs": {
    "time": [0.0, 0.01],
    "steps": []
  },
  "events": [],
  "metrics": {
    "sampleCount": 2,
    "stepIndex": 2,
    "time": 0.01,
    "done": true,
    "elapsedMs": 1.23
  },
  "warnings": []
}
```

### 创建步进仿真会话

```text
POST /api/simulations/session
```

请求体：可执行模型包。

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "sessionId": "session-xxxxxxxxxxxx",
  "status": "success",
  "metrics": {
    "sampleCount": 0,
    "stepIndex": 0,
    "time": 0.0,
    "done": false,
    "elapsedMs": 1.23
  },
  "warnings": []
}
```

### 推进仿真会话

```text
POST /api/simulations/session/{sessionId}/step
```

请求体：

```json
{
  "steps": 1
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `steps` | integer | 否 | 推进步数，默认 `1`，范围 `1..1000`，且不能超过服务端响应样本上限 |

成功响应结构与一次性运行仿真一致，并额外包含 `sessionId`。

### 删除仿真会话

```text
DELETE /api/simulations/session/{sessionId}
```

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "sessionId": "session-xxxxxxxxxxxx",
  "status": "success"
}
```

## 练习/排故接口

### 创建练习会话

```text
POST /api/practice/session
```

请求体：

```json
{
  "simulationPackage": {},
  "dMatrix": {},
  "targetFaultId": "fault-001",
  "scoringRules": {
    "fullEfficiencySeconds": 600
  },
  "lifecycle": {
    "maxLifetimeSeconds": 3600,
    "idleTimeoutSeconds": 900
  },
  "resourceLimits": {
    "maxActions": 200
  },
  "actionRules": {}
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `simulationPackage` | object | 是 | 可执行模型包 |
| `dMatrix` | object | 是 | 排故 D 矩阵，包含测点和故障行 |
| `targetFaultId` | string | 是 | 当前训练任务的真实故障 ID，必须存在于 `dMatrix.rows` |
| `scoringRules.fullEfficiencySeconds` | number | 否 | 效率满分阈值，默认 600 秒 |
| `lifecycle.maxLifetimeSeconds` | number | 否 | 练习会话最大生命周期 |
| `lifecycle.idleTimeoutSeconds` | number | 否 | 练习会话空闲超时时间 |
| `resourceLimits.maxActions` | integer | 否 | 最大动作数，默认由服务端配置决定 |
| `actionRules` | object | 否 | 维修动作业务规则，例如是否要求断电 |

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "physicalMeasurementSnapshot": {
    "source": "backend",
    "points": [],
    "abnormalPointCodes": [],
    "normalPointCodes": [],
    "unknownPointCodes": []
  },
  "troubleshootingState": {
    "physicalMeasurementSnapshot": {},
    "virtualMeasurements": [],
    "repairAttempts": [],
    "faultCandidates": [],
    "status": "inProgress"
  },
  "lifecycle": {
    "state": "active",
    "createdAt": 0.0,
    "lastActivityAt": 0.0,
    "submittedAt": null,
    "endedAt": null,
    "durationSeconds": 0.0,
    "idleSeconds": 0.0,
    "actionCount": 0,
    "maxLifetimeSeconds": 3600,
    "idleTimeoutSeconds": 900,
    "maxActions": 200
  },
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

说明：

- 创建会话时会返回初始物理测点快照。
- 评分用的 `faultTreeKeyNodes` 不在创建响应中返回，只在提交后随 `record.pathEvaluation` 返回。

### 提交练习动作

```text
POST /api/practice/session/{practiceSessionId}/action
```

公共请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protocolVersion` | string | 否 | 建议传 `"1.0"` |
| `operationId` | string | 否 | 前端生成的动作 ID，用于链路追踪 |
| `actionType` | string | 是 | `measurePoint`、`replaceComponent` 或 `replaceWire` |
| `target` | object | 是 | 操作目标 |
| `target.type` | string | 是 | `measurePoint` 为 `testPoint`，`replaceComponent` 为 `component`，`replaceWire` 为 `wire` |
| `target.id` | string | 是 | 后端模型中的测点通道、组件 ID 或线路 ID |
| `faultId` | string | 更换动作必填 | 要修复的故障实例 ID |
| `pointCode` | string | 测量动作必填 | D 矩阵测点编码，仅允许虚拟测点 |
| `steps` | integer | 否 | 维修动作后推进仿真步数，默认 `1`；`measurePoint` 不推进仿真，后端会忽略该字段 |
| `safetyState` | object | 否 | 安全状态，例如 `{ "powerOff": true }` |
| `clientTime` | string | 否 | 客户端动作时间 |
| `rawAction` | object | 否 | 三维端原始交互信息 |

测量虚拟测点请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-measure-001",
  "actionType": "measurePoint",
  "target": {
    "type": "testPoint",
    "id": "scope-1.ch1"
  },
  "pointCode": "V1",
  "steps": 1
}
```

测量成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "normalizedAction": {},
  "virtualMeasurement": {
    "pointCode": "V1",
    "pointId": "tp-virtual",
    "pointType": "virtual",
    "channel": "scope-1.ch1",
    "observed": "normal",
    "actualValue": 1.0,
    "referenceValue": 1.0,
    "metricValue": 0.0,
    "reason": "metric-below-normal-threshold"
  },
  "troubleshootingState": {},
  "simulationResult": {},
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

更换组件请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-repair-component-001",
  "actionType": "replaceComponent",
  "target": {
    "type": "component",
    "id": "imu-gyro-001"
  },
  "faultId": "fault-gyro-bias-001",
  "safetyState": {
    "powerOff": true
  },
  "steps": 1
}
```

更换线路请求：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-repair-wire-001",
  "actionType": "replaceWire",
  "target": {
    "type": "wire",
    "id": "edge-sim-scope"
  },
  "faultId": "fault-wire-001",
  "steps": 1
}
```

维修动作成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "normalizedAction": {},
  "ruleResult": {
    "allowed": true,
    "ruleCode": "ACTION_ALLOWED",
    "durationSeconds": 90,
    "riskLevel": "low",
    "repeatAction": false,
    "safetyViolation": false,
    "warnings": []
  },
  "appliedAction": {
    "status": "applied",
    "actionType": "replaceWire",
    "changes": []
  },
  "repairEffect": {
    "effective": true,
    "status": "recovered",
    "recoveredPointCodes": [],
    "newAbnormalPointCodes": [],
    "remainingAbnormalPointCodes": [],
    "unchangedAbnormalPointCodes": []
  },
  "physicalMeasurementSnapshot": {},
  "troubleshootingState": {},
  "simulationResult": {},
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

动作说明：

- `measurePoint` 只能测量 D 矩阵中的虚拟测点；物理测点由创建会话和维修动作后的 `physicalMeasurementSnapshot` 返回。
- `measurePoint` 不会调用仿真步进，也不会改变绑定仿真会话的 `stepIndex`；返回的 `virtualMeasurement` 基于当前最新仿真结果计算。
- `replaceComponent` 和 `replaceWire` 会根据 `faultId` 和 `target.id` 校验真实故障实例绑定。
- 重复维修会被记录，但后端不会重复修改模型状态。
- 若动作命中安全前置条件但未满足，例如维修前要求断电，`ruleResult.safetyViolation` 会为 `true`，安全合规评分会扣分。

### 查询练习状态

```text
GET /api/practice/session/{practiceSessionId}/status
```

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "targetFaultId": "fault-001",
  "lifecycle": {},
  "troubleshootingState": {},
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

### 提交练习并评分

```text
POST /api/practice/session/{practiceSessionId}/submit
```

请求体：

```json
{
  "finalFaultName": "IMU 偏差",
  "submittedAt": 1710000000.0
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `finalFaultName` | string | 是 | 学员最终判断的故障名称，例如 `IMU 偏差` |
| `faultName` | string | 否 | `finalFaultName` 的兼容别名 |
| `finalFaultId` | string | 否 | 旧版兼容字段；后端仍可按 ID 判断，但学生端应提交名称 |
| `faultId` | string | 否 | `finalFaultId` 的兼容别名 |
| `submittedAt` | number/string | 否 | 客户端提交时间，服务端只记录到结果中 |

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "score": 100,
  "grade": "优秀",
  "scoreBreakdown": {
    "faultLocalization": 30,
    "diagnosticTreePath": 30,
    "informationGain": 20,
    "efficiency": 5,
    "safetyCompliance": 15
  },
  "deductions": [],
  "initialRecommendedPath": {},
  "record": {
    "sessionId": "practice-xxxxxxxxxxxx",
    "simulationSessionId": "session-xxxxxxxxxxxx",
    "targetFaultId": "fault-001",
    "targetFaultName": "IMU 偏差",
    "finalFaultId": "fault-001",
    "finalFaultName": "IMU 偏差",
    "correct": true,
    "durationSeconds": 120.0,
    "studentActions": [],
    "simulationActionHistory": [],
    "initialPhysicalMeasurementSnapshot": {},
    "physicalMeasurementSnapshots": [],
    "virtualMeasurements": [],
    "repairAttempts": [],
    "troubleshootingState": {},
    "actualTroubleshootingPath": {},
    "pathEvaluation": {},
    "recommendedPathHistory": [],
    "dynamicReferenceHistory": []
  },
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

提交后练习会话和其绑定的仿真会话会被服务端移除，不能继续动作或查询。

#### 当前评分结构

总分 100 分：

| 字段 | 分值 | 计算方式 |
| --- | ---: | --- |
| `faultLocalization` | 30 | `finalFaultName` 匹配目标故障名称给 30 分，否则 0 分；旧版 `finalFaultId` 仍兼容 |
| `diagnosticTreePath` | 30 | 来自 `record.pathEvaluation.diagnosticTreePathScore` |
| `informationGain` | 20 | 来自 `record.pathEvaluation.informationGainScore`，当前含义为单步决策合理性 |
| `efficiency` | 5 | 提交耗时不超过 `fullEfficiencySeconds` 给 5 分，否则 2.5 分 |
| `safetyCompliance` | 15 | 初始 15 分，每个 `safetyViolation` 扣 5 分，最低 0 分 |

`diagnosticTreePath` 拆分：

| 字段 | 分值 | 说明 |
| --- | ---: | --- |
| `keyNodeCoverage` | 12 | 关键节点覆盖，当前关键节点为虚拟测点节点 6 分、维修目标节点 6 分 |
| `sequenceReasonability` | 10 | 根据是否先采证后维修、动态参考匹配比例、非 unmatched 比例计算 |
| `pathEfficiency` | 8 | 无效维修、重复维修、unmatched 动作会扣分 |

`pathEvaluation` 关键字段：

```json
{
  "totalStepCount": 2,
  "measuredVirtualPointCount": 1,
  "componentRepairAttemptCount": 0,
  "wireRepairAttemptCount": 1,
  "repairAttemptCount": 1,
  "effectiveRepairCount": 1,
  "ineffectiveRepairCount": 0,
  "safetyViolationCount": 0,
  "faultTreeKeyNodes": [
    {
      "nodeId": "measure-V1",
      "type": "measurePoint",
      "pointCode": "V1",
      "score": 6
    },
    {
      "nodeId": "repair-fault-001",
      "type": "repairTarget",
      "target": {
        "type": "wire",
        "id": "edge-sim-scope"
      },
      "faultId": "fault-001",
      "score": 6
    }
  ],
  "keyNodeCoverage": {
    "score": 12,
    "maxScore": 12,
    "coveredNodeIds": ["measure-V1", "repair-fault-001"],
    "missedNodeIds": []
  },
  "diagnosticTreePathBreakdown": {
    "keyNodeCoverage": 12,
    "sequenceReasonability": 10,
    "pathEfficiency": 8
  },
  "diagnosticTreePathScore": 30,
  "informationGain": {
    "metric": "singleStepDecisionReasonability",
    "score": 20,
    "maxScore": 20,
    "stepCount": 2,
    "averageDecisionScore": 1.0,
    "stepScores": []
  },
  "informationGainScore": 20,
  "routeQualityBreakdown": {},
  "routeQualityScore": 50
}
```

说明：

- `faultTreeKeyNodes` 在任务初始化时生成，创建会话和动作响应不返回，只在提交后的 `record.pathEvaluation` 中返回。
- `informationGainScore` 字段名为兼容保留，当前业务含义已经调整为“单步决策合理性”。
- `routeQualityScore` 和 `routeQualityBreakdown` 仍保留用于兼容和分析，不再作为总分中的独立权重项。

### 删除练习会话

```text
DELETE /api/practice/session/{practiceSessionId}
```

成功响应：

```json
{
  "runId": "run-xxxxxxxxxxxx",
  "status": "success",
  "sessionId": "practice-xxxxxxxxxxxx",
  "practiceSessionId": "practice-xxxxxxxxxxxx",
  "simulationSessionId": "session-xxxxxxxxxxxx",
  "lifecycle": {
    "state": "abandoned"
  },
  "metrics": {
    "elapsedMs": 1.23
  }
}
```

删除练习会话时，绑定的仿真会话也会一并删除。

## 接口清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/simulations/run` | 一次性运行完整仿真 |
| POST | `/api/simulations/session` | 创建步进仿真会话 |
| POST | `/api/simulations/session/{sessionId}/step` | 推进步进仿真会话 |
| DELETE | `/api/simulations/session/{sessionId}` | 删除步进仿真会话 |
| POST | `/api/practice/session` | 创建练习会话 |
| POST | `/api/practice/session/{practiceSessionId}/action` | 提交练习动作 |
| GET | `/api/practice/session/{practiceSessionId}/status` | 查询练习状态 |
| POST | `/api/practice/session/{practiceSessionId}/submit` | 提交练习并评分 |
| DELETE | `/api/practice/session/{practiceSessionId}` | 删除练习会话 |
