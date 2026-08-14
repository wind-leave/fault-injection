# 故障注入平台：麒麟 Linux x86_64 离线部署说明

## 1. 当前部署方案

本说明适用于当前已确认的目标环境：

- 银河麒麟 Linux V10 SP1 / 2403；
- `ID_LIKE=debian`；
- CPU 架构为 `x86_64`，使用 GNU C 库（glibc）；
- 系统已安装 `Python 3.8.10`；
- 前端依赖 `node_modules/` 已在 Linux x86_64 环境中准备完成。

当前后端已兼容 Python 3.8.10，且只使用 Python 标准库。因此本次部署**不需要**安装 Python 3.13、pip、uv 或任何第三方 Python 包；只需准备 Node.js 运行前端，并启动前后端两个进程。

部署前在目标机确认：

```bash
uname -m
getconf GNU_LIBC_VERSION
python3 --version
```

预期至少确认：

```text
x86_64
Python 3.8.10
```

## 2. 需要带到目标机的文件

将完整的“故障注入”项目目录复制到目标机，例如：

```text
/opt/fault-injection-platform
```

项目中至少应包括：

```text
fault-injection-platform/
├── backend/
├── src/
├── public/
├── node_modules/
├── package.json
├── package-lock.json
├── vite.config.js
└── 离线安装包-kylin-linux-x86_64/
    └── node-v24.18.0-linux-x64.tar.xz
```

`node_modules/` 必须来自 Linux x86_64 + glibc 环境，不能直接复制 Windows 中的 `node_modules/`。当前若该目录已经在目标机准备完成，无需再次执行 `npm ci`。

离线目录中的 `Python-3.13.14.tar.xz` 和 uv 安装包在当前方案中不需要使用，可保留为后续环境升级时的备用文件。

## 3. 安装 Node.js

项目附带 Node.js 24 Linux x64 离线包，满足当前 Vite 8 对 Node.js `>= 20.19.0` 的要求。以 `/opt` 为安装位置执行：

```bash
cd /opt/fault-injection-platform/离线安装包-kylin-linux-x86_64
sudo tar -xJf node-v24.18.0-linux-x64.tar.xz -C /opt

export PATH="/opt/node-v24.18.0-linux-x64/bin:$PATH"
node --version
npm --version
```

若希望新终端也自动使用该 Node.js，可将以下内容加入当前用户的 `~/.bashrc`：

```bash
export PATH="/opt/node-v24.18.0-linux-x64/bin:$PATH"
```

重新打开终端后执行 `node --version` 确认生效。

## 4. 启动平台

打开两个终端，并保持两个终端都在运行。

### 4.1 终端 A：启动 Python 后端

```bash
cd /opt/fault-injection-platform
python3 -m backend.server
```

启动成功时会显示：

```text
Simulation backend listening on http://127.0.0.1:8766
```

后端仅监听本机 `127.0.0.1:8766`，为前端提供仿真和故障排查 API。不要直接关闭此终端。

### 4.2 终端 B：启动前端

```bash
export PATH="/opt/node-v24.18.0-linux-x64/bin:$PATH"
cd /opt/fault-injection-platform
npm run dev
```

终端会显示访问地址，通常为：

```text
http://127.0.0.1:5173/
```

使用目标机浏览器访问该地址即可打开平台。前端会自动将 `/api/simulations` 和 `/api/troubleshooting` 请求转发到本机的 Python 后端。

## 5. 验证

后端启动前，可选地执行内置测试：

```bash
cd /opt/fault-injection-platform
python3 -m unittest discover backend.tests -v
```

前端启动后，可在另一终端验证页面服务：

```bash
curl -I http://127.0.0.1:5173/
```

返回 `HTTP/1.1 200 OK` 表示前端服务可访问。

## 6. 可选：局域网访问

当前 `vite.config.js` 已将前端监听地址配置为 `0.0.0.0`。如需让局域网其他机器访问，可使用：

```text
http://目标机IP:5173/
```

仅允许局域网访问 `5173/TCP`；不要开放后端 `8766/TCP`。若暂不需要局域网访问，无需配置防火墙。

## 7. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `python3 -m backend.server` 启动失败 | 先执行 `python3 --version`，应为 3.8.10；确认项目目录中存在 `backend/`。 |
| `npm: command not found` | 在当前终端执行 `export PATH="/opt/node-v24.18.0-linux-x64/bin:$PATH"`。 |
| `npm run dev` 报原生模块错误 | `node_modules/` 不是在 Linux x86_64 环境中生成；需在兼容的 Linux 环境重新执行 `npm ci` 后再复制。 |
| 页面能打开但仿真或故障排查失败 | 确认终端 A 的 Python 后端仍在运行，并显示 `127.0.0.1:8766` 正在监听。 |
| 端口已被占用 | 使用 `ss -lntp | grep -E ':5173|:8766'` 定位占用进程；不要重复启动同一服务。 |

## 8. 停止平台

分别在前端和后端终端按 `Ctrl+C` 即可停止。当前说明采用前台启动方式；如后续需要开机自启或长期运行，再将这两个启动命令配置为系统服务。
