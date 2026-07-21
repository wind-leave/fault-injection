# 实践动作协议 v1

本文档定义三维端与故障注入后端在联调阶段使用的学生动作协议。

## 适用范围

联调 v1 支持三类学生动作：

```text
replaceWire
replaceComponent
measurePoint
```

暂不开放调参、断线、复位等动作。后端内部可能仍保留相关能力，但三维端联调时不得提交这些动作。

## 接口

```text
POST /api/practice/session/{practiceSessionId}/action
Content-Type: application/json
```

后端收到动作后会：

1. 校验并归一化动作协议。
2. 按 `target.id` 定位组件、线缆或虚拟测点。
3. 更换组件或线缆时，自动禁用该目标上的全部启用故障；目标没有故障也允许更换。
4. 更换后保留最新模型修改，清空运行状态并从时间 `0` 跑完整仿真。
5. 测量动作读取当前最新仿真结果，不修改模型。
6. 返回归一化动作、动作应用结果和仿真结果。

## 公共字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protocolVersion` | string | 建议必填 | 固定为 `"1.0"`。后端缺省按 `"1.0"` 处理。 |
| `operationId` | string | 建议必填 | 三维端生成的动作 ID，用于过程记录和联调排查。 |
| `actionType` | string | 是 | 只允许 `replaceWire`、`replaceComponent` 或 `measurePoint`。 |
| `target` | object | 是 | 学生操作的三维对象在后端模型中的映射。 |
| `target.type` | string | 是 | `replaceWire` 必须为 `wire`，`replaceComponent` 必须为 `component`，`measurePoint` 必须为 `testPoint`。 |
| `target.id` | string | 是 | 后端模型中的线缆 ID、部件 ID 或测点通道基名。 |
| `faultId` | string | 否 | 旧客户端兼容字段。更换动作以后端 `target.id` 为准，不依赖该字段。 |
| `pointCode` | string | 检测测点必填 | D 矩阵测点编号，例如 `M1`。 |
| `steps` | integer | 否 | 兼容字段，不控制测量或更换动作的仿真步数。 |
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
  "clientTime": "2026-06-29T15:30:00+08:00",
  "rawAction": {
    "sceneObjectId": "3d-imu-gyro-001"
  }
}
```

后端处理语义：

```text
确认 target.id 对应的组件存在
清除该组件上的全部启用故障；没有故障时仍记录更换
基于更换后的最新模型从时间 0 跑完整仿真
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
  "clientTime": "2026-06-29T15:31:00+08:00",
  "rawAction": {
    "sceneObjectId": "3d-wire-001"
  }
}
```

后端处理语义与更换部件一致：按 `target.id` 更换线缆，清除该线缆上的全部启用故障并从时间 `0` 跑完整仿真。线缆没有故障时也允许更换。

## 检测测点

请求示例：

```json
{
  "protocolVersion": "1.0",
  "operationId": "op-measure-virtual-001",
  "actionType": "measurePoint",
  "target": {
    "type": "testPoint",
    "id": "scope-2.ch1"
  },
  "pointCode": "V1",
  "steps": 1,
  "clientTime": "2026-06-29T16:20:00+08:00",
  "rawAction": {}
}
```

`measurePoint` 只用于虚拟测点。物理测点由显控台统一展示，其完整时序由导出包或维修响应中的 `simulationResult.physicalMeasurements` 提供；三维端不需要提交 `observed`。后端会根据仿真曲线和测点规则生成虚拟测点观测结果。

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
    "steps": 1,
    "rawAction": {
      "sceneObjectId": "3d-wire-001"
    }
  },
  "simulationResult": {}
}
```

`simulationResult` 与导出包的 `initialSimulationResult` 使用相同结构，包含 `status`、`simulationConfig`、`physicalMeasurements`、`virtualMeasurements` 和 `summary`。每个测点仅返回来源设备、来源端口及从时间 `0` 开始的 `{ time, actual }` 时序数据；不返回原始曲线、组件输出、事件、指标或参考值。

`measurePoint` 成功返回时仅确认已接受的动作，不返回 `virtualMeasurement`、`troubleshootingState`、`ruleResult` 或 `appliedAction`。

## 安全前置条件

后端只检查配置的安全前置条件，例如更换前是否已断电。即使条件未满足，更换动作仍会执行；后端仅在内部记录安全违规，并在最终的安全合规评分中扣分。该内部判定不在动作响应中返回。

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

### 更换目标不存在

```json
{
  "status": "error",
  "errorCode": "TARGET_NOT_FOUND",
  "field": "target.id",
  "message": "component not found: missing-component"
}
```

## 三维端联调要求

- 三维端必须维护三维对象到后端 `target.id` 的映射。
- 三维端每次学生更换对象时提交一次 `/action`。
- 学生使用仪器测量虚拟测点时，三维端提交 `measurePoint`；物理测点由显控台快照展示，不通过 `measurePoint` 提交。
- 三维端不得把点击查看、展开面板等非动作行为提交为学生动作。
