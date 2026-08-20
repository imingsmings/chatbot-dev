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
| 模型 endpoint、API key、认证哈希/JWT secret、业务参数 | 宿主机 `server/.env` | 否 |
| HTTPS 证书和私钥 | 宿主机 `~/devhttps` | 否，只读挂载 |
| file/SQLite 会话数据与认证 Session SQLite | Compose `chatbot-data` volume | 否 |
| 备份 tar 与 manifest | 操作者指定的宿主机目录 | 否 |

容器可以重建，volume 不应随普通回滚删除。只运行一个 `chatbot` 实例，避免 file store 队列和 SQLite 的单进程写入语义失效。

## 镜像设计

`Dockerfile` 使用 Node 22 Debian slim 多阶段构建：

1. `pnpm-base` 固定 pnpm 11.16，与仓库 `packageManager` 一致，仅供构建和依赖解析阶段使用。
2. `build` 使用根 lockfile 安装完整 workspace 依赖并构建 React。
3. `production-dependencies` 解析 server 生产依赖，pnpm store 和 metadata 仅存在于 BuildKit cache mount。
4. `runtime` 从原始 Node slim 重新开始，只复制生产 `node_modules`、server 源码和 `client/dist`，不包含 pnpm/Corepack 下载缓存。
5. entrypoint 以 root 读取宿主机 `0600` 私钥并复制到容器临时目录，随后使用 `setpriv` 降权为官方 `node` 用户运行应用。
6. `/app/data` 预设为 `node:node`，命名卷首次创建后可由非 root 应用进程写入。
7. `.dockerignore` 阻止 `.env`、证书、`server/data`、备份 tar/manifest、无关测试和 Git 元数据进入 build context；`tests/client` 仅作为 TypeScript 构建输入，不进入运行镜像。

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
LLM_DISABLED_MODELS=gpt-5.6-sol
CONVERSATION_STORE=sqlite
```

production 默认启用单用户认证。首次启动前生成密码哈希和两个不同的随机 secret：

```bash
pnpm --dir server auth:hash-password
pnpm --dir server auth:generate-secrets
```

把输出手工写入同一个未提交的 `server/.env`：

```dotenv
AUTH_ENABLED=true
AUTH_USERNAME=local-user
AUTH_PASSWORD_HASH='<argon2id hash; keep these single quotes>'
AUTH_ACCESS_TOKEN_SECRET=<first generated secret>
AUTH_REFRESH_TOKEN_SECRET=<second generated secret>
AUTH_COOKIE_SECURE=true
```

Argon2id 哈希包含 `$`，在 Compose 使用的 `.env` 中必须用单引号包住，避免被当成变量插值；dotenv 和 Compose 都会去掉引号并把原始哈希交给 Node。缺少任一值、Argon2id 参数低于 `m=19456,t=2,p=1`、salt 少于 16 bytes、摘要少于 32 bytes、两个 secret 相同/不足 32 字节、关闭 Secure Cookie 或 production 未启用 HTTPS，容器都会 fail-fast。CLI 不会写 `.env`；不要在 shell history 中输入明文密码或把输出提交到 Git。

如默认使用 OpenAI，应显式设置 `LLM_PROVIDER=openai` 及对应 OpenAI 配置。当前启动校验会拒绝默认 provider 缺少 endpoint 或 API key 的配置。

测试可通过 `CHATBOT_ENV_FILE=/absolute/test.env` 使用隔离配置，不修改真实 `server/.env`。

## TLS 证书

Compose 将以下宿主机文件分别只读挂载：

```text
~/devhttps/dev-cert.pem -> /run/tls/server-cert.pem
~/devhttps/dev-key.pem  -> /run/tls/server-key.pem
```

默认路径保持不变；证书不在默认目录时可覆盖两个宿主机源路径：

```bash
CHATBOT_TLS_CERT_SOURCE=/absolute/path/lan-cert.pem \
CHATBOT_TLS_KEY_SOURCE=/absolute/path/lan-key.pem \
pnpm run docker:up
```

这两个变量只改变宿主机 bind source。容器内目标路径、entrypoint 的权限收敛和 Node 读取路径不变。

私钥不会进入镜像，证书更新也不需要重新构建。Node 启动前仍会校验证书格式、有效期和密钥匹配。

宿主机私钥通常是 `0600`。entrypoint 只在容器启动阶段以 root 读取只读挂载，将证书和私钥复制到 `/tmp/chatbot-tls`，再降权为 UID/GID 1000 的 `node` 用户；Node 进程不以 root 运行。

局域网通过 IP 访问时，证书 SAN 必须包含该 IP，客户端必须信任签发证书的 mkcert 根 CA。只分发根 CA 证书，不分发根 CA 私钥。主机 IP 超出证书 SAN 后需要重新签发证书或固定 DHCP 地址。

## 数据与 SQLite

Compose 把整个 `/app/data` 挂载到 `chatbot-data` volume。不能只挂载 `conversations.sqlite3`，因为 SQLite WAL 模式还会写入 `-wal` 和 `-shm` 文件。

认证 Session 固定使用独立的 `/app/data/auth-sessions.sqlite3`，不随
`CONVERSATION_STORE=file|sqlite` 切换。它只保存 Session/family 状态和 refresh
`jti` 摘要，不保存密码、完整 JWT 或模型凭据。

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
pnpm run docker:stop
pnpm run docker:down
```

`docker:down` 不删除 volume。禁止使用 `docker compose down -v` 作为普通停止或回滚命令。

## 验收

不调用真实模型的容器验收：

```bash
pnpm run test:docker
```

它使用临时 env、随机宿主机端口、独立 Compose project 和独立 SQLite volume，验证：

- 默认和覆盖后的证书源路径均可解析，镜像可构建，容器进入 healthy；
- 应用主进程以非 root `node` 用户运行；
- React 页面通过 Node HTTPS 返回；
- 缺失认证 secret 时 fail-fast；未登录 API 返回 401，登录后 runtime config 正确，Refresh Cookie 属性安全；
- `/api/health` 正常为 200、数据目录不可写为 503，认证后未知 API 返回 JSON 404；
- 测试会话跨容器 restart 持久化；
- Refresh Session 跨 restart 与新卷恢复可用，logout 后既有 Access Token 被拒绝；
- Docker stop 触发 SIGTERM，Node 在宽限期内以 0 退出；
- 停止后的完整 volume 可生成 tar 和带 SHA-256 的 manifest；
- 损坏校验或已存在目标卷会在覆盖前失败；
- 恢复到新 volume 后，会话数量、消息、reasoning、summary、generation 和 tool trace 与恢复前完全一致；
- 备份 manifest 同时包含独立认证 Session SQLite；
- `finally` 只删除测试 project、测试 volume、临时证书和临时 env。

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

## 健康检查

Compose healthcheck 请求 `GET /api/health`。该接口同时检查：

- 当前模型与存储运行配置可以通过启动级校验；
- 当前存储实现可读取会话；
- 当前会话 store 可以完成真实写入/读回/回滚探针；
- 认证启用时，独立 Session SQLite 可以完成写入/读回/删除探针。

正常返回 200：

```json
{"status":"ok","checks":{"configuration":"ok","storage":"ok"}}
```

任一检查失败返回 503，并只将对应检查标为 `error`。响应不包含 endpoint、API key、证书路径、数据路径或底层错误文本。健康探针不调用模型或其他外部服务。

## 备份、恢复与切换

备份必须覆盖整个 `/app/data` volume，不能只复制 SQLite 主文件；这样当 `conversations.sqlite3-wal`、`conversations.sqlite3-shm` 存在时，会与 file store、migration metadata 和 `auth-sessions.sqlite3` 一并进入 tar。先停止服务，保证两个 SQLite store 及其 sidecar 不再变化：

```bash
pnpm run docker:stop
pnpm run docker:backup --output /absolute/safe/chatbot-backups
```

`docker:backup` 默认从已停止但仍存在的 Compose `chatbot` 容器发现 `/app/data` 的实际 volume 名；也可显式传入 `--volume <name>`。脚本会：

1. 拒绝不存在或仍被运行中容器挂载的源 volume；
2. 只读挂载源 volume，记录每个文件的大小和 SHA-256；
3. 生成完整 tar，再次校验源数据树在打包期间未变化；
4. 写出同目录 `*.manifest.json`，记录 archive SHA-256 和数据树 SHA-256。

默认输出目录是已被 Git ignore 的仓库根 `backups/`。正式备份建议写到仓库外并保留 tar 和 manifest 两个文件。

恢复时必须使用一个从未存在过的新 volume 名：

```bash
pnpm run docker:restore \
  --manifest /absolute/safe/chatbot-backups/chatbot-data-时间.tar.manifest.json \
  --volume chatbot-data-restored-20260812
```

恢复脚本先验证 tar SHA-256，再创建目标 volume、解包并比较恢复后的数据树 SHA-256。目标 volume 已存在时直接拒绝；恢复或校验失败时只尝试删除本次刚创建的新 volume，不修改源 volume。

验证通过后显式切换 Compose：

```bash
export CHATBOT_DATA_VOLUME=chatbot-data-restored-20260812
pnpm run docker:up:volume
curl -sk https://127.0.0.1:7001/api/health
```

`compose.data-volume.yaml` 只把 `/app/data` 替换为指定 external volume。切换后继续启动或重建时必须保留同一个 `CHATBOT_DATA_VOLUME` 并使用 `docker:up:volume`；不要误用普通 `docker:up` 切回默认 volume。确认会话列表和重点会话内容后，仍建议保留原 volume 至少一个观察周期。

若恢复后的服务验收失败，停止当前容器，重新选择原 volume，而不是清空或覆盖恢复卷：

```bash
pnpm run docker:stop
export CHATBOT_DATA_VOLUME=切换前记录的原始_volume_名称
pnpm run docker:up:volume
```

应用回滚只切换镜像并保留当前 volume：

```bash
docker compose down
docker compose up -d
```

如果新镜像启动失败，检查 `docker compose logs chatbot`，恢复上一镜像标签后重新启动。不要执行 `down -v`。

## 迁移到另一台局域网电脑

迁移按“运行配置、TLS、镜像、数据”四条独立链路处理，脚本不会自动打包 `.env`、API key、TLS 私钥或 mkcert 根 CA 私钥。

### 1. 源电脑冻结并取证

1. 记录当前 Git revision、Node/pnpm/Docker 版本和实际数据 volume 名。
2. 通过 `/api/conversations/export.json` 保存一份仅用于比对的导出，至少记录会话数量并抽查包含 reasoning、summary 和 generation 的会话。
3. 执行 `pnpm run docker:stop` 和 `docker:backup`，把 tar 与 manifest 安全传到目标电脑。
4. 不删除源 volume，不执行 `docker compose down -v`。

### 2. 目标电脑重建运行配置与 TLS

1. 拉取同一代码 revision，安装仓库声明的 Node 22 和 pnpm 11.16，启动 Docker Desktop。
2. 手工创建 `server/.env`，填写目标机需要的 provider endpoint、API key、认证用户名/哈希和新生成的两组 JWT secret；不要把源 `.env` 放进备份 tar 或 Git。使用新 secret 会让恢复卷中的历史 Refresh Session 自动失效，目标机需重新登录。
3. 为目标机局域网 IP/DNS 名重新签发服务器证书，或通过 `CHATBOT_TLS_CERT_SOURCE` / `CHATBOT_TLS_KEY_SOURCE` 指向安全传入的服务器证书与私钥。
4. 客户端只安装并信任签发者的根 CA **证书**；绝不分发 mkcert 根 CA 私钥。证书 SAN 必须包含实际访问的 IP 或 DNS 名。
5. 执行 `pnpm install --frozen-lockfile` 和 `pnpm run docker:build`，不复制旧机器的 Docker volume 内部目录。

### 3. 恢复并验收

1. 使用 `docker:restore` 恢复到目标机的新 volume。
2. 设置 `CHATBOT_DATA_VOLUME` 并运行 `docker:up:volume`。
3. 确认容器 healthy、`/api/health` 为 200、Node 主进程为非 root。
4. 对比源/目标会话数量，并逐项抽查消息、reasoning、summary、stopped/completed、generation usage 和 tool trace。
5. 从另一台局域网客户端通过证书覆盖的 IP/DNS 访问，验证未登录门禁、登录、页面、会话切换和一次不调用真实模型的读取流程。

### 4. 回滚

目标机验收失败时停止目标容器并保留恢复卷和日志；源电脑继续使用未修改的原 volume。若目标机只是镜像问题，修复或切回镜像后复用恢复卷；若数据校验失败，丢弃该**新恢复卷**并从原 tar + manifest 恢复到另一个新名字。任何回滚路径都禁止用 `docker compose down -v` 代替精确卷操作。
