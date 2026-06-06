# 平台文件架构与清理标注

本文档是当前阶段的平台文件清单。它只做标注，不删除任何文件。后续如需清理，由人工确认后再删除。

## 1. 当前运行入口

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `package.json` | 正在使用 | Vite/Vitest/审计脚本入口。 |
| `index.html` | 正在使用 | Vite 页面入口。 |
| `src/main.js` | 正在使用 | Vue 应用挂载入口。 |
| `src/App.vue` | 正在使用 | 主工作台布局、左右栏尺寸、运行时装配入口。 |
| `src/services/legacyRuntimeBootstrap.js` | 正在使用 | 将 `legacy-runtime.txt` 注入浏览器运行时，是当前大量交互逻辑的桥接层。 |
| `src/services/legacy-runtime.txt` | 正在使用 | 当前核心运行时，包含画布、节点、连线、故障注入、测点、D 矩阵和导入导出逻辑。后续应逐步拆分，但目前不能删除。 |

## 2. 前端布局与样式

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `src/fragments/header.html` | 正在使用 | 顶部项目区、阶段导航、导入/注入/保存按钮。 |
| `src/fragments/canvas.html` | 正在使用 | 画布、视图切换、SVG 连线层、工具栏、仿真控制停靠区。 |
| `src/fragments/main.html` | 正在使用 | 旧片段兼容文件，仍含画布结构镜像；改动 canvas 坐标时需同步检查。 |
| `src/fragments/left-panel.html` | 正在使用 | 左侧组件库。 |
| `src/fragments/right-panel.html` | 正在使用 | 属性面板。 |
| `src/fragments/statusbar.html` | 正在使用 | 底部日志、告警、仿真结果和性能趋势。 |
| `src/styles/base.css` | 正在使用 | 全局变量、主网格尺寸、字体和基础布局。 |
| `src/styles/components.css` | 正在使用 | 组件库、画布节点、故障标签、绑定弹窗、测点台、D 矩阵等主要样式。 |
| `src/styles/console-redesign.css` | 正在使用 | 工作台重排、顶部响应式、左中右三栏设计。 |
| `src/styles/ibm-workbench.css` | 正在使用 | IBM 风格补丁和部分响应式规则。 |

## 3. 前端功能服务

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `src/services/statusBarRuntime.js` | 正在使用 | 底部状态栏数据、筛选、清空、导出。 |
| `src/services/flightModelPackage.js` | 正在使用 | 模型包导入导出、结构校验、Python 模块打包。 |
| `src/services/pythonModuleAuthoring.js` | 正在使用 | 新增仿真组件时读取/解析 Python 接口。 |
| `src/services/pythonExecutionClient.js` | 正在使用 | Python 执行客户端，默认请求 `/api/python-flow/execute`。 |
| `src/services/simulationStatusBridge.js` | 正在使用 | 仿真状态与 UI 状态栏同步。 |
| `src/composables/useLayoutResize.js` | 正在使用 | 左栏、右栏、底部状态栏尺寸拖动与持久化。 |
| `src/constants/componentLibrary.js` | 正在使用 | 左侧组件库定义，包括故障组件、仪器组件和新增组件入口。 |

## 4. 后端与 Python 执行

当前 Vue 前端可以独立运行；严格意义上没有必须常驻的后端服务。Python 执行属于可选扩展：

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `tools/python_model_runner/server.py` | 可选后端 | 提供 Python 模块执行 HTTP 服务，可与 `pythonExecutionClient.js` 对接。 |
| `tools/python_model_runner/runtime.py` | 可选后端 | 安全加载 Python 模块、执行入口函数、返回输出和观测变量。 |
| `tools/python_model_runner/test_runtime.py` | 测试 | Python runner 单元测试。 |
| `tools/python_model_runner/test_server.py` | 测试 | Python runner 服务测试。 |

## 5. Demo 与模型数据

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `public/model-packages/evtol_closed_loop_fault_demo.json` | 当前主 Demo | 默认演示模型，包含四旋翼姿态闭环画布、故障类型、故障能力映射、测点和 D 矩阵基础数据。 |
| `public/model-packages/evtol_small_nonlinear.json` | 参考 Demo | 较早期小型非线性模型包，可作为格式参考。 |
| `public/model-packages/evtol_small_nonlinear_fault_injected.json` | 测试/参考 | 带故障注入状态的模型包，测试仍在使用。 |
| `model-authoring/evtol_small_nonlinear/package-meta.json` | 建模源数据 | 模型包元信息。 |
| `model-authoring/evtol_small_nonlinear/workbench-snapshot.json` | 建模源数据 | 源工作台快照。 |
| `model-authoring/evtol_small_nonlinear/fault-library.json` | 建模源数据 | 旧故障库参考。 |
| `model-authoring/evtol_small_nonlinear/modules/*.py` | 建模源代码 | Python 仿真模块参考源码。 |
| `public/samples/*.py` | 示例 | 新增组件或 Python 绑定的样例代码。 |

## 6. 工具脚本

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `tools/ui_quality_audit.mjs` | 正在使用 | UI 质量审计脚本，`npm run audit:ui` 调用。 |
| `tools/flight_model_package/build_evtol_package.mjs` | 构建工具 | 从源数据构建模型包的工具。 |

## 7. 测试文件

| 路径 | 状态 | 说明 |
| --- | --- | --- |
| `tests/canvas-layout-app.spec.js` | 正在使用 | 主工作台、故障注入、测点、D 矩阵、布局和交互测试。 |
| `tests/flight-model-package.spec.js` | 正在使用 | 模型包导入导出和 Python 模块打包测试。 |
| `tests/signal-routing-app.spec.js` | 正在使用 | 信号源、适配、增益、求和、Mux 等基础连接测试。 |
| `tests/subsystem-hierarchy-app.spec.js` | 正在使用 | 子系统结构测试。 |

## 8. 可以人工评估删除的候选

以下文件或目录不要在本阶段自动删除，只标注为清理候选：

| 路径 | 建议 | 原因 |
| --- | --- | --- |
| `public/legacy/` | 可人工评估 | 旧 HTML 原型，当前 Vite 应用不直接依赖。 |
| `backups/` | 可人工评估 | 历史备份，确认无回滚需求后可归档或删除。 |
| `artifacts/` | 可人工评估 | 运行产物或截图类文件，可能只用于阶段验收。 |
| `tmp/` | 可人工评估 | 临时文件。 |
| `dist/` | 可人工评估 | 构建产物；如果 GitHub Pages 使用该目录则保留，否则可由构建流程生成。 |
| `*.log`、`*.err.log` | 可人工评估 | 本地开发日志，通常不应长期保留。 |
| `Jigui_demo/` | 忽略 | 用户已说明不用管。该目录当前未纳入本次整理。 |
| `演示视频/` | 可人工评估 | 演示材料，是否保留取决于交付文档需求。 |

## 9. 当前架构问题与整理方向

当前平台可演示，但存在历史包袱：

- `legacy-runtime.txt` 承载过多职责。建议后续按“画布渲染、模型数据、故障绑定、测点诊断、导入导出、属性面板”拆分。
- `canvas.html` 与 `main.html` 存在结构镜像。后续应明确单一事实来源，避免坐标和 SVG viewBox 不同步。
- 故障库应从“通用列表”整理为“系统匹配后的故障能力图”。一个系统一个故障库，其他系统单独设计。
- Python 模块目前有源文件参考，但主 Demo 包未嵌入源码。正式交付时应让模型包自带 `pythonModules`，保证别人导入即可仿真。
- 故障注入建议最终统一为“拖入层级注入块 -> 选择目标 -> 选择槽位和数学模型 -> 确认生成故障标签”的流程。

## 10. 当前主 Demo 的边界

当前演示只承诺四旋翼姿态闭环飞控 Demo：

- 固定的中文模块名称。
- 固定的可安装测点与 D 矩阵关系。
- 固定的电气层、物理层、协议层注入入口。
- 故障标签作为组件或连线的附属实例存在。
- 不承诺任意外部模型自动匹配当前故障库。
