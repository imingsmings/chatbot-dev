# chatbot-dev

面向个人学习和内部使用的 local-first AI 聊天项目。前端使用 Vue 3 + Vite，后端使用 Express + TypeScript，重点覆盖流式协议、模型适配、Function Calling、reasoning、上下文管理和本地持久化。

## 当前能力

- 多会话：创建、切换、重命名、清空、删除、标题自动生成。
- 会话管理：标题/消息搜索、单会话 Markdown 导出、全量 JSON 导入导出。
- 本地存储：默认单会话 JSON 文件；可选 SQLite；支持 JSON 到 SQLite 幂等迁移。
- 模型接入：DeepSeek-compatible adapter，支持 temperature、max tokens、thinking 和 reasoning effort。
- 流式链路：provider SSE 转应用 NDJSON v2，事件包含正文、reasoning、工具状态、完成和错误。
- Thinking：流式展示、耗时记录、持久化和历史恢复。
- 上下文：最近消息数/字符窗口、手动会话摘要、模型 request preview。
- Function Calling：天气、当前时间和安全表达式计算器。
- Prompt 模板：代码解释、Bug 分析、方案评审、翻译润色、周报和学习计划，支持变量表单。
- Markdown：净化、流式轻量渲染、完成态代码高亮、语言标签、代码复制、安全外链和表格。
- 停止生成：前端 abort、cancel API、后端 request registry 和 provider/tool upstream abort。
- 异步 UI 状态：初始化、会话操作、导入导出和停止过程均有等待态、按钮互斥与重复点击保护。
- 回归：Node 单元测试与基于 CDP 的 mock 浏览器回归。

## 架构

```text
Vue components
  -> composables
  -> HTTP API / NDJSON parser
  -> Express routes
  -> controllers
  -> chat/context/import/export/summary services
  -> LLM adapter | tool registry | conversation store
  -> provider SSE | external tool | JSON/SQLite
```

开发环境中，浏览器请求 `/api/*`，Vite 将其代理到 `http://127.0.0.1:7001` 并去掉 `/api` 前缀。

流式响应链路：

```text
DeepSeek-compatible SSE
  -> server adapter parses data lines
  -> server emits app-level NDJSON v2
  -> client fetch + ReadableStream parser
  -> reasoning, tool state and assistant Markdown
```

详细设计：

- [架构与扩展边界](docs/architecture.md)
- [流式协议 v2](docs/streaming-protocol.md)
- [实验记录](docs/experiments.md)
- [当前 roadmap](docs/roadmap.md)

## 运行要求

- Node.js `>=22.18.0`
- pnpm

安装前后端依赖：

```bash
pnpm --dir server install
pnpm --dir client install
```

## 环境配置

```bash
cp server/.env.example server/.env
```

然后在 `server/.env` 填写本地配置。不要提交该文件。

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端端口，默认 `7001` |
| `LLM_PROVIDER` | provider adapter，当前支持 `deepseek` |
| `LLM_ENDPOINT` | Chat Completions endpoint，启动必填 |
| `LLM_MODEL` | provider model name，启动必填 |
| `LLM_TIMEOUT_MS` | 上游超时毫秒数 |
| `LLM_TEMPERATURE` | 默认 temperature，范围 `0..2` |
| `LLM_MAX_TOKENS` | 默认最大输出 token 数 |
| `LLM_REASONING_ENABLED` | 默认是否开启 thinking/reasoning |
| `LLM_REASONING_EFFORT` | 默认 reasoning effort |
| `DEEPSEEK_API_KEY` | DeepSeek adapter 凭据 |
| `HEFENG_API_HOST` | 天气 API host，仅调用天气工具时校验 |
| `HEFENG_API_KEY` | 天气 API key，仅调用天气工具时校验 |
| `CONTEXT_MAX_HISTORY_MESSAGES` | 发给模型的最大历史消息数，默认 `20` |
| `CONTEXT_MAX_HISTORY_CHARS` | 历史消息字符预算，默认 `12000` |
| `CONVERSATION_STORE` | `file`/`json`/`fs` 或 `sqlite`/`sqlite3` |
| `CONVERSATION_DATA_DIR` | 可选数据根目录，测试时使用临时目录 |
| `CONVERSATION_FILE_DATA_DIR` | 可选 file store 目录覆盖 |
| `CONVERSATION_DB_PATH` | 可选 SQLite 路径覆盖 |

启动时会校验核心 LLM、参数和存储配置。`GET /runtime-config` 只返回 provider、model、存储类型、默认参数和凭据是否配置，不返回 key 原值。

## 本地开发

终端 1：

```bash
pnpm run dev:server
```

终端 2：

```bash
pnpm run dev:client
```

本机打开：

```text
http://localhost:5173
```

局域网其他机器打开：

```text
http://<开发机局域网IP>:5173
```

Vite 监听 `0.0.0.0`，API proxy 仍连接开发机本地 `127.0.0.1:7001`。系统防火墙也必须允许 Node/Vite 接收入站连接。

## API 摘要

| Method | Path | 说明 |
| --- | --- | --- |
| `GET/POST` | `/conversations` | 列表、新建 |
| `GET/PATCH/DELETE` | `/conversations/:id` | 详情、重命名、删除 |
| `POST` | `/conversations/:id/clear` | 清空消息和摘要 |
| `POST` | `/conversations/:id/ask` | NDJSON 流式问答 |
| `POST` | `/conversations/:id/context-preview` | 查看实际模型上下文和参数 |
| `POST` | `/conversations/:id/summary` | 生成或重新生成摘要 |
| `GET` | `/conversations/search?q=` | 搜索标题和消息 |
| `GET` | `/conversations/:id/export.md` | 导出单会话 Markdown |
| `GET` | `/conversations/export.json` | 导出 schema v1 全量备份 |
| `POST` | `/conversations/import` | 导入备份，策略为 `skip`/`duplicate`/`overwrite` |
| `POST` | `/requests/:requestId/cancel` | 显式取消活动请求 |
| `GET` | `/runtime-config` | 非敏感运行配置 |

`/ask` 与 `/context-preview` 接受本次请求选项：

```json
{
  "options": {
    "temperature": 0.3,
    "maxTokens": 2048,
    "reasoningEnabled": true,
    "reasoningEffort": "high"
  }
}
```

## 代码边界

后端：

- `server/routes/*`：只注册路由。
- `server/controllers/*`：HTTP 输入输出。
- `server/services/chatService.ts`：聊天与两阶段 Function Calling 编排。
- `server/services/contextService.ts`：摘要和最近消息窗口。
- `server/services/toolService.ts`：工具注册、执行和状态事件。
- `server/tools/*`：单个工具 schema、校验和实现。
- `server/utils/llm/*`：provider adapter 和流解析。
- `server/utils/conversationStore.ts`：file/SQLite 统一持久化。

前端：

- `client/src/App.vue`：应用组合和高层事件。
- `client/src/api/conversations.ts`：API 契约。
- `client/src/composables/useConversations.ts`：会话状态。
- `client/src/composables/useChatStream.ts`：流式请求、取消和工具状态。
- `client/src/utils/streamProtocol.ts`：NDJSON v2 运行时校验。
- `client/src/utils/markdownRenderer.ts`：Markdown、安全和高亮。

## 检查与测试

基础检查：

```bash
pnpm run check
pnpm run build:client
pnpm run test:unit
```

专项测试：

```bash
pnpm run test:context
pnpm run test:conversation-search
pnpm run test:conversation-export
pnpm run test:conversation-summary
pnpm run test:conversation-import
pnpm run test:model-options
pnpm run test:llm-adapter
pnpm run test:tools
pnpm run test:client-logic
```

CDP mock 回归：

```bash
pnpm run test:cdp:p0
pnpm run test:cdp:ui
pnpm run test:cdp:context-debug
pnpm run test:cdp:conversation-search
pnpm run test:cdp:conversation-export
pnpm run test:cdp:roadmap
pnpm run test:cdp:sidebar-state
pnpm run test:cdp:markdown
pnpm run test:cdp:highlight
pnpm run test:cdp:all-mock
```

真实 provider 套件被刻意隔离：

```bash
pnpm run test:cdp:real
```

只有明确要验证真实模型或真实工具时才运行。`all-mock` 包含 P0、完整 UI、上下文、搜索、导出、Roadmap、侧栏状态、Markdown 和高亮专项。测试定义见 [回归测试用例](docs/regression-test-cases.md)，当前阶段执行证据见 `docs/cdp-regression-results-2026-07-31.md`。
