# 实践动作协议 v1

本文档定义三维端与故障注入后端在联调阶段使用的学生动作协议。

## 适用范围

联调 v1 只支持两类学生动作：

```text
replaceWire
replaceComponent
```

暂不开放测量、调参、断线、复位等动作。后端内部可能仍保留相关能力，但三维端联调时不得提交这些动作。

## 接口

```text
POST /api/practice/session/{practiceSessionId}/action
Content-Type: application/json
```

后端收到动作后会：

1. 校验并归一化动作协议。
2. 按 `faultId` 定位故障实例。
3. 校验故障实例绑定的 `targetId` 与动作里的 `target.id` 是否一致。
4. 禁用该故障实例。
5. 推进实践仿真会话。
6. 返回归一化动作、动作应用结果和仿真结果。

## 公共字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protocolVersion` | string | 建议必填 | 固定为 `"1.0"`。后端缺省按 `"1.0"` 处理。 |
| `operationId` | string | 建议必填 | 三维端生成的动作 ID，用于过程记录和联调排查。 |
| `actionType` | string | 是 | 只允许 `replaceWire` 或 `replaceComponent`。 |
| `target` | object | 是 | 学生操作的三维对象在后端模型中的映射。 |
| `target.type` | string | 是 | `replaceWire` 必须为 `wire`，`replaceComponent` 必须为 `component`。 |
| `target.id` | string | 是 | 后端模型中的线缆 ID 或部件 ID。 |
| `faultId` | string | 是 | 本次动作要修复的故障实例 ID。 |
| `steps` | integer | 否 | 动作后推进的仿真步数，默认 `1`，范围 `1..1000`。 |
| `clientTime` | string | 否 | 三维端动作发生时间。 |
| `rawAction` | object | 否 | 三维端原始交互信息，例如场景对象 ID、点击位置等。 |

## 更换部件

请求示例：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-001",
  "actionType": "replaceComponent",
  "target": {
    "type": "component",
    "id": "imu-gyro-001"
  },
  "faultId": "fault-gyro-bias-001",
  "steps": 1,
  "clientTime": "2026-06-29T15:30:00+08:00",
  "rawAction": {
    "sceneObjectId": "3d-imu-gyro-001"
  }
}
```

后端处理语义：

```text
按 faultId 找到故障实例
确认 fault.targetId == target.id
将该故障实例 enabled 置为 false
```

## 更换电线

请求示例：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-002",
  "actionType": "replaceWire",
  "target": {
    "type": "wire",
    "id": "wire-001"
  },
  "faultId": "fault-wire-open-001",
  "steps": 1,
  "clientTime": "2026-06-29T15:31:00+08:00",
  "rawAction": {
    "sceneObjectId": "3d-wire-001"
  }
}
```

后端处理语义与更换部件一致：按 `faultId` 清除该电线上的故障实例。

## 成功返回

```json
{
  "status": "success",
  "practiceSessionId": "practice-001",
  "simulationSessionId": "session-001",
  "normalizedAction": {
    "protocolVersion": "1.0",
    "operationId": "op-002",
    "actionType": "replaceWire",
    "target": {
      "type": "wire",
      "id": "wire-001"
    },
    "targetId": "wire-001",
    "faultId": "fault-wire-open-001",
    "steps": 1,
    "rawAction": {
      "sceneObjectId": "3d-wire-001"
    }
  },
  "ruleResult": {
    "allowed": true,
    "ruleCode": "ACTION_ALLOWED",
    "durationSeconds": 90,
    "riskLevel": "low",
    "repeatAction": false,
    "warnings": []
  },
  "appliedAction": {
    "status": "applied",
    "actionType": "replaceWire",
    "changes": [
      {
        "type": "fault_disabled",
        "faultId": "fault-wire-open-001",
        "targetId": "wire-001",
        "previousEnabled": true,
        "newEnabled": false
      }
    ],
    "warnings": []
  },
  "simulationResult": {}
}
```

`simulationResult` 为当前后端已有仿真结果结构，包含曲线、事件、指标和警告。

## 业务规则结果

`ruleResult` 表示后端对学生动作的业务判断。联调阶段支持：

- `ACTION_ALLOWED`：允许执行，后端会修复故障。
- `REPEAT_REPAIR`：重复更换，HTTP 200 返回，动作会被记录，但不会再次修改模型。

`durationSeconds`、`riskLevel`、`repeatAction` 只记录业务语义，当前版本不参与评分。

## 错误返回

### 不支持的动作

提交 `measure`、`adjustParameter` 等非联调动作时返回：

```json
{
  "status": "error",
  "errorCode": "UNSUPPORTED_ACTION_TYPE",
  "field": "actionType",
  "message": "unsupported action type: measure"
}
```

### 缺少 faultId

```json
{
  "status": "error",
  "errorCode": "INVALID_ACTION_SCHEMA",
  "field": "faultId",
  "message": "faultId is required"
}
```

### 目标与故障不匹配

当 `faultId` 对应的故障实例不属于 `target.id` 时返回：

```json
{
  "status": "error",
  "errorCode": "TARGET_MISMATCH",
  "field": "target.id",
  "message": "faultId fault-gyro-bias-001 does not match target imu-accel-001"
}
```

## 三维端联调要求

- 三维端必须维护三维对象到后端 `target.id` 的映射。
- 三维端必须能拿到当前任务中故障实例的 `faultId`。
- 一个部件或一根电线在当前联调阶段只绑定一个故障。
- 三维端每次学生更换对象时提交一次 `/action`。
- 三维端不得把测量、点击查看、展开面板等非更换行为提交为学生动作。
