# 实践后端服务后续完善说明

## 目标

本文档用于说明三维实践训练后端服务在当前版本基础上仍需进一步完整的部分。当前后端已经具备仿真、实践会话、学生动作影响仿真状态、排故路径记录和提交评分的基础能力，但要支撑正式训练、评分追溯和平台长期运行，还需要补齐动作协议、评分规则、记录持久化、回放、生命周期和接口文档等模块。

## 当前已有能力

### 仿真接口

当前保留了原有仿真后端接口：

```text
POST /api/simulations/run
POST /api/simulations/session
POST /api/simulations/session/{id}/step
```

其中 `/api/simulations/run` 用于一次性仿真，适合故障注入平台预览和保存仿真结果；`/api/simulations/session` 和 `/api/simulations/session/{id}/step` 用于创建和推进普通仿真会话。

### 实践接口

当前新增了实践后端接口：

```text
POST /api/practice/session
POST /api/practice/session/{id}/action
POST /api/practice/session/{id}/submit
```

实践会话会保存一个独立的 `SimulationSession`。学生每次提交动作时，后端会先把动作作用到当前仿真状态，再推进仿真步进，并返回新的仿真结果。学生提交最终判断后，后端返回本次实践得分、初始最佳排故路径和过程记录，并主动结束本次 practice session 及其绑定的 simulation session。

### 已支持的实践动作

当前支持的动作类型包括：

```text
adjustParameter
replaceComponent
repairComponent
disconnectLine
reconnectLine
resetDevice
measure
```

这些动作已经不是简单记录。除 `measure` 外，动作会修改当前实践会话中的仿真状态。例如：

- `adjustParameter` 会修改目标节点运行时参数。
- `replaceComponent` / `repairComponent` 会禁用目标部件或目标故障上的故障实例。
- `disconnectLine` 会让目标线路输出为 `0`。
- `reconnectLine` 会恢复目标线路。
- `resetDevice` 会清空目标节点模块状态和相关历史值。

这些修改保留在同一个实践仿真会话中，学生下一步操作会基于已经修改过的仿真模型继续执行。

### 已支持的评分和记录

当前提交结果包含：

- 最终故障判断得分。
- 排故路线质量得分。
- 效率得分。
- 安全文明操作得分。
- 初始最佳排故路径。
- 学生动作记录。
- 实际排故路径。
- 推荐排故路径历史。
- 仿真动作应用历史。

## 仍需进一步完整的部分

### 1. 学生动作协议标准化  解决

当前后端已经支持若干动作类型，但三维端和后端之间还需要形成固定协议，避免字段不统一导致动作无法正确作用到模型。

建议为每类动作明确标准字段：

```json
{
  "operationId": "op-001",
  "actionType": "adjustParameter",
  "targetId": "source-1",
  "parameter": "value",
  "value": 2.0,
  "observed": "unknown",
  "steps": 1
}
```

需要进一步明确：

- `operationId` 是否由三维生成，还是后端兜底生成。
- `targetId` 对应三维中的部件、线路、节点还是故障实例。
- `faultId` 与 `targetId` 同时存在时的优先级。
- `observed` 是否由学生填写，还是由后端根据仿真结果自动判断。
- `steps` 的默认值、最大值和是否允许三维指定。
- 每类动作是否允许携带 `rawAction` 用于保存三维原始交互信息。

建议输出一份独立的《实践动作协议》文档，作为三维端和后端联调依据。

### 2. 动作到仿真模型的业务规则细化  解决

当前动作应用规则是通用规则，能支撑基础闭环，但正式实践需要更精细的业务语义。

需要补齐的规则包括：

- 更换错误部件时是否无效，是否扣分。
- 更换正确部件后是否一定清除故障，还是需要满足前置条件。
- 断开错误线路是否会引入新的异常状态。
- 调整参数是否需要范围校验，范围来自模型参数、组件定义还是任务配置。
- 复位设备是否需要断电前置条件。
- 重复更换、重复复位、重复测量是否扣效率分或路线分。
- 某些动作是否有耗时，例如更换部件耗时大于测量动作。
- 某些动作是否有安全风险，例如带电拆线。

建议将动作规则从代码中的通用逻辑扩展为任务可配置规则。例如任务配置中定义：

```json
{
  "allowedActions": ["measure", "replaceComponent", "resetDevice"],
  "actionRules": {
    "replaceComponent": {
      "requiresPowerOff": true,
      "durationSeconds": 120,
      "wrongTargetPenalty": 5
    }
  }
}
```

### 3. 观测结果自动判定  

当前排故路径更新主要依赖三维提交的 `observed` 字段。正式实践中，后端最好能够根据仿真结果和测点规则自动判断该测点是正常、异常还是不确定。

需要补齐：

- 测点正常阈值和异常阈值。
- 不同测点的判断方式，例如数值范围、趋势变化、残差、频谱特征。
- 多通道测点的组合判断。
- 学生测量点位和后端仿真通道之间的映射。
- 当学生填写的观测结果与后端计算结果不一致时如何处理。

建议 D 矩阵或任务配置中增加测点判定规则：

```json
{
  "pointCode": "M1",
  "channel": "scope-1.ch1.actual",
  "normalRange": [0.9, 1.1],
  "abnormalWhen": "outsideRange"
}
```

这样后端可以根据仿真返回曲线自动生成 `observed`，减少三维端和学生主观输入带来的不一致。

### 4. 推荐排故路径算法增强

当前排故路径主要基于 D 矩阵中的可检测关系和剩余候选故障动态更新。后续需要让路径质量评价更加贴近真实排故过程。

建议增强：

- 支持测点检查顺序相似度，而不只是是否命中当前推荐点。
- 支持跳过关键测点的扣分。
- 支持检查无关测点的扣分。
- 支持错误观测导致候选故障误收敛的记录。
- 支持故障层级，例如物理层、电气层、协议层优先级。
- 支持成本模型，例如高风险、高耗时、高拆装成本动作后置。
- 支持多个等价最优路径，而不是唯一标准路径。

最终推荐路径不应只回答“下一步查什么”，还应能用于解释“为什么这一步更优”。

### 5. 评分规则配置化

当前评分已经包含故障判断、路线质量、效率和安全文明操作，但分值和扣分逻辑还需要任务化配置。

建议形成标准评分配置：

```json
{
  "scoreRules": {
    "faultDetection": 40,
    "routeQuality": 40,
    "efficiency": 10,
    "safety": 10,
    "deductions": {
      "wrongRepairAction": 5,
      "unnecessaryOperation": 2,
      "safetyViolation": 5
    }
  }
}
```

需要进一步明确：

- 最终判断正确但过程错误时的得分上限。
- 最终判断错误但过程合理时是否给过程分。
- 安全违规是否可导致一票否决。
- 超时如何扣分。
- 重复操作如何扣分。
- 是否支持教师手动复核和调整分数。

### 6. 实践记录持久化  暂时不需要

当前 practice session 存在内存中，提交后返回结果并结束 session。正式平台需要将结果持久化到数据库或文件存储，否则服务重启或提交后无法追溯。

需要持久化的数据包括：

- practice session 基本信息。
- 学生、任务、班级、设备或三维场景标识。
- 初始 simulation package。
- 初始 D 矩阵。
- 目标故障。
- 初始最佳排故路径。
- 学生动作序列。
- 每次动作后的仿真动作应用结果。
- 每次动作后的仿真摘要或关键曲线。
- 推荐排故路径历史。
- 实际排故路径。
- 最终提交答案。
- 得分明细和扣分原因。
- 模型版本、D 矩阵版本、评分规则版本。

建议后续新增 `PracticeRecordRepository`，先支持本地 JSON 文件或 SQLite，再根据平台需要切换到正式数据库。

### 7. 实践过程回放  暂时不需要

正式训练通常需要教师复盘学生操作。当前记录已经有基础数据，但完整回放还需要保证：

```text
初始模型 + D 矩阵 + 任务配置 + 学生动作序列
=> 可重新生成同样的仿真过程和评分结果
```

需要进一步补齐：

- 所有动作应用结果可序列化。
- 仿真引擎确定性运行。
- 记录每次动作前后的关键状态摘要。
- 记录每次动作返回给三维的仿真结果摘要。
- 支持按步骤查询实践记录。
- 支持教师查看某一步的推荐路径、学生实际操作和仿真变化。

如果曲线数据较大，可以保存摘要和关键通道，完整曲线单独归档。

### 8. 会话生命周期管理  解决

当前 submit 后会主动结束 practice session。但还需要处理未提交、中断、超时等情况。

建议补齐：

- practice session 最大存活时间。
- 长时间无操作自动过期。
- 学生主动放弃任务接口。
- 教师或系统强制结束接口。
- 过期 session 的记录策略。
- 内存 session 数量上限。
- 并发学生数量限制。
- 同一学生同一任务是否允许重复开始。

建议未来增加：

```text
DELETE /api/practice/session/{id}
GET /api/practice/session/{id}/status
```

是否需要这两个接口取决于三维端和教学平台的集成方式。

### 9. 接口文档和错误码完整化

当前接口已经可用，但需要整理正式接口文档。至少应覆盖：

```text
POST /api/simulations/run
POST /api/simulations/session
POST /api/simulations/session/{id}/step
POST /api/practice/session
POST /api/practice/session/{id}/action
POST /api/practice/session/{id}/submit
```

每个接口需要说明：

- 请求字段。
- 返回字段。
- 必填字段。
- 默认值。
- 错误码。
- 示例请求和示例返回。
- 与三维端交互时的调用时机。

错误码也需要进一步规范，例如：

```text
INVALID_SCHEMA
SESSION_NOT_FOUND
TARGET_NOT_FOUND
MODULE_NOT_WHITELISTED
SIMULATION_LIMIT_EXCEEDED
ACTION_NOT_ALLOWED
PRACTICE_ALREADY_SUBMITTED
PRACTICE_EXPIRED
```

### 10. 任务配置和版本管理  暂时不需要

实践任务不应只依赖接口临时传入的数据。后续需要形成任务配置实体。

建议一个实践任务至少包含：

- 任务 ID。
- 任务名称。
- 三维场景 ID。
- simulation package 版本。
- D 矩阵版本。
- 目标故障 ID。
- 标准排故路径。
- 允许动作列表。
- 评分规则。
- 安全规则。
- 时间限制。
- 教师说明和学生说明。

这样可以保证不同学生执行的是同一版本任务，提交记录也能追溯到当时使用的模型和规则。

### 11. 安全与资源限制 解决

后端已经对仿真包有基础限制，但实践训练还需要补齐运行时保护：

- 单次 action 最大步数。
- 单个 session 最大动作数。
- 单个 session 最大仿真时长。
- 单个学生并发 session 数。
- 请求体大小限制。
- 曲线返回大小限制。
- 服务端日志脱敏。
- 禁止执行前端提交的任意 Python 代码。
- 后端模块白名单继续保留。

对三维实践来说，尤其需要避免学生或前端异常循环提交 action 导致后端内存和 CPU 被占满。

## 建议实施优先级

### 第一阶段：联调必需

第一阶段目标是保证三维端和后端稳定联调。

建议优先完成：

- 实践动作协议标准化。
- 每类动作的字段示例。
- 接口文档。
- 评分返回结构固定。
- 错误码固定。
- 三维测点与后端仿真通道映射。

### 第二阶段：评分可信

第二阶段目标是让评分结果能用于教学评价。

建议完成：

- 评分规则配置化。
- 路线质量算法增强。
- 错误维修动作扣分。
- 安全文明操作规则。
- 观测结果自动判定。
- 任务级时间限制。

### 第三阶段：正式运行

第三阶段目标是支撑正式课程和教师复盘。

建议完成：

- 实践记录持久化。
- 实践过程回放。
- 任务配置和版本管理。
- session 超时清理。
- 教师查看和导出结果。
- 后端运行监控和日志。

## 建议的数据结构

### PracticeSessionRecord

```json
{
  "practiceSessionId": "practice-001",
  "studentId": "student-001",
  "taskId": "task-001",
  "simulationSessionId": "session-001",
  "targetFaultId": "fault-001",
  "startedAt": 0,
  "submittedAt": 0,
  "status": "submitted"
}
```

### PracticeActionRecord

```json
{
  "operationId": "op-001",
  "stepIndex": 1,
  "actionType": "measure",
  "targetId": "point-M1",
  "pointCode": "M1",
  "observed": "abnormal",
  "simulationActionResult": {},
  "simulationSummary": {},
  "recordedAt": 0
}
```

### PracticeScoreRecord

```json
{
  "score": 92,
  "grade": "优秀",
  "scoreBreakdown": {
    "faultDetection": 40,
    "routeQuality": 35,
    "efficiency": 9,
    "safety": 8
  },
  "deductions": [
    {
      "reason": "存在一次不必要测量",
      "points": -2
    }
  ]
}
```

## 验收标准

后端服务达到较完整状态时，应满足以下条件：

- 三维端可以按统一动作协议提交学生操作。
- 每次学生动作都会正确改变当前实践仿真状态。
- 下一步操作基于已经修改过的模型继续运行。
- 后端能够根据 D 矩阵和仿真结果更新排故路径。
- 后端能够给出稳定、可解释的评分结果。
- 提交后 practice session 主动结束。
- 提交结果和过程记录可持久化、可查询、可回放。
- 教师能够看到学生实际排故路径、推荐路径历史、扣分原因和关键仿真结果。
- 接口文档足够支撑三维端独立联调。

