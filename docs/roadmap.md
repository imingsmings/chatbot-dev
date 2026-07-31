# Chatbot Roadmap

项目定位：个人学习和内部使用，不对外发布、不商业化、不面向大量用户。优先级是学习价值、自用效率、本地稳定、可调试和可回归。

当前阶段 roadmap 已全部落地。后续新增功能应先证明能改善个人使用或学习目标，不为多租户 SaaS、计费、公开部署或复杂平台化预留抽象。

## 当前基线

- Vue 3 + Vite 前端，Express + TypeScript 后端。
- 多会话 CRUD、搜索、导入导出和 file/SQLite 持久化。
- DeepSeek-compatible provider adapter 和请求级模型参数。
- provider SSE 转应用 NDJSON v2，前端严格解析。
- reasoning、工具生命周期和最终回答的流式展示。
- 最近上下文窗口、持久化会话摘要和 context preview。
- 天气、当前时间和计算器 Function Calling。
- Prompt 模板与变量替换。
- 安全 Markdown、流式轻量渲染、完成态高亮和代码复制。
- 前端/后端/上游停止生成。
- 初始化、会话操作、导入导出和停止过程的显式等待态与重复点击保护。
- Node 单元测试和 mock CDP 回归。

## 完成矩阵

| 优先级 | 项目 | 状态 | 主要落点 | 验收证据 |
| --- | --- | --- | --- | --- |
| P0 | R0.1 配置体验补齐 | 已完成 | `runtimeConfig.ts`、`.env.example`、README | 启动配置和参数校验 |
| P0 | R0.2 回归入口固定 | 已完成 | 根 `package.json`、CDP runner | `pnpm run check`、P0/all-mock |
| P1 | R1.1 最近 N 轮上下文窗口 | 已完成 | `contextService.ts` | context Node tests |
| P1 | R1.2 会话摘要 | 已完成 | `conversationSummaryService.ts`、摘要弹窗、file/SQLite summary | summary Node tests、roadmap CDP |
| P1 | R1.3 调试当前模型上下文 | 已完成 | `/context-preview`、ContextDebugModal | context tests、context-debug CDP |
| P2 | R2.1 模型信息展示 | 已完成 | `/runtime-config`、ModelSettingsModal | roadmap CDP |
| P2 | R2.2 本地参数切换 | 已完成 | `modelOptions.ts`、DeepSeek adapter、模型参数弹窗 | model-options tests、roadmap CDP |
| P3 | R3.1 会话搜索 | 已完成 | search service/API/sidebar | file/SQLite tests、search CDP |
| P3 | R3.2 会话导出 | 已完成 | Markdown/JSON export service/API/UI | file/SQLite tests、export CDP |
| P3 | R3.3 会话导入 | 已完成 | import service/API/UI，三种冲突策略 | file/SQLite tests、roadmap CDP |
| P4 | R4.1 模板列表 | 已完成 | 6 个静态模板、模板弹窗 | client tests、roadmap CDP |
| P4 | R4.2 模板变量 | 已完成 | 变量提取、表单替换、只填充不发送 | client tests、roadmap CDP |
| P5 | R5.1 基础工具扩展 | 已完成 | weather/time/calculator 独立工具和注册表 | tool tests、P0 CDP |
| P5 | R5.2 Tool 过程可视化 | 已完成 | `tool_start`/`tool_result`、MessageList 状态 | protocol tests、roadmap/P0 CDP |
| P6 | R6.1 大文本流式性能 | 已完成 | 自适应节流、streaming-lite、完成态高亮 | 41,280 字符 roadmap CDP |
| P6 | R6.2 Markdown 功能补齐 | 已完成 | 语言标签、代码复制、表格、外链策略 | roadmap/Markdown/Highlight CDP |
| P7 | R7.1 架构图和协议文档 | 已完成 | `architecture.md`、`streaming-protocol.md` | 文档与代码契约复核 |
| P7 | R7.2 实验记录 | 已完成 | `experiments.md`、当次回归结果 | mock 实验记录和结果文件 |

## 关键验收结论

### 上下文

- 历史窗口只影响模型 request，不删除原始消息。
- 摘要可查看、生成、重新生成、持久化，并参与后续 prompt。
- context preview 展示最终 messages、工具定义和本次有效参数，不返回 secret。

### 模型参数

- temperature 范围为 `0..2`，max tokens 必须为正整数。
- 前端参数只影响当前页面后续请求，不写入会话数据。
- DeepSeek adapter 统一映射 `temperature`、`max_tokens`、`thinking` 和 `reasoning_effort`。

### 导入导出

- schema v1 备份导入前完整校验。
- 冲突策略为 `skip`、`duplicate`、`overwrite`；UI 默认 `skip`。
- file 和 SQLite 语义一致，reasoning 和 summary 均保留。
- 导入、单会话导出和全量导出在请求期间显示等待态并阻止重复提交；生成或停止期间禁用备份操作。

### 工具与流式

- 工具实现独立于注册表；参数错误和外部服务失败不会让聊天接口返回 500。
- NDJSON v2 显式表达工具开始/结果，不泄漏 tool decision preamble。
- reasoning、正文、工具状态、停止和错误后恢复均有自动化断言。
- 停止请求使用独立 `isStopping` 状态；连续点击只发送一次 cancel，取消完成前不能再次发送。

### UI 状态

- 首屏初始化、新建、切换、重命名、删除、清空、导入和导出均有明确的禁用或等待状态。
- 会话切换类操作进行时同步禁用输入、建议和重试，防止把消息发送到旧会话。
- 侧栏异步处理函数使用同步入口互斥，DOM 更新前发生的连续点击也只产生一个请求。

### Markdown

- 流式中跳过高成本代码高亮，完成后统一完整渲染。
- 代码块提供语言标签和复制；外链使用安全 `target/rel`。
- DOMPurify 继续阻止脚本、事件属性和远程图片加载。

## 本阶段不做

- 自动摘要触发策略。当前采用用户手动生成，行为更可控。
- URL 抓取、本地文件读取和 Git 操作工具。当前三个工具已足够验证 Function Calling 架构，新增权限面会提高风险。
- 参数或 Prompt 模板跨设备同步。
- 用户登录、权限、数据隔离、管理后台和商业计费。
- Kubernetes、复杂观测平台、公开部署方案。
- 通用多模型网关和复杂 agent 编排平台。

## 后续维护

当前阶段完成后，后续以缺陷和真实使用反馈驱动：

1. 修改流式、工具、存储或上下文时，先更新对应协议或数据契约测试。
2. 使用 mock 回归验证稳定性；真实 provider 测试保持显式、独立、低频。
3. 重要模型实验按 `docs/experiments.md` 记录输入、参数、结果和结论。
4. 新增 roadmap 项目前，说明它对个人使用或学习目标的直接价值。
