# 组件与 Python 模块建模规范

本文档定义当前故障注入平台的演示模型、组件、连线、故障槽位和 Python 模块的约定。目标是让“系统模型”和“故障注入逻辑”可以一一追踪，同时保留后续扩展到其他飞控系统的空间。

## 1. 模型包顶层结构

模型包建议使用 JSON，顶层字段如下：

```json
{
  "schemaVersion": 1,
  "packageType": "flight-control-model",
  "systemFamily": "uav-flight-control",
  "modelId": "evtol-closed-loop-fault-demo",
  "modelName": "四旋翼姿态闭环飞控故障诊断 Demo",
  "pythonModules": [],
  "workbenchSnapshot": {},
  "faultTypeCatalog": {},
  "faultCapabilityMap": [],
  "faultInstances": []
}
```

关键约束：

- `workbenchSnapshot` 是画布可见模型，包含组件、连线、测点、故障标签和视图状态。
- `pythonModules` 是仿真组件可执行代码，建议随模型包一起导入，不能只依赖本地文件名。
- `faultTypeCatalog` 是当前系统支持的故障类型。它不是通用故障大全，而是与当前飞控系统匹配后的故障库。
- `faultCapabilityMap` 描述每个组件或连线能接受哪些层级、哪些故障模型。
- `faultInstances` 描述已经实例化的故障。重置画布时必须一起清空。

## 2. 组件节点格式

每个组件节点至少包含：

```json
{
  "id": "node-imu",
  "type": "simulation_block",
  "x": 760,
  "y": 620,
  "w": 196,
  "h": 134,
  "geometry": "rect",
  "props": {
    "name": "IMU 陀螺仪反馈",
    "category": "仿真块",
    "description": "将机体角速度转换为测量反馈"
  },
  "ports": {
    "inputs": [{ "id": "in-1", "name": "机体角速度", "unit": "rad/s" }],
    "outputs": [{ "id": "out-1", "name": "测量角速度", "unit": "rad/s" }]
  },
  "parameters": [
    { "key": "bias", "name": "零偏", "layer": "physical", "default": 0, "unit": "rad/s" },
    { "key": "scale", "name": "比例系数", "layer": "physical", "default": 1 }
  ],
  "pythonBinding": {
    "moduleId": "imu_gyro",
    "entryFunction": "process"
  },
  "faultSlots": []
}
```

字段约定：

- `type` 用于平台行为：`signal_source`、`simulation_block`、`sum_block`、`instrument_scope`、`instrument_logger`、`subsystem_block` 等。
- `geometry` 用于画布图形：仿真块统一矩形，信号源可胶囊形，求和块可圆角胶囊，仪器块可绿色边框矩形。
- `props.name` 必须是中文展示名。Python 名称和变量名保留英文。
- `parameters` 是组件自身模型参数。物理层故障只能绑定到有模型参数的组件。
- `ports` 是输入输出信号接口。电气层故障主要绑定输入输出信号；协议层故障主要绑定离散通信信号或连线。

## 3. 连线格式

连线既可以表示普通连续信号，也可以表示 CAN/协议信号：

```json
{
  "id": "edge-imu-error",
  "sourceNodeId": "node-imu",
  "sourcePortIndex": 0,
  "targetNodeId": "node-error-sum",
  "targetPortIndex": 1,
  "lineType": "can",
  "signalId": "imu.pitch_rate",
  "channelId": "CAN-FC-IMU",
  "bus": "CAN",
  "unit": "rad/s",
  "payload": "float32",
  "faultPolicy": "propagates",
  "faultSlots": []
}
```

连线故障绑定规则：

- `lineType: "signal"`：一般只接受电气层信号故障，如偏置、噪声、冻结。
- `lineType: "can"` 或 `bus: "CAN"`：可接受协议层故障，如延迟、丢包、篡改、冻结报文。
- 协议层故障不改变连续物理量本身，而改变消息、状态位、计数器或离散命令值。

## 4. 故障槽位

故障槽位是组件或连线可注入故障的入口。一个对象必须先声明槽位，才能接受对应层级的故障注入。

```json
{
  "slotId": "physical:gyro_bias",
  "slotName": "陀螺仪零偏",
  "layer": "physical",
  "targetField": "parameters.bias",
  "allowedModels": ["bias", "drift", "step"],
  "allowedFaultTypeIds": ["gyro_zero_bias_offset", "gyro_zero_bias_drift"]
}
```

层级含义：

- `physical`：改变组件模型参数，例如惯量、推力系数、零偏参数、比例系数。
- `electrical`：改变输入输出连续信号，例如偏置叠加、噪声注入、冻结、间歇异常。
- `protocol`：改变离散通信或总线消息，例如 CAN 指令篡改、报文丢包、报文延迟、状态字错误。

匹配规则：

- 物理层注入块只能绑定到含 `parameters` 且槽位层级为 `physical` 的组件。
- 电气层注入块只能绑定到含信号端口或信号连线的对象。
- 协议层注入块只能绑定到协议连线或声明协议槽位的组件。
- 匹配不上时，画布不进入待选态，也不能完成绑定。

## 5. 故障类型格式

故障类型是系统级故障库中的定义，建议格式如下：

```json
{
  "id": "gyro_zero_bias_drift",
  "displayName": "Gyro 陀螺仪零偏 - 缓慢漂移",
  "layer": "electrical",
  "modelClass": "渐变故障",
  "runtimeBehavior": "parameter_drift",
  "formula": "gyro_rate_fault = gyro_rate + rate * max(t - start, 0)",
  "defaultParameters": {
    "rate": 0.006,
    "start": 3,
    "duration": ""
  },
  "targetModuleName": "IMU 陀螺仪反馈",
  "platformImplementation": {
    "recommendedModule": "fault_tag",
    "pythonFunction": "fault_drift_bias",
    "variableRelation": "gyro_rate_fault = gyro_rate + rate * max(t - start, 0)"
  }
}
```

建议把“故障类型”和“故障实例”分开：

- 故障类型：描述可选的故障模型、默认参数、数学关系。
- 故障实例：描述已经绑定到哪个组件或哪条连线，以及用户实际设置的参数。

## 6. 故障实例格式

```json
{
  "instanceId": "fault-tag-001",
  "faultTypeId": "gyro_zero_bias_drift",
  "targetKind": "edge",
  "targetId": "edge-imu-error",
  "slotId": "electrical:imu_feedback",
  "layer": "electrical",
  "parameters": {
    "rate": 0.006,
    "start": 3,
    "duration": ""
  },
  "active": true,
  "visual": {
    "x": 840,
    "y": 540,
    "expanded": false
  }
}
```

约束：

- 同一对象、同一槽位、同一故障类型默认不能重复注入。
- 已注入故障以故障标签显示。收起时目标组件变红；展开时显示具体故障标签。
- 故障标签参数修改应走“修改 -> 应用修改/取消修改”的流程，避免输入框一改就影响仿真状态。

## 7. Python 模块格式

Python 模块用于仿真块计算。建议每个模块一个 `.py` 文件，一个稳定入口函数：

```python
"""
Module: imu_gyro
Description: Gyro sensing with optional bias injection
"""


def process(body_rate: float, bias: float = 0.0, scale: float = 1.0):
    # @observable
    measured_rate = (body_rate + bias) * scale
    return measured_rate
```

规范：

- 文件名、`moduleId`、模块注释中的 `Module` 保持一致。
- 入口函数默认使用 `process`；如需其他名称，必须在 `pythonBinding.entryFunction` 中声明。
- 函数参数是输入信号和可调参数。带默认值的参数可以映射为组件参数。
- `# @observable` 后面的局部变量可以作为中间变量、测点候选或示波器输出。
- 返回值数量必须与组件输出端口数量一致。
- 函数应保持确定性。随机故障必须通过显式 `seed` 或平台注入模型控制。
- 不在模块内直接读取本地文件、网络或全局 UI 状态。

## 8. 当前 Demo 组件映射

当前演示模型建议固定为一个完整 Demo，不再临时假设其他系统：

| 节点 ID | 中文名称 | 类型 | 建议 Python 模块 |
| --- | --- | --- | --- |
| `node-command` | 姿态指令 | 信号源 | 无 |
| `node-command-shaper` | 指令整形 | 仿真块 | `command_shaper.process` |
| `node-error-sum` | 姿态误差求和 | 求和块 | 无 |
| `node-controller` | 姿态控制器 | 仿真块 | `attitude_pid.process` |
| `node-allocator` | 控制分配 | 仿真块 | `control_allocation.process` |
| `node-motor` | 电机混控器 | 仿真块 | `motor_mixer.process` |
| `node-motor-1` 到 `node-motor-4` | 1-4 号电机与旋翼 | 仿真块 | `motor_model.process` |
| `node-dynamics` | 飞行动力学 | 仿真块 | `vehicle_dynamics.process` |
| `node-imu` | IMU 陀螺仪反馈 | 仿真块 | `imu_gyro.process` |
| `node-scope` | 指令与反馈示波器 | 测量仪器 | 无 |
| `node-residual-logger` | 残差诊断记录仪 | 测量仪器 | 无 |
| `node-residual-spectrum` | 频谱分析仪 | 测量仪器 | 无 |

当前参考 Python 源码位于 `model-authoring/evtol_small_nonlinear/modules/`。当前线上 Demo 包 `public/model-packages/evtol_closed_loop_fault_demo.json` 仍以 UI 演示为主，`pythonModules` 暂为空；后续正式模型包应把这些模块源码嵌入 `pythonModules`。

## 9. 后续扩展建议

- 新增组件时，先选择 Python 模块或手工定义端口，再保存为组件模板。
- 新增故障时，先选择层级和数学模型，再声明可绑定槽位。
- 故障库应按系统维护：四旋翼姿态闭环 Demo 的故障库只描述这个系统能演示的故障。
- 多信号流图和 D 矩阵应从 `faultCapabilityMap` 与测点定义生成，避免手工维护两套关系。
