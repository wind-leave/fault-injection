# 故障注入平台 GZ_0524 部署说明

这是无人机飞控故障注入平台的 `GZ_0524` 独立版本。当前版本面向 eVTOL 闭环飞控演示模型，包含系统建模、故障注入、示波器观测、多信号流图、D 矩阵与测点诊断流程。

线上演示地址：

```text
https://blank1cheng.github.io/uav-fault-platform/
```

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 一个静态文件服务器或 GitHub Pages，用于部署 `dist/` 构建产物

压缩包不包含 `node_modules/`。首次部署需要安装依赖。

## 本地运行

进入项目目录后执行：

```bash
npm ci
npm run dev
```

开发服务器启动后，打开终端输出的地址，通常为：

```text
http://127.0.0.1:5173/
```

如果端口被占用，Vite 会自动使用新的端口。

## 构建与本地预览

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5190
```

构建产物位于：

```text
dist/
```

`dist/` 可以直接部署到 GitHub Pages、Nginx、Apache、OSS 静态站点或其他静态文件服务。

## GitHub Pages 部署

推荐做法：

1. 执行 `npm ci`。
2. 执行 `npm run build`。
3. 将 `dist/` 目录内的所有文件复制到 GitHub Pages 发布分支或发布目录。
4. 确保发布目录根部存在 `.nojekyll` 文件。
5. 访问 GitHub Pages 地址验证页面是否正常加载。

当前工程的 Vite `base` 为 `./`，因此可以部署在仓库子路径，例如：

```text
https://<user>.github.io/uav-fault-platform/
```

## 演示流程

1. 打开平台后，默认加载 `public/model-packages/evtol_closed_loop_fault_demo.json`。
2. 在画布上查看飞控闭环模型、故障标签和测量仪器。
3. 使用故障模型加载或故障注入流程，分别演示陀螺仪零偏、单电机卡死和控制指令篡改。
4. 双击示波器打开故障前后对比示波器。
5. 示波器支持拖动、关闭、清空、CH1/CH2 切换和时间窗口切换。
6. 切换到多信号流图和 D 矩阵视图，查看信号关系与诊断结构。
7. 人工添加测点后，可进入测点诊断流程。

## 主要目录

- `src/`：Vue 入口、运行时桥接、界面片段和样式。
- `public/model-packages/`：演示模型包。
- `public/samples/`：示例 Python 组件文件。
- `fault-types/`：故障类型目录。
- `docs/`：组件、Python 绑定和平台文件说明。
- `tests/`：平台关键交互和运行时回归测试。
- `tools/`：UI 审计脚本。
- `dist/`：已经构建好的静态演示产物。

## 验证命令

```bash
npm test -- --run
npm run build
npm run audit:ui
```

当前发布前验证结果：

- Vitest：24 个测试文件、283 个用例通过。
- Vite build：通过。
- UI audit：通过。

## 常见问题

如果页面空白，优先检查：

- 是否已经执行 `npm run build`。
- 静态服务根目录是否指向 `dist/` 内容。
- `assets/*.js` 和 `assets/*.css` 是否能返回 HTTP 200。
- GitHub Pages 是否已经完成最新分支部署。

如果默认模型没有加载，检查：

- `public/model-packages/evtol_closed_loop_fault_demo.json` 是否存在。
- 部署后对应 URL 是否能直接访问。

如果示波器不能拖动或关闭，确认部署的是当前版本，并检查浏览器缓存。可在 URL 后增加时间戳参数强制刷新：

```text
https://blank1cheng.github.io/uav-fault-platform/?v=latest
```
