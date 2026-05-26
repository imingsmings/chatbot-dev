# Chatbot Roadmap

本文档按当前项目定位制定：个人学习、内部使用、不对外发布、不做商业化、不面向大量用户。

因此 roadmap 优先关注：

- 学习价值：能覆盖 LLM 应用里的关键技术点。
- 自用效率：能提升日常使用和调试体验。
- 稳定性：本地运行可靠、可回归、可恢复。

暂不优先投入：

- 登录注册、多用户、RBAC、租户隔离。
- 商业化计费、限流平台、审计后台。
- 大规模部署、Kubernetes、复杂监控告警。
- 面向公开发布的安全合规体系。

## 当前基线

已具备的核心能力：

- Vue 3 + Vite 前端，Express + TypeScript 后端。
- 多会话 CRUD、本地持久化、默认文件 JSON 存储。
- 可选 SQLite 存储及 JSON 到 SQLite 的幂等迁移。
- DeepSeek-compatible 模型接入。
- SSE provider stream -> backend NDJSON -> frontend streaming render。
- 显式流式协议：`delta`、`reasoning_delta`、`done`、`error`，并通过 `X-Chat-Stream-Protocol` 固定版本。
- Function Calling：`tools + tool_choice:auto`，当前包含 weather tool。
- Thinking/reasoning 展示：流式 `reasoning_delta`、`Thoughts` 面板、持久化、历史恢复。
- Markdown 渲染：`markdown-it`、`DOMPurify`、selective `highlight.js`。
- 停止生成：前端 abort、cancel API、后端 upstream abort。
- CDP 回归测试矩阵，覆盖 P0/P1/UI/Markdown/Highlight/真实接口。

## P0: 稳定当前核心链路

目标：保证当前能力可靠，减少后续迭代时反复破坏流式、tool、reasoning 和持久化链路。

### R0.1 配置体验补齐

状态：完成。

内容：

- 完善 `server/.env.example`，补齐 reasoning、SQLite、真实接口测试相关变量。
- 启动时校验关键配置，例如 `LLM_ENDPOINT`、`LLM_MODEL`、provider key。
- 对天气工具配置缺失给出明确错误，而不是等请求阶段出现不清晰失败。

验收：

- 缺少核心 LLM 配置时，后端启动或首次请求能返回明确错误。
- README 环境变量表和 `.env.example` 一致。

验证：已通过。

### R0.2 回归入口固定

状态：完成。

内容：

- 保持根目录脚本作为统一入口。
- 将常用检查固化为最小集合：server typecheck、client typecheck、P0 mock。
- 继续避免默认真实接口测试，减少成本和不稳定性。

验收：

```bash
pnpm run check
pnpm run test:cdp:p0
```

验证：已通过。

## P1: 上下文管理

目标：解决长会话越来越慢、越来越贵、可能超上下文的问题，同时增强学习价值。

### R1.1 最近 N 轮上下文窗口

状态：待做。

内容：

- 在 prompt 构造前裁剪历史消息。
- 默认保留最近 N 轮，例如最近 10 到 20 条消息。
- 保留 system prompt 和当前用户问题。

设计建议：

- 放在 `server/utils/promptTemplates.ts` 或新增 `server/services/contextService.ts`。
- 不直接修改原始会话存储，只影响发送给模型的上下文。

验收：

- 长会话只发送窗口内消息给模型。
- 不影响前端历史展示。
- 不破坏 tool calling 和 reasoning。

### R1.2 会话摘要

状态：待做。

内容：

- 当会话超过阈值时生成摘要。
- 后续 prompt 使用 `summary + 最近 N 轮`。
- 摘要可落盘，便于刷新后继续使用。

设计建议：

- 新增 `conversation.summary` 或单独 `contextSummary` 字段。
- 摘要生成应可手动触发，自动触发放到后续。

验收：

- 用户可看到当前会话摘要。
- 摘要不会污染原始消息。
- 摘要参与后续回答上下文。

### R1.3 调试当前模型上下文

状态：待做。

内容：

- 提供“查看本次发送给模型的上下文”能力。
- 展示最终 messages、tool definitions、模型参数。

设计建议：

- 只在本地开发模式或设置开关后显示。
- 可先做服务端日志或调试 API，再做 UI。

验收：

- 能清楚看到一次 `/ask` 最终发给模型的 request body。

## P2: 模型和参数可视化

目标：让项目更适合学习和调试不同模型行为。

### R2.1 模型信息展示

状态：待做。

内容：

- 前端展示当前 provider、model。
- 展示 reasoning 是否开启、reasoning effort。
- 展示当前存储后端：file 或 SQLite。

验收：

- 用户不看 `.env` 也能知道当前运行配置。

### R2.2 本地参数切换

状态：待做。

内容：

- 支持 temperature、max tokens 等常见参数。
- 可以先做后端环境变量，再做前端 UI。

设计建议：

- 参数先进入 LLM adapter body。
- 前端配置只影响当前会话或当前请求，不急着全局持久化。

验收：

- 同一个问题可以用不同参数发起请求。
- 请求参数能在调试上下文里看到。

## P3: 会话管理增强

目标：提升个人长期使用体验。

### R3.1 会话搜索

状态：待做。

内容：

- 按标题搜索。
- 按消息内容搜索。
- 搜索结果可跳转到对应会话。

设计建议：

- 文件 JSON 存储可以先全量读取过滤。
- SQLite 存储后续可使用 SQL 查询或 FTS。

验收：

- 搜索关键词能命中标题和历史消息。
- 不影响会话列表默认排序。

### R3.2 会话导出

状态：待做。

内容：

- 单会话导出 Markdown。
- 全量导出 JSON 备份。
- 备份保留 reasoningContent 和 reasoningDurationMs。

验收：

- 导出的 Markdown 可读。
- 导出的 JSON 可用于后续恢复。

### R3.3 会话导入

状态：待做。

内容：

- 支持导入此前导出的 JSON。
- 导入时处理重复 id。
- 给出导入结果：新增、跳过、冲突。

验收：

- 能在新数据目录恢复旧会话。
- 不覆盖已有会话，除非明确选择覆盖策略。

## P4: Prompt 模板

目标：把常用内部任务沉淀成可复用入口，提高日常使用效率。

### R4.1 模板列表

状态：待做。

候选模板：

- 代码解释。
- Bug 分析。
- 技术方案评审。
- 翻译润色。
- 周报总结。
- 学习计划。

设计建议：

- 先用静态 JSON 或 TS 配置。
- 模板生成后填入输入框，用户可修改后再发送。

验收：

- 点击模板后输入框填充完整 prompt。
- 不自动发送，保留用户编辑空间。

### R4.2 模板变量

状态：待做。

内容：

- 支持 `{topic}`、`{code}`、`{language}` 等简单变量。
- 提供小表单替换变量。

验收：

- 模板可复用，不需要手工改大段 prompt。

## P5: 工具能力扩展

目标：继续学习 Function Calling 和工具编排，但不把系统做成复杂 agent 平台。

### R5.1 基础工具扩展

状态：待做。

候选工具：

- 当前时间。
- 简单计算器。
- URL 内容抓取和摘要。
- 本地文件摘要。
- Git diff 总结。

设计建议：

- 每个工具独立文件。
- `toolService.ts` 保持注册表职责，不堆业务逻辑。
- 每个工具都要有参数 schema、validateArgs、mock 测试。

验收：

- 新工具能通过原生 tool call 调用。
- 工具失败不会导致聊天请求 500。

### R5.2 Tool 执行过程可视化

状态：可选。

内容：

- 在 UI 中显示 “调用工具中” 状态。
- 展示工具名称和简要结果。

注意：

- 当前产品取舍是不让用户看到 tool 判断过程中的无关内容。
- 若展示工具状态，应避免泄漏模型 tool decision preamble。

## P6: 流式和 Markdown 继续打磨

目标：保持当前强项，避免长回答和复杂 Markdown 退化。

### R6.1 大文本流式性能优化

状态：待做。

内容：

- 长回答时减少整段 Markdown 反复 parse 的成本。
- 评估“流式中纯文本、完成后 Markdown”与当前节流 parse 的取舍。

验收：

- 长代码块、长表格、长 reasoning 不造成明显卡顿。

### R6.2 Markdown 功能补齐

状态：可选。

候选：

- 代码块复制按钮。
- 代码语言标签。
- 表格样式优化。
- 链接 `target/rel` 策略。

验收：

- 不降低现有 XSS 安全边界。
- 不引入远程图片自动加载。

## P7: 文档和学习材料

目标：让项目本身成为可复盘的学习材料。

### R7.1 架构图和协议文档

状态：待做。

内容：

- 补一张架构图。
- 补 streaming protocol 文档。
- 补 Function Calling 两阶段流程图。
- 补 reasoning 数据流说明。

验收：

- 新开发者可通过文档理解请求从前端到模型再回到 UI 的全链路。

### R7.2 实验记录

状态：可选。

内容：

- 记录不同模型、不同 reasoning effort、不同上下文策略下的表现。
- 记录真实接口测试结果和结论。

验收：

- 每次重要实验有输入、配置、结果、结论。

## 不计划优先做

以下能力暂不进入近期路线：

- 用户登录和权限系统。
- 多用户数据隔离。
- 管理后台。
- 商业计费。
- 外部公开部署方案。
- 复杂观测平台。
- 多模型网关平台化。

## 建议执行顺序

1. R0.1 配置体验补齐。
2. R1.1 最近 N 轮上下文窗口。
3. R1.3 调试当前模型上下文。
4. R3.1 会话搜索。
5. R3.2 会话导出。
6. R4.1 Prompt 模板列表。
7. R5.1 增加 1 到 2 个基础工具。
8. R7.1 架构图和协议文档。
9. R1.2 会话摘要。
10. R2.2 本地参数切换。
