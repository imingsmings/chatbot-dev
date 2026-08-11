# Docker 局域网部署

本文定义个人使用场景的 Docker 交付：单个 Node/Express 容器直接终止 HTTPS，同时提供 React 构建和 `/api/*`。不使用 Nginx/Caddy，不面向公网或多实例部署。

## 拓扑与边界

```text
局域网浏览器
    -> https://宿主机 IP:7001
    -> Docker 7001:7001
    -> Node HTTPS / Express
       -> client/dist
       -> /api/*
       -> DeepSeek / OpenAI / Weather
       -> /app/data
```

镜像、运行配置和数据采用不同生命周期：

| 内容 | 位置 | 是否进入镜像 |
| --- | --- | --- |
| Node、server、生产依赖、`client/dist` | `chatbot:local` | 是 |
| 模型 endpoint、API key、业务参数 | 宿主机 `server/.env` | 否 |
| HTTPS 证书和私钥 | 宿主机 `~/devhttps` | 否，只读挂载 |
| file/SQLite 会话数据 | Compose `chatbot-data` volume | 否 |

容器可以重建，volume 不应随普通回滚删除。只运行一个 `chatbot` 实例，避免 file store 队列和 SQLite 的单进程写入语义失效。

## 镜像设计

`Dockerfile` 使用 Node 22 Debian slim 多阶段构建：

1. `base` 固定 pnpm 11.16，与仓库 `packageManager` 一致。
2. `build` 使用根 lockfile 安装完整 workspace 依赖并构建 React。
3. `runtime` 只安装 server 生产依赖，复制 server 源码和 `client/dist`。
4. entrypoint 以 root 读取宿主机 `0600` 私钥并复制到容器临时目录，随后使用 `setpriv` 降权为官方 `node` 用户运行应用。
5. `/app/data` 预设为 `node:node`，命名卷首次创建后可由非 root 应用进程写入。
6. `.dockerignore` 阻止 `.env`、证书、`server/data`、无关测试和 Git 元数据进入 build context；`tests/client` 仅作为 TypeScript 构建输入，不进入运行镜像。

运行镜像默认配置：

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=7001
SERVE_CLIENT_BUILD=true
CLIENT_DIST_DIR=/app/client/dist
HTTPS_ENABLED=true
HTTPS_CERT_PATH=/tmp/chatbot-tls/server-cert.pem
HTTPS_KEY_PATH=/tmp/chatbot-tls/server-key.pem
CONVERSATION_DATA_DIR=/app/data
```

Compose 的同名 `environment` 会覆盖 `server/.env` 中不适用于容器的宿主机路径。

## 环境变量

Compose 默认读取 `server/.env`，该文件保持 Git ignore，只在容器创建时注入。不要把 API key 写入 `Dockerfile`、`compose.yaml` 或 build args。

启动前至少保证默认 provider 配置完整。DeepSeek Flash 示例：

```dotenv
LLM_PROVIDER=deepseek
DEEPSEEK_ENDPOINT=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=本机实际密钥
LLM_DISABLED_MODELS=deepseek-v4-pro,gpt-5.6-sol
CONVERSATION_STORE=sqlite
```

如默认使用 OpenAI，应显式设置 `LLM_PROVIDER=openai` 及对应 OpenAI 配置。当前启动校验会拒绝默认 provider 缺少 endpoint 或 API key 的配置。

测试可通过 `CHATBOT_ENV_FILE=/absolute/test.env` 使用隔离配置，不修改真实 `server/.env`。

## TLS 证书

Compose 将以下宿主机文件分别只读挂载：

```text
~/devhttps/dev-cert.pem -> /run/tls/server-cert.pem
~/devhttps/dev-key.pem  -> /run/tls/server-key.pem
```

私钥不会进入镜像，证书更新也不需要重新构建。Node 启动前仍会校验证书格式、有效期和密钥匹配。

宿主机私钥通常是 `0600`。entrypoint 只在容器启动阶段以 root 读取只读挂载，将证书和私钥复制到 `/tmp/chatbot-tls`，再降权为 UID/GID 1000 的 `node` 用户；Node 进程不以 root 运行。

局域网通过 IP 访问时，证书 SAN 必须包含该 IP，客户端必须信任签发证书的 mkcert 根 CA。只分发根 CA 证书，不分发根 CA 私钥。主机 IP 超出证书 SAN 后需要重新签发证书或固定 DHCP 地址。

## 数据与 SQLite

Compose 把整个 `/app/data` 挂载到 `chatbot-data` volume。不能只挂载 `conversations.sqlite3`，因为 SQLite WAL 模式还会写入 `-wal` 和 `-shm` 文件。

Docker 默认使用 `CONVERSATION_STORE=sqlite`：

- SQLite 使用现有 migration 语义，首次访问时幂等导入 volume 内的旧 JSON；
- 需要回退时可显式设置 `CONVERSATION_STORE=file`，保留单会话 JSON 语义。

从当前 file store 首次迁移时，先停止宿主机 Node 和 Docker 服务，再只将当前活动的 JSON 目录复制到新 volume：

```bash
docker compose create
docker compose run --rm --no-deps \
  --entrypoint sh \
  --volume "$PWD/server/data/file:/source:ro" \
  chatbot -c 'mkdir -p /app/data/file && cp -a /source/. /app/data/file/ && chown -R node:node /app/data'
```

首次访问会话 API 时会在 `/app/data/sqlite` 生成新 SQLite 并导入 JSON。不要把旧的、已标记 migration 完成的 SQLite 与更新 JSON 一起复制进新 volume，否则新 JSON 不会再次导入。迁移后先核对会话数量和内容，再停止使用宿主机 Node 直接写旧数据。

## 构建与启动

```bash
pnpm run docker:config
pnpm run docker:build
pnpm run docker:up
pnpm run docker:status
```

默认地址：

```text
本机：https://localhost:7001
局域网：https://<宿主机局域网 IP>:7001
```

其他常用命令：

```bash
pnpm run docker:logs
docker compose restart chatbot
pnpm run docker:down
```

`docker:down` 不删除 volume。禁止使用 `docker compose down -v` 作为普通停止或回滚命令。

## 验收

不调用真实模型的容器验收：

```bash
pnpm run test:docker
```

它使用临时 env、随机宿主机端口、独立 Compose project 和独立 SQLite volume，验证：

- Compose 可解析，镜像可构建，容器进入 healthy；
- 应用主进程以非 root `node` 用户运行；
- React 页面通过 Node HTTPS 返回；
- runtime config 正确，未知 API 返回 JSON 404；
- 测试会话跨容器 restart 持久化；
- Docker stop 触发 SIGTERM，Node 在宽限期内以 0 退出；
- `finally` 只删除测试 project、测试 volume 和临时 env。

容器页面与截图验收需要先启动容器，然后运行：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 \
APP_URL=https://127.0.0.1:7001/ \
CDP_SCREENSHOTS=1 \
pnpm run test:cdp:docker-ui
```

结果写入 `.tmp/docker-screenshots/`。

## Docker Desktop 网络排障

若构建停在 Docker Hub 请求或出现 `i/o timeout`，先区分宿主机网络和 Docker Desktop VM 网络。宿主机 `curl` 成功不代表 Docker Desktop 已继承同一代理。

本机验证时，Docker Desktop 的 System proxy 未能稳定完成镜像拉取，改用手动 HTTP/HTTPS proxy 后恢复。代理地址属于宿主机环境配置，不应写入 `Dockerfile`、Compose 或仓库文件。建议在 Docker Desktop 的 Resources / Proxies 中配置，并让以下地址绕过代理：

```text
localhost,127.0.0.1,host.docker.internal,*.local,192.168.0.0/16
```

自动化测试使用临时 Docker CLI 配置规避桌面 credential helper 阻塞，但不会修改或持久化 Docker Hub 凭据。

## 备份与回滚

原始文件级备份前先停止容器，保证 SQLite/WAL 状态稳定：

```bash
docker compose stop chatbot
```

备份应覆盖完整 volume，而不是只复制 SQLite 主文件。恢复时优先写入新 volume 并验证，再切换服务，避免直接清空唯一数据副本。

应用回滚只切换镜像并保留当前 volume：

```bash
docker compose down
docker compose up -d
```

如果新镜像启动失败，检查 `docker compose logs chatbot`，恢复上一镜像标签后重新启动。不要执行 `down -v`。
