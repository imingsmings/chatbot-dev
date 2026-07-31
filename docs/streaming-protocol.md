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
- 正文开始后，UI 从 `Thinking...` 切换为可展开的 `Thoughts`。

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

## Provider SSE 适配

DeepSeek-compatible adapter 负责：

- 去掉 `data: ` 前缀并识别 `[DONE]`。
- 提取 `delta.content`、`delta.reasoning_content` 和增量 `tool_calls`。
- 合并分片工具参数。
- 把请求选项映射为 `temperature`、`max_tokens`、`thinking` 和 `reasoning_effort`。

provider 字段不会直接透传到浏览器。更换 provider 时，只需保持内部 LLM event 和应用 NDJSON 协议稳定。

## Function Calling 与内容抑制

第一次模型调用带 `tools` 和 `tool_choice:auto`。在是否调用工具尚未确定前，后端不会把普通 content 直接写给客户端，避免 “我先查一下” 一类前导语泄漏。

- 无 tool call：缓冲内容按多个 `delta` 继续输出。
- 有 tool call：丢弃前导 content，发送 `tool_start` 和 `tool_result`，再流式输出第二阶段最终回答。
- 工具参数 JSON 损坏：回退到不带工具的标准回答。

## 取消与清理

停止生成包含三层：

1. 前端中止 fetch。
2. 前端调用 `/requests/:requestId/cancel`。
3. 后端 `AbortController` 中止 provider fetch 或正在执行的工具。

请求中止后不写入完整问答。request registry 会释放 requestId，后续请求可继续使用同一会话。

## 协议演进规则

新增可选字段且旧客户端可忽略时，可以保持版本。新增事件、改变字段语义或删除字段时必须：

1. 提升后端和前端协议版本常量。
2. 同步修改两端运行时校验。
3. 更新 mock fixture 和 CDP 协议测试。
4. 明确是否需要双版本兼容；当前内部项目选择前后端同步升级，不保留隐式旧字段兼容。
