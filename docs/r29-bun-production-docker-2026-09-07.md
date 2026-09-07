# R29 Bun 生产与 Docker 交付验收记录

日期：2026-09-07

## 结论

R29 已完成并通过本地 Docker 实机验收。开发、非容器 production、容器构建、容器运行、健康检查和 Volume 运维现在都以 Bun 为唯一运行时；仓库不再保留 pnpm workspace 或 lockfile。至此 R25-R29 定义的 Bun 生态迁移已经闭环。

本轮保持 API、认证、Provider 请求、file/SQLite schema、附件格式和 NDJSON v2 不变。原始 R29 容器测试使用本地 Mock Provider，没有重复调用 DeepSeek、OpenAI 或 Vision 真实接口；个人数据切换完成后的收尾阶段另补一次生产 Bun 容器内的最小 DeepSeek 文本流门禁。

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

## R23 Docker 专项与个人数据灰度

2026-09-07 在 R29 门禁上补充了两类后续验收：

- Docker smoke 显式注入 `DEEPSEEK_CONTEXT_WINDOW_TOKENS=80000`，API 上下文预览断言模型窗口、输出预留、图片预算和总预算不超过 80,000；预览前后本地 Mock Provider 调用数不变。
- 同一上下文窗口通过无截图 CDP 打开“上下文”弹窗，断言浏览器显示的 `Context Window` 和 `Total Estimate` 分母均为 80,000。
- `test:docker:personal-canary` 只接受显式源 Volume、已由恢复脚本创建的验证 Volume、预期会话数和 TLS 文件；它拒绝在源卷或运行中卷上执行。
- 本次先把 `chatbot_chatbot-data` 备份到 `backups/personal-canary-2026-09-07/`，再恢复到隔离验证卷。验证卷中的 8 个历史会话、138 条消息、readiness、登录、上下文预览和浏览器加载全部通过。
- 源数据没有附件目录，因此只在验证卷创建一个临时图片会话，通过本地 Mock Provider 持久化后验证原图和浏览器展示；测试会话随验证卷清理，没有写入源卷。
- 验证卷清理后，同一备份恢复到干净目标卷 `chatbot_bun_personal_20260907`。恢复前 manifest 与源卷均为 10 个文件、638,273 字节，tree SHA-256 为 `fcf6271004ca4d18d5efcfdc0fbaa4d8e75a4c49ef1c19eb74bdd11560bbba9c`。
- 生产 Compose 已切换到该干净目标卷；`chatbot:local` 以 `bun bun-server/bin/www.ts` 运行在 7001，容器健康、React HTTPS、liveness/readiness、认证启用与未登录 API 保护均通过。

旧配置从停止的 Node 容器迁移到未提交的 `bun-server/.env`，Argon2 哈希等包含 `$` 的值使用单引号保持 Compose 字面量语义；18 个迁移项与新容器环境逐项一致。原卷 `chatbot_chatbot-data` 保留用于回滚，切换后再次只读计算的文件数、字节数和 tree SHA-256 均未变化。

本次个人数据灰度调用本地 Mock Provider 1 次，只用于验证卷的附件 fixture；R23 预览和 canary 均未调用真实 Provider，也未生成截图。切换并重建到已验证镜像后，生产 Bun 容器通过正式 DeepSeek 配置完成一次 14-token 最小文本流：`deepseek-v4-flash` 返回 3 个内容 chunk、`finishReason=stop` 和 usage；该门禁直接调用 Provider adapter，不创建或修改个人会话。最终实例的真实密码登录没有自动化执行；认证登录已在同数据验证卷上用临时凭据通过。

## 完整验证证据

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 461 installs / 547 packages，lockfile 无漂移 |
| `bun run test:toolchain` | 7/7 通过；包含唯一 Bun 后端、原生 SQLite/HTTP 与 Bun Docker 交付守卫 |
| `CHATBOT_ENV_FILE=./bun-server/.env.example CHATBOT_TLS_CERT_PATH=<test-cert> CHATBOT_TLS_KEY_PATH=<test-key> bun run docker:config` | Compose 配置校验通过 |
| `DOCKER_CONFIG=<isolated-cli-config> bun run docker:build` | Bun 多阶段镜像构建通过；隔离配置仅绕过本机 Docker credential helper 卡住问题 |
| `bun run test:docker` | Bun 容器、HTTPS、认证、健康检查、持久化、重启、备份恢复和 Docker UI 全部通过 |
| `bun run test:docker:personal-canary -- --source-volume <source> --validation-volume <restored> --expected-conversations <count> --certificate <cert> --private-key <key>` | 恢复副本上的历史读取、临时登录、R23 上下文、附件 fixture、无截图浏览器和源卷不变门禁通过 |
| 生产容器内 `callLLMStream` 最小门禁 | DeepSeek V4 Flash 流式完成、3 个内容 chunk、`finishReason=stop`、usage 14 tokens；不写会话 |
| `bun run check` | Bun Server / Client TypeScript 7 与 React 两级 Oxlint 通过 |
| `bun run test:unit` | Bun Server 46 个文件 179/179；React 27 个文件 119/119 |
| `bun run test:bun-http-runtime` | Bun HTTPS、SQLite、安全头和 SIGTERM 通过 |
| `bun run build` | 静态检查与 Vite 8 production build 通过 |
| `bun run audit:production` | 检查 498 个包，high/critical 漏洞 0 |
| `CDP_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 bun run test:cdp:all-mock` | 无重试 18/18 脚本通过；无截图 |

全量 Mock 完成后确认 5173、5184、7001、7701-7705 无本轮遗留监听进程；Docker smoke 的隔离容器和 Volume 也已清理。

## 证据边界

- 本轮 Docker 实机运行环境为本机 Docker Desktop 的 ARM64 Linux VM；没有在 AMD64 主机重复运行。
- Provider 请求和解析逻辑未修改；原始 R29 验收沿用此前功能证据，个人数据切换后的收尾阶段仅新增一次生产容器内最小 DeepSeek 文本流，不替代完整真实 UI、工具、Vision 或参数矩阵。
- 未请求截图，因此 Docker UI 与全量 Mock 只保留自动化断言结果，没有生成交付截图。
