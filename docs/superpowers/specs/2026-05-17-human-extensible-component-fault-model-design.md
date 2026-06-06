# 人工扩展组件与故障建模设计

## 目标

平台后期需要支持人工扩展，而不是只依赖预置 demo。用户应能完成两类建模工作：

1. 给已有组件或连线添加新的故障形式，并设置该故障可修改的参数。
2. 新增一个组件，绑定对应 Python 代码，声明输入输出接口、可调参数、可观测变量，以及该组件能被注入哪些故障。

设计核心是：故障不是普通仿真块，而是组件、子模块或连线的一种可激活属性。画布上可以用故障标签表现它，但数据模型中故障应记录为目标对象上的 `faultInstance`。

## 设计原则

内部建模保持英文 ID、Python 函数名和变量名，界面展示优先使用中文名称和中文说明。

组件先声明自己能坏在哪里，故障再作为该组件能力被激活。也就是说，故障选择不应该从全局故障库无约束挑选，而应该由目标组件或连线的能力表决定。

故障类型、故障能力和故障实例必须分离：

- `faultTypeCatalog` 定义有什么故障。
- `faultCapabilityMap` 或组件内的 `faultSlots` 定义谁能添加什么故障。
- `faultInstances` 定义用户实际注入了什么故障。
- `diagnosticModel` 定义测点与故障之间的可检测关系。

## 推荐包结构

后续模型包建议升级为统一结构：

```json
{
  "schemaVersion": "3.0",
  "modelInfo": {},
  "componentTemplates": [],
  "systemModel": {
    "nodes": [],
    "edges": []
  },
  "faultTypeCatalog": [],
  "faultCapabilityMap": [],
  "faultInstances": [],
  "diagnosticModel": {
    "testPoints": [],
    "detectabilityMatrix": []
  },
  "pythonModules": []
}
```

`componentTemplates` 用于保存可复用组件类型，例如姿态控制器、IMU 反馈、电机与旋翼、CAN 总线链路。`systemModel.nodes` 和 `systemModel.edges` 是当前画布中的实例。`faultInstances` 初始为空，除非该模型包本身是一个故障场景。

## 组件定义

新增组件时，用户需要定义组件的中文名称、内部类型、几何显示、Python 绑定、接口和可故障槽位。

```json
{
  "id": "node-attitude-controller",
  "templateId": "attitude-controller",
  "type": "simulation_block",
  "displayName": "姿态控制器",
  "category": "控制模块",
  "geometry": "rect",
  "pythonBinding": {
    "module": "attitude_controller.py",
    "entryFunction": "process"
  },
  "ports": {
    "inputs": [
      {
        "id": "in-error",
        "displayName": "姿态误差",
        "signalId": "attitude.error",
        "unit": "rad"
      }
    ],
    "outputs": [
      {
        "id": "out-torque",
        "displayName": "力矩指令",
        "signalId": "control.torque_cmd",
        "unit": "N*m"
      }
    ]
  },
  "parameters": [
    {
      "id": "kp",
      "displayName": "比例增益",
      "type": "number",
      "default": 1.2
    }
  ],
  "stateVariables": [
    {
      "id": "integrator_state",
      "displayName": "积分状态",
      "unit": "rad*s"
    }
  ],
  "faultSlots": [
    {
      "slotId": "controller-gain",
      "displayName": "控制增益",
      "kind": "parameter",
      "bindVariable": "kp",
      "allowedFaultTypeIds": [
        "parameter_bias",
        "parameter_drift",
        "parameter_step"
      ]
    },
    {
      "slotId": "controller-output",
      "displayName": "控制输出",
      "kind": "output_signal",
      "signalId": "control.torque_cmd",
      "allowedFaultTypeIds": [
        "output_bias",
        "output_noise",
        "intermittent_fault"
      ]
    }
  ]
}
```

组件必须能回答三个问题：它从哪里读信号、向哪里输出信号、哪些变量或接口允许注入故障。

## Python 组件代码规范

平台应要求组件 Python 代码采用可解析入口函数。入口函数用于生成接口，注释用于生成中文显示名。

```python
"""
Module: attitude_controller
Description: 姿态控制器
"""

# @entry
def process(
    attitude_error: float,   # 输入: 姿态误差
    rate_feedback: float,    # 输入: 角速度反馈
    time: float = 0.0,       # 输入: 仿真时间
    dt: float = 0.1,         # 输入: 仿真步长
    kp: float = 1.2,         # 参数: 比例增益
    kd: float = 0.15,        # 参数: 阻尼增益
):
    torque_cmd = kp * attitude_error - kd * rate_feedback

    # @observable
    control_error = attitude_error

    return torque_cmd  # 输出: 力矩指令
```

解析结果应包含：

- 输入接口：`attitude_error`、`rate_feedback`。
- 输出接口：`torque_cmd`。
- 可调参数：`kp`、`kd`。
- 可观测变量：`control_error`。
- 原始源码快照和入口函数名。

Python 解析只能提供候选接口。哪些接口允许注入故障仍由组件的 `faultSlots` 明确声明，不能完全自动推断。

## 故障类型定义

故障类型是模板，不代表已经注入。每个故障类型应包含中文名称、运行行为、参数 schema 和默认展示说明。

```json
{
  "id": "gyro_zero_bias_drift",
  "displayName": "Gyro 陀螺仪零偏 - 缓慢漂移",
  "layer": "electrical",
  "faultClass": "漂移故障",
  "runtimeBehavior": "drift",
  "formula": "y_fault = y + rate * max(t - start, 0)",
  "parameters": {
    "rate": {
      "label": "漂移速率",
      "type": "number",
      "unit": "rad/s²",
      "default": 0.006,
      "min": 0,
      "max": 0.1
    },
    "start": {
      "label": "开始时间",
      "type": "number",
      "unit": "s",
      "default": 3
    },
    "duration": {
      "label": "持续时间",
      "type": "number",
      "unit": "s",
      "default": ""
    }
  }
}
```

首批应支持这些运行行为：

- `bias`：固定偏差。
- `drift`：缓慢漂移。
- `intermittent`：间歇故障。
- `noise`：噪声增强。
- `lock`：卡死或保持。
- `tamper`：指令篡改。
- `freeze`：信号冻结。
- `scale`：比例失真。
- `custom_python`：自定义 Python 故障函数。

## 故障能力映射

故障能力映射是拖入故障标签时的判定依据。目标对象没有能力定义时，不允许注入故障。

```json
{
  "targetId": "node-imu",
  "targetKind": "node",
  "targetName": "IMU 陀螺仪反馈",
  "faultSlots": [
    {
      "slotId": "gyro-feedback",
      "slotName": "陀螺仪反馈信号",
      "kind": "output_signal",
      "signalId": "imu.pitch_rate",
      "allowedFaultTypeIds": [
        "gyro_zero_bias_fixed",
        "gyro_zero_bias_drift",
        "gyro_zero_bias_intermittent"
      ]
    }
  ]
}
```

连线也应支持故障能力：

```json
{
  "targetId": "edge-motor-motor1",
  "targetKind": "edge",
  "targetName": "1号电机 CAN 指令",
  "faultSlots": [
    {
      "slotId": "motor1-can-command",
      "slotName": "1号电机控制指令",
      "kind": "protocol_payload",
      "signalId": "motor1.command",
      "allowedFaultTypeIds": [
        "motor1_can_command_tamper"
      ]
    }
  ]
}
```

规则：

- 故障组件拖到目标后，只显示该目标 `allowedFaultTypeIds` 中的故障。
- 同一目标、同一槽位、同一故障类型不能重复注入。
- 已注入的具体故障在候选列表中应禁用并显示“已注入”。
- 不兼容目标在拖动时应显示不可注入状态。

## 故障实例

用户确认注入后生成故障实例。

```json
{
  "instanceId": "fault-inst-001",
  "faultTypeId": "gyro_zero_bias_drift",
  "targetKind": "node",
  "targetId": "node-imu",
  "slotId": "gyro-feedback",
  "displayName": "Gyro 陀螺仪零偏 - 缓慢漂移",
  "parameters": {
    "rate": 0.006,
    "start": 3,
    "duration": ""
  },
  "active": true,
  "visual": {
    "expanded": false,
    "x": 540,
    "y": 260
  }
}
```

组件或连线是否变红只由 active `faultInstances` 决定。故障库和能力表不能让组件进入故障态。

## 人工新增故障流程

人工新增故障建议做成向导。

第一步选择目标：组件、子模块或连线。

第二步选择故障槽位：例如控制增益、输出信号、CAN 报文、执行器状态。

第三步选择故障行为模板：固定偏差、缓慢漂移、间歇故障、噪声增强、卡死、指令篡改、自定义 Python。

第四步填写参数 schema：参数名、中文标签、类型、单位、默认值、上下限、是否必填。

第五步填写诊断关系：影响哪些信号，是否沿连线传播，哪些测点可能检测到，检测特征是什么。

第六步保存到当前模型包：新增 `faultTypeCatalog` 记录，并将该故障 ID 写入目标槽位的 `allowedFaultTypeIds`。

## 人工新增组件流程

人工新增组件建议做成独立向导。

第一步填写组件基础信息：中文名称、组件类型、几何形状、所属分组。

第二步上传或编写 Python 代码，平台解析入口函数。

第三步确认接口：输入、输出、可调参数和可观测变量。

第四步声明故障槽位：选择某个参数、输出信号、状态变量或协议字段作为可故障对象。

第五步选择每个槽位允许的故障类型。用户可以从已有故障库选择，也可以新建故障类型。

第六步声明测点关系：哪些输出或连线可以放置测点，哪些故障能被哪些测点检测。

第七步生成组件模板并允许拖入画布。

## 自定义故障 Python 代码规范

自定义故障函数应只描述单个信号或参数如何被改变，不直接操作整张图。

```python
"""
Module: custom_fault_bias
Description: 自定义偏差故障
"""

# @entry
def process(
    input_signal: float,  # 输入: 原始信号
    time: float = 0.0,    # 输入: 仿真时间
    dt: float = 0.1,      # 输入: 仿真步长
    bias: float = 0.05,   # 参数: 偏差
    start: float = 0.0,   # 参数: 开始时间
):
    if time < start:
        return input_signal  # 输出: 故障后信号
    return input_signal + bias  # 输出: 故障后信号
```

平台应把该函数包装为 `runtimeBehavior: "custom_python"`，并要求用户明确它能绑定到哪些 `faultSlots`。

## 测点与 D 矩阵

新增故障或组件后，必须维护诊断模型。测点不是实时自动发现故障，而是固定位置上的一次检测入口。

```json
{
  "faultTypeId": "gyro_zero_bias_drift",
  "targetId": "node-imu",
  "slotId": "gyro-feedback",
  "detectability": [
    {
      "testPointId": "M3",
      "detectable": true,
      "signature": "均值随时间漂移",
      "confidence": 0.9
    },
    {
      "testPointId": "M10",
      "detectable": false,
      "signature": "频谱变化不明显",
      "confidence": 0.2
    }
  ]
}
```

D 矩阵应由 `detectabilityMatrix` 生成，而不是从图距离临时推断。这样可以支持同一组件的不同故障在同一个测点上表现不同。

## 界面行为

故障组件是激活工具，不是普通仿真块。

拖动故障组件时，兼容目标高亮，不兼容目标淡化或显示不可用状态。

拖到兼容目标后，弹出目标故障选择窗口。窗口只显示该目标支持的故障类型。

确认注入后，目标组件或连线进入故障态，故障标签默认收起。只有故障态目标显示展开按钮。

展开后显示该目标已注入的故障标签。双击故障标签进入参数编辑。参数修改应有“应用修改”和“取消修改”流程，未应用前只修改草稿。

## 运行时执行顺序

仿真执行时按以下顺序解析故障：

1. 读取 active `faultInstances`。
2. 根据 `faultTypeId` 找到 `faultTypeCatalog`。
3. 根据 `targetId` 和 `slotId` 找到目标槽位。
4. 根据 `runtimeBehavior` 或自定义 Python 修改对应信号、参数或协议字段。
5. 更新仿真输出、示波器和测点响应。
6. 根据 `diagnosticModel` 生成候选故障和 D 矩阵结果。

## 重置与保存

重置画布必须清空：

- 当前节点和连线。
- 故障实例。
- 故障标签。
- 已安装测点。
- 诊断结果。
- D 矩阵选择状态。
- 派生字段，例如 `injectedFault`、`faultBindings`、`activeFaults`。

保存模型时应保存组件模板、系统模型、故障库、能力表和诊断模型。保存故障场景时才保存 `faultInstances`。

## 后续实现建议

第一阶段实现数据结构迁移：把现有 demo 梳理成 schema 3.0，同时保留兼容字段。

第二阶段实现组件扩展向导：支持 Python 解析、接口确认、组件模板保存。

第三阶段实现故障扩展向导：支持对目标槽位新增故障，配置参数 schema 和诊断关系。

第四阶段完善运行时：让内置故障行为和自定义 Python 都通过统一的 `faultInstances` 执行。

第五阶段完善展示：故障视图、D 矩阵、测点诊断台全部读取统一模型，减少重复状态。

## 验收标准

- 用户可以新增一个组件，绑定 Python，并在画布中使用。
- 新组件可以声明输入、输出、参数、状态变量和可观测变量。
- 新组件可以声明至少一个可故障槽位。
- 用户可以给已有组件或连线新增故障类型。
- 新故障可以设置参数 schema，并在属性栏中编辑实例参数。
- 故障只能注入到兼容目标，不能重复注入同一目标、同一槽位、同一故障类型。
- 连线故障和组件故障都能进入故障实例列表。
- D 矩阵能显示人工新增故障与固定测点的关系。
- 重置画布后，人工注入的故障实例、测点安装状态和诊断结果全部清空。
