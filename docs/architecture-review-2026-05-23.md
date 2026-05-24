# 架构与代码 Review 记录 2026-05-23

## 结论

当前实现已经具备可回归验证的核心链路：

- 前端按协议解析 NDJSON，支持 `delta`、`reasoning_delta`、`done`、`error`。
- 后端把 provider SSE 转换为应用 NDJSON，并通过协议 header 固定前后端契约。
- 会话本地持久化支持 CRUD、标题规则、legacy migration、损坏 JSON 错误返回。
- 会话存储层保持文件 JSON 为默认实现，并新增 SQLite 实现和 JSON 到 SQLite 的幂等迁移。
- tool/function calling 有 mock 和真实接口覆盖。
- CDP 自动化已覆盖 P0、P1、UI 矩阵、Markdown、Highlight、真实接口。

本轮 code review 中发现的明确问题已修复：

- 避免普通 assistant 消息持久化空 `reasoningContent`。
- real runner 改为直接启动后端，避免正常 SIGTERM 产生 pnpm lifecycle 噪音。
- 流式错误态保留已收到正文，错误文案作为状态显示。
- 侧栏父容器增加高度约束，保证大量会话时滚动正常。
- tool decision 阶段改为严格不提前 flush 普通 content，避免长 preamble 在 tool_call 前泄漏。
- DeepSeek reasoning 参数支持环境变量配置，默认行为保持 `enabled/max`。
- 原生 `prompt/confirm/alert` 替换为应用内 modal，便于主题、键盘、移动端和 CDP 断言统一。
- CDP runner 生成 `.tmp/cdp-results/<suite>.json` 机器可读结果，并支持真实接口脚本超时/重试配置。
- SQLite 模块改为按需加载，默认文件 JSON 存储不依赖 `node:sqlite` 可用性。

以下是本轮针对原优化项的整改状态。

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

整改：

- 已新增 `tests/cdp/helpers/`，包含 `cdpClient.mjs`、`browser.mjs`、`appActions.mjs`、`mockStream.mjs`、`services.mjs`、`results.mjs`。
- `run-cdp-regression.mjs` 已改为复用 `services.mjs`，并统一写入 `.tmp/cdp-results/<suite>.json`。
- `p0-api-tool.mjs` 已复用 `mockStream.mjs`，新增的脚本应优先使用 helpers，既有大脚本可在后续低风险窗口继续迁移重复 CDP 操作。

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

整改：

- 已选择严格不泄漏策略，`callLLMStreamWithTools` 在 tool decision 阶段仅累计普通 content；确认无 tool_call 后才 flush。
- 已新增 `P0-35` 长 preamble 回归，覆盖超过旧缓冲阈值后再返回 tool_call 的边界。

## O3. 原生 prompt/confirm/alert 限制了 UI 一致性

现状：

- 重命名、删除、清空、错误提示依赖浏览器原生弹窗。
- CDP 需要特殊处理 dialog，且难以做完整视觉和可访问性验证。

风险：

- 移动端、深色主题、键盘可达性、文案布局都不可控。

建议：

- 后续用应用内 modal/toast 替代原生弹窗。
- 替换后补 UI 场景：键盘 Esc/Enter、焦点陷阱、取消/确认、移动端遮罩和滚动锁定。

整改：

- 已新增 `AppDialog.vue`，统一承载 alert、confirm、prompt 三类交互。
- 新 dialog 支持 Esc 取消、Enter 提交 prompt、Tab 焦点约束，并继承明暗主题变量。
- `App.vue` 和 `useChatStream` 已移除原生 `prompt/confirm/alert` 调用，UI CDP 脚本改为操作应用内 modal。

## O4. 真实接口测试应减少对模型具体措辞的依赖

现状：

- 真实 Markdown 和真实 UI 场景已经尽量通过结构断言验证，但仍依赖模型按提示输出特定 marker。
- 本轮真实 Markdown 的 `streamingMid.hasH2` 为 `false` 但最终通过，因为中间态在真实流中可能还没形成完整 Markdown 结构。

风险：

- 真实模型更新或响应节奏变化可能导致偶发失败。

建议：

- 真实接口更多验证协议、状态机、持久化、清理、结构最终态。
- 对中间态只断言“正在生成 + 有 assistant 行 + 无异常”，不要要求特定 Markdown 结构已经闭合。

整改：

- `markdown-real.mjs` 的流式中间态已改为断言 assistant 行存在、仍在生成、无错误态；Markdown 结构闭合只在最终态验证。
- 真实接口脚本等待时间改为 `CDP_REAL_WAIT_TIMEOUT_MS` 及细分变量配置。

## O5. Reasoning 参数应配置化

现状：

- DeepSeek adapter 固定发送 `thinking: { type: 'enabled' }` 和 `reasoning_effort: 'max'`。

风险：

- 不同 DeepSeek-compatible endpoint 对这些字段支持不一致。
- 固定 max 可能增加真实接口成本和延迟。

建议：

- 增加环境变量，例如 `LLM_REASONING_ENABLED`、`LLM_REASONING_EFFORT`。
- 默认保持当前行为，允许本地或 CI 降级为关闭/低 effort。

整改：

- 已新增 `LLM_REASONING_ENABLED`、`LLM_REASONING_EFFORT`。
- 默认仍发送 `thinking: { type: 'enabled' }` 和 `reasoning_effort: 'max'`；设置 `LLM_REASONING_ENABLED=false` 后不再发送 reasoning 参数。

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

整改：

- `run-cdp-regression.mjs` 已捕获每个脚本末尾 JSON，并写入 suite 汇总。
- 汇总同时覆盖通过和失败结果；失败时保留已执行脚本结果和失败原因。
- runner 支持 `CDP_SCRIPT_RETRIES` 与 `CDP_REAL_SCRIPT_RETRIES`，真实接口偶发失败可配置重试，不改变默认低成本行为。

## O7. SQLite 存储支持和迁移

背景：

- 当前文件 JSON 存储适合本地开发和简单持久化，但后续会话量增大后，列表排序、迁移、并发写入和查询能力会受限。
- 文件 JSON 仍应作为默认实现，避免影响现有本地数据和最小启动成本。

整改：

- 新增 `CONVERSATION_STORE=sqlite` 切换 SQLite 存储，默认 `file/json` 不变。
- 文件 JSON 默认落在 `CONVERSATION_DATA_DIR/file/conversations/*.json`，也可用 `CONVERSATION_FILE_DATA_DIR` 单独指定文件存储根目录。
- 新增 `CONVERSATION_DB_PATH` 指定数据库路径，默认落在 `CONVERSATION_DATA_DIR/sqlite/conversations.sqlite3`。
- SQLite 仅在选择 `CONVERSATION_STORE=sqlite` 时加载 `node:sqlite`；默认文件 JSON 实现仍可在不启用 SQLite 时独立启动。
- SQLite 首次启用时会从 `file/conversations/*.json`、`file/conversations.json`、`file/conversations.json.migrated` 以及旧根目录 `conversations/*.json`、`conversations.json(.migrated)` 导入数据；导入使用 `INSERT OR IGNORE` 和 `storage_meta` 标记保证幂等。
- 迁移只复制 JSON 数据到 SQLite，不删除、不重命名已有 JSON 文件。
- 已新增 `P0-36` 到 `P0-38` 覆盖迁移、重启幂等、ask 持久化、标题生成和 SQLite CRUD。
