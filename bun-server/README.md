# Bun Server

`bun-server/` 是 chatbot 的独立 Bun 1.4 后端。HTTP/HTTPS 由 `Bun.serve` 直接承载，内部使用轻量路由/响应适配器；它与 Node `server/` 保持相同的 API、环境变量、持久化格式、认证规则和 NDJSON v2 流协议，但不导入 Node 后端的业务源码。

仓库使用 Bun 1.4 管理依赖、workspace、catalog 和权威根 `bun.lock`；Bun 同时执行该后端及其原生 `bun:test` 测试。会话 SQLite 和认证 Session Store 使用 `bun:sqlite`，静态构建使用 `Bun.file`，multipart 使用有界 Web `FormData` 解析，NDJSON 写入通过 Web Stream 等待下游背压。数据库路径、schema 和对外协议均与 Node 基线兼容。

```bash
bun install --frozen-lockfile
cp bun-server/.env.example bun-server/.env
bun run dev:bun-server
```

默认端口仍为 `7001`。Node 与 Bun 后端并行运行时，应显式设置不同的 `PORT`。Bun 运行数据默认位于 `bun-server/data/`，不得与正在运行的 Node 进程共享写入路径。

验证命令：

```bash
bun run typecheck:bun-server
bun run test:bun-server
bun run test:backend-parity
bun run test:bun-http-runtime
bun run test:sqlite-runtime-compatibility
bun run test:cdp:all-mock:bun
```

Docker 打包与默认生产脚本切换不在 R27 交付范围内；真实 Provider 沿用 R24 功能证据，R27 不重复调用付费接口。
