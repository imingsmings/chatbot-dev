# Chatbot Roadmap

项目定位：个人学习和内部使用。优先级是本地稳定、可调试、可回归和自用效率；不面向多租户 SaaS、计费或公开大规模部署。

## 当前结论

- P0-P7、R8.0-R8.9、R9-R20 已完成；R11-R20 均有明确验收记录。
- 最近完成阶段是 R20：JWT 单用户认证、Refresh 轮换、Session 撤销、登录 UI 和认证回归。
- 当前没有进行中的 Roadmap 阶段，也没有分配 R21；下一阶段必须先从候选中确认一个单一范围。
- 详细历史范围和交付证据见 [P0-R20 历史阶段记录](roadmap-history.md)。

## 当前基线

### 应用与模型

- React 19 + TypeScript 7 + Vite 8；Tailwind CSS 4 + shadcn/ui Base UI + Lucide React。
- Express 5.2 + TypeScript 7，与前端共用根 workspace、TypeScript catalog、基础 tsconfig 和 lockfile。
- DeepSeek Chat Completions 与 OpenAI Responses adapters；支持 reasoning、模型能力参数和 Function Calling。
- Provider SSE 经服务端转换为应用 NDJSON v2；DeepSeek `[DONE]` 和 OpenAI `response.completed` 是成功完成门禁。

已知兼容边界：DeepSeek 官方当前接受 `low/high/max`，兼容选项 `medium` 会映射为 `high`。官方思考模式文档说明支持工具调用，但没有明确 `tool_choice` 参数的兼容语义；当前项目工具请求会发送 `tool_choice:auto`。历史真实门禁是日期证据，修改请求形状前需要补 mock 并单独确认最小真实接口验证。

### 会话与上下文

- file/SQLite 会话存储、JSON 到 SQLite 迁移、搜索、导入导出、历史消息分支和重新生成。
- 会话级 provider/model/reasoning/temperature/max tokens 配置可跨刷新、分支、导入导出、Docker 重启和 Volume 恢复。
- 摘要覆盖边界、增量滚动摘要、消息数/字符预算和上下文预览统计。
- assistant 生成元数据、裁剪工具轨迹和 `completed`/`stopped` 状态；停止正文默认不进入后续模型上下文。

### 前端与流式状态

- 首段文本即时显示，后续 40ms 有界合并；Markdown 按内容长度以 80/160ms 刷新。
- 历史消息行与当前流隔离；ResizeObserver + 单一 rAF 自动滚动，并提供快速到底恢复。
- 全链路取消、首包/流空闲超时、单会话请求互斥、持久化消息索引和流结束详情回拉。

### 认证、部署与验证

- production 默认启用单用户认证；除健康检查与认证入口外，API 需要短期 Bearer Access Token。
- Access Token 只保存在 React 内存；Refresh Token 只存在于受限 Cookie，并由独立 SQLite Session Store 执行轮换、重放检测和撤销。
- 单 Node Docker HTTPS 部署、只读 TLS 挂载、非 root 应用进程、持久化 `/app/data`、健康检查和完整 Volume 备份恢复。
- Node/Vitest/CDP 覆盖聊天、存储、上下文、工具、Markdown、UI、认证、Docker 和真实 Provider 隔离门禁。

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

## 下一阶段候选

以下项目尚未立项，也没有分配阶段编号。自定义 Prompt 模板已在 R18 完成，不再列入候选。

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
3. 设计文档不代表实施批准；用户确认具体范围后才分配下一阶段编号并修改代码。
4. 新问题先复现并增加最小回归；UI、流式和存储行为以自动化断言为准。
5. 默认使用 mock、fixture 和临时 file/SQLite；真实模型必须明确确认。
6. 完成阶段必须同步功能、架构、测试、部署文档和验收证据。

## 非目标

- 注册、账号管理、角色权限、第三方登录和多用户数据隔离；R20 只实现单用户认证。
- 管理后台、商业计费和面向公众的大规模部署平台能力。
- 通用多模型网关、复杂观测平台或 Agent 平台化。
- 没有真实问题支撑的微服务、Kubernetes、消息队列或分布式 Session。

## 历史与证据

- [P0-R20 历史阶段记录](roadmap-history.md)
- [R16 全链路一致性验收记录](r16-consistency-hardening-2026-08-13.md)
- [R17 会话级模型配置持久化验收记录](r17-conversation-model-options-2026-08-13.md)
- [R18 自定义 Prompt 模板验收记录](r18-custom-prompt-templates-2026-08-13.md)
- [R19 流式渲染与快速到底验收记录](r19-streaming-rendering-2026-08-13.md)
- [R20 JWT 单用户认证方案与实施说明](r20-jwt-authentication-plan.md)
