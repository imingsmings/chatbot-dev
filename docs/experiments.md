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

## 真实接口实验边界

本轮没有调用真实模型或真实天气 API，因此不对以下内容作结论：

- 不同 temperature 对回答稳定性的影响。
- 不同 reasoning effort 对质量、延迟和成本的影响。
- 长会话摘要对真实回答准确性的影响。
- 不同 provider 的 tool call 兼容性。

执行真实实验时，应记录 endpoint 对应的 provider/model、输入、参数、耗时、输出和结论，但不得把 API key 或完整凭据写入本文档。
