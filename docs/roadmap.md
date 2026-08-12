# Chatbot Roadmap

项目定位：个人学习和内部使用。优先级是本地稳定、可调试、可回归和自用效率；不面向多租户 SaaS、计费或公开大规模部署。

## 当前状态

- P0-P7：核心聊天、存储、工具、上下文、摘要、导入导出、Markdown 与回归体系已完成。
- R8.0-R8.6：React 并行迁移阶段已完成。
- R8.7：React-only 切换与阶段交付加固已实施；`client/` 为唯一前端，Vue/Volar/SFC 和双端 parity 测试已移除。
- R8.8：Express 同源托管 React 构建、统一 `/api`、HTTPS fail-fast 与部署文档已完成并通过最终门禁。
- R8.9：TypeScript 7 前后端统一、根 workspace/catalog、共享 tsconfig 与 Express 5 升级已完成。
- R9：DeepSeek Chat Completions 与 OpenAI Responses provider adapters 已完成。
- R10：单 Node Docker 局域网部署、TLS/数据挂载和容器验收已完成并验证。
- R11：Provider 流完整性与摘要覆盖语义已完成，并通过 DeepSeek/OpenAI mock、P0、UI 恢复和上下文预览回归。
- R12：生成元数据、工具轨迹和手动停止持久化已完成，并通过 file/SQLite、DeepSeek/OpenAI mock、P0 和上下文回归。
- R13：前端编排、存储实现、共享 NDJSON 协议和 CDP 场景套件已完成维护性拆分并通过全部门禁。
- R14：Docker 完整卷备份、新卷恢复、证书源路径覆盖、存储感知健康检查和局域网迁移手册已完成并通过隔离容器验收。
- R15：已选择并完成“编辑历史用户消息、重新生成回答和必要会话分支”这一单一自用功能；其余候选未进入范围。

R11-R15 已完成并验证。后续阶段仍必须从真实个人使用证据中一次选择一个范围。

## 当前基线

- React 19 + TypeScript 7 + Vite 8。
- Tailwind CSS 4 + shadcn/ui Base UI + Lucide React。
- Express 5.2 + TypeScript 7，与前端共用根 TypeScript 基础配置。
- file/SQLite 会话持久化。
- 历史用户消息编辑与已完成回答重新生成；通过普通独立会话分支保留父会话基线。
- DeepSeek/OpenAI 请求级 provider/model 与 reasoning 配置。
- 应用 NDJSON v2、reasoning 和工具生命周期。
- DeepSeek `[DONE]` / OpenAI `response.completed` 完整性门禁，异常 EOF 不落库。
- 摘要覆盖边界之后的原始消息窗口，以及可见的覆盖/选择范围统计。
- 全链路取消、首包/流空闲超时和单会话请求互斥。
- Node/Vitest/CDP 自动化回归。
- assistant 可选生成元数据、裁剪工具轨迹和 `completed`/`stopped` 状态；手动停止正文默认排除在后续模型上下文之外。
- Docker `/api/health` 配置/存储探针、停止后完整数据卷备份、新卷校验恢复和显式 volume 切换。

## 阶段矩阵

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 配置校验、核心发送/停止、回归入口 | 完成 |
| P1 | 多会话、持久化、Markdown、代码高亮 | 完成 |
| P2 | Function Calling 与工具失败隔离 | 完成 |
| P3 | reasoning 流式、耗时与持久化 | 完成 |
| P4 | 上下文窗口与摘要 | 完成 |
| P5 | 搜索、导入导出、上下文预览 | 完成 |
| P6 | UI 异步状态、响应式和主题 | 完成 |
| P7 | file/SQLite、迁移和 CDP 回归 | 完成 |
| R8.0-R8.6 | React 工具链、核心逻辑、hooks、UI、Tailwind/shadcn、并行验收 | 完成 |
| R8.7 | React 接管 `client/`、删除 Vue、并发/异常加固、文档收口 | 完成并验证 |
| R8.8 | React 构建托管、SPA 回退、HTTPS、缓存和部署边界 | 完成并验证 |
| R8.9 | TypeScript 7 统一、pnpm catalog/单 lockfile、共享 tsconfig、Express 5.2 | 完成并验证 |
| R9 | OpenAI Responses adapter、reasoning summary、Function Calling continuation | 完成 |
| R10 | 多阶段镜像、Compose、Node HTTPS、持久卷和容器回归 | 完成并验证 |
| R11 | Provider 流完整性与摘要覆盖语义 | 完成并验证 |
| R12 | 生成元数据、工具轨迹和中断状态持久化 | 完成并验证 |
| R13 | 前端编排、存储实现和 CDP 套件拆分 | 完成并验证 |
| R14 | Docker 备份恢复、证书路径和健康检查 | 完成并验证 |
| R15 | 编辑历史消息、重新生成和会话分支 | 完成并验证 |

## R8.7 交付边界

- 根 `dev:client`、`typecheck:client`、`build:client`、`lint:client` 全部指向 React `client/`。
- Vite 唯一开发端口为 5173。
- 删除 Vue 源码、Vue/Volar 依赖、Vue Node tests 与双实现 parity tests。
- React 删除当前会话、首包超时、模型目录损坏和协议非法字段有回归测试。
- file store 同会话并发 mutation 串行化，并采用临时文件 + rename 原子替换。
- 后端拒绝同会话并行 ask，检测摘要陈旧写入和回答落盘前会话删除。
- Provider URL、天气网络、输入长度和生产 5xx 有显式边界。
- 架构、功能、迁移和测试文档更新为 React-only。

## R8.8 交付边界

- 生产启动默认从 `client/dist` 同源提供 React 页面和静态资源。
- API 统一为 `/api/*`；生产不保留可能遮蔽 SPA 的根路径 API。
- HTTPS 证书、私钥、有效期和密钥匹配在监听端口前验证。
- 证书与构建路径均由环境配置集中管理，并支持 `~/` 展开。
- API 404 不回退 HTML，非 GET 导航不回退，hash assets 和 HTML 使用不同缓存策略。
- 当前证书仅用于本机/局域网；公开互联网仍不属于产品范围。

## R8.9 交付边界

- client/server 都从根 pnpm catalog 解析 TypeScript 7.0.2，不再分别维护 6.x/7.x。
- 通用编译约束集中在 `tsconfig.base.json`，浏览器和 NodeNext 差异保持在子配置。
- 依赖安装和 lockfile 收口到仓库根 workspace。
- Express 升级到 5.2.1，同步升级 Express 5 类型及 debug/http-errors 等配套依赖。
- 生产依赖以根 `pnpm run audit:production` 为单一审计入口。

## R10 交付边界

- 单个 Node/Express 容器直接终止 HTTPS，并同源提供 React 构建和 `/api/*`，不引入反向代理。
- 多阶段镜像只包含运行所需 server、生产依赖和 `client/dist`；环境变量、TLS 私钥和会话数据不进入镜像。
- Compose 只运行一个应用实例，TLS 只读挂载，完整 `/app/data` 使用独立 named volume 持久化。
- entrypoint 只以 root 复制受限权限的证书和私钥，应用主进程降权为 `node` 用户运行。
- 自动化容器回归覆盖 HTTPS、运行配置、API 404、SQLite 跨重启持久化和 SIGTERM 优雅停机。
- 已验证局域网地址可访问，Docker Desktop 中的容器、镜像和应用页面均保留验收截图。

## R11 Provider 流完整性与摘要覆盖语义

状态：2026-08-12 完成并验证。

### 直接价值

- 避免 Provider 在输出部分正文后异常 EOF 时，被误判为完整回答并写入会话。
- 避免摘要已经覆盖的历史消息再次进入模型上下文，减少重复 token 和语义噪声。

### 实施范围

- DeepSeek 必须收到 `[DONE]`，OpenAI Responses 必须收到 `response.completed`；只收到正文后 EOF 视为上游响应不完整。
- 不完整响应通过现有 NDJSON `error` 语义交给前端，不发送成功 `done`，也不持久化本轮 user/assistant 消息。
- 保留已显示的前端部分正文并标记为错误，后续请求仍可恢复。
- 摘要参与上下文时，只选择 `summary.sourceMessageCount` 之后的新消息；导入或异常计数必须进行安全截断。
- 上下文预览明确显示摘要覆盖消息数、新增原始消息数和最终选择范围。

### 交付结果

- LLM 流读取层只有在 DeepSeek `[DONE]` 或 OpenAI `response.completed` 到达后才返回成功；OpenAI 的通用 `[DONE]` 哨兵不再冒充 Responses 完成事件。
- Provider 在正文、reasoning 或工具参数中途 EOF 时，经现有 NDJSON v2 `error` 结束，不发送 `done`，也不追加本轮 user/assistant 消息。
- 前端保留已接收的部分正文和错误状态，同一会话的下一次请求可以继续成功。
- 摘要上下文只读取安全截断后的 `sourceMessageCount` 之后消息；file/SQLite 读取和 schema v1 导入都会截断越界计数。
- 上下文预览显示摘要覆盖数、摘要后原始消息数以及按会话序号表示的最终选择范围。
- 验收证据见 [R11 流完整性与摘要覆盖验收记录](r11-stream-context-2026-08-12.md)。

### 验收标准

- DeepSeek/OpenAI mock 均覆盖“部分正文后 EOF”“只有 reasoning 后 EOF”“工具参数未完成后 EOF”和正常终止。
- 不完整上游响应不会落库，前端显示可恢复错误，下一次发送成功。
- 摘要生成后立即提问、摘要后新增多轮消息、摘要重新生成及旧备份导入均无重复上下文。
- 通过 server/client unit、P0、UI 异常恢复和 context preview 回归；真实 Provider 仅在明确授权后验证。

### 非目标

- 不在本阶段增加自动重试、断点续传或跨进程恢复。
- 不改变 NDJSON v2 的公开事件类型；若确需协议字段变更，单独评估协议升级。

## R12 生成元数据、工具轨迹和中断状态持久化

状态：2026-08-12 完成并验证。

### 直接价值

- 为个人模型实验提供可回看证据，能比较模型、token、首字延迟、总耗时和工具行为。
- 刷新或重新进入会话后，仍能区分完整回答、手动停止和工具执行结果。

### 实施范围

- 为 assistant message 增加可选、向后兼容的生成元数据：provider、model、finish reason、首字耗时、总耗时和 Provider 实际返回的 usage。
- 持久化经过裁剪的工具轨迹，包括工具名、成功状态、耗时和用户可读摘要；不保存凭据或原始 Provider continuation state。
- 有正文的手动停止结果可按 `stopped` 状态保存，默认不作为后续模型上下文中的完整 assistant 回答；空失败请求不写入伪消息。
- JSON 备份、导入、Markdown 导出和 file/SQLite 两种存储保持一致语义。
- UI 在消息级别按需展示诊断信息，不增加全局复杂观测平台。

### 验收标准

- 旧会话和 schema v1 备份无需手工迁移即可读取；缺失 usage 时保持未知，不伪造为 0。
- 完整回答的模型、耗时、usage 和工具轨迹刷新后可恢复，并能正确导入导出。
- 手动停止的部分正文刷新后仍可辨识，且上下文预览证明其不会冒充完整回答。
- DeepSeek/OpenAI、无工具/单工具/并行工具、停止和错误路径都有存储回归。

### 交付结果

- assistant message 以可选字段保存 `status`、`generation` 和 `toolTrace`；旧消息、schema v1、NDJSON v2 和 SQLite 表结构均无需迁移。
- DeepSeek 开启官方 `stream_options.include_usage`，OpenAI 从 `response.completed` 读取 usage；多阶段工具回答只对所有已完成请求都提供的 token 字段求和，缺失字段保持未知。
- 工具轨迹最多保存 20 项，每项只有工具名、成功状态、耗时和最多 240 字符的可读摘要，不保存参数、请求头、API key 或 Provider continuation state。
- 只有用户显式停止且已经收到正文时才追加 user + `stopped` assistant；首 token 前停止、超时、切换/新建、卸载和错误均不写伪消息。
- `stopped` assistant 不进入后续原始上下文和新摘要；context preview 显示 `Stopped Excluded` 数量。
- JSON 备份/导入、Markdown 导出、file/SQLite、刷新映射与消息级“生成详情”保持相同语义；缺失 usage 显示“未知”。
- 验收证据见 [R12 生成元数据与停止持久化验收记录](r12-generation-metadata-2026-08-12.md)。

### 非目标

- 不实现计费、预算告警、跨用户统计或集中 tracing 平台。
- 不保存 API key、完整请求头、原始 SSE 或未经裁剪的工具敏感结果。

## R13 模块与回归套件维护性拆分

状态：2026-08-12 完成并验证。

### 直接价值

- 降低继续修改聊天、存储和 UI 状态时的回归概率，让个人学习时更容易定位责任边界。
- 缩短大型测试失败后的诊断路径，不改变现有用户功能。

### 实施范围

- 将 `useChatAppController` 按会话操作、导入导出、摘要/上下文和页面组合职责拆分，保留单一页面装配入口。
- 将 `conversationStore` 拆为公共契约、规范化/迁移、file store、SQLite store 和 facade。
- 将大型 CDP 脚本按流式恢复、会话操作、滚动/布局、模型菜单等场景拆分，并复用现有 helpers。
- 合并前后端重复但稳定的应用协议定义时，优先使用轻量共享类型模块，不引入新的运行时框架。

### 交付结果

- 页面继续只通过 `useChatAppController` 装配；会话操作、导入导出、摘要/上下文分别进入专责 hooks。
- `conversationStore.ts` 保留兼容 facade，公共契约、路径、规范化、迁移、file store 和 SQLite store 分离。
- NDJSON v2 事件联合与协议常量集中到根 `shared/chatStreamProtocol.ts`，前后端共同使用；Docker build/runtime 同步复制共享模块。
- UI CDP 拆为会话操作、流式恢复、滚动/布局和模型菜单四个入口，并复用既有 browser、CDP client 和 process helpers。
- 验收证据见 [R13 维护性拆分验收记录](r13-maintainability-2026-08-12.md)。

### 验收标准

- API、持久化格式、NDJSON v2 和 UI 可见行为不变。
- 现有静态检查、87+ server tests、55+ client tests、all-mock CDP、Docker smoke 全部继续通过。
- 每个拆分模块有清晰单一职责，测试仍集中在根 `tests/`，不与源码混放。
- 重构按小提交边界实施，任一步均可独立回滚。

### 非目标

- 不借重构引入状态管理库、ORM、通用插件系统或无关 UI 改版。
- 不以机械行数指标替代职责和依赖方向判断。

## R14 Docker 备份恢复与局域网运维

状态：完成并验证。

### 直接价值

- 降低换局域网电脑、重建容器或误操作时丢失个人会话的风险。
- 让 env、TLS、镜像和 Volume 的迁移步骤可执行、可验证，而不只依赖人工阅读文档。

### 实施范围

- 将宿主机证书和私钥源路径参数化，保留当前 `~/devhttps` 默认值和容器内受限权限复制流程。
- 增加停止服务后备份完整 `/app/data` Volume、恢复到新 Volume、校验后切换的脚本和 package 命令。
- 增加独立 `/api/health`，检查进程、配置和存储可读写状态，但不返回 endpoint、路径或凭据。
- 补充迁移到另一台局域网电脑的 env、证书信任、镜像重建、数据恢复、验收和回滚流程。
- Docker 自动化使用临时 project、临时 Volume 和 mock Provider 验证备份恢复，不接触正式数据。

### 验收标准

- 备份产物包含 SQLite 主文件及 WAL/SHM 所在完整数据目录，并带校验信息。
- 可从备份恢复到新 Volume；恢复前后会话数量、消息、reasoning、summary 和生成元数据一致。
- 证书路径可覆盖，默认 Compose 行为保持兼容；Node 进程仍以非 root 用户运行。
- healthcheck 改用 `/api/health` 后，正常、存储不可写和配置异常有稳定状态码及测试。
- 文档明确禁止使用 `docker compose down -v` 作为普通停止或回滚方式。

### 实施结果

- `docker:backup` 仅接受已停止的完整 `/app/data` volume，生成 tar 与逐文件/数据树/archive SHA-256 manifest，并检测打包期间的数据变化。
- `docker:restore` 校验 archive 后只创建带本次唯一标签的新 volume，恢复后复算数据树；目标已存在或所有权标签无法确认时拒绝写入。
- `compose.data-volume.yaml` 用显式 external volume 替换 `/app/data`；源 volume 不被覆盖，验证失败可切回。
- Compose 证书源支持 `CHATBOT_TLS_CERT_SOURCE` 和 `CHATBOT_TLS_KEY_SOURCE`，默认仍为 `~/devhttps`；容器内复制和非 root Node 流程不变。
- `/api/health` 独立检查启动配置、存储读取和数据根目录读写，返回稳定 200/503 且不暴露内部细节。
- 验收证据见 [R14 Docker 运维验收记录](r14-docker-operations-2026-08-12.md)。

### 非目标

- 不引入 Nginx、Kubernetes、自动证书续期、镜像仓库发布、多架构 CI 或公网部署平台。
- 不自动复制 `.env`、API key、TLS 私钥或 mkcert 根 CA 私钥到其他机器。

## R15 基于真实使用证据选择下一项功能

状态：2026-08-12 完成并验证。

### 已选择范围与直接价值

- 选择“编辑历史用户消息、重新生成回答和必要会话分支”作为 R15 的唯一范围。
- 在个人调试 prompt、比较回答和修正早期输入时，不再需要复制整段上下文或破坏原会话；父会话本身就是可回看的基线证据。
- 编辑使用多行对话框；保存后新分支只复制目标用户消息之前的历史，再通过既有 ask 流追加编辑后的问题与新回答。
- 已完成回答和有正文的 stopped 回答可重新生成；错误回答继续使用原地重试，不为尚未持久化的失败问题创建伪分支。

### 交付结果

- 新增 `POST /api/conversations/:id/branches`，校验目标必须是已保存的用户消息，并创建独立会话；原会话、后续消息和摘要均不改写。
- 分支保留前缀消息中的 reasoning、生成元数据和裁剪工具轨迹，但不继承可能覆盖后续历史的摘要；标题使用单个 `（分支）` 后缀并遵守长度上限。
- 前端分支创建后立即选中新会话，并用显式新会话 ID 复用 NDJSON v2 流式发送；模型请求失败时当前分支页面保留原地重试状态，父会话不受影响。
- 未增加父子关系字段、备份 schema 或 SQLite 表迁移；分支是普通独立会话，可继续搜索、导出、删除和再次分叉。
- 验收证据见 [R15 消息分支验收记录](r15-message-branching-2026-08-12.md)。

### 验收标准

- file/SQLite 均证明只复制目标用户消息之前的前缀，元数据保留、摘要清空且原会话逐字段不变。
- 空问题、超长问题、不存在会话、非用户消息或越界索引返回 4xx，且不留下部分分支。
- 浏览器自动化覆盖编辑、重新生成、连续分支、流式禁用状态和分支失败恢复；不调用真实模型。
- 静态检查、前端单测、后端专项测试、生产构建和 UI CDP 全部通过。

### 决策原则

- R15 不是必须全部实现的功能包。一次只选择一个能直接改善个人使用或带来明确学习价值的主题。
- 立项前记录真实使用中的频率、痛点、当前替代方式和预期验收；没有证据的候选项继续留在候选池。

### 未选择候选

1. 自定义 Prompt 模板 CRUD、导入导出和本地持久化。
2. 文件附件与受限文本提取；只有明确资料问答需求后再评估 RAG。
3. 移除语音占位，或在确定高频语音需求后实现真正可用的语音输入。

### 本轮进入条件（均已满足）

- R11-R14 已完成，既有数据与协议设计保持兼容。
- 已明确个人 prompt 调试与回答比较场景、数据边界、失败恢复和测试方案。
- 用户已确认“编辑/重新生成与会话分支”这一单一范围，其他候选未进入本轮。

### 非目标

- 不一次性实现全部候选功能。
- 不扩展为通用 Agent 平台、公共知识库服务、多人协作产品或商业 SaaS。

## 维护规则

1. 新问题先复现并加最小回归，再修复。
2. UI/流式/存储行为以可测量断言为准，不以截图代替。
3. 默认使用 mock、fixture、临时 file/SQLite；真实模型需明确确认。
4. 依赖升级必须通过 typecheck、lint、unit、build 和受影响 CDP。
5. Provider 特有逻辑留在 adapter；工具和存储保持现有模块边界。
6. 重要模型/上下文实验记录到 `docs/experiments.md`。
7. 后续 roadmap 阶段开始实施前先确认单一范围；完成后必须更新状态、验收证据和相关架构/测试文档。

## 非目标

- 用户登录、权限和多用户数据隔离。
- 管理后台、商业计费和面向公众的大规模部署平台能力。
- 通用多模型网关、复杂观测平台或 Agent 平台化。

R11-R15 已完成。后续候选仍必须先说明对个人使用或学习的直接价值，并由用户明确确认单一实施范围。

最终门禁、修复项和剩余边界见 [阶段交付审查（2026-08-09）](release-readiness-2026-08-09.md)。
