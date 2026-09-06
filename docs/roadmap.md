# Chatbot Roadmap

项目定位：个人学习和内部使用。优先级是本地稳定、可调试、可回归和自用效率；不面向多租户 SaaS、计费或公开大规模部署。

## 当前结论

- P0-P7、R8.0-R8.9、R9-R27 已完成；Bun 后端现已使用 Bun 工具链、`bun:sqlite` 和 `Bun.serve`。
- 最近完成的编号阶段是 R27：Bun 原生 HTTP/HTTPS、路由/响应适配、multipart、`Bun.file` 静态托管和可等待的 NDJSON 背压。
- R21 静态、单元/API、构建、18/18 全量 Mock 与全量真实 Provider 已通过；Docker 实机新 Volume 恢复门禁按用户要求暂缓。
- R23 静态检查、168 项服务端单测、114 项 React 单测、无重试 18/18 全量 Mock 和无重试全量真实 Provider 已通过；Docker 按用户要求不验证。
- 2026-08-31 完成健康检查拆分、Provider 非 2xx 安全诊断和超时取消后立即重试协调；静态、172 项服务端单测、115 项 React 单测、18/18 全量 Mock 及全量真实 Provider 通过，Docker 运行验证按用户要求暂缓。
- 2026-09-04 完成独立 Bun 后端；Node 177 项、Bun 45 个测试文件、React 119 项、契约对照、构建、无重试 Bun `all-mock` 及 DeepSeek/OpenAI 真实功能门禁通过，Docker 未执行；真实总入口的 Vite 清理问题随后完成聚焦修复验证。
- 2026-09-04 完成 Bun 工具链迁移；冻结安装、静态检查、Node 177 项、Bun 174 项、React 119 项、契约对照、构建和无重试 Bun 全量 Mock 通过。真实 Provider 与 Docker 未执行。
- 2026-09-05 完成 Bun 原生 SQLite 迁移；旧数据库双向兼容、file/SQLite parity、静态检查、Node 177 项、Bun 174 项、React 119 项、构建、依赖审计和无重试 18/18 Bun 全量 Mock 通过。真实 Provider 与 Docker 未执行。
- 2026-09-05 完成 Bun 原生 HTTP 迁移；静态检查、Node 177 项、Bun 175 项、React 119 项、HTTP/HTTPS 运行时、file/SQLite parity、数据库双向兼容、构建、审计和无重试 18/18 Bun 全量 Mock 通过。真实 Provider 与 Docker 未执行。
- 详细范围和交付证据见 [P0-R21 历史阶段记录](roadmap-history.md)、[R22 验收记录](r22-request-consistency-atomic-import-2026-08-29.md)、[R23 验收记录](r23-provider-aware-context-budget-2026-08-29.md)、[P1 工程可靠性优化验收记录](engineering-hardening-2026-08-31.md)、[R24 验收记录](r24-bun-server-2026-09-04.md)、[R25 验收记录](r25-bun-toolchain-2026-09-04.md)、[R26 验收记录](r26-bun-sqlite-2026-09-05.md)与 [R27 验收记录](r27-bun-http-runtime-2026-09-05.md)。

## 当前基线

### 应用与模型

- React 19 + TypeScript 7 + Vite 8；Tailwind CSS 4 + shadcn/ui Base UI + Lucide React。
- Node `server/` 是 Express 5.2 后端，Bun `bun-server/` 是 `Bun.serve` 后端；两者均使用 TypeScript 7，并与前端共用根 Bun workspace/catalog、`bun.lock` 和基础 tsconfig。Node 后端只作为过渡与对照基线保留。
- DeepSeek Chat Completions 与 OpenAI Responses adapters；支持 reasoning、模型能力参数和 Function Calling。
- Provider SSE 经服务端转换为应用 NDJSON v2；DeepSeek `[DONE]` 和 OpenAI `response.completed` 是成功完成门禁。

已知兼容边界：DeepSeek 官方当前接受 `low/high/max`，兼容选项 `medium` 会映射为 `high`。官方思考模式文档说明支持工具调用，但没有明确 `tool_choice` 参数的兼容语义；当前项目工具请求会发送 `tool_choice:auto`。历史真实门禁是日期证据，修改请求形状前需要补 mock 并单独确认最小真实接口验证。

### 会话与上下文

- file/SQLite 会话存储、JSON 到 SQLite 迁移、搜索、导入导出、历史消息分支和重新生成。
- 会话级 provider/model/reasoning/temperature/max tokens 配置可跨刷新、分支、导入导出、Docker 重启和 Volume 恢复。
- 摘要覆盖边界、增量滚动摘要、Provider-aware 统一上下文预算、消息数/字符二级护栏和可解释上下文预览。
- assistant 生成元数据、裁剪工具轨迹和 `completed`/`stopped` 状态；停止正文默认不进入后续模型上下文。
- JPEG/PNG/WebP 图片附件、本地文件持久化、DeepSeek Vision 请求时 Base64、统一图片 token 估算和 schema v2 ZIP 便携备份。

### 前端与流式状态

- 首段文本即时显示，后续 40ms 有界合并；Markdown 按内容长度以 80/160ms 刷新。
- 历史消息行与当前流隔离；ResizeObserver + 单一 rAF 自动滚动，并提供快速到底恢复。
- 全链路取消、首包/流空闲超时、单会话请求互斥、持久化消息索引和流结束详情回拉。

### 认证、部署与验证

- production 默认启用单用户认证；除健康检查与认证入口外，API 需要短期 Bearer Access Token。
- Access Token 只保存在 React 内存；Refresh Token 只存在于受限 Cookie，并由独立 SQLite Session Store 执行轮换、重放检测和撤销。
- 单 Node Docker HTTPS 部署、只读 TLS 挂载、非 root 应用进程、持久化 `/app/data`、轻量 liveness、深度 readiness 和完整 Volume 备份恢复框架；Bun Docker 不在当前基线，R21 附件的新 Volume 实机恢复仍待补证。
- Node test 对照、原生 `bun:test`、Node/Bun 契约对照、Bun 驱动的 Vitest 与 CDP 覆盖聊天、存储、上下文、工具、Markdown、UI、认证和隔离门禁。

## 阶段矩阵

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0-P7 | 核心聊天、会话、工具、reasoning、上下文、导入导出、UI、存储与回归 | 完成 |
| R8.0-R8.9 | React-only 迁移、同源托管、TypeScript 7 与 Express 5 工具链 | 完成并验证 |
| R9 | OpenAI Responses adapter、reasoning summary、Function Calling continuation | 完成 |
| R10 | Node HTTPS Docker、持久卷和容器回归 | 完成并验证 |
| R11 | Provider 流完整性与摘要覆盖语义 | 完成并验证 |
| R12 | 生成元数据、工具轨迹和中断状态持久化 | 完成并验证 |
| R13 | 前端编排、存储实现和 CDP 套件拆分 | 完成并验证 |
| R14 | Docker 备份恢复、证书路径和健康检查 | 完成并验证 |
| R15 | 编辑历史消息、重新生成和会话分支 | 完成并验证 |
| R16 | 全链路一致性、摘要预算、存储探针和测试门禁 | 完成并验证 |
| R17 | 会话级模型配置持久化、恢复、兼容和竞态保护 | 完成并验证 |
| R18 | 自定义 Prompt 模板 CRUD、浏览器持久化和 JSON 导入导出 | 完成并验证 |
| R19 | 流式渲染平滑度、历史行隔离、快速到底和性能门禁 | 完成并验证 |
| R20 | JWT 单用户认证、Refresh 轮换、Session 撤销和登录 UI | 完成并验证 |
| R21 | 图片附件、DeepSeek Vision 多模态输入、本地持久化和备份恢复 | 完成（Docker 实机恢复暂缓） |
| R22 | 请求幂等、断线结果恢复和批量导入原子性 | 功能与非 Docker 验收完成 |
| R23 | Provider-aware 上下文预算 | 完成并验证（Docker 按要求未跑） |
| R24 | 独立 Bun 后端、运行时兼容、契约对照与 Bun Mock/真实 Provider 回归 | 完成并验证（Docker 未跑） |
| R25 | Bun 包管理、workspace/catalog、脚本执行与原生 `bun:test` | 完成并验证（Docker/真实 Provider 未跑） |
| R26 | Bun 原生 SQLite 替换 Bun 后端的 `node:sqlite` | 完成并验证（Docker/真实 Provider 未跑） |
| R27 | `Bun.serve`、原生路由/multipart/静态文件与流式背压 | 完成并验证（Docker/真实 Provider 未跑） |
| R28 | 删除 Node 后端与 Node 对照链路，收口单一 Bun 应用 | 待实施 |
| R29 | Bun 生产启动、Docker 镜像、备份恢复与部署门禁 | 待实施 |

## R21 图片附件与多模态理解

状态：功能与非 Docker 验收已完成。完整范围与设计见 [R21 图片附件与多模态理解方案](r21-multimodal-vision-plan.md)，验收证据见 [R21 验收记录](r21-multimodal-vision-2026-08-24.md)。

- 直接价值：支持围绕截图、照片和图表提问，并学习上传安全、多模态消息建模、Provider 能力约束、附件生命周期和上下文预算。
- 模型边界：接入 `deepseek-v4-flash-vision-exp`；该模型默认支持纯文本，图片是可选输入，同时支持文本加图片和仅图片消息。
- 存储边界：浏览器 multipart 上传，原始图片保存在 `/app/data/attachments`；会话只保存元数据和引用。
- Provider 边界：首期调用时由服务端临时转 Base64 Data URL；不把 Base64 长期保存，不接外部 URL，DeepSeek Files API 暂缓。
- 协议边界：现有 NDJSON v2 输出协议保持不变；不支持图片的模型不得静默接收或降级图片请求。
- 已验证：上传状态、刷新、停止/恢复、重试、分支、file/SQLite、schema v1/v2、上下文预算、请求时 Base64、安全边界、全量 Mock 和真实图片完整识别。
- 暂缓项：用户恢复 Docker 工作后执行新 Volume 恢复实机验证；不影响本轮功能与非 Docker 验收结论。
- 非目标：文档文本提取、OCR/RAG、图片生成/编辑、音视频和通用多模态网关。

### R21 遗留验收

R21 不新增功能，只补齐部署证据。当前 Docker smoke 脚本已实现以下场景，但本轮未执行容器门禁：

- Docker smoke 创建带图片消息的会话，确认附件二进制和 sidecar 位于 `/app/data/attachments`。
- 停止容器后执行整卷备份，恢复到从未存在过的新 Volume，再验证会话详情、缩略图、原图读取和携带历史图片继续提问。
- 比较恢复前后的附件大小与 SHA-256，并确认源 Volume 未被修改。
- 失败时只删除本次测试创建的新恢复卷和测试数据，不使用 `docker compose down -v`。

该门禁按用户最新要求暂缓；在实际执行完成前不得把“附件已通过新 Volume 恢复”写成既成事实。

## R22 请求一致性与原子导入

状态：功能与非 Docker 验收已完成。实现与验证证据见 [R22 验收记录](r22-request-consistency-atomic-import-2026-08-29.md)。

### 直接价值

- 避免服务端已经保存回答但客户端未收到 `done` 时，重试造成重复问答。
- 让网络中断、页面刷新和服务重启后的请求结果可判断、可恢复，而不是只能依赖当前进程内存。
- 避免批量 JSON/ZIP 导入中途失败后留下用户不可见的部分创建、部分覆盖或附件残留。
- 学习幂等键、交付确认、状态恢复、事务边界和 file/SQLite 两种存储的一致性设计。

### 范围

1. 为 ask 请求保存稳定 `requestId`、会话绑定和终态；同一会话中的相同 `requestId` 只能产生一组用户/assistant 消息。
2. 提供受认证保护的请求结果查询或等价恢复入口；前端在异常 EOF、网络断开和超时后先核对服务端终态，再决定显示失败或恢复已保存消息。
3. 明确定义 `processing`、`completed`、`stopped`、`failed` 的可持久化语义，以及服务重启后遗留 `processing` 的恢复规则。
4. JSON/ZIP 批量导入改为“完整预检 -> 暂存 -> 提交”；任何一项失败时，本批次创建、覆盖和附件写入全部撤销。
5. file 与 SQLite 保持相同对外语义；schema v1 JSON、schema v2 ZIP 和无 `requestId` 的旧会话继续可读。

### 验收门禁

- 服务端已持久化但 `done` 未送达时，刷新或重试能够恢复原回答，消息不重复。
- 同一 `requestId` 并发提交、顺序重放和服务重启后重放均不会产生第二组消息。
- 手动停止仍保存 `stopped`；超时、切换和卸载不会被错误恢复为成功回答。
- 对 file/SQLite 分别注入第一个、中间和最后一个会话写入失败；导入前后会话、覆盖目标和附件文件完全一致。
- 导入成功时 `skip`、`duplicate`、`overwrite` 现有语义及附件 ID 重映射保持不变。
- 单元/API、CDP 网络中断恢复、存储重开和 Docker 重启场景通过；真实 Provider 只做经确认的最小门禁。

### 非目标与回滚边界

- 不引入 Redis、消息队列、分布式锁、多实例调度或通用任务平台。
- 不借 R22 修改 Markdown、模型请求参数、上下文内容或新增附件类型。
- 持久化字段必须采用可选、向后兼容的增量格式；上线前先备份 `/app/data`。
- 若新恢复入口异常，可关闭客户端自动恢复并继续读取旧会话；不得通过清空数据库或 Volume 回滚。

## R23 Provider-aware 上下文预算

状态：功能与非 Docker 验收已完成；静态、单元、构建、全量 Mock 和全量真实 Provider 均已通过，Docker 按用户要求不在本阶段验证。实现与证据见 [R23 验收记录](r23-provider-aware-context-budget-2026-08-29.md)。

- 直接价值：让当前问题、历史消息、摘要、工具结果、图片和预留输出共享同一模型上下文预算，减少长中文、代码或未来文件内容触发 Provider 拒绝的概率。
- 进入条件已满足：R22 完成；2,000 字符 ASCII/中文对照实验证明相同字符数无法稳定代表兼容链路输入规模，记录见 [实验记录](experiments.md#2026-08-29-字符数无法预测模型上下文边界)。
- 首期边界：先提供 Provider-aware token 估算、裁剪统计和上下文预览，不追求跨模型完全精确计数。
- 验收：边界输入不会超过所选模型配置上限；裁剪结果可解释、摘要覆盖语义不倒退、纯文本与图片请求均有 Mock 和最小真实验证。
- 非目标：不随本阶段引入 RAG、Embedding、向量数据库或通用文档检索。

## R24 独立 Bun 后端

状态：功能与本地非 Docker 验收已完成。实现决策、命令、基准和真实门禁证据见 [R24 验收记录](r24-bun-server-2026-09-04.md)。

- 直接价值：在不打断现有 Node 生产链路的情况下学习和评估 Bun 的运行兼容性、启动/内存特征与测试差异，并保留可直接回退的稳定基线。
- 实现边界：新建独立 `bun-server/`，保持 Express、pnpm、现有 API/环境变量/schema/NDJSON v2；不从 `server/` 导入业务源码。
- 验收：Bun 类型检查与 45 个测试文件、Node/Bun API/流/重启持久化对照、无重试完整 Bun Mock CDP、DeepSeek/OpenAI 真实功能门禁、Node 基线和 React 构建全部通过；Vite 进程组清理另有 Node/Bun 单测与聚焦 CDP 自动退出证据。
- 数据边界：两套后端默认数据目录隔离；并行运行时不得共享写入同一个 file/SQLite store。
- 暂缓项：Bun Docker 镜像与容器验证；现有 Docker、生产启动与部署文档继续以 Node 为基线。
- R24 当时的非目标：`Bun.serve`、`bun:sqlite`、Bun 包管理、删除 Node 后端或一次性抽取共享业务包；其中 Bun 包管理已由 R25 独立完成。

## R25 Bun 工具链迁移

状态：本地非 Docker 验收已完成。实现与证据见 [R25 验收记录](r25-bun-toolchain-2026-09-04.md)。

- 直接价值：把日常安装、脚本、前端工具和 Bun 后端测试统一到一个运行时，减少双包管理器和 Node 兼容测试包装层带来的认知与维护成本。
- 实现边界：`bun.lock` 成为权威锁文件；根 manifest 声明 Bun workspace/catalog 与 Argon2 trusted dependency；Vite、Vitest、TypeScript、Oxlint、CDP 和 runtime harness 由 Bun 调度。
- 测试边界：45 个 Bun 后端测试文件改用 `bun:test`，共 174 项；Node 177 项仍作为过渡基线，不在 R25 删除。
- 兼容边界：Express、`node:sqlite`、API、环境变量、file/SQLite schema 与 NDJSON v2 均不改变。
- 暂缓项：现有 Node Docker 构建仍依赖临时保留的 pnpm workspace/lock，未在 R25 运行或保证可部署；真实 Provider 沿用 R24 功能证据，没有重复付费调用。
- 回滚：恢复根 package manager/scripts 和 Bun 测试导入，删除 `bun.lock`/`bunfig.toml`，即可回到 R24 的 pnpm 工具链；无数据迁移。

## R26 Bun 原生 SQLite

状态：本地非 Docker 验收已完成。实现与证据见 [R26 验收记录](r26-bun-sqlite-2026-09-05.md)。

- 直接价值：让 Bun 后端的默认会话存储和认证 Session Store 使用 Bun 原生驱动，减少继续依赖 Node SQLite 兼容层的运行时边界。
- 实现边界：仅 `bun-server/` 使用 `bun:sqlite`；Node `server/` 继续使用 `node:sqlite` 作为过渡对照。Express、API、环境变量、数据库文件/schema、WAL、NDJSON v2 和附件格式不变。
- 兼容边界：新增 Node 写入 → Bun 读取/更新 → Node 回读门禁，证明现有 SQLite 文件可直接复用且回滚不需要数据迁移。
- 验收：会话/认证 SQLite 聚焦测试、Node 177 项、Bun 174 项、file/SQLite 契约对照、React 119 项、构建、依赖审计和无重试 18/18 Bun 全量 Mock 均通过。
- 暂缓项：不改 HTTP 框架，不删除 Node 对照，不运行真实 Provider 或 Docker；这些分别属于 R27、R28 和 R29。

## R27 Bun 原生 HTTP 运行时

状态：本地非 Docker 验收已完成。实现与证据见 [R27 验收记录](r27-bun-http-runtime-2026-09-05.md)。

- 直接价值：让 Bun 后端从兼容运行 Express/Node HTTP 改为由 Bun 直接承载连接、TLS、请求和 Web Stream，减少核心请求链上的兼容层与依赖。
- 实现边界：`Bun.serve` 同时承载 HTTP/HTTPS；轻量路由/响应适配器保持控制器与服务职责；multipart 通过有界 `Request.formData()` 解析；`Bun.file` 托管静态构建和 SPA 回退。
- 流式边界：NDJSON v2 使用 `TransformStream`，写入逐级 `await` 到 Provider SSE reader，使慢客户端背压不再只停留在同步布尔值；断开仍触发上游取消和请求终态收敛。
- 兼容边界：API、环境变量、认证、file/SQLite schema、附件格式、Provider 请求和 NDJSON v2 事件不变；Node 后端继续作为 R28 前的对照和回滚基线。
- 暂缓项：默认生产命令和 Docker 仍使用 Node；真实 Provider 未重复调用。二者分别保留到 R29 和需要 Provider 形状变化时的单独授权门禁。

## Bun 完全迁移序列

R25-R27 已完成工具链、SQLite 驱动与 HTTP 运行时迁移。后续按可独立回退的顺序推进：

1. R27 已由 `Bun.serve` 接管 HTTP/HTTPS、路由适配、multipart、静态文件和流式背压，同时保持现有 API 与 NDJSON v2。
2. R28 在 Bun 门禁稳定后删除 Node `server/`、Node 测试副本与 Node/Bun parity，仅保留一套业务实现。
3. R29 最后迁移默认生产启动与 Docker，重新验证 TLS、非 root、健康检查、附件、Volume 备份恢复、SIGTERM 和镜像边界，并删除临时 pnpm 文件。

## 工程优化 Backlog

这些项目不单独占用 Roadmap 阶段。修改相关模块时按风险择机处理，并补对应的聚焦回归；不得为清理代码而改变既有用户行为。

| 优先级 | 优化项 | 状态 | 完成边界 |
| --- | --- | --- | --- |
| P1 | 健康检查拆分 | 已完成；Docker 运行未复验 | Docker 高频调用轻量 liveness；实际配置/存储写探针改为 readiness，且继续不泄漏路径和凭据 |
| P1 | Provider 错误诊断 | 已完成 | 限长、脱敏解析非 2xx 错误，增加内部 correlation id；不记录 API key、完整 Prompt、Cookie 或 Token |
| P1 | 超时取消后的立即重试 | 已完成 | 取消未完成时保持当前会话发送互斥，避免短暂 409；客户端、网络和服务端占用释放断言已覆盖 |
| P2 | NDJSON 背压 | 已完成（R27） | Web Stream writer 等待下游可写；Provider reader 逐级等待，且取消、连接关闭和后续请求恢复门禁通过 |
| P2 | 附件孤儿清理 | 待处理 | 增加扫描/删除数量和耗时的非敏感诊断；只有真实数据证明需要时才改为周期或索引清理 |
| P2 | 模型 fallback 单一事实源 | 已完成 | 服务端 model catalog 同时声明模型、能力、默认值与禁用状态；React 不再内置模型/能力 fallback，目录缺失时 fail-closed 且保留会话浏览与草稿编辑 |
| P3 | 大文件渐进拆分 | 按需 | 仅在修改对应功能时拆分 import、chat stream、conversation controller、attachment 和 LLM orchestration；不做一次性全仓重构 |

## 其他功能候选

R21 已完成图片附件与多模态理解。以下功能继续保留为后续候选，尚未立项或分配阶段编号；其优先级低于当前 P2 可靠性优化。自定义 Prompt 模板已在 R18 完成，不再列入候选。

### 文件附件与受限文本提取

状态：候选，未选择。

- 直接价值：支持围绕本地资料提问，并学习上传安全、MIME/大小校验、文本提取、文件生命周期和上下文注入。
- 进入条件：出现明确且重复的资料问答需求，并记录当前替代方式、文件类型、容量边界和隐私要求。
- 首期边界：只支持少量明确文本格式；先完成安全摄取和引用，不直接引入向量数据库。
- RAG 条件：只有全文检索或受限上下文无法满足实际需求时，再单独评估分块、Embedding、召回和效果评测。

### 语音占位处理

状态：候选，未选择。

- 直接价值：消除不可用控件，或在高频语音输入需求成立时学习权限、录音、转写、取消和临时数据清理。
- 进入条件：先决定是移除当前占位，还是实现真正可用的语音输入；两者不能作为同一模糊范围进入开发。
- 最小实现边界：语音只转成可编辑文本，不自动发送；音频默认不持久化。
- 非目标：实时语音通话、TTS、VAD 和复杂音频会话不随首期语音输入一并实施。

## 选择规则

1. 一次只选择一个能直接改善个人使用或带来明确学习价值的主题。
2. 立项前记录使用频率、痛点、当前替代方式、数据边界、预期验收和回滚方案。
3. 设计文档和阶段编号不代表实施批准；用户明确确认实施范围后才修改代码。
4. 新问题先复现并增加最小回归；UI、流式和存储行为以自动化断言为准。
5. 默认使用 mock、fixture 和临时 file/SQLite；真实模型必须明确确认。
6. 完成阶段必须同步功能、架构、测试、部署文档和验收证据。

## 非目标

- 注册、账号管理、角色权限、第三方登录和多用户数据隔离；R20 只实现单用户认证。
- 管理后台、商业计费和面向公众的大规模部署平台能力。
- 通用多模型网关、复杂观测平台或 Agent 平台化。
- 没有真实问题支撑的微服务、Kubernetes、消息队列或分布式 Session。

## 历史与证据

- [P0-R21 历史阶段记录](roadmap-history.md)
- [R16 全链路一致性验收记录](r16-consistency-hardening-2026-08-13.md)
- [R17 会话级模型配置持久化验收记录](r17-conversation-model-options-2026-08-13.md)
- [R18 自定义 Prompt 模板验收记录](r18-custom-prompt-templates-2026-08-13.md)
- [R19 流式渲染与快速到底验收记录](r19-streaming-rendering-2026-08-13.md)
- [R20 JWT 单用户认证方案与实施说明](r20-jwt-authentication-plan.md)
- [R21 图片附件与多模态理解方案](r21-multimodal-vision-plan.md)
- [R21 图片附件与 Vision 验收记录](r21-multimodal-vision-2026-08-24.md)
- [P1 工程可靠性优化验收记录](engineering-hardening-2026-08-31.md)
- [R24 独立 Bun 后端验收记录](r24-bun-server-2026-09-04.md)
- [R25 Bun 工具链迁移验收记录](r25-bun-toolchain-2026-09-04.md)
- [R26 Bun 原生 SQLite 验收记录](r26-bun-sqlite-2026-09-05.md)
- [R27 Bun 原生 HTTP 运行时验收记录](r27-bun-http-runtime-2026-09-05.md)
