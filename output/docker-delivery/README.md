# Docker 运行交付目录

此目录的 `compose.yaml` 和 `.env` 是可直接使用的运行配置，默认监听 `0.0.0.0:8080`。`.env` 中的回调地址和注册令牌留空，仅保存可公开的默认配置。

## 在开发机生成镜像归档

在项目根目录执行：

```powershell
docker compose build
docker image save -o output/docker-delivery/docker-images.tar gz-fault-frontend:local gz-fault-backend:local
```

镜像归档由有 Docker 的机器生成，不提交到 Git。将生成的归档与本目录其他文件一起交付。

## 在目标机器运行

目标机器安装 Docker 和 Compose，支持镜像对应的 Linux 容器及 CPU 架构。在本目录内执行：

```powershell
docker image load -i docker-images.tar
docker compose up -d --no-build --pull never
```

其他电脑通过 `http://目标机器IP:8080` 访问，目标机器需允许 TCP 8080 入站。

## 外部文件

- `backend/`：直接放组件 Python 文件及其公共计算代码。当前只保留 `__init__.py`，不预装自动发现组件。新增、修改或删除组件后，执行 `docker compose restart backend` 并刷新页面。
- `public/display-console.json`：显控台运行时配置，修改后刷新页面生效。
- `.env`：镜像标签、监听地址、端口及外部目录设置。修改后重新执行 `docker compose up -d --no-build --pull never`。

源码项目的根目录 `compose.yaml` 用于构建；本目录的 `compose.yaml` 用于运行已构建的镜像。
