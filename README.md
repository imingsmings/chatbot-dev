# chatbot-dev

面向个人学习和内部使用的 local-first AI 聊天项目。前端为 React 19 + TypeScript 7 + Vite 8，后端为 Express 5 + TypeScript 7；重点覆盖可靠流式输出、模型适配、Function Calling、上下文管理和本地持久化。

Vue 客户端已在 2026-08-09 完成下线，`client/` 现在是唯一的 React 客户端。迁移记录见 [React 迁移收口文档](docs/react-migration-plan.md)。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript 7、Vite 8 |
| UI | Tailwind CSS 4、shadcn/ui Base UI、Lucide React |
| 前端质量 | Oxlint/tsgolint、Vitest、Testing Library、jsdom |
| 后端 | Express 5.2、TypeScript 7、Node.js `>=22.18` |
| 工具链 | 根 pnpm workspace/catalog、共享 `tsconfig.base.json` |
| 存储 | 单会话 JSON 文件或 SQLite |
| 模型 | DeepSeek Chat Completions、OpenAI Responses adapter |
| 回归 | Node test、Vitest、CDP 浏览器自动化 |

## 当前能力

- 多会话创建、切换、重命名、清空、删除和自动标题。
- 历史用户消息编辑、已完成回答重新生成和不改写原会话的独立分支。
- 标题/消息搜索，单会话 Markdown 导出，全量 JSON 备份与导入。
- file/SQLite 本地存储及旧 JSON 到 SQLite 幂等迁移。
- DeepSeek / OpenAI provider、模型和推理强度的请求级切换。
- provider SSE 到应用 NDJSON v2 的稳定流式协议；异常 EOF 不发送成功 `done` 且不落库。
- reasoning 展示、耗时、持久化和历史恢复。
- 天气、当前时间和安全表达式计算器 Function Calling。
- 摘要覆盖边界后的消息/字符上下文窗口、有输入预算的增量摘要和带覆盖范围统计的实际上下文预览。
- 6 个内置 Prompt 模板，以及浏览器本地自定义模板 CRUD、JSON 导入导出和变量替换。
- Markdown 净化、代码高亮/复制和安全外链。
- 前端 fetch abort、cancel API、后端 registry 与上游 AbortSignal 全链路停止；确认清理后回拉持久化详情。
- 明暗主题、响应式布局、滚动跟随及流式代码块自动滚动。

完整功能与边界见 [功能清单](docs/features.md)。

## 快速开始

要求：Node.js `>=22.18.0`、pnpm。

```bash
pnpm install --frozen-lockfile
cp server/.env.example server/.env
```

在 `server/.env` 填写本地配置，不要提交该文件。分别启动：

```bash
pnpm run dev:server
pnpm run dev:client
```

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:7001`
- Vite 将 `/api/*` 原样代理到后端；开发与生产使用同一 API 路径。

## 环境配置

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端端口，默认 `7001` |
| `HOST` | 监听地址，默认 `0.0.0.0` |
| `SERVE_CLIENT_BUILD` / `CLIENT_DIST_DIR` | 是否托管 React 构建及可选构建目录 |
| `HTTPS_ENABLED` | 是否由 Node HTTPS 直接提供服务 |
| `HTTPS_CERT_PATH` / `HTTPS_KEY_PATH` | TLS 证书和私钥；支持 `~/` 路径 |
| `HTTPS_CA_PATH` | 可选 CA chain 路径 |
| `LLM_PROVIDER` | 默认 provider：`deepseek` 或 `openai` |
| `LLM_ENDPOINT` / `LLM_MODEL` | 默认 provider 的兼容配置 |
| `DEEPSEEK_ENDPOINT` / `DEEPSEEK_MODEL` / `DEEPSEEK_API_KEY` | DeepSeek 专用配置 |
| `OPENAI_ENDPOINT` / `OPENAI_MODEL` / `OPENAI_API_KEY` | OpenAI Responses 专用配置 |
| `LLM_TIMEOUT_MS` | 上游请求超时 |
| `LLM_TEMPERATURE` | 默认 temperature，范围 `0..2` |
| `LLM_MAX_TOKENS` | 默认最大输出 token 数 |
| `LLM_REASONING_ENABLED` / `LLM_REASONING_EFFORT` | 默认 reasoning 配置 |
| `LLM_DISABLED_MODELS` | 逗号分隔的禁用模型 ID |
| `HEFENG_API_HOST` / `HEFENG_API_KEY` | 天气工具配置，仅调用时需要 |
| `CONTEXT_MAX_HISTORY_MESSAGES` | 历史消息上限，默认 `20` |
| `CONTEXT_MAX_HISTORY_CHARS` | 历史字符预算，默认 `12000` |
| `SUMMARY_MAX_INPUT_CHARS` | 单次滚动摘要的输入字符预算，默认 `24000`，最小 `8000` |
| `CONVERSATION_STORE` | `file`/`json`/`fs` 或 `sqlite`/`sqlite3`，默认 `sqlite` |
| `CONVERSATION_DATA_DIR` | 数据根目录覆盖 |
| `CONVERSATION_FILE_DATA_DIR` | file store 目录覆盖 |
| `CONVERSATION_DB_PATH` | SQLite 文件覆盖 |
| `APP_PROFILE_NAME` / `APP_PROFILE_AVATAR_URL` | 侧栏用户资料；头像为 Vite public URL |

Provider endpoint 只接受 HTTP/HTTPS。`GET /api/runtime-config` 只返回非敏感能力、默认值和“是否已配置”，不会返回 key 原值。

## 生产构建与 HTTPS

生产模式由 Express 同源托管 `client/dist`，API 固定使用 `/api/*`，未知 HTML GET 路径回退到 React `index.html`。缺少构建、证书无效/过期或私钥不匹配时启动会失败，而不是静默降级为不安全 HTTP。

```bash
pnpm run build
pnpm run start:production
```

本机默认读取 `~/devhttps/dev-cert.pem` 和 `~/devhttps/dev-key.pem`。完整配置、证书适用范围、上线检查和回滚见 [生产部署说明](docs/production-deployment.md)。

## Docker 局域网部署

Docker 采用单容器拓扑：Node/Express 直接终止 HTTPS，同时提供 React 构建和 `/api/*`，不引入 Nginx。`server/.env` 只在启动时注入，TLS 文件以只读 bind mount 提供，会话数据保存在独立 Docker volume。

```bash
pnpm run docker:config
pnpm run docker:build
pnpm run docker:up
pnpm run docker:status
```

默认从宿主机 `~/devhttps` 读取证书，映射 `7001:7001`。局域网设备通过 `https://<宿主机局域网 IP>:7001` 访问，并需要信任 mkcert 根 CA。镜像设计、环境变量、数据迁移、验证和回滚见 [Docker 部署说明](docs/docker-deployment.md)，本轮实际结果见 [Docker 验证记录（2026-08-10）](docs/docker-validation-2026-08-10.md)。

## 目录

```text
client/                         React 业务客户端
  src/app/                      页面组合
  src/components/               展示与 shadcn UI 组件
  src/hooks/                    会话、流式、搜索、主题、滚动生命周期
  src/reducers/                 conversation/stream 纯状态转换
  src/api/                      HTTP 与 NDJSON reader
  src/utils/                    Markdown、协议、模型目录、模板
shared/                         前后端共用 NDJSON v2 事件与协议常量
server/
  config/                       产品限制、构建托管和部署/TLS 配置
  routes/                       路由注册
  controllers/                  HTTP 校验和状态码
  services/                     聊天、上下文、摘要、导入导出、工具编排
  tools/                        工具 schema、参数校验和 handler
  utils/llm/                    provider 配置、目录、adapter 和 SSE 解析
  utils/conversationStore.ts    file/SQLite 稳定 facade
  utils/conversationStore/      契约、规范化/迁移和两种存储实现
tests/client/                   React unit/component/hook 测试及 setup
tests/server/                   后端单元、存储和异常测试
tests/cdp/                      浏览器/API 回归及拆分后的 UI 场景入口
docs/                           架构、协议、功能、路线图和测试文档
pnpm-workspace.yaml             client/server workspace 与公共版本 catalog
tsconfig.base.json             前后端共用 TypeScript 严格规则
```

## API 摘要

| Method | Path | 说明 |
| --- | --- | --- |
| `GET/POST` | `/api/conversations` | 列表、新建 |
| `GET/PATCH/DELETE` | `/api/conversations/:id` | 详情、重命名、删除 |
| `PATCH` | `/api/conversations/:id/model-options` | 保存当前会话的完整模型配置 |
| `POST` | `/api/conversations/:id/clear` | 清空消息和摘要 |
| `POST` | `/api/conversations/:id/branches` | 从已保存用户消息前创建独立分支 |
| `POST` | `/api/conversations/:id/ask` | NDJSON v2 流式问答 |
| `POST` | `/api/conversations/:id/context-preview` | 实际上下文预览 |
| `POST` | `/api/conversations/:id/summary` | 生成摘要 |
| `GET` | `/api/conversations/search?q=` | 搜索标题和消息 |
| `GET` | `/api/conversations/:id/export.md` | 单会话 Markdown |
| `GET` | `/api/conversations/export.json` | 全量 schema v1 备份 |
| `POST` | `/api/conversations/import` | `skip`/`duplicate`/`overwrite` 导入 |
| `POST` | `/api/requests/:requestId/cancel` | 取消活动请求 |
| `GET` | `/api/runtime-config` | 非敏感运行配置和模型能力目录 |

## 检查与测试

```bash
pnpm run check                 # server/client 类型检查 + React lint
pnpm run test:unit             # 全部后端 Node tests + React Vitest
pnpm run build                 # 全部静态检查 + React 生产构建
pnpm run audit:production      # 整个 workspace 生产依赖审计
pnpm run test:cdp:all-mock     # React-only 全量 mock 浏览器回归
pnpm run test:cdp:all-real     # OpenAI 全链路 + DeepSeek Flash reasoning 矩阵；真实接口，需明确确认
pnpm run test:docker           # Docker HTTPS、API、SQLite 持久性与 SIGTERM 冒烟
```

专项入口仍保留在根 `package.json`。自动化默认使用 mock、fixture 和临时存储；真实模型只在明确确认后执行。

## 相关文档

- [架构](docs/architecture.md)
- [功能清单](docs/features.md)
- [流式协议 v2](docs/streaming-protocol.md)
- [回归测试矩阵](docs/regression-test-cases.md)
- [生产部署说明](docs/production-deployment.md)
- [Docker 部署说明](docs/docker-deployment.md)
- [Docker 验证记录（2026-08-10）](docs/docker-validation-2026-08-10.md)
- [R11 流完整性与摘要覆盖验收记录（2026-08-12）](docs/r11-stream-context-2026-08-12.md)
- [R16 全链路一致性验收记录（2026-08-13）](docs/r16-consistency-hardening-2026-08-13.md)
- [R17 会话级模型配置持久化验收记录（2026-08-13）](docs/r17-conversation-model-options-2026-08-13.md)
- [R18 自定义 Prompt 模板验收记录（2026-08-13）](docs/r18-custom-prompt-templates-2026-08-13.md)
- [会话级模型配置持久化方案](docs/conversation-model-options-plan.md)
- [全面 Code Review 与回归记录（2026-08-10）](docs/code-review-2026-08-10.md)
- [TypeScript 7 / Express 5 工具链升级记录](docs/toolchain-upgrade-2026-08-09.md)
- [阶段交付审查（2026-08-09）](docs/release-readiness-2026-08-09.md)
- [Roadmap](docs/roadmap.md)
- [React 迁移收口](docs/react-migration-plan.md)
- [实验记录](docs/experiments.md)
