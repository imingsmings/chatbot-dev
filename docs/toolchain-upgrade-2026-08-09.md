# TypeScript 7 / Express 5 工具链升级记录

日期：2026-08-09

## 结论

- client/server 统一使用 TypeScript 7.0.2，workspace 中只解析到一个 TypeScript 版本。
- 根 `tsconfig.base.json` 承载两端共用严格规则，DOM/JSX/Bundler 和 NodeNext 差异仍保留在子配置。
- Express 由 4.22.2 升级到当前稳定版 5.2.1，`@types/express` 升级到 5.0.6。
- 直接运行时依赖同步锁定：cookie-parser 1.4.7、debug 4.4.3、dotenv 17.4.2、http-errors 2.0.1、morgan 1.11.0。
- 生产依赖审计由根 `pnpm run audit:production` 统一执行，结果为 0 已知漏洞。

## Workspace 与配置

```text
pnpm-workspace.yaml
  catalog: typescript 7.0.2 / @types/node 22.20.1
tsconfig.base.json
  strict / noEmit / verbatimModuleSyntax / side-effect imports / casing
client/tsconfig.app.json
  DOM / JSX / Bundler / Vite
client/tsconfig.node.json
  Vite/Vitest Node config
server/tsconfig.json
  ES2024 / NodeNext / erasableSyntaxOnly
```

安装和 CI 从仓库根目录执行 `pnpm install --frozen-lockfile`，只保留根 `pnpm-lock.yaml`。子项目不再维护独立 workspace 和 lockfile，避免 TypeScript 与转移依赖漂移。

## Express 5 兼容审查

按 [Express 5 官方迁移指南](https://expressjs.com/en/guide/migrating-5/) 检查了路由语法、`req.query`、body parser、异步错误、静态文件与 `sendFile`：

- 无旧式未命名 `*`、`?` 可选路由或路由正则字符串。
- 不写入 `req.query`；`express.urlencoded` 已显式使用 `extended: false`。
- 状态码为有效整数，无 Express 4 已删除的 response 方法签名。
- React 托管使用固定 `express.static` 选项和绝对 `sendFile` 路径，API 404 不回退 HTML。
- Node.js 基线 `>=22.18.0` 高于 Express 5 的 Node 18 最低要求。

## 验证证据

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 3 个 workspace project，lockfile 无变更 |
| client/server `tsc -v` | 均为 7.0.2；`pnpm why -r typescript` 仅 1 个版本 |
| `pnpm run check` | 两端类型检查与 Oxlint/tsgolint 通过 |
| `pnpm run test:server` | 77 / 77 通过 |
| `pnpm run test:client` | 14 files，53 / 53 通过 |
| `pnpm run build` | Vite 8.2.0 生产构建通过 |
| `pnpm run audit:production` | 0 已知漏洞 |
| `pnpm run test:cdp:all-mock` | 10 / 10 脚本通过 |
| `pnpm run test:cdp:real` | DeepSeek 真实 UI/上下文/Markdown 3 / 3 通过 |
| `pnpm run test:cdp:real-model-options` | V4 Flash/Pro × Off/Low/Medium/High，8 / 8 通过 |
| `pnpm run test:cdp:real-openai` | OpenAI Responses 16 / 16 断言通过 |

真实测试使用独立临时会话目录，通过明确 ID 删除测试会话，未生成截图。
