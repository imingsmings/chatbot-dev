# R25 Bun 工具链迁移验收记录

日期：2026-09-04

## 结论

R25 已把本地依赖安装、workspace/catalog、脚本编排、前端工具执行和 Bun 后端测试迁移到 Bun 1.4。`bun.lock` 是新的权威锁文件；45 个 Bun 后端测试文件直接使用 `bun:test`，不再通过 `node:test` 兼容层和逐文件 Node runner。

本阶段不改变 Express、`node:sqlite`、API、环境变量、持久化格式或 NDJSON v2。Node 后端和 Node 单测继续保留为过渡对照。真实 Provider 沿用 R24 的功能证据；R25 没有付费调用。Docker 仍是 Node/pnpm 旧链路，本阶段没有运行或宣称容器通过。

## 主要决策

- 根 `packageManager` 固定为 `bun@1.4.0`，根 `package.json` 直接声明三个 workspace 和共享 catalog。
- `bun.lock` 负责本地 frozen install、开发、构建、测试与审计；`bunfig.toml` 使用 isolated linker，避免 hoisted 依赖掩盖 workspace 声明缺失。
- `argon2` 是唯一 trusted dependency；安装后 `bun pm untrusted` 应为 0。
- TypeScript、Oxlint、Vite 与 Vitest 使用 `bun --bun`，确保 CLI 的 JavaScript 运行时也是 Bun；Node 服务启动和 Node 单测仍显式使用 `node`。
- Bun 后端测试使用 `bun test --isolate --parallel=1`，并将 `node:test` 的 suite hooks/conditional skip 迁移为 `bun:test` 等价 API。
- CDP 总入口、子场景和 Vite wrapper 全部由 Bun 启动；进程组清理语义保持 R24 修复后的实现。
- `pnpm-workspace.yaml`/`pnpm-lock.yaml` 只作为延期 Node Docker 的迁移输入临时保留。两者不再是本地工具链事实源，R29 完成 Bun Docker 后删除。

## 变更范围

| 范围 | 结果 |
| --- | --- |
| 根工具链 | Bun package manager、workspace/catalog、trusted dependencies、`bun.lock`、isolated linker |
| 前端 | Vite/Vitest/TypeScript/Oxlint 由 Bun 执行 |
| Node 后端 | 安装与 TypeScript 检查由 Bun 调度；运行和 177 项基线测试仍用 Node |
| Bun 后端 | 类型检查、启动与 174 项测试均由 Bun 执行 |
| CDP/runtime | runner、子场景、Vite、parity 和 benchmark 改由 Bun 调度 |
| 文档 | README、架构、功能、Roadmap、测试矩阵和部署边界同步 |

## 验证证据

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 通过；锁文件无变化 |
| `bun run test:toolchain` | 3/3 通过 |
| `bun run check` | server/bun-server/client 类型检查与两级 Oxlint 通过 |
| `bun run test:server` | 177/177 通过 |
| `bun run test:bun-server` | 174/174 通过，45 个文件，0 fail |
| `bun run test:client` | 119/119 通过，27 个文件 |
| `bun run test:backend-parity` | 通过；API、NDJSON v2 与重启持久化一致 |
| `bun run build:client` | 通过；Vite 8.2.0 构建 2173 个模块 |
| `CDP_SCREENSHOTS=0 CDP_SCRIPT_RETRIES=0 bun run test:cdp:image-attachments` | 通过；刷新、分支、失败重试、模型拦截、停止和 390px 布局断言成立 |
| `CDP_SCREENSHOTS=0 CDP_SCRIPT_RETRIES=0 bun run test:cdp:all-mock:bun` | 通过；18 个脚本，无重试、无截图、无真实 Provider |
| `bun run audit:production` | 初次发现 `fast-uri 3.1.5` 的 4 个 high；已按官方公告锁到 3.1.7。复验因 npm audit endpoint 超时未得到最终漏洞计数 |

## 测试中发现并修复的问题

首次无重试全量 Mock 在图片刷新场景失败。失败截图实际已显示持久化消息，原因是 `Page.reload` 后的等待条件可能在旧 document 尚未卸载时立即满足；Node 启动子脚本时的时序曾掩盖该竞态。

修复为每个新 document 注入唯一 id，reload 后先断言 document id 已换代，再验证图片与回答。该断言强化了原有语义，没有放宽图片持久化要求。聚焦图片专项和随后无重试全量 Mock 均通过。

## 风险与后续

- `fast-uri 3.1.7` 已写入 Bun override、`bun.lock` 和临时 pnpm override/lock，并有工具链测试守卫；npm 漏洞接口本轮持续超时，因此不能把复验写成“审计 0 漏洞”。网络恢复后应重新运行 `bun run audit:production`。
- 当前不是“纯 Bun 运行时”：Express、`node:sqlite`、Node 对照后端和 Node Docker 仍存在。
- 根 `packageManager` 已切到 Bun，而旧 Dockerfile 仍直接调用 pnpm；因为 Docker 被明确延期，R25 未对该组合做运行保证。R29 必须迁移并重新验证镜像后才能恢复容器交付结论。
- 下一阶段 R26 应只迁移 Bun 后端 SQLite 层到 `bun:sqlite`，先覆盖会话、认证 Session、事务回滚、WAL/重启和原子导入，不同时改 HTTP 框架。
- R27 再迁移 `Bun.serve`，R28 删除 Node 对照链路，R29 最后完成 Bun Docker 与部署收口。

## 回滚

恢复 R24 的根 package manager 与脚本、还原 Bun 测试导入/hooks、恢复测试 runner，并删除 `bun.lock` 与 `bunfig.toml`。本阶段没有数据 schema 或用户数据迁移，回滚不需要修改会话、附件或认证 Session。
