# Python 组件自动发现

新增内置计算组件时，可以只添加一个带 `COMPONENT` 声明的 Python 文件，无需修改 `backend/builtin_modules/manifest.json` 或 `src/services/componentRegistry.js`。

已有内置组件可使用 [内置组件批量转换脚本](内置组件批量转换.md) 自动生成此格式。

## 操作步骤

1. 在 `backend/auto_components/` 新建一个英文文件名的 Python 文件，例如 `temperature_sensor.py`。默认目录仅保留 `__init__.py`，不预装自动组件。
2. 修改文件顶部的 `COMPONENT` 字典，设置唯一的 `moduleId`、显示名称、分类、输入输出和参数。
3. 在同一个文件里实现 `process` 计算函数。
4. 重启 Python 后端，刷新平台页面。
5. 在左侧“仿真组件”或“电气组件”的对应分类中找到新组件，拖入画布、连线并运行仿真。`group` 默认为 `simulation`，设置为 `electrical` 时进入电气组件库。

安装本次平台更新时，需要更新后端文件，并重新构建/部署前端。此后按本流程新增组件不需要重新构建前端。Docker Compose 默认将宿主机 `backend/auto_components/` 只读挂载到容器内同名包目录，也可在 `.env` 中设置 `GZ_AUTO_COMPONENTS_DIR` 使用其他宿主机目录。因此日常添加或修改 `.py` 后只需执行 `docker compose restart backend` 并刷新页面，无需重新构建镜像，具体见 [Docker 部署说明](Docker部署说明.md)。文件新增、修改、删除后均需要重启后端并刷新页面；平台在页面加载时自动读取后端启动时的扫描结果，不会热加载 Python 代码。

## 可直接使用的示例

在 `backend/auto_components/temperature_sensor.py` 中写入：

```python
COMPONENT = {
    "moduleId": "temperature_sensor_v1",
    "name": "温度传感器",
    "category": "传感器模型",
    "description": "带比例系数和零偏的温度测量",
    "icon": "温",
    "inputs": [
        {"varName": "temperature", "name": "真实温度", "unit": "℃"},
    ],
    "outputs": [
        {"varName": "measured", "name": "测量温度", "unit": "℃"},
    ],
    "parameters": {
        "scale": {"name": "比例系数", "default": 1.0, "min": 0, "max": 10},
        "bias": {"name": "零偏", "default": 0.0, "min": -100, "max": 100},
    },
}


def process(temperature=0.0, scale=1.0, bias=0.0):
    return {"outputs": {"measured": temperature * scale + bias}}
```

输入输出的 `varName` 和参数字典的键必须与函数形参一致；输出变量名还必须与返回值 `outputs` 的键一致。中文名称仅用于显示。输入和输出的数组顺序决定端口顺序；已投入使用的组件调整接口时应使用新 `moduleId`，避免旧模型连错端口。

## 声明规则

| 字段 | 规则 |
| --- | --- |
| Python 文件名 | 有效的 Python 标识符，不能以 `_` 开头；只扫描目录直属 `.py` 文件 |
| `moduleId` | 非空组件 ID 字符串，允许 `"11"` 等数字字符串；省略时使用文件名。外部文件之间须唯一，与内置 ID 重复时需设置 `replacesBuiltin: True` |
| `templateId` | 可选，前端组件标识，默认等于 `moduleId`；转换脚本保留原前端标识，供模型和显控台控制绑定匹配 |
| `name` | 必填，组件在界面上的名称 |
| `category` | 可选，默认“自动发现组件”；可直接填写新的分类名称 |
| `group` | 可选，`simulation`（默认，仿真组件）或 `electrical`（电气组件） |
| `paletteMenu` | 可选，二级菜单 ID；电气组件可用 `power-source`（电源模块）、`power-conversion`（电源变换），省略时按 `category` 创建分类 |
| `replacesBuiltin` | 可选，默认 `False`；设为 `True` 时同 ID 外部仿真或电气模块优先于内置模块，没有同 ID 内置模块时按新增处理；不能替换界面注册的自定义后端模块。转换脚本默认自动设置 |
| `entryFunction` | 可选，默认 `process`；必须是同文件顶层同步函数 |
| `inputs` / `outputs` | 端口数组；可写变量名字符串，或包含 `varName`、`name`、`unit` 的字典；至少声明一个输入或输出，允许无输出的终端组件 |
| `parameters` | 参数字典；每项包含 `default`，可选 `name`、`unit`、`min`、`max` |
| `requiresPower` | 可选，默认 `False`；需要电源端口时设置 `True` |
| `faultSlots` | 可选，沿用平台故障槽位格式；参数本身会自动生成物理层参数故障槽位 |

`COMPONENT` 必须直接写成 Python 字面量字典，不支持通过函数调用、变量拼接等方式生成。扫描器用 AST 读取声明，不会为读取元数据而执行 Python 文件。

## 外部电气组件

`backend/auto_components/` 当前为空组件目录（仅保留 `__init__.py`）。需要电气组件时，可运行内置组件转换脚本生成以下四个文件，再复制到该目录；它们与仿真组件共用 Docker 外部挂载目录：

| 文件 | 电气组件分类 |
| --- | --- |
| `electrical_ac_power_source.py` | 电源模块 → 交流电源模块（三相） |
| `electrical_dc_power_source.py` | 电源模块 → 直流电源模块 |
| `electrical_dc_boost.py` | 电源变换 → 直流升压模块 |
| `electrical_ac_dc_matching.py` | 电源变换 → 直流匹配模块 |

转换生成的这些文件带有 `group: "electrical"` 和 `replacesBuiltin: True`，保留原有组件 ID 和端口顺序。后端使用外部文件的计算代码，前端保留原组件标识并显示外部声明，不重复生成组件；内置条目隐藏。旧模型可继续使用原 ID；已有画布节点保留已保存的参数，新拖入的节点使用外部文件声明的默认参数。

日常修改这些文件中的 `COMPONENT` 或 `process` 后，执行 `docker compose restart backend` 并刷新浏览器。删除文件或声明校验失败时，恢复使用镜像内置版本；声明失败会在组件库顶部显示原因。函数运行时异常仍会导致仿真报错，不会自动回退。首次部署本次功能需要执行一次 `docker compose up -d --build`。

新增电气组件可按下面的格式创建独立文件，使用新的文件名和全局唯一的 `moduleId`。仅用于新增时可省略 `replacesBuiltin` 或将其设为 `False`。例如：

```python
COMPONENT = {
    "moduleId": "custom_dc_converter",
    "name": "自定义直流变换",
    "group": "electrical",
    "category": "电源变换",
    "paletteMenu": "power-conversion",
    "requiresPower": False,
    "inputs": [{"varName": "voltage", "name": "输入电压", "unit": "VDC"}],
    "outputs": [{"varName": "result", "name": "输出电压", "unit": "VDC"}],
    "parameters": {"ratio": {"name": "变换倍率", "default": 2, "min": 0}},
}


def process(voltage=0.0, ratio=2.0):
    return {"outputs": {"result": voltage * ratio}}
```

省略 `paletteMenu` 并设置新的 `category`，可创建新的电气二级分类。上述组件通过信号端口接收和输出电压，无需额外供电端口，因此设置 `requiresPower: False`。外部同 ID 组件可以提供其他版本的接口和计算实现；模型中的端口、参数和连线必须与外部声明一致。已有画布节点不会自动改写接口，跨版本迁移时应同时导入匹配的模型。

标量端口和参数使用 `type: "number"`（默认）；数值向量端口使用 `type: "vector"`，同时声明正整数 `vectorLength`。复数包络端口增加 `dataType: "rf_complex_envelope"`；如果同时为向量，平台会保留向量语义和路数。参数支持数值标量及 `type: "integer"`，可声明数值 `enum`；暂不支持向量参数，以匹配现有参数编辑器。

有状态组件可以声明可选形参 `time=0.0`、`dt=0.0`、`state=None`，并在返回字典中加入 `state`、`middleVars`。这三个名字由运行时提供，不作为普通输入或参数使用。组件状态应通过 `state` 传递，避免使用模块全局变量共享仿真状态。

## 扫描、报错和执行

- 启动时合并已有内置清单、界面注册组件与自动发现组件，保持原有调用方式。
- `GET /api/components/discovered` 返回成功发现的组件及每个错误文件的说明。
- 声明错误、语法错误、接口不一致和重复 ID 的文件会跳过，左侧组件库顶部会显示对应文件名和原因。已有组件仍可使用。
- 扫描只校验声明和函数形参；实际计算、第三方依赖和输出数值需要通过仿真验证。
- 此目录用于开发者安装的可信本地代码。它与界面导入的受限制组件不同，执行时可以使用正常 Python 语法和本机已安装依赖；离线机器应提前备齐新增依赖。
- 模型 JSON 不包含此目录的后端代码。迁移模型时，要同时带上相应 Python 文件并重启目标后端。
- 打包部署时应包含此目录及其 `.py` 文件，保留组件文件可被发现和导入的路径。当前功能按源码部署方式验证，冻结成 EXE 后的资源路径仍需在安装包制作阶段适配。

## 验证示例

默认不附带计算组件。按上文创建温度传感器示例后，输入 `4`，默认比例系数 `1`、零偏 `0`，输出应为 `4`；将比例系数改为 `3`、零偏改为 `1`，输出应为 `13`。

```powershell
python -m unittest backend.tests.test_component_discovery -v
npm.cmd test -- --run tests/discovered-component-catalog.spec.js
npm.cmd run build
```
