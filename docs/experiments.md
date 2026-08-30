# Experiment Log

本文档记录可重复的模型、上下文、工具和渲染实验。mock 实验验证链路和契约，不代表真实模型质量。

## 记录模板

```markdown
## YYYY-MM-DD: experiment name

- Goal:
- Input:
- Provider/model:
- Parameters:
- Context strategy:
- Tool/storage:
- Test mode: mock or real
- Script:
- Assertions:
- Result:
- Conclusion:
- Follow-up:
```

## 2026-07-31: Roadmap feature integration

- Goal：验证会话摘要、模型参数、导入、模板、工具状态和长 Markdown 能组成完整前端链路。
- Input：固定的模板变量、摘要 fixture、41,280 字符 TypeScript code block、外链和表格。
- Provider/model：本地 mock DeepSeek-compatible endpoint。
- Parameters：`temperature=0.3`、`maxTokens=2048`、reasoning enabled、effort high。
- Context strategy：持久化摘要 + 最近消息窗口。
- Tool/storage：mock calculator lifecycle；file store；导入冲突策略 `skip`。
- Test mode：mock。
- Script：`pnpm run test:cdp:roadmap`。
- Assertions：
  - runtime provider/model/storage 可见。
  - 模板变量替换后只填充输入框，不自动发送。
  - 摘要生成后可见，并参与 context preview。
  - 请求参数进入 `/ask` 和 context preview。
  - `tool_start` 显示执行中，`tool_result` 显示成功。
  - 长回答中使用 streaming-lite，完成后显示语言标签并完整高亮。
  - 代码复制内容长度为 41,280，外链带安全 `target/rel`，表格和移动端无页面级溢出。
  - JSON 导入使用安全默认 `skip`，结果进入会话列表。
- Result：全部自动化断言通过。
- Conclusion：当前阶段新增能力已连通，不依赖真实 provider 才能验证协议和 UI 状态。
- Follow-up：真实模型参数对回答质量和 reasoning effort 的影响需单独授权真实接口后实验。

## 2026-07-31: Tool failure semantics

- Goal：验证外部天气 API 失败不会被错误展示为工具成功。
- Input：天气 provider 返回 `code=500`。
- Provider/model：本地 mock LLM 和 mock weather fetch。
- Tool/storage：weather tool；临时 file/SQLite 数据目录。
- Test mode：mock。
- Script：`pnpm run test:tools`、`node tests/cdp/p0-api-tool.mjs`。
- Assertions：
  - NDJSON 顺序为 `tool_start`、`tool_result`、`delta`、`done`。
  - `tool_result.success=false`，摘要为可控错误，不包含堆栈。
  - 模型第二阶段返回用户可读的稍后重试提示。
  - 请求不中断为 HTTP 500，后续请求仍可恢复。
- Result：全部自动化断言通过。
- Conclusion：工具业务失败与聊天传输失败已分离，UI 状态和模型兜底语义一致。

## 2026-07-31: Mock 实验边界

上述两项 2026-07-31 实验没有调用真实模型或真实天气 API，因此不对以下内容作结论：

- 不同 temperature 对回答稳定性的影响。
- 不同 reasoning effort 对质量、延迟和成本的影响。
- 长会话摘要对真实回答准确性的影响。
- 不同 provider 的 tool call 兼容性。

执行真实实验时，应记录 endpoint 对应的 provider/model、输入、参数、耗时、输出和结论，但不得把 API key 或完整凭据写入本文档。

## 2026-08-02 OpenAI Responses 全链路

- Goal：验证 OpenAI-compatible Responses relay 在现有 NDJSON v2、React reasoning UI、Function Calling 和停止恢复流程中的真实行为。
- Provider/model：已配置的 OpenAI-compatible Responses endpoint / `gpt-5.6-luna`；不记录 endpoint 和凭据。
- Parameters：`reasoningEffort=high/medium`、`reasoning.summary=detailed`、`store=false`，不发送 temperature。
- Evidence：浏览器观察到流式中间态；reasoning summary 进入独立思考区；calculator 通过 `call_id` continuation 返回正确结果；停止触发 fetch abort，后续请求恢复成功。
- Conclusion：真实 provider 的文本、reasoning summary、工具两阶段和取消恢复已与应用协议连通。Mock 回归继续承担异常、上游释放和边界条件的稳定验证。
- Reproduction：`pnpm run test:cdp:real-openai`；该命令会调用真实模型并自动清理 `CDPOPENAIREAL-` 测试会话。

## 2026-08-10 OpenAI reasoning summary 与 tools 组合

- Goal：复核真实 OpenAI Responses 请求在始终携带 Function Calling tools 时的 reasoning summary 行为。
- Provider/model：已配置的 OpenAI-compatible Responses endpoint / `gpt-5.6-luna`；不记录 endpoint 和凭据。
- Parameters：`reasoning.effort=high`、`reasoning.summary=detailed`、`reasoning.context=current_turn`、`store=false`。
- Test mode：真实接口；`pnpm run test:cdp:all-real` 加定向原始 SSE 结构诊断。
- Evidence：不带 tools 的请求返回 `response.reasoning_summary_text.delta`，完成事件中 `reasoning.summary` 有内容；携带 tools 且无需调用工具的请求返回空 `reasoning.summary`，正文仍正常完成。重复 UI 请求均观察到该差异。
- Conclusion：当前上游在 tools 组合下不保证 reasoning summary。前端和 NDJSON 解析没有丢失事件；UI 只在 provider 实际返回摘要时展示 thinking 内容。
- Follow-up：真实门禁继续断言 reasoning 参数、正文、工具、取消和恢复；`uiReasoningSummaryPresent` 作为证据记录，不作为上游输出内容的强制断言。若 provider 行为变化，再恢复摘要存在性门禁。

## 2026-08-24 DeepSeek Vision 真实图片全链路

- Goal：验证 Vision 模型的纯文本兼容、工具调用、真实识图、历史图片上下文、停止/恢复、完整识别输出与持久化。
- Provider/model：已配置 DeepSeek endpoint / `deepseek-v4-flash-vision-exp`；不记录 endpoint 和凭据。
- Input：`Downloads/ai-basic-master` 子目录中的 `books.jpeg`，500×500 JPEG，34,429 bytes，SHA-256 `e8decf4230ec0c622f030ffe6456e5dca03a39b97c5ec3bd20814408f82ef59d`。
- Test mode：真实接口；`CDP_SCREENSHOTS=1 pnpm run test:cdp:all-real`。
- Assertions：Vision 纯文本调用 calculator 得到 42；图片识别书堆和饮用容器；历史上下文选中 1 张/34,429 bytes；刷新、分支、仅图片、停止/恢复、schema v2 ZIP 和 390px 布局通过。
- Result：全量真实入口通过；完整图片识别报告为 1,851 个可见字符，包含书堆、容器、相对位置、色彩、构图和不确定信息。
- Conclusion：当前 Provider 的当轮图片输入、应用 NDJSON v2 输出、附件持久化与 React 展示已连通。停止后恢复与完整识图分离验证，避免把历史图片是否重发的模型波动误当成恢复链路失败。
- Reproduction：`pnpm run test:cdp:real-vision` 或全量 `pnpm run test:cdp:all-real`；脚本自动清理测试会话、附件、临时服务与浏览器 Profile。

## 2026-08-29 字符数无法预测模型上下文边界

- Goal：验证旧的消息数/字符数护栏不能稳定代表不同文本的 Provider 输入规模，为 R23 统一上下文预算提供进入证据。
- Input：两条长度都为 2,000 字符的当前问题，一条全 ASCII，一条全中文；上下文上限固定为 5,000，输出预留 200，不带历史、图片或工具。
- Provider/model：本地 DeepSeek V4 Pro 配置，仅使用估算器，不调用外部模型。
- Context strategy：`deepseek-utf8-conservative-v1` 按 JSON 序列化后的 UTF-8 字节计算保守上界。
- Test mode：mock/unit。
- Script：`pnpm run test:context`。
- Assertions：两条输入在旧字符预算中完全相同；ASCII 输入估算总量不超限，中文输入固定部分超过 5,000 并在 Provider 前被拒绝。
- Result：自动化断言通过，证明“相同字符数”不能稳定预测当前兼容链路的输入规模。
- Conclusion：R23 以 Provider/model 本地上限和统一组成项估算作为主预算，旧消息数/字符数仅保留为二级护栏。该实验验证预检契约，不代表真实 tokenizer 精度或模型质量。

## 2026-08-30 R23 真实 Provider 上下文预算门禁

- Goal：验证统一预算在真实 DeepSeek/OpenAI 文本、工具续调和 DeepSeek Vision 图片链路中不会超过本地模型上限，并保持既有停止、恢复、分支和持久化语义。
- Test mode：真实接口；`CDP_SCREENSHOTS=0 CDP_REAL_SCRIPT_RETRIES=0 pnpm run test:cdp:all-real`。
- Result：三个隔离套件均一次通过。DeepSeek V4 Pro 文本上下文总估算为 7,947/131,072；Vision 上下文总估算为 70,203/131,072，其中真实 34,429 字节图片估算 896 tokens；DeepSeek 8 组模型/推理配置、OpenAI Responses、Vision 完整识别和 schema v2 ZIP 均通过。
- Conclusion：R23 的 Provider-aware 保守预算已在当前配置的真实文本、工具和图片路径闭环；这些数字是本地预检上界，不是 Provider 精确 tokenizer 或计费 usage。Docker 按用户要求未纳入本次实验。
