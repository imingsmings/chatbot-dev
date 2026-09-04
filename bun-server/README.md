# Bun Server

`bun-server/` 是 chatbot 的独立 Bun 1.4 后端。它与 `server/` 保持相同的 Express 路由、环境变量、持久化格式、认证规则和 NDJSON v2 流协议，但不导入 Node 后端的业务源码。

仓库使用 Bun 1.4 管理依赖、workspace、catalog 和权威根 `bun.lock`；Bun 同时执行该后端及其原生 `bun:test` 兼容测试。

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
bun run test:cdp:all-mock:bun
```

Docker 打包不在当前 Bun 工具链交付范围内；真实 Provider 沿用 R24 功能证据，R25 不重复调用付费接口。
