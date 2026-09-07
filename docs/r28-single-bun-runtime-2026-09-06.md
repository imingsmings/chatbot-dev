# R28 单一 Bun 后端收口验收记录

日期：2026-09-06

## 结论

R28 已完成本地非 Docker 验收。仓库只保留 `bun-server/` 一套后端业务源码；开发、非容器 production、类型检查、单元测试、真实后端 CDP 场景和真实 Provider runner 都默认选择 Bun。API、认证、Provider 请求、file/SQLite schema、附件格式与 NDJSON v2 没有改变。

本记录不证明 Docker 或真实 Provider。Dockerfile、Compose 和 pnpm 文件是 R29 的历史迁移输入，当前不能从已删除的 Node 源码重建；真实 Provider 因本阶段没有改变请求形状而未重复付费调用。

## 变更范围

- 删除 Git 跟踪的 Node `server/` 业务源码、manifest、tsconfig 和示例环境文件。
- 删除 `tests/server/` Node 测试副本，以及 backend parity、Node/Bun SQLite 兼容和双后端观测基准。
- 根 Bun workspace 从 client/server/bun-server 收口为 client/bun-server；`bun.lock` 删除 Node workspace 依赖声明。
- 保留稳定命令名 `dev:server`、`start:server`、`typecheck:server`、`test:server`，全部改为调用 `bun-server/`；删除重复的 `*:bun-server` 与 `all-mock:bun` 入口。
- `start:production` 改为 Bun 非容器 production；CDP runtime helper 默认且只接受 Bun。
- 真实 Provider runner 的密码工具、环境文件和 ZIP 依赖路径改为 `bun-server/`，但本轮没有执行真实 Provider。
- Docker build/up/test 脚本从根 manifest 暂时移除；现有容器管理与离线 Volume 备份/恢复脚本仍可由 Bun 调度，容器实现本身留到 R29。

## 数据与回滚边界

删除只针对 Git 跟踪文件。执行前后均确认本地被忽略的 `server/.env`、`server/data/` 和 `server/node_modules/` 未被删除或修改。

`bun-server/data/` 仍是默认数据目录。需要复用旧 `server/data/` 时，先停止旧写入进程并完成完整备份，再通过 `CONVERSATION_DATA_DIR` 显式指向旧数据；不得让旧 Node 进程与 Bun 同时写同一个 file/SQLite store。

源码回滚应切换到 R28 前的 Git revision；因为 R28 不改变 schema 或附件格式，不需要反向数据迁移。回滚后需恢复旧 revision 对应的环境文件路径和启动命令。

## 验证证据

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 461 installs / 547 packages，无 lockfile 变化 |
| `bun run test:toolchain` | 6/6 通过；单 workspace、单运行时、46 个 Bun 测试文件、`bun:sqlite` 与 `Bun.serve` 守卫通过 |
| `bun run check` | Bun Server / Client TypeScript 7 与 React 两级 Oxlint 通过 |
| `bun run test:server` | 46 个文件，179/179 通过 |
| `bun run test:client` | 27 个文件，119/119 通过 |
| `bun run test:bun-http-runtime` | 真实 Bun HTTPS、SQLite、安全头和 SIGTERM 优雅退出通过 |
| `bun run build` | 静态检查与 Vite 8 production build 通过 |
| `bun run audit:production` | 检查 498 个包，high/critical 漏洞 0 |
| `CDP_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 bun run test:cdp:all-mock` | 无重试 18/18 脚本通过；使用本地 Mock Provider，未截图 |

CDP 完成后确认 5173、5184、7001、7701-7705 无本轮遗留监听进程。自动化使用临时数据和明确测试会话清理逻辑，未触碰用户现有会话。

## 未执行

- Docker build、Compose 启动、容器 smoke、Docker UI、Volume 新卷恢复与镜像边界：属于 R29。
- DeepSeek/OpenAI/Vision 真实 Provider：本阶段未改变 Provider 请求或解析语义，没有获得新的付费接口证据。
