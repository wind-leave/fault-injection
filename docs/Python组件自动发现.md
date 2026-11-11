# 创建仿真组件：Python 单文件模板

[下载或复制 Python 模板](templates/simulation_component_template.py)。模板是一个标量增益组件，输入 `1.0`、使用默认增益 `2.0` 时，输出为 `2.0`。一个文件同时定义组件库中显示的接口和后端计算逻辑，无需修改白名单或前端注册表。

## 1. 复制并接入

1. 在源码版项目根目录执行以下命令；Docker 交付版则把模板复制到交付目录的 `backend/`。如果部署配置了 `GZ_AUTO_COMPONENTS_DIR`，请使用配置指定的目录。

   ```powershell
   New-Item -ItemType Directory -Force 'backend/auto_components' | Out-Null
   Copy-Item 'docs/templates/simulation_component_template.py' 'backend/auto_components/'
   ```

2. 重启后端并刷新页面。Docker 后端已在运行时，在对应部署目录执行 `docker compose restart backend`。在左侧 **仿真组件 → 信号处理模型** 下找到 **示例增益组件**。
3. 将组件拖到画布，连接 **信号源 → 示例增益组件 → 示波器**。用恒定输入 `1.0` 运行仿真，检查输出是否为 `2.0`。

如果组件未出现，访问平台同源的 `/api/components/discovered`，在 `components` 中查找 `simulation_component_template`，并查看 `errors` 中是否有对应文件的报错。本地直连后端默认使用 `http://127.0.0.1:8766/api/components/discovered`。

## 2. 改成自己的组件

| 修改项 | 填写规则 |
| --- | --- |
| 文件名、`moduleId`、`templateId` | 建议使用同一个唯一的英文下划线标识，例如 `temperature_sensor`。文件名需是合法的 Python 标识符加 `.py`，且不能以 `_` 开头。已被模型使用的标识应保持稳定。 |
| `name`、`description`、`paletteMenu` | 填写中文显示名称与用途。`paletteMenu` 对应 `public/config/palette-menus.json` 中的菜单 ID；示例使用 `signal-processing`。 |
| `inputs`、`outputs` | `name` 是显示名，`portId` 是稳定的端口标识。输入 `varName` 对应 `process` 的形参，输出 `varName` 对应返回的 `outputs` 键。保持已发布端口的顺序。单元素名称用 `elementNames`。向量端口将 `type` 设为 `vector`，用 `vectorLength` 和 `vectorElementNames` 声明长度和逐项名称。复数包络端口将 `dataType` 设为 `rf_complex_envelope`，单路和四路写法见模板末尾。 |
| `parameters` | 键名对应 `process` 的形参，且不能与输入同名。类型为 `number` 或 `integer`，`default` 必须在所声明的 `min`、`max` 范围内。 |
| `process` | 实现单步计算，显式返回所有输出端口的值。标量输出用有限数值，向量输出长度应与声明一致。`middleVars` 可记录内部计算量。 |

有状态的组件可以在函数签名中增加 `dt=0.0`、`time=0.0`、`state=None` 等可选形参，并通过返回字典中的 `state` 保存下一步状态。这些上下文参数由运行时传入，不应声明为业务端口或可调参数。

内置函数的输入、输出和作用见 [Python 接口说明](内置仿真函数库说明.py)。引用自定义辅助文件可参考[外部函数导入示例](内置仿真函数库说明.txt)。

### 模式选择参数

在 `COMPONENT["parameters"]` 中定义各选项的数值 `value` 和显示文字 `label`。`control` 填 `stepper` 时，属性面板会显示可点击的模式按钮。省略 `control` 时，选项显示为下拉框。

```python
"parameters": {
    "input_mode": {
        "name": "输入选择模式",
        "type": "integer",
        "default": 1,
        "control": "stepper",
        "options": [
            {"value": 1, "label": "第一路输入"},
            {"value": 2, "label": "第二路输入"},
        ],
    },
},
```

默认值须是一个选项值。`process` 接收同名的数值参数 `input_mode`。平台按 `options` 校验可选值，也支持继续使用 `enum: [1, 2]`。同时声明 `options` 和 `enum` 时，两者的可选值须一致。

## 3. 验证参数故障

平台会为 `gain` 自动生成参数故障槽位。给该槽位绑定参数偏置故障；如果通过模型包运行，可在 `faultInstances` 中加入下例，并将 `targetId` 替换为画布上的**节点 ID**：

```json
{
  "faultId": "gain-bias-demo",
  "faultType": "parameter_bias",
  "targetId": "sim-1",
  "targetField": "params.gain",
  "injectionForm": "module-variable",
  "parameterKey": "gain",
  "enabled": true,
  "startTime": 0.1,
  "duration": 0.2,
  "parameters": { "bias": 0.5 }
}
```

保持输入为 `1.0`、初始增益为 `2.0`，仿真时长设为 `0.5 s`，步长设为 `0.1 s`。在 `0.0`、`0.1`、`0.2`、`0.3`、`0.4 s` 五个采样点上，实际输出依次为 `2.0、2.5、2.5、2.5、2.0`；参考输出始终为 `2.0`。平台将故障结束时刻 `0.3 s` 纳入生效窗口。
