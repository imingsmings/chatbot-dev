# Bun Server

`bun-server/` 是 chatbot 的唯一后端。HTTP/HTTPS 由 Bun 1.4 `Bun.serve` 直接承载，内部使用轻量路由/响应适配器，并保持既有 API、环境变量、持久化格式、认证规则和 NDJSON v2 流协议。

仓库使用 Bun 1.4 管理依赖、workspace、catalog 和权威根 `bun.lock`；Bun 同时执行该后端及其原生 `bun:test` 测试。会话 SQLite 和认证 Session Store 使用 `bun:sqlite`，静态构建使用 `Bun.file`，multipart 使用有界 Web `FormData` 解析，NDJSON 写入通过 Web Stream 等待下游背压。数据库路径、schema 和对外协议在 R28 中没有改变。

```bash
bun install --frozen-lockfile
cp bun-server/.env.example bun-server/.env
bun run dev:server
```

默认端口仍为 `7001`，运行数据默认位于 `bun-server/data/`。如果要复用旧 `server/data/`，应先停止所有旧进程、完成备份，再通过 `CONVERSATION_DATA_DIR` 显式指向该目录，不能并发写入。

验证命令：

```bash
bun run typecheck:server
bun run test:server
bun run test:bun-http-runtime
bun run test:cdp:all-mock
```

本地 production 与 Docker 均使用 Bun 1.4.0；容器验收运行 `bun run test:docker`。R29 未改变 Provider 请求形状，因此真实 Provider 仍使用既有功能证据，没有重复调用付费接口。
