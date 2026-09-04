# React 迁移收口记录

状态：React-only 切换已完成；2026-08-09 最终静态检查、77 个后端测试、49 个 React 测试、生产构建和 10 个 CDP mock 脚本均通过。

## 决策

2026-08-09 用户明确要求删除 Vue 版本，后续只使用 React。该决定取代此前“Vue 默认、React 并行”的临时边界。

## 最终拓扑

```text
client/                 唯一 React 客户端
server/                 Express/TypeScript 后端
tests/client/           React unit/component/hook 测试
tests/server/           后端测试
tests/cdp/              React-only 浏览器/API 回归
```

- 根客户端命令统一指向 `client/`。
- React 开发端口由并行期的 5174 收敛为标准 5173。
- `/api`、后端 7001、NDJSON v2 和用户会话数据格式不变；开发代理不再移除 `/api` 前缀。

## 最终技术基线

| 类别 | 选型 |
| --- | --- |
| Framework | React 19 |
| TypeScript | 7.0.2，与 server 共用根 catalog 和 `tsconfig.base.json` |
| Build | Vite 8 |
| CSS | Tailwind CSS 4 |
| UI | shadcn/ui Base UI |
| Icons | Lucide React |
| Lint | Oxlint + tsgolint |
| Unit | Vitest + Testing Library + jsdom |
| Browser | 复用现有 CDP runner，默认 React |

## 已移除

- Vue SFC、composables 和 Vue-only styles。
- Vue、`@vitejs/plugin-vue`、Volar/vue-tsc、Vue ESLint 配置和 lockfile 依赖。
- 旧版 `tests/client/*` Vue 纯逻辑测试与 Vue/React parity 测试。
- `dev:client:react` 等并行期重复脚本。
- 双客户端端口、目录和日常回归分支。

React 的对应 Vitest 覆盖统一位于 `tests/client/**/*.test.*`，源码目录不再混放测试文件；迁移目录不降低测试门槛。

迁移后工具链已进一步收口：根 Bun workspace 统一 client/server/bun-server 安装与 `bun.lock`，TypeScript 版本由 catalog 单点管理，前后端通用编译规则放在 `tsconfig.base.json`。

## 迁移后的责任边界

| 责任 | 落点 |
| --- | --- |
| 页面组合 | `client/src/app/App.tsx` |
| 业务生命周期 | `client/src/hooks/*` |
| 纯状态转换 | `client/src/reducers/*` |
| HTTP/NDJSON | `client/src/api/*` |
| 模型目录/协议/Markdown | `client/src/utils/*` |
| UI primitives | `client/src/components/ui/*` |
| 主题/基础/Markdown CSS | `client/src/styles/globals.css` |

业务布局与响应式优先使用 Tailwind utilities；全局 CSS 仅承载 tokens、基础滚动、Markdown/高亮和无法合理内联的复杂样式。

## 本次交付加固

### React

- 删除当前会话时立即清理 active detail，避免后继加载失败留下悬空状态。
- 首包等待与流空闲共享超时，覆盖 fetch 尚未返回响应头的情况。
- cancel 去重集合在请求结束后清理。
- 摘要在流式响应/会话切换期间禁用并在 handler 内二次防护。
- 运行时 provider/model 目录为空或含非法 model 时安全降级。
- NDJSON 拒绝负 reasoning duration、空 tool 名/ID 和空错误消息。
- 非 2xx 流/下载/删除/取消保留后端错误消息。

### 后端

- file store 对同会话完整 read-modify-write 串行化。
- JSON 写入改为同目录临时文件 + rename；异常清理临时文件。
- 文件名决定会话 ID；损坏时间戳规范化。
- 同一会话只允许一个活动 ask。
- 会话在回答落盘前删除时返回明确错误。
- 摘要生成期间会话发生变化时拒绝写入陈旧摘要。
- 摘要请求随客户端断开取消。
- Provider endpoint 限制为 HTTP/HTTPS。
- 天气 lookup/network/HTTP 错误统一为稳定错误，本地日期不再经 UTC 截断。
- 关键产品限制抽离至 `server/config/productLimits.ts`。
- 生产环境未处理 5xx 使用通用文案。

## 验收门槛

```bash
bun run check
bun run test:unit
bun run build:client
bun run test:cdp:all-mock
```

生产收口另需验证 Express 托管、SPA 回退和 HTTPS，见 [生产部署说明](production-deployment.md)。

关键断言还包括：

- 文件/SQLite 临时目录隔离，测试会话清理。
- 同会话并发写无消息丢失，无 `.tmp` 残留。
- Strict Mode 不重复创建会话。
- 超时、取消、协议错误后可以继续发起请求。
- streaming code block 处于底部时持续跟随，用户上滚时不强拉。
- 390px 无页面级横向溢出。
- build 中无 Vue runtime 或 Vue 工具链依赖。

真实模型、真实天气和截图不属于默认验收；只有用户明确要求时执行。

## 回滚

Vue 代码不再作为运行时回滚副本保留。若切换产生阻断问题，应通过 Git 恢复迁移前提交；file/SQLite 数据协议未改变，因此不需要数据迁移或回滚。不要把旧 Vue 依赖重新混入当前 React lockfile。
