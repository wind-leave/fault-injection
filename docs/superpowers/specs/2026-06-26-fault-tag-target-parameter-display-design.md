# 故障组件目标参数显示设计

## 背景

故障组件绑定到仿真组件的参数槽位后，属性面板“目标参数”当前可能显示内部变量名，例如 `controller_gain`。用户在界面中更希望看到参数中文名称，例如“姿态控制增益”。

## 目标

- 故障组件属性面板“目标参数”优先显示参数中文名称。
- 内部数据仍保留 `controller_gain` 等工程变量名，不修改故障实例、绑定对象或仿真运行键。
- 当无法解析中文名称时，继续兜底显示现有变量名，避免历史数据为空。

## 解析规则

展示“目标参数”时，按当前故障标签关联的目标对象和槽位信息解析：

1. 如果故障标签或其 `injectedFault` 已经带有 `slotName`、`displayName`、`name` 等展示字段，优先使用这些字段。
2. 如果只有 `slotId`、`parameterKey`、`variableKey`、`bindingObject` 或 `targetVariable`，从目标组件的 `faultSlots` 中查找匹配槽位，优先显示槽位的 `slotName`、`displayName` 或 `name`。
3. 如果 `faultSlots` 查不到，再从目标组件的 `props.modelParameters`、`props.physicalParameters`、`parameters`、`physicalParameters` 中按 `key`、`id`、`varName`、`name` 匹配，显示参数的 `displayName`、`name` 或 `label`。
4. 仍无法解析时，显示原始工程字段，例如 `controller_gain`。

## 非目标

- 不修改 `bindingObject`、`targetVariable`、`parameterKey` 的存储值。
- 不修改故障绑定算法。
- 不修改仿真运行时参数读取逻辑。
- 不修改 D 矩阵或诊断逻辑。

## 测试范围

- 故障标签属性面板在目标槽位 `bindingObject: controller_gain`、`slotName: 姿态控制增益` 时显示“姿态控制增益”。
- 当槽位没有中文名但目标组件参数列表有中文名时，也显示中文名。
- 当无法解析中文名时仍显示原变量名。
