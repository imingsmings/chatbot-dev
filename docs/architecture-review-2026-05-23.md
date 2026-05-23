# 架构与代码 Review 记录 2026-05-23

## 结论

当前实现已经具备可回归验证的核心链路：

- 前端按协议解析 NDJSON，支持 `delta`、`reasoning_delta`、`done`、`error`。
- 后端把 provider SSE 转换为应用 NDJSON，并通过协议 header 固定前后端契约。
- 会话本地持久化支持 CRUD、标题规则、legacy migration、损坏 JSON 错误返回。
- tool/function calling 有 mock 和真实接口覆盖。
- CDP 自动化已覆盖 P0、P1、UI 矩阵、Markdown、Highlight、真实接口。

本轮 code review 中发现的明确问题已修复：

- 避免普通 assistant 消息持久化空 `reasoningContent`。
- real runner 改为直接启动后端，避免正常 SIGTERM 产生 pnpm lifecycle 噪音。
- 流式错误态保留已收到正文，错误文案作为状态显示。
- 侧栏父容器增加高度约束，保证大量会话时滚动正常。

以下是暂不直接修改、建议后续排期的优化项。

## O1. CDP 脚本公共能力应抽取

现状：

- 多个 CDP 脚本重复实现 WebSocket client、`waitFor`、截图、输入、点击、服务启动。
- 新增协议 header 后，Markdown 和 Highlight fixture 都需要分别修改，说明公共 mock response 能力不足。

风险：

- 后续 DOM 或协议变更时需要多处同步，容易出现某个脚本滞后。
- 真实接口和 mock 脚本的日志格式不统一，结果文档需要人工整理。

建议：

- 新增 `tests/cdp/helpers/`，拆出 `cdpClient.mjs`、`browser.mjs`、`appActions.mjs`、`mockStream.mjs`、`services.mjs`。
- runner 统一收集每个脚本的 JSON result，输出 `.tmp/cdp-results/<suite>.json`。

## O2. Tool 决策阶段内容缓冲策略需要明确产品取舍

现状：

- `callLLMStreamWithTools` 为了保留无 tool 普通回答的流式体验，会先缓冲 content，达到一定长度后释放。
- 如果模型先输出很长 preamble，之后才返回 tool call，理论上仍可能泄漏一段 tool 决策前 content。
- 当前 P0 已覆盖短 preamble 不泄漏，但长 preamble 边界还未脚本化。

风险：

- 严格语义上，“tool_calls 前普通 content 不提前泄漏”与“所有无 tool 普通回答都立即流式输出”存在天然张力。

建议：

- 明确优先级：
  - 若优先严格不泄漏：tool decision 阶段不提前 flush content，等 finish 后确认无 tool call 再输出。
  - 若优先流式体验：保留缓冲阈值，但文档把它定义为 best effort，并增加长 preamble 回归用例。
- 建议后续新增 `P0-tool-long-preamble`，固化最终选择。

## O3. 原生 prompt/confirm/alert 限制了 UI 一致性

现状：

- 重命名、删除、清空、错误提示依赖浏览器原生弹窗。
- CDP 需要特殊处理 dialog，且难以做完整视觉和可访问性验证。

风险：

- 移动端、深色主题、键盘可达性、文案布局都不可控。

建议：

- 后续用应用内 modal/toast 替代原生弹窗。
- 替换后补 UI 场景：键盘 Esc/Enter、焦点陷阱、取消/确认、移动端遮罩和滚动锁定。

## O4. 真实接口测试应减少对模型具体措辞的依赖

现状：

- 真实 Markdown 和真实 UI 场景已经尽量通过结构断言验证，但仍依赖模型按提示输出特定 marker。
- 本轮真实 Markdown 的 `streamingMid.hasH2` 为 `false` 但最终通过，因为中间态在真实流中可能还没形成完整 Markdown 结构。

风险：

- 真实模型更新或响应节奏变化可能导致偶发失败。

建议：

- 真实接口更多验证协议、状态机、持久化、清理、结构最终态。
- 对中间态只断言“正在生成 + 有 assistant 行 + 无异常”，不要要求特定 Markdown 结构已经闭合。

## O5. Reasoning 参数应配置化

现状：

- DeepSeek adapter 固定发送 `thinking: { type: 'enabled' }` 和 `reasoning_effort: 'max'`。

风险：

- 不同 DeepSeek-compatible endpoint 对这些字段支持不一致。
- 固定 max 可能增加真实接口成本和延迟。

建议：

- 增加环境变量，例如 `LLM_REASONING_ENABLED`、`LLM_REASONING_EFFORT`。
- 默认保持当前行为，允许本地或 CI 降级为关闭/低 effort。

## O6. 测试结果应机器可读

现状：

- 脚本会输出 JSON，但 runner 不统一汇总。
- 文档中的通过次数和失败原因需要人工维护。

建议：

- runner 捕获每个脚本最后一个 JSON object，生成统一结果：

```text
.tmp/cdp-results/
  all-mock.json
  real.json
```

- 文档由结果 JSON 半自动生成，减少遗漏。
