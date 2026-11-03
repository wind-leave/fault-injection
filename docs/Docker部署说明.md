# 故障注入平台 Docker 部署说明

当前项目使用两个 Linux 容器部署：Nginx 提供 Vue 构建产物并转发 `/api/` 请求，Python 3.12 运行仿真、故障诊断、实践会话和自定义组件接口。只向主机发布一个 HTTP 端口，默认是 `127.0.0.1:8080`。训练控制子系统、学生服务和三维客户端不包含在本部署中。

## 1. 安装和检查 Docker

Windows 安装 Docker Desktop，启用 WSL 2 并使用 Linux 容器；Linux 服务器安装 Docker Engine 和 Compose 插件。安装步骤参见 [Docker Desktop Windows 文档](https://docs.docker.com/desktop/setup/install/windows-install/) 和 [Docker Engine 文档](https://docs.docker.com/engine/install/)。

在 PowerShell 7 或 Linux 终端执行：

```text
docker version
docker compose version
```

两个命令均应正常返回。首次构建需要访问基础镜像仓库和 npm 仓库；运行构建好的镜像不需要在主机另装 Node.js、Python 或 npm 依赖。

## 2. 构建并启动

在 Windows PowerShell 7 中进入项目：

```powershell
Set-Location 'D:\项目方案\故障注入'
Copy-Item docker.env.example .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

`.env` 只需在首次部署时复制；已有配置时直接编辑，不要用示例覆盖。Linux 上进入项目目录后使用 `cp docker.env.example .env`，其余 Docker 命令相同。

Compose 现在默认挂载两个宿主机目录：`backend/auto_components/`（Python 自动组件）和 `public/config/`（显控台运行时 JSON）。两个目录必须存在，缺失时启动会报错，避免把空目录误当成已安装的配置。首次安装本次功能仍须执行一次 `docker compose up -d --build`；之后按下文编辑外部文件即可。

Python 自动组件目录同时支持仿真组件和电气组件：`COMPONENT.group` 默认 `simulation`，设为 `electrical` 则进入电气组件库。目录中已提供交流电源、直流电源、直流升压、直流匹配四个外部电气组件文件，保留原组件 ID，修改后重启后端并刷新页面即可生效。离线交付或切换 `GZ_AUTO_COMPONENTS_DIR` 时，应同时复制这四个 `.py` 文件。外部文件缺失或声明校验失败时使用内置版本，校验失败会显示提示；运行时异常不自动回退。声明格式及新增步骤见 [Python 组件自动发现](Python组件自动发现.md#外部电气组件)。

打开：

```text
http://127.0.0.1:8080/
```

构建过程从源码执行 `npm ci`、`npm run build`，无需先手动生成 `dist/`。Python 后端当前使用标准库和随项目交付的模块，不需要额外 pip 安装。后端监听容器内的 `0.0.0.0:8766`；Nginx 使用 Compose 服务名 `backend` 转发请求，浏览器仍使用原有 `/api/...` 地址。

后端健康检查通过后，Compose 才启动前端。后端不直接向主机发布 8766 端口；外部三维客户端可通过 `http://服务器地址:8080/api/practice/...` 使用原接口，但跨域调用仍需按实际客户端接入方式配置。

## 3. 常用配置

修改 `.env` 后执行 `docker compose up -d` 应用配置。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `GZ_HTTP_PORT` | `8080` | 主机访问端口 |
| `GZ_BIND_ADDRESS` | `127.0.0.1` | 改为 `0.0.0.0` 后允许其他机器通过主机地址访问；同时按实际网络配置放行端口 |
| `GZ_IMAGE_TAG` | `local` | 两个镜像的版本标签，离线部署时必须与导入镜像的标签一致 |
| `GZ_AUTO_COMPONENTS_DIR` | `./backend/auto_components` | 宿主机自动组件目录，挂载至后端 `/app/backend/auto_components` |
| `GZ_DISPLAY_CONFIG_DIR` | `./public/config` | 宿主机显控台配置目录，挂载至前端 `/usr/share/nginx/html/config`，其中放置 `display-console.json` |
| `PRACTICE_RESULT_CALLBACK_URL` | 空 | 空值关闭学生服务回调，适合独立演示；联调时填写学生服务实际地址 |
| `GZ_COMPONENT_REGISTRATION_TOKEN` | 空 | 选配注册接口令牌；设置后调用方须发送匹配的注册令牌，不能只修改服务端配置 |

如果学生服务运行在 Docker 所在主机的 9000 端口，可设置：

```dotenv
PRACTICE_RESULT_CALLBACK_URL=http://host.docker.internal:9000/student/practice/result
```

Compose 已配置 `host.docker.internal` 的主机映射。学生服务仍须监听容器可访问的主机网络接口；仅监听主机 `127.0.0.1` 的服务未必可由容器访问。学生服务在其他服务器时使用该服务器地址；容器内的 `127.0.0.1` 指向容器自身。

两个目录配置可以使用绝对路径，也可以使用相对 `compose.yaml` 的路径；Windows 绝对路径建议写成 `D:/故障注入数据/components`。更换路径后执行 `docker compose up -d` 重建受影响的容器。目录整体只读挂载给容器，日常在宿主机编辑；Linux 上需保证容器运行用户有目录读取、遍历和文件读取权限。挂载会遮住镜像内同路径的文件，迁移目录时应复制完整内容。

### 3.1 新增和更新 Python 组件

在 `GZ_AUTO_COMPONENTS_DIR` 指向的目录中添加带 `COMPONENT` 声明及计算函数的 `.py` 文件，参照 [Python 组件自动发现](Python组件自动发现.md)。默认目录已附带 `__init__.py` 和线性变换示例，迁移时一起保留。

新增、修改或删除文件后，在 Compose 目录执行：

```powershell
docker compose restart backend
Invoke-RestMethod http://127.0.0.1:8080/api/components/discovered
```

待后端健康后刷新页面，平台会自动加载组件库并显示逐文件扫描错误。此操作不需要构建镜像；后端重启会结束进行中的仿真、实践会话。第三方 Python 依赖仍需预装到后端镜像中，挂载 `.py` 文件本身不会安装依赖。

界面上传注册的组件继续保存在 `component-data` 命名卷中，与此自动发现目录独立；二者的 `moduleId` 仍必须全局唯一。

### 3.2 更新显控台运行时配置

编辑宿主机 `public/config/display-console.json`（或 `GZ_DISPLAY_CONFIG_DIR` 下的同名文件），保存后刷新浏览器即可。不需要构建镜像或重启容器。前端在加载组件注册表和恢复画布之前获取 JSON；Nginx 和浏览器请求均禁用该配置的缓存。不要直接编辑容器内部文件。

JSON 现在覆盖 `displayConsoleConfig.js` 的全部四个数据导出，顶层字段与导出名一致。随项目附带的文件已完整写入公共默认值和原有七个预设，不需要手工从 JS 复制：

| JSON 顶层字段 | 对应作用 |
| --- | --- |
| `DISPLAY_CONSOLE_INPUTS` | 公共输入元素数组，包含 `key`、`label`、可选的 `type`（当前为 `float`）、`unit`、`displayScale`、`generateMeasurementPoint`；数组长度决定所有显控台每个输入端口的向量维度 |
| `DISPLAY_CONSOLE_VECTOR_PORT_ID` | 未显式指定端口 ID 时使用的默认 ID，例如 `console-input` |
| `DISPLAY_CONSOLE_COLUMNS` | 公共列数组，定义列数量、顺序、`key`、`label`、`value`、`source`、`inputIndex`；不再截断为 16 列 |
| `DISPLAY_CONSOLE_PRESETS` | 各显控台的名称、输入及列覆盖、端口、控制对象和共享参数 |

`createDisplayConsoleVectorPort()` 和 `createDisplayConsoleConfig()` 等函数保留在程序里执行，并读取加载后的公共输入、端口 ID、列和预设；JSON 不需要也不能写函数、`export` 或 JS 表达式。新增/修改这些函数的程序逻辑时仍需更新前端镜像。

其他版本的 `displayConsoleConfig.js` 可使用 `tools/convert_display_console_config.mjs` 转成完整 JSON，具体命令与支持范围见 [显控台配置转换](显控台配置转换.md)。脚本在开发机运行，生成后将 JSON 放入此处挂载的配置目录。

四个顶层字段可省略，省略者使用内置默认值；显式提供的数组/预设映射作为完整数据替换，不是增量补丁。删除 `DISPLAY_CONSOLE_PRESETS` 中的预设会从组件库移除该模板，新增 `display_console_8` 等预设会自动进入组件库。`"DISPLAY_CONSOLE_PRESETS": {}` 表示组件库不提供预设显控台。原来直接以 `display_console_1` 等为顶层的旧 JSON 仍兼容，其公共输入、端口 ID 和列使用内置默认值。

每个 `DISPLAY_CONSOLE_PRESETS` 项的配置如下；显控台/端口的明确配置优先于公共默认值，所以修改公共标题时也应检查该显控台是否通过 `fields` 或 `inputs` 覆盖了它：

| 字段 | 作用 |
| --- | --- |
| `name` | 显控台模板名称；已有画布实例手工设置的名称保留 |
| `inputs` | 按公共输入元素的 `key` 覆盖名称、`unit`、`displayScale`、`generateMeasurementPoint`，支持字符串名称或配置对象 |
| `fields` | 按公共列的 `key` 覆盖标题、静态值及数据来源；`source` 可为 `input`、`status`、`time`、`static`，输入索引 `inputIndex` 为 0 至公共输入元素数减一 |
| `ports` | 非空端口数组，每个端口有唯一稳定的 `id`、可选的 `name` 和该端口的 `inputs` 覆盖；一个端口对应表格一行，每个端口的向量长度由公共输入数组决定；省略时为一个默认端口 |
| `controls` | `componentType`、可选显示 `label`、非空 `parameterKeys`；仅允许控制已有组件的已有参数 |
| `sharedParameters` | `key`、可选显示 `label` 和 `bindings`，每个绑定含 `componentType` / `parameterKey`，只有同时列在 `controls` 中的绑定才能实际生效 |

例如，下列完整文件定义两个公共向量元素、五列数据、一个含三个输入端口的显控台，并允许控制下变频器的本振频率和变频增益：

```json
{
  "DISPLAY_CONSOLE_INPUTS": [
    { "key": "centerFrequency", "label": "载频（MHz）", "type": "float", "displayScale": 0.000001 },
    { "key": "amplitude", "label": "幅度", "type": "float" }
  ],
  "DISPLAY_CONSOLE_VECTOR_PORT_ID": "console-input",
  "DISPLAY_CONSOLE_COLUMNS": [
    { "key": "serialNumber", "label": "序号" },
    { "key": "centerFrequency", "label": "载频（MHz）", "source": "input", "inputIndex": 0 },
    { "key": "amplitude", "label": "幅度", "source": "input", "inputIndex": 1 },
    { "key": "status", "label": "工作状态", "source": "status" },
    { "key": "remark", "label": "说明", "value": "--" }
  ],
  "DISPLAY_CONSOLE_PRESETS": {
    "display_console_2": {
      "name": "下变频控制台",
      "fields": { "remark": { "value": "接收链路控制" } },
      "ports": [
        { "id": "console-input", "name": "通道 A" },
        { "id": "console-input-2", "name": "通道 B" },
        { "id": "console-input-3", "name": "通道 C" }
      ],
      "controls": [
        {
          "componentType": "rf_downconverter",
          "label": "射频下变频器",
          "parameterKeys": ["lo_frequency_hz", "conversion_gain"]
        }
      ],
      "sharedParameters": []
    }
  }
}
```

自动发现组件在前端的类型为 `discovered_<moduleId>`，例如 `discovered_auto_linear_transform`；其参数键与 `COMPONENT.parameters` 的键一致。控制目标按类型匹配已放入各画布的仿真组件；尚未放入画布或参数键不存在的目标不会生成控件。新增组件后，先重启后端，再刷新页面加载配置及组件目录。

文件缺失、读取超时、JSON 语法或结构错误（如重复端口/输入/列 ID、列索引超出输入维度、预设引用不存在的公共字段）时，四部分配置整体回退到内置默认值（七个元素、16 列、七个显控台），页面顶部显示可关闭的错误提示，不会只应用半份配置。修正文件后刷新即可恢复。可访问 `http://127.0.0.1:8080/config/display-console.json` 核对实际内容。

已有画布实例通过预设 ID 读取当前配置；删除预设不会自动删除画布上的旧实例。修改端口时保持原端口的 ID 和数组顺序，新增端口优先追加；减少或重排端口后应核对已有连线。修改公共输入数组的维度或顺序时，需同步调整列的 `inputIndex`、各预设引用及上游输出的向量长度/元素顺序。显式指定了 `ports[].id` 的端口不会随公共默认端口 ID 改变。实践会话的控制白名单在创建时固定，配置更新后需创建新实践会话。

## 4. 数据保存与已有组件迁移

自定义组件的 Python 文件及清单保存在命名卷 `component-data` 中，容器内路径为 `/data/components`。正常执行 `docker compose down` 或重建容器会保留该卷。`docker compose down -v` 会删除卷内数据，不用于日常停止。

现有项目中的 `component-data/` 不会被打进镜像，也不会自动复制进命名卷。首次迁移到一个空卷时，可执行：

```text
docker compose build
docker compose run --rm --no-deps --user root -v "./component-data:/import:ro" backend python -c "import shutil; shutil.copytree('/import', '/data/components', dirs_exist_ok=True)"
docker compose run --rm --no-deps --user root backend chown -R gz:gz /data/components
docker compose up -d
```

该操作要求本地 `component-data/` 存在，且仅适用于尚无新组件的目标卷。迁移前关闭平台组件编辑，完整复制目录中的 `manifest.json` 与 `gz_custom_components/`；已有数据的目标卷应先备份，不直接覆盖合并。

画布和工作台快照目前保存在浏览器本地存储，不在 Docker 卷中。更换电脑、浏览器或访问地址会使用另一份浏览器存储，迁移前应从平台导出系统模型或模型包。仿真和实践会话保存在后端进程内存中，重启后不能继续原会话；因此当前后端保持单实例，更新前先完成或结束正在进行的训练。

## 5. 启动后核对

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:8080/healthz
docker compose exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8766/healthz').read().decode())"
docker compose logs --tail 100 backend frontend
```

两个健康接口应返回 `{"status":"ok"}`。随后在页面加载演示模型并执行一次仿真，验证前端至后端的 `/api/` 代理；仅访问首页或前端健康接口不能证明仿真链路正常。联调时再提交一项测试实践任务，核对学生服务是否收到结果。

日常停止、再次启动和查看日志：

```text
docker compose down
docker compose up -d
docker compose logs -f --tail 100
```

更新代码后执行 `docker compose up -d --build`。部署策略参见 [Compose 文档](https://docs.docker.com/compose/)。

## 6. 导出到离线电脑

Docker 交付包采用简化目录：`backend/` 直接放外部组件 Python 文件，`public/` 直接放 `display-console.json`。交付使用 `deploy/compose.delivery.yaml`（复制并改名为 `compose.yaml`）和 `deploy/docker.delivery.env.example`（复制并改名为 `.env`），默认分别设置 `GZ_AUTO_COMPONENTS_DIR=./backend`、`GZ_DISPLAY_CONFIG_DIR=./public`。容器内的读取路径保持 `/app/backend/auto_components` 和 `/usr/share/nginx/html/config`，无需修改组件扫描器或前端配置加载代码。

交付包默认设置 `GZ_BIND_ADDRESS=0.0.0.0`、`GZ_HTTP_PORT=8080`，支持其他电脑通过 `http://目标机器IP:8080` 访问；目标机器的防火墙及所在网络需允许 TCP 8080 访问。修改监听地址或端口后，在交付目录执行 `docker compose up -d --no-build --pull never` 应用配置，无需重新生成镜像归档。源项目本地构建配置仍默认只监听 `127.0.0.1`。

源码项目仍按第 2 节使用根目录的 `compose.yaml` 和 `docker.env.example` 构建，以免将整个后端源码目录当作外部组件扫描。交付版 Compose 只引用已构建镜像，不包含 `build` 配置。

先在有网络、可构建目标 CPU 架构镜像的机器上构建，再导出两个镜像：

```text
docker compose build
docker image save -o docker-images.tar gz-fault-frontend:local gz-fault-backend:local
```

将镜像归档放入交付目录，并按下表复制其余内容。组件目录须完整携带公共计算文件和 `__init__.py`；复制目录内容，不再额外套一层 `auto_components/` 或 `config/`。

| 源码项目中的内容 | 交付包中的位置 |
| --- | --- |
| `docker-images.tar` | `docker-images.tar` |
| `deploy/compose.delivery.yaml` | `compose.yaml` |
| `deploy/docker.delivery.env.example` | `.env`（按部署需要修改） |
| `backend/auto_components/` 中的文件 | `backend/` |
| `public/config/` 中的文件 | `public/` |

交付包结构如下（两个外部目录不能省略）：

```text
故障注入平台/
├── docker-images.tar
├── compose.yaml
├── .env
├── backend/
│   ├── __init__.py
│   ├── auto_linear_transform.py
│   ├── electrical_ac_power_source.py
│   ├── electrical_dc_power_source.py
│   ├── electrical_dc_boost.py
│   └── electrical_ac_dc_matching.py
└── public/
    └── display-console.json
```

需要现有界面注册组件时，还应单独迁移 `component-data` 数据卷。目标机器需预装 Docker 和 Compose，执行：

```text
docker image load -i docker-images.tar
docker compose up -d --no-build --pull never
```

`--no-build --pull never` 使用已导入的镜像，不下载镜像或重新构建。镜像归档不包含浏览器数据或 Docker 数据卷；导出和导入方法参见 [Docker image save](https://docs.docker.com/reference/cli/docker/image/save/)。

交付到麒麟等 Linux 系统时，要先核对目标 CPU：x86_64 使用 `linux/amd64`，ARM64 使用 `linux/arm64`。在支持对应构建平台的 Docker 环境中，可先设置 `DOCKER_DEFAULT_PLATFORM`，例如 PowerShell 的 `$env:DOCKER_DEFAULT_PLATFORM='linux/arm64'`，再执行构建和导出；构建机需具备目标架构执行或仿真能力。操作系统支持和 Docker 运行环境也应在目标机验证。
