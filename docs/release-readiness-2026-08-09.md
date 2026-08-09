# 阶段交付审查（2026-08-09）

结论：React-only 客户端、Express 5 后端、统一 TypeScript 7 工具链和单机/局域网 HTTPS 部署已达到本阶段交付门槛。本轮没有增加产品功能，工作限定为缺陷修复、边界加固、依赖维护、测试和文档。

## 审查范围

- React：会话状态、流式生命周期、模型目录、NDJSON、Markdown、滚动、异步操作和错误恢复。
- Backend：路由校验、上下文/摘要、Function Calling、provider adapters、超时/取消、file/SQLite、导入导出和运行配置。
- Production：React 构建托管、统一 `/api`、SPA 回退、缓存、安全头、TLS 启动校验和本机证书。
- Supply chain：生产依赖清单、废弃依赖和已知漏洞。
- Documentation：README、架构图、功能边界、Roadmap、迁移、部署和测试矩阵。

## 主要修复

### React

- 删除当前会话时立即清空 active detail，避免后继加载失败显示已删除内容。
- 首包超时覆盖 fetch 等待响应头阶段；结束后清理取消 ID、timer 和 refs。
- 摘要在生成/切换期间禁用并由 handler 二次保护。
- 运行时模型目录为空、含空 model 或损坏字段时使用安全 fallback。
- NDJSON 拒绝负 reasoning duration、空 tool ID/name 和空 error message。
- 非 2xx 流、下载、删除和取消保留后端返回的可读错误。
- 流式代码块位于底部时由 MutationObserver/rAF 持续跟随；用户主动上滚时不抢滚动。

### Backend

- file store 将完整 read-modify-write 纳入单会话队列，并使用同目录临时文件 + rename 原子替换。
- 文件名决定会话 ID；非法时间恢复；损坏单文件被隔离且不阻塞其他会话，也不自动删除源文件。
- 同一会话仅允许一个活动 ask；落盘前会话被删除时拒绝假成功。
- 摘要随断连取消，生成期间会话变化时拒绝陈旧写入。
- LLM timeout 持续覆盖响应头之后的 body/stream stall。
- Provider URL 只允许 HTTP/HTTPS；天气 lookup/HTTP/network 错误稳定化并使用本地日历日期。
- 标题、搜索、问题、导入数和单会话消息数集中在 `productLimits.ts`。
- 存储类型解析抽离到独立配置模块，业务读取运行配置不再加载存储实现副作用。
- 生产未处理 5xx 不向客户端返回内部异常细节。

### Production 与依赖

- `NODE_ENV=production` 默认启用 `client/dist` 托管和 Node HTTPS。
- API 固定为 `/api/*`；生产根路径不再暴露会遮蔽 SPA 的兼容 API。
- 缺少 build、证书无效/未生效/过期、私钥格式错误或密钥不匹配均 fail-fast。
- HTML 使用 `no-cache`，hash assets 使用一年 immutable cache；API 404 永不回退 HTML。
- 移除未使用且废弃的 `jade`。
- Express `4.16.4 -> 4.22.2 -> 5.2.1`，配套 `@types/express 5.0.6`、debug 4.4.3 和 http-errors 2.0.1。
- client/server 统一 TypeScript 7.0.2，通过根 pnpm catalog 和 `tsconfig.base.json` 单点管理。
- 子项目 lockfile/workspace 收口为根 workspace 和单一 `pnpm-lock.yaml`。
- `pnpm run audit:production`：整个 workspace 0 已知漏洞。

## 验证证据

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | Server/Client TS 7.0.2、共享 tsconfig、Oxlint/类型感知 lint 通过 |
| `pnpm run test:server` | 77 / 77 通过 |
| `pnpm run test:client` | 14 files，53 / 53 通过 |
| `pnpm run build:client` | Vite 8.2.0 构建通过；最大 chunk 208.04 kB / gzip 80.91 kB |
| `pnpm run test:cdp:all-mock` | 10 / 10 脚本通过，无截图、无真实模型 |
| `pnpm run audit:production` | workspace 生产依赖 0 已知漏洞 |
| `pnpm run test:cdp:real` | DeepSeek 真实 UI/上下文/Markdown 3 / 3 通过 |
| `pnpm run test:cdp:real-model-options` | DeepSeek V4 Flash/Pro 与 Effort 矩阵 8 / 8 通过 |
| `pnpm run test:cdp:real-openai` | OpenAI Responses 流式/reasoning/工具/停止恢复 16 / 16 通过 |
| `git diff --check` | 通过 |

CDP 包含：上游中止、P0/P1 API/工具、核心 UI、Markdown、安全高亮、上下文预览、搜索、导出、Roadmap 和侧栏异步状态。滚动专项测得流式代码块增长后 `bottomGap=0`；390px viewport 无页面级横向溢出。

HTTPS 冒烟使用真实 `client/dist`、`~/devhttps` 证书、临时 `127.0.0.1:7443`，12 项断言全部通过：受信证书、React HTML、SPA shell、runtime providers、凭据不下发、HSTS、nosniff、frame deny、HTML no-cache、asset immutable、API 404 状态与 JSON 文案。测试服务和临时文件已关闭/清理。

## 明确边界

- 本轮经用户明确授权调用了真实 DeepSeek 和 OpenAI；未调用真实天气服务，未生成截图。会话使用临时存储并按 ID 清理。
- 当前 mkcert 证书仅适合已信任本机 CA 的本机/局域网，不能替代公共域名 CA 证书。
- 产品没有登录、多用户隔离、限流、WAF、集中日志或自动证书续期，不应匿名暴露公网。
- Vue 源码和工具链已删除；回滚依赖 Git，不保留双运行时。

## 交付判定

本阶段无已知阻断项。后续若恢复功能开发，应先从新需求建立独立 Roadmap 条目；不得把本阶段的安全/并发/协议断言降级为可选测试。

工具链与 Express 5 的细节见 [TypeScript 7 / Express 5 工具链升级记录](toolchain-upgrade-2026-08-09.md)。
