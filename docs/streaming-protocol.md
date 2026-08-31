# Streaming Protocol

## 传输边界

模型 provider 返回 `text/event-stream`。后端 adapter 解析 provider SSE，再转换为应用级 NDJSON：

```text
provider SSE
  -> LLM adapter event
  -> chat service event
  -> one JSON object per line
  -> frontend ReadableStream parser
```

provider adapter 接受标准 SSE `data:` 字段，兼容冒号后有或没有空格的形式；空 `data:`、注释和其他字段行会被忽略。

浏览器响应约定：

```http
Content-Type: application/x-ndjson; charset=utf-8
X-Chat-Stream-Protocol: 2
Cache-Control: no-cache
X-Accel-Buffering: no
```

前端必须先校验 `X-Chat-Stream-Protocol`。版本不匹配、JSON 损坏、未知事件或字段类型错误都会进入可恢复错误态，不静默猜测旧字段。

## NDJSON framing

每个事件是一个完整 JSON 对象，以单个换行符结束：

```ndjson
{"type":"reasoning_delta","content":"先分析问题。"}
{"type":"delta","content":"最终回答"}
{"type":"done","reasoningDurationMs":1280}
```

网络 chunk 不等于事件边界。前端保留未完成行缓冲，只对完整行调用 `JSON.parse`，流结束时再处理最后一个非空缓冲。

## 协议 v2 事件

### `reasoning_delta`

```json
{"type":"reasoning_delta","content":"正在分析"}
```

- `content` 必须是字符串。
- 追加到 assistant 的 `reasoningContent`。
- reasoning 仍在流式输出时，可展开区域的标签为 `Thinking...`；流结束后显示 `已深度思考`，存在耗时时显示 `已深度思考（用时 N 秒）`。

### `delta`

```json
{"type":"delta","content":"回答片段"}
```

- `content` 必须是字符串。
- 追加到 assistant 正文。
- 流式阶段使用轻量 Markdown 渲染，完成后执行完整高亮。

### `tool_start`

```json
{"type":"tool_start","toolCallId":"call_1","name":"calculate"}
```

- `name` 必须是字符串。
- `toolCallId` 可选，用于关联同一次工具调用。
- 不传递工具参数，避免 UI 暴露不必要的模型判断内容。

### `tool_result`

```json
{
  "type":"tool_result",
  "toolCallId":"call_1",
  "name":"calculate",
  "summary":"计算结果：42",
  "success":true
}
```

- `summary` 是后端截断后的用户可读摘要，不是完整内部返回值。
- `success=false` 表示参数校验、外部调用或未知工具失败；聊天请求仍可进入模型兜底回答。

### `done`

```json
{"type":"done","reasoningDurationMs":1280}
```

- 标志当前流正常完成。
- `reasoningDurationMs` 可选，存在时必须是有限数字。
- 前端收到后停止消费业务事件，并把 assistant 状态设为完成。

### `error`

```json
{"type":"error","message":"模型响应失败"}
```

- 用于响应头已发送后的流内错误。
- 前端保留已收到的部分正文，显示错误并允许后续请求恢复。
- Provider 在完成事件前 EOF 时也使用该事件；此时不得再发送 `done`，本轮问答不得持久化。

## Provider SSE 适配

DeepSeek adapter 负责：

- 去掉 `data: ` 前缀并识别 `[DONE]`。
- 提取 `delta.content`、`delta.reasoning_content` 和增量 `tool_calls`。
- 合并分片工具参数。
- 把请求选项映射为 `temperature`、`max_tokens`、`thinking` 和 `reasoning_effort`。DeepSeek thinking 模式会忽略 temperature；接受的 effort 为 `low/high/max`，兼容选项 `medium` 会映射为 `high`。
- 只有收到 `[DONE]` 才视为完整流。

当前 DeepSeek adapter 在提供工具时还会发送 `tool_choice:auto`。[DeepSeek 官方思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)说明 thinking 支持工具调用，但没有明确 `tool_choice` 参数的兼容语义。因此该请求形状仍是需要真实门禁覆盖的上游兼容边界，历史真实测试通过不代表官方协议漂移后仍然成立。修改请求形状前应先补 adapter mock，并经用户确认运行最小真实接口验证。

OpenAI Responses adapter 负责：

- 按语义事件解析 `response.output_text.delta`、`response.reasoning_summary_text.delta`、`response.function_call_arguments.delta` 和完成/错误事件。
- 使用 `response.output_item.added` 保存 message phase 与 function `call_id`；使用 `response.output_item.done` 兜底补齐完整工具参数。
- 完成时用 response output snapshot 校验/补齐正文和 reasoning summary，并把 output items 仅保留在当前请求内供工具 continuation 使用。
- 将工具定义映射为 Responses API 的扁平 strict function schema；工具结果映射为 `function_call_output`。
- `reasoning_delta` 表示 provider 提供的 reasoning summary，不代表隐藏的原始思维链。
- 只有 `response.completed` 才视为完整流；通用 `[DONE]` 不能替代 Responses 完成事件。

两种 provider 在正文、reasoning 或工具参数之后直接 EOF 都视为不完整。该判定发生在内部 LLM 层，不增加 NDJSON v2 事件类型。

provider 字段不会直接透传到浏览器。更换 provider 时，只需保持内部 LLM event 和应用 NDJSON 协议稳定。

## Function Calling 与内容抑制

第一次模型调用带 `tools` 和 `tool_choice:auto`。后端对尚未标记为最终回答的普通 content 使用 120ms 短窗口缓冲，在工具意图通常能够被识别的时间内抑制“我先查一下”一类前导语，同时避免普通回答一直等待到上游结束。

- Provider 明确标记 `final_answer`：立即解锁并流式输出正文。
- 无 tool call：普通 content 最多短暂缓冲，窗口到期后按 `delta` 继续输出；流结束时刷新剩余内容。
- 缓冲窗口内出现 tool call：丢弃尚未发送的前导 content，发送 `tool_start` 和 `tool_result`，再流式输出第二阶段最终回答。
- 普通 content 已因窗口到期发送后才出现 tool call：已发送内容无法撤回。这是低延迟与工具前导语抑制之间的已知取舍，不是绝对的内容隔离保证。
- 工具参数 JSON 损坏：回退到不带工具的标准回答。

## 取消与清理

用户手动停止时，顺序是：

1. 前端先刷新已接收但尚未渲染的事件缓冲。
2. 前端调用 `POST /api/requests/:requestId/cancel`，reason 为 `manual`。
3. 后端 request registry 触发 `AbortController`，中止 provider fetch 或正在执行的工具，并保持 requestId 占用直到 ask 请求的 `finally` 完成清理。
4. cancel API 等待该清理完成后返回；前端复用同一 cancellation Promise，收到确认后中止本地 fetch，并在 ask 流完成收尾后释放当前会话发送锁。

首包或流空闲超时时，前端先启动 reason 为 `timeout` 的取消请求，再立即中止本地 fetch；当前会话发送锁继续保持到取消请求完成。这样既能快速停止无效流，又不会在服务端仍持有会话锁时开放一次必然冲突的重试。会话切换和组件卸载沿用各自 reason；切换会等待取消请求完成后中止本地 fetch，卸载只做 best-effort 清理且不再更新 UI。

只有显式手动停止、且后端已经收到非空正文时，当前用户消息和部分回答才持久化为 `stopped`。首个正文前停止、超时、切换会话、组件卸载、网络错误或 Provider 不完整 EOF 都不会把部分问答写入历史。成功完成或确认停止后，前端重新拉取会话详情，使 optimistic 行与持久化索引一致。

request registry 完成清理后释放 requestId 和会话锁，后续请求可立即继续使用同一会话。取消接口异常时客户端记录错误并走既有流异常恢复；取消失败不被当作服务端清理完成证据。

## 协议演进规则

新增可选字段且旧客户端可忽略时，可以保持版本。新增事件、改变字段语义或删除字段时必须：

1. 提升后端和前端协议版本常量。
2. 同步修改两端运行时校验。
3. 更新 mock fixture 和 CDP 协议测试。
4. 明确是否需要双版本兼容；当前内部项目选择前后端同步升级，不保留隐式旧字段兼容。
