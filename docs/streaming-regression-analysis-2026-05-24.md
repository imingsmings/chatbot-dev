# 流式回答回归问题分析 2026-05-24

## 现象

- 问答过程中，`reasoning_delta` 能持续到达前端，思考过程可以流式渲染。
- 普通回答正文没有持续 `delta`，前端长时间无新字出现。
- 超过前端 idle 超时窗口后，前端会显示“响应超时或连接中断”。
- 同时后端仍在读取模型上游流，说明上游模型和后端读取链路没有先失败。

## 链路定位

本次问题发生在后端模型流转换层：

```text
provider SSE -> server/utils/llm/index.ts -> chatService -> chatController NDJSON -> frontend useChatStream
```

具体断点是 `callLLMStreamWithTools`。该函数在 tool decision 阶段把普通 `content` 先放进 `pendingContent`，只有上游流结束并确认没有 `tool_calls` 后，才一次性通过 callback 写给 `chatController`。

因此：

- reasoning chunk 会立即进入 callback，所以前端思考过程正常流式。
- content chunk 被后端缓冲，没有写出应用 NDJSON `delta`。
- 前端 `useChatStream` 的 `STREAM_IDLE_TIMEOUT_MS = 15000` 只会在收到网络 chunk 后重置；正文被后端缓冲时，浏览器读不到任何新 chunk，于是触发超时。

## 根因

前一次整改选择了“严格不提前泄漏 tool_calls 前普通 content”的策略：

- 优点：如果模型先输出 preamble 再返回 tool call，preamble 不会被写到最终回答里。
- 缺点：如果模型最终不调用 tool，而是直接普通回答，整个普通回答会被缓冲到上游结束才输出。

这个策略破坏了真实问答的核心体验：普通回答不再是增量 `delta`，长回答还会被前端 idle timer 判定为连接中断。

## 修复方案

`callLLMStreamWithTools` 改为短窗口缓冲：

- tool decision 阶段先缓冲普通 `content`。
- 如果随后出现 `toolCallDeltas`，丢弃待发送 preamble，继续执行 tool 调用。
- 如果普通 `content` 持续超过 `120ms` 仍没有 tool call，则认为当前分支是普通回答，解锁 content 流式输出。
- 解锁后后续 `content` 立即作为 `delta` 传给前端。
- 上游结束时，如果没有 tool call，仍会 flush 剩余 content。

该方案优先恢复普通回答流式体验，同时保留短 preamble 和单 chunk 长 preamble 不泄漏。极端情况下，如果模型先连续输出很长 preamble、超过解锁窗口后才返回 tool call，仍可能泄漏已解锁内容；这是流式体验与绝对不泄漏 tool preamble 之间的产品取舍。

## 已补测试

- `tests/cdp/p0-api-tool.mjs` 新增 `P0-39`：
  - mock 上游先返回 `reasoning_content`。
  - 随后在 tool-choice 请求中不返回 tool call，而是分多段返回普通 content。
  - 断言前端协议事件中有 `reasoning_delta`。
  - 断言普通回答产生至少 2 个 `delta`。
  - 断言第一个 `delta` 早于 `done`。
- 保留 `P0-35`：
  - tool call 前单 chunk 长 preamble 仍不进入最终回答。

## 当前验证

已完成静态、核心算法、mock 全量、真实接口全量验证：

- `pnpm --dir server typecheck`：通过。
- `pnpm --dir client type-check`：通过。
- `pnpm --dir client build`：通过。
- `node --check tests/cdp/p0-api-tool.mjs`：通过。
- 纯本地 mock 上游直测 `callLLMStreamWithTools`：通过，普通回答产生 2 次 content callback，首次 content callback 约 `194ms`，tool preamble 未通过 content callback 泄漏。
- `CDP_SCREENSHOTS=1 node tests/cdp/run-cdp-regression.mjs all-mock`：通过。
- 使用临时 SQLite 目录 `/tmp/chatbot-real-sqlite-3cKhXW` 执行 `CDP_SCREENSHOTS=1 node tests/cdp/run-cdp-regression.mjs real`：通过。
- 真实 tool smoke：通过，真实天气工具返回成功，`deltaCount = 62`，`hasDone = true`，测试会话删除后临时库 `conversation_count = 0`。

关键截图：

- mock Markdown 流式中间态：`.tmp/cdp-markdown-screenshots/08-streaming-mid-render.png`。
- mock Markdown 流式完成态：`.tmp/cdp-markdown-screenshots/09-streaming-done-render.png`。
- 真实 Markdown 流式中间态：`.tmp/cdp-markdown-real-screenshots/08-real-streaming-mid-render.png`。
- 真实 Markdown 流式完成态：`.tmp/cdp-markdown-real-screenshots/09-real-streaming-done-render.png`。

真实 Markdown 中间态断言：

- `hasAssistantRow = true`。
- `textLength = 14`。
- `isGenerating = true`。
- `hasErrorText = false`。
