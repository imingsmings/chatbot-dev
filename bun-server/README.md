# Bun Server

`bun-server/` 是 chatbot 的独立 Bun 1.4 后端。它与 `server/` 保持相同的 Express 路由、环境变量、持久化格式、认证规则和 NDJSON v2 流协议，但不导入 Node 后端的业务源码。

仓库继续使用 pnpm 管理依赖、workspace 和唯一的根 lockfile；Bun 只负责运行该后端及其兼容测试。

```bash
pnpm install --frozen-lockfile
cp bun-server/.env.example bun-server/.env
pnpm run dev:bun-server
```

默认端口仍为 `7001`。Node 与 Bun 后端并行运行时，应显式设置不同的 `PORT`。Bun 运行数据默认位于 `bun-server/data/`，不得与正在运行的 Node 进程共享写入路径。

验证命令：

```bash
pnpm run typecheck:bun-server
pnpm run test:bun-server
pnpm run test:backend-parity
pnpm run test:cdp:all-mock:bun
```

Docker 打包和真实 Provider 验证不在当前 Bun 后端交付范围内。
