# R29 Bun 生产与 Docker 交付验收记录

日期：2026-09-07

## 结论

R29 已完成并通过本地 Docker 实机验收。开发、非容器 production、容器构建、容器运行、健康检查和 Volume 运维现在都以 Bun 为唯一运行时；仓库不再保留 pnpm workspace 或 lockfile。至此 R25-R29 定义的 Bun 生态迁移已经闭环。

本轮保持 API、认证、Provider 请求、file/SQLite schema、附件格式和 NDJSON v2 不变。容器测试使用本地 Mock Provider；没有重复调用 DeepSeek、OpenAI 或 Vision 真实接口。

## 变更范围

- Docker 多阶段构建固定使用 `oven/bun:1.4.0-slim`，按 `bun.lock` 冻结安装 workspace 依赖并构建 React。
- production dependencies 阶段只解析 `bun-server` 的生产依赖；最终镜像只复制 Bun 后端、共享协议、React 构建、生产依赖和必要运维脚本。
- Compose 默认读取未提交的 `bun-server/.env`，健康检查由容器内 Bun 脚本请求 `/api/health/live`。
- entrypoint 复制只读 TLS 证书后降权到镜像内置的 `bun` 用户（UID/GID 1000），再启动 `bun bun-server/bin/www.ts`。
- Docker 备份、恢复和 Volume manifest 子进程全部由 Bun 执行；原有完整卷、双重 SHA-256 和显式切卷边界不变。
- 恢复 `docker:config`、`docker:build`、`docker:up`、`docker:up:volume`、`test:docker` 和 `test:cdp:docker-ui` 命令。
- 删除 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml`，并增加工具链守卫，避免 Docker 重新引用 Node 后端或 pnpm 构建输入。

## 数据与回滚边界

R29 不迁移、删除或重写用户数据。生产数据仍完整位于 `/app/data`；SQLite 主文件、WAL/SHM、附件、认证 Session 和 requestId 记录随同一 Volume 备份恢复。

容器升级前应在停止写入后运行 `bun run docker:backup`。恢复流程只写一个明确且尚不存在的新 Volume，并在 archive SHA-256、tree manifest 或内容校验失败时停止；不会覆盖源 Volume。切换失败时，可把 `CHATBOT_DATA_VOLUME` 指回原 Volume 并重新创建容器。

源码回滚应切换到 R29 前的 Git revision，并同时恢复该 revision 对应的 Dockerfile、Compose 和 pnpm 输入。R29 没有改变持久化 schema，所以不需要反向数据迁移。

## Docker 实机验收

`bun run test:docker` 使用临时 env、自签名测试证书、随机宿主机端口、独立 Compose project、独立 SQLite volumes 和本地 Mock Provider。自动化执行并断言：

- 固定 Bun 1.4.0，应用进程为 UID/GID 1000 的非 root `bun` 用户，命令为 `bun bun-server/bin/www.ts`。
- 运行镜像为 188,509,646 字节，低于 300 MB 门禁；不包含测试、前端依赖、TypeScript、pnpm 输入或安装缓存。
- Bun HTTPS 同源提供 React 与 `/api/*`；认证 fail-fast、Secure refresh cookie、API 保护、登录和 logout 撤销均生效。
- liveness 保持轻量；readiness 在 SQLite 路径不可写时失败，恢复写权限后无需重建容器即可恢复。
- SQLite 会话、模型参数、附件、认证 Session 与 requestId 结果跨容器重启保持；相同 requestId 重放不会第二次调用 Provider。
- SIGTERM 触发优雅停止且进程退出码为 0。
- 运行中的 Volume 拒绝备份；停止后备份包含 archive/tree SHA-256，篡改校验和与已存在恢复目标均安全失败。
- 恢复到全新 Volume 后，会话语义、附件字节和 SHA-256、缩略图/原图读取、浏览器展示及历史图片续问全部通过，源 Volume 保持不变。

测试创建的容器、网络、Volume、临时证书和测试数据均由脚本清理；未删除或修改现有用户会话。

## 完整验证证据

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 461 installs / 547 packages，lockfile 无漂移 |
| `bun run test:toolchain` | 7/7 通过；包含唯一 Bun 后端、原生 SQLite/HTTP 与 Bun Docker 交付守卫 |
| `CHATBOT_ENV_FILE=./bun-server/.env.example CHATBOT_TLS_CERT_PATH=<test-cert> CHATBOT_TLS_KEY_PATH=<test-key> bun run docker:config` | Compose 配置校验通过 |
| `DOCKER_CONFIG=<isolated-cli-config> bun run docker:build` | Bun 多阶段镜像构建通过；隔离配置仅绕过本机 Docker credential helper 卡住问题 |
| `bun run test:docker` | Bun 容器、HTTPS、认证、健康检查、持久化、重启、备份恢复和 Docker UI 全部通过 |
| `bun run check` | Bun Server / Client TypeScript 7 与 React 两级 Oxlint 通过 |
| `bun run test:unit` | Bun Server 46 个文件 179/179；React 27 个文件 119/119 |
| `bun run test:bun-http-runtime` | Bun HTTPS、SQLite、安全头和 SIGTERM 通过 |
| `bun run build` | 静态检查与 Vite 8 production build 通过 |
| `bun run audit:production` | 检查 498 个包，high/critical 漏洞 0 |
| `CDP_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 bun run test:cdp:all-mock` | 无重试 18/18 脚本通过；无截图 |

全量 Mock 完成后确认 5173、5184、7001、7701-7705 无本轮遗留监听进程；Docker smoke 的隔离容器和 Volume 也已清理。

## 证据边界

- 本轮 Docker 实机运行环境为本机 Docker Desktop 的 ARM64 Linux VM；没有在 AMD64 主机重复运行。
- Provider 请求和解析逻辑未修改，真实 Provider 继续沿用此前功能门禁证据，R29 本身不新增真实接口证据。
- 未请求截图，因此 Docker UI 与全量 Mock 只保留自动化断言结果，没有生成交付截图。
