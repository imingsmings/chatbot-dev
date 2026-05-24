# Chatbot 回归测试用例

本文档用于后续代码重构、问题修复和功能调整后的回归测试。

默认规则：

- 默认使用 mock 上游，保证稳定、可重复、低成本。
- 默认使用 CDP 自动化执行测试，不做手工点测作为最终结论。
- 默认不截图，只输出结果摘要和失败原因。
- 只有明确要求“真实接口”时，才执行真实模型或真实外部 API 测试。
- 只有明确要求“截图”时，才保存并返回截图。
- 所有 SQLite 回归必须使用 `mktemp` 创建的临时数据目录和临时数据库，不直接使用或写入 `server/data/sqlite`。
- 每次重构或问题修复后，默认至少执行 P0。
- 涉及 UI、Markdown、样式、复制、重试、滚动时，加跑对应 P1。
- 涉及真实模型质量、真实 tool API、真实上下文表现时，加跑 P2。

## P0 必跑

| ID | 场景 | 默认方式 | 关键断言 |
| --- | --- | --- | --- |
| P0-01 | 正常发送消息 | mock | 用户消息插入；assistant 返回；按钮恢复“发送”；会话 messageCount +2 |
| P0-02 | 生成中按钮状态 | mock + CDP | 请求中显示“停止”；输入框禁用；结束后恢复“发送” |
| P0-03 | 流式中停止 | mock + 可观测上游 | `/ask` 取消；上游 stream 提前 close；不持久化完整问答；部分内容保留 |
| P0-04 | 首 token 前停止 | mock 慢 function-call | function-call 上游提前 close；不进入 stream；不持久化问答 |
| P0-05 | 上游慢响应停止 | mock 慢 stream | stream 建立但未吐 token 时停止；上游提前 close |
| P0-06 | 新建聊天中断生成 | mock | 旧请求取消；旧上游 close；新会话为空；旧会话不写完整回答 |
| P0-07 | 停止后继续发送 | mock | 旧请求释放；新 requestId 正常；内容不串流 |
| P0-08 | 重复停止 | mock | 多次停止无异常；最终请求释放 |
| P0-09 | cancel 接口 | API + mock | `/requests/:requestId/cancel` 成功；未知 requestId 返回 `cancelled: false`；无 500 |
| P0-10 | 正常会话 CRUD | API/CDP | 列表、新建、详情、重命名、清空、删除均正常 |
| P0-11 | 会话上下文隔离 | mock | A/B 会话上下文互不污染；切回 A 历史恢复 |
| P0-12 | 本地 JSON 持久化 | API/文件检查 | 一个会话一个 JSON；增删改清落盘正确 |
| P0-13 | 服务端错误 JSON | API | 404/500 返回 JSON；不返回 HTML 错误页 |
| P0-14 | tool 调用成功 | mock tool | 模型流式返回原生 tool_calls 后，后端调用 tool，并基于 tool result 生成回答；tool_calls 前的普通 content 不提前泄漏到最终响应；reasoning_content 会随 tool result 回灌 |
| P0-15 | tool 调用失败 | mock tool error | tool 异常不打断服务；回答友好降级；不暴露内部堆栈 |
| P0-16 | 未知 tool | mock | 未注册 tool 返回可控结果；后端不崩溃 |
| P0-17 | tool 期间停止 | mock 慢 tool / 慢 answer | 停止后请求释放；后续 answer 阶段不继续消耗；不持久化完整问答 |
| P0-18 | invalid requestId | API/CDP | `/ask` 返回 400 JSON；服务端不崩溃 |
| P0-19 | duplicate requestId | API/CDP | 第二个同 requestId 请求返回 409 JSON；首个请求可正常结束 |
| P0-20 | tool arguments 非法 JSON | mock LLM | 非法 arguments fallback 到标准回答；后续请求仍可恢复 |
| P0-21 | 损坏上游 stream | mock LLM | malformed upstream stream 返回可控 error；服务端不崩溃 |
| P0-22 | 前端损坏 NDJSON | mock/CDP | 客户端进入错误态；后续请求可恢复 |
| P0-23 | 模型空响应 | mock LLM | 返回可控 error；不写入完整问答 |
| P0-24 | tool answer 阶段停止 | mock tool + 慢 answer | tool 已返回后停止，answer stream abort；不持久化完整问答 |
| P0-25 | 异常后恢复发送 | mock | 前序异常后，新请求仍可成功生成 |
| P0-26 | 流式协议 header | mock/API/CDP | `/ask` 返回 `X-Chat-Stream-Protocol: 1`；前端只接受当前协议版本 |
| P0-27 | tool 决策阶段使用会话上下文 | mock tool | 历史消息中的上下文能影响 tool call 参数；不同会话仍隔离 |
| P0-28 | reasoning 持久化 | mock LLM | assistant 的 `reasoningContent` 和非负 `reasoningDurationMs` 落盘，刷新/切换后可恢复 |
| P0-29 | reasoning_delta 前端渲染 | mock/CDP | reasoning 流式阶段显示 `Thinking...`；正文出现后显示 `Thoughts`；正文正常渲染 |
| P0-30 | reasoning 阶段停止 | mock 慢 reasoning | 停止后请求释放；不持久化完整问答；后续发送正常 |
| P0-31 | 缺失/错误协议版本 | mock/CDP | 前端进入可恢复错误态；不会误渲染不兼容流；后续请求可恢复 |
| P0-32 | 非法流式事件 | mock/CDP | 非法 `reasoning_delta`、非法 `done.reasoningDurationMs` 均进入可恢复错误态 |
| P0-33 | reasoning 不污染复制内容 | mock/CDP | assistant 复制只复制最终回答正文，不混入 Thoughts/reasoning |
| P0-34 | 会话操作清空未发送草稿 | mock/CDP | 新建、切换、删除、清空当前会话后 textarea 均为空 |
| P0-35 | 长 tool preamble 不泄漏 | mock tool | 模型在 tool_call 前输出超过旧缓冲阈值的普通 content，最终响应仍不泄漏 preamble |
| P0-36 | JSON 到 SQLite 迁移 | API/SQLite | `CONVERSATION_STORE=sqlite` 首次启动导入单会话 JSON 与 legacy JSON；保留 reasoning 字段；迁移元数据完整且重启幂等 |
| P0-37 | SQLite ask 持久化 | API/SQLite + mock LLM | SQLite 后端下 `/ask` 正常返回协议 header；用户和 assistant 消息落库；自动标题生成；重启后仍可读 |
| P0-38 | SQLite CRUD | API/SQLite | SQLite 后端下重命名、清空、删除均正常；默认文件 JSON 实现不受影响 |

## P1 常规回归

| ID | 场景 | 默认方式 | 关键断言 |
| --- | --- | --- | --- |
| P1-01 | assistant 复制 | mock/CDP | 复制成功；短暂显示“已复制”；生成中不显示复制 |
| P1-02 | 停止后复制部分内容 | mock/CDP | stopped 内容保留；停止后可复制 |
| P1-03 | 失败消息重试 | mock error | 原失败位置重试；不重复插入用户问题 |
| P1-04 | 自动滚动到底部 | mock/CDP | 用户接近底部时流式内容跟随 |
| P1-05 | 查看历史不强拉底部 | mock/CDP | 用户滚到历史位置时，新 token 不强制拉到底 |
| P1-06 | 空态和侧栏状态 | mock/CDP | 空会话、按钮禁用、侧栏高亮正确 |
| P1-07 | Markdown 基础渲染 | fixture mock | 标题、列表、表格、引用、链接、代码块正常 |
| P1-08 | Markdown 安全 | fixture mock | script/img/onerror/onclick 不执行 |
| P1-09 | 用户消息纯文本 | fixture mock | 用户 Markdown 不被渲染 |
| P1-10 | 流式 Markdown | fixture mock | 中间态稳定，完成态完整渲染 |
| P1-11 | Markdown 复制原文 | fixture mock | 复制的是原始 Markdown 文本 |
| P1-12 | 代码高亮基础 | fixture mock | JS/TS/JSON/Bash/Python/SQL 高亮 |
| P1-13 | Go/C/C++/Rust 高亮 | fixture mock | 四种语言 token 正常 |
| P1-14 | JSX/MJS/TSX 高亮 | fixture mock | alias 生效 |
| P1-15 | 大括号/注释可见 | fixture mock | `{}`、行注释、块注释颜色可读 |
| P1-16 | 长代码/表格移动端布局 | fixture mock | 页面无整体横向溢出，内部可滚动 |
| P1-17 | 刷新后渲染持久化 | fixture mock | 刷新后 Markdown/高亮仍正确 |
| P1-18 | 切换会话中断生成 | mock/CDP | 生成中切换已有会话会 abort 旧请求；内容不串会话 |
| P1-19 | 生成中删除当前会话 | mock/CDP | 当前实现为 no-op；会话不被删除，UI 不错乱 |
| P1-20 | 生成中清空当前会话 | mock/CDP | 清空按钮禁用或 no-op；不会清空正在生成的会话 |
| P1-21 | 生成中重命名当前会话 | mock/CDP | 当前实现允许重命名；生成状态不丢失 |
| P1-22 | 输入框行为 | mock/CDP | 空输入不能发送；生成中禁用；高度增长后发送恢复 |
| P1-23 | 建议问题卡片 | mock/CDP | 点击填充输入；生成中不造成并发请求 |
| P1-24 | 主题切换 | mock/CDP | 明暗主题可切换并持久化；生成中切换不影响 stream |
| P1-25 | 移动端布局 | mock/CDP | 390px 宽度无页面级横向溢出；composer 不遮挡最后消息 |
| P1-26 | 默认会话标题 | API/CDP | 新会话默认标题正确 |
| P1-27 | 首条消息自动标题 | API/CDP | 未手动改名时，首条用户消息生成标题 |
| P1-28 | 手动标题保护 | API/CDP | 手动重命名后，后续消息不覆盖标题 |
| P1-29 | legacy migration | API/文件检查 | 旧聚合 JSON 迁移成单会话 JSON，并生成 `.migrated` |
| P1-30 | legacy migration 幂等 | API/文件检查 | 重复读取不会重复迁移或重复会话 |
| P1-31 | 损坏 JSON 文件 | API/文件检查 | 返回 JSON 错误且服务不崩溃 |
| P1-32 | reasoning 面板展开/收起 | mock/CDP | details open 状态可切换；正文、复制、重试不受影响 |
| P1-33 | reasoning 长文本和移动端布局 | mock/CDP | 长 reasoning 自动换行；390px 下不产生页面级横向溢出 |
| P1-34 | reasoning + Markdown 正文 | fixture mock | reasoning 纯文本展示；assistant 正文 Markdown/高亮仍正常 |
| P1-35 | 旧会话无 reasoning 字段 | API/fixture | 旧数据正常 normalize；无 reasoning 字段不报错 |
| P1-36 | 无效 reasoningDurationMs normalize | API/fixture | 非数字、负数、非有限值被丢弃 |
| P1-37 | LAN dev 配置 | 本地配置检查 | Vite 监听 `0.0.0.0`；API proxy 仍指向 `127.0.0.1:7001` |
| P1-38 | 完整 UI 交互矩阵 | mock/CDP | 覆盖 UI-01 到 UI-40，包含弹窗、错误态、刷新恢复、移动端、快速操作和流式边界 |

## UI 场景矩阵

以下 UI 场景默认由 `tests/cdp/ui-scenarios.mjs` 覆盖；除非单独说明，均使用 mock，不调用真实接口，不截图。

| ID | 场景 | 关键断言 |
| --- | --- | --- |
| UI-01 | 首屏初始化加载态 | 侧栏、空态、suggestion、active 会话、composer 状态正确；无页面级横向溢出 |
| UI-02 | 会话列表空/多/长标题 | 空列表自动创建会话；多会话和超长标题不挤压操作按钮 |
| UI-03 | 会话列表滚动 | 大量会话时侧栏可滚动；当前会话保持高亮；操作按钮可点击 |
| UI-04 | rename 取消 | 应用内 prompt 取消后标题不变、会话数量不变 |
| UI-05 | rename 空白 | 空白标题不提交；原标题不丢 |
| UI-06 | delete confirm 取消 | 取消删除后会话仍存在，当前会话不切换 |
| UI-07 | clear confirm 取消 | 取消清空后消息和未发送草稿不被清掉 |
| UI-08 | 删除非当前会话 | 删除侧栏非 active 会话后，当前聊天内容和高亮不变 |
| UI-09 | 删除最后一个会话 | 删除唯一会话后自动进入新空会话，composer 可聚焦 |
| UI-10 | 切换会话时请求失败 | 详情接口失败时 UI 不崩，当前可用会话保持不变 |
| UI-11 | 新建会话失败 | 创建接口失败时不清空当前消息，当前 active 会话不变 |
| UI-12 | 发送时创建会话失败 | 无 currentConversationId 时创建失败不丢用户输入；当前实现通常由禁用态避免触发 |
| UI-13 | 发送 HTTP 500 | `/ask` 非 200 显示错误消息；后续可继续发送 |
| UI-14 | stream 中途网络断开 | 已有部分正文时显示“响应中断”；复制和重试状态正确 |
| UI-15 | stream 长时间无 token 超时 | 触发超时文案；请求释放；后续发送正常 |
| UI-16 | done 后还有多余 chunk | `done` 后的额外内容不渲染 |
| UI-17 | 多行输入视觉 | Shift+Enter 不提交；textarea 高度增长，发送后恢复 |
| UI-18 | 超长单词输入 | textarea 和消息区域不产生页面级横向滚动 |
| UI-19 | 发送后 focus | 新建、删除最后会话、切换后 composer focus 符合当前设计 |
| UI-20 | 生成中按钮禁用矩阵 | 生成中 textarea 禁用；清空禁用；复制/重试不显示；停止可用 |
| UI-21 | 复制按钮显示条件 | pending/streaming 不显示复制；stopped/done 且有正文时可复制 |
| UI-22 | 重试按钮显示条件 | 仅 error assistant 显示重试；stopped 不显示重试 |
| UI-23 | retry 后滚动位置 | 失败位置原位替换；不重复插入用户问题 |
| UI-24 | reasoning 展开中继续流式 | reasoning 面板流式阶段打开，完成后可展开/收起 |
| UI-25 | reasoning only 错误 | 只有 reasoning 没有 answer 时进入“模型未返回内容”错误态 |
| UI-26 | reasoning 长文本移动端 | 390px 下长 reasoning 换行，不产生页面级横向溢出 |
| UI-27 | Markdown + reasoning 组合 | reasoning 纯文本展示；answer Markdown/代码块正常渲染 |
| UI-28 | 主题刷新持久化 | 明/暗切换写入 localStorage；reload 后保持 |
| UI-29 | 主题下可访问性 | 明暗主题下核心按钮、错误态、reasoning 文本可读 |
| UI-30 | 移动端侧栏/主区 | 390px 下侧栏、消息区、composer 无遮挡，最后消息可见 |
| UI-31 | 窄屏长按钮文案 | “清空当前会话”“已复制”“停止”等不产生页面级横向溢出 |
| UI-32 | 页面级横向溢出总检查 | 桌面和移动核心状态 `scrollWidth <= innerWidth` |
| UI-33 | suggestion 空态消失 | 有消息后 suggestion 不再显示；空态时可再次出现 |
| UI-34 | suggestion 点击后发送 | suggestion 点击只填充输入，不直接发送，不绕过禁用态 |
| UI-35 | 快速连续点击发送 | 只产生一个 `/ask`；不重复插入用户消息 |
| UI-36 | 快速切换会话 | A/B/C 快速切换时 active、高亮、消息内容一致，不串流 |
| UI-37 | 浏览器刷新恢复当前会话 | reload 后会话列表和当前详情恢复；未发送草稿按当前设计清空 |
| UI-38 | 后端返回旧数据格式 | messages 无 reasoning 字段时 UI 兼容，不显示空 reasoning 面板 |
| UI-39 | 空 assistant content | 空正文但有 error/stopped 状态时不出现异常空白操作区 |
| UI-40 | 应用内弹窗 alert/confirm/prompt 流程 | rename/delete/clear/new-chat error 的 alert/confirm/prompt 均由 `AppDialog` 承载，可被 CDP 稳定断言 |

## P2 真实接口回归

P2 仅在明确要求“真实接口”时执行。

| ID | 场景 | 方式 | 关键断言 |
| --- | --- | --- | --- |
| P2-01 | 真实模型普通问答 | 真实 LLM | 能返回完整 assistant；会话持久化正确 |
| P2-02 | 真实模型停止生成 | 真实 LLM | 前端停止；后端 abort；不继续写完整回答 |
| P2-03 | 真实上下文会话 | 真实 LLM | 同会话能利用上下文；不同会话隔离 |
| P2-04 | 真实 Markdown 输出 | 真实 LLM | 标题、列表、代码、表格渲染正确 |
| P2-05 | 真实代码高亮输出 | 真实 LLM | Go/C/Rust/TSX 等 fenced code 高亮正常 |
| P2-06 | 真实 tool 调用 | 真实 tool API | tool 成功调用并回答；失败时友好降级 |
| P2-07 | 真实接口临时数据清理 | API | 所有测试会话被删除，不污染侧栏 |

## 执行策略

| 变更类型 | 建议执行范围 |
| --- | --- |
| 普通重构或 bug 修复 | P0 |
| UI、交互、按钮、滚动变更 | P0 + `ui`，必要时补 P1-01 到 P1-06 的结果定位 |
| Markdown 或高亮变更 | P0 + P1-07 到 P1-17 |
| 会话存储或路由变更 | P0-10 到 P0-13、P0-36 到 P0-38，再补 P0-01 到 P0-06 |
| tool、weather、function call 变更 | P0-14 到 P0-17、P0-35，再补 P0-01 到 P0-06 |
| reasoning、思考过程、流式协议变更 | P0-26 到 P0-33，再补 P0-01 到 P0-07 |
| composer 草稿、会话切换/清空/删除变更 | P0-34 + P1-18 到 P1-25 |
| Vite dev server 或 LAN 访问变更 | P1-37，并手动确认目标机器可访问前端入口 |
| 真实模型链路验证 | P0 + P2 |
| 明确要求截图 | 设置 `CDP_SCREENSHOTS=1`，对本次执行用例保存并返回截图 |
| 未明确要求截图 | 不产出截图，只输出结果摘要 |

所有回归测试默认通过 CDP 自动化脚本执行。若临时需要人工辅助定位问题，人工观察只能作为诊断信息，最终结果仍以 CDP 自动化断言为准。

## 推荐执行顺序

1. 先跑 P0-01 到 P0-09，确认核心发送、停止和请求释放。
2. 再跑 P0-10 到 P0-13，确认会话生命周期和持久化。
3. 如果涉及 tool/function call，继续跑 P0-14 到 P0-17。
4. 如果涉及 UI/Markdown/高亮，再跑对应 P1。
5. 只有明确要求真实接口时，最后跑 P2。

## 失败定位索引

| 失败现象 | 优先排查方向 |
| --- | --- |
| 点击停止后前端仍显示生成中 | `client/src/App.vue` 或拆分后的 composer/request 状态管理 |
| `/ask` 未变成 aborted/canceled | 前端 `AbortController`、fetch signal、请求发起封装 |
| 前端取消但上游仍继续输出 | `server/routes/index.ts`、`server/utils/llm/index.ts`、`server/utils/streamReader.ts`、request registry |
| 停止后仍写入完整回答 | `appendMessages` 调用时机、abort 后的 finally/catch 分支 |
| 重试重复插入用户问题 | retry 插入索引、`appendUser: false` 路径 |
| 切换会话串上下文 | 当前 `conversationId`、prompt 构造、会话详情加载 |
| 前端直接报协议版本错误 | `server/utils/ndjsonStream.ts` header、`client/src/utils/streamProtocol.ts` |
| reasoning 面板不显示或复制混入 reasoning | `server/utils/llm/index.ts` chunk type、`client/src/components/MessageList.vue`、`copyMessage` |
| Markdown 不渲染或渲染不安全 | `MarkdownMessage.vue`、`markdown-it`、`DOMPurify` 配置 |
| 代码块符号不可见 | highlight CSS、代码块基础文字颜色、背景色 |
| 表格或长代码导致页面横向溢出 | markdown/table/pre 容器 overflow 样式 |
| tool 调用异常导致 500 | tool 调用 try/catch、工具结果封装、answer prompt |

## 临时数据清理规则

- mock/CDP 测试创建的临时会话必须在脚本结束时删除。
- 真实接口测试建议使用固定前缀，例如 `CDP-`、`CDPCTX-`、`CDPMDREAL-`。
- SQLite 测试必须设置临时 `CONVERSATION_DATA_DIR`，必要时同时设置临时 `CONVERSATION_DB_PATH`；禁止用真实本地库做自动化回归。
- 测试结束后必须调用会话列表接口确认临时会话已清理。
- 不要删除人工创建的业务会话，除非用户明确指定。

## 现有脚本映射

以下脚本是正式 CDP 回归入口。若代码结构变化，允许微调脚本，但用例语义保持不变。

| 覆盖范围 | 当前脚本 |
| --- | --- |
| 统一 runner | `tests/cdp/run-cdp-regression.mjs` |
| 完整 UI 矩阵 | `tests/cdp/run-cdp-regression.mjs ui` |
| 停止生成、上游取消、request cancel | `tests/cdp/upstream-abort.mjs` |
| 会话 API、JSON/SQLite 持久化、JSON 到 SQLite 迁移、错误 JSON、tool mock、流式协议 header、reasoning 持久化、tool 上下文、标题和存储边界 | `tests/cdp/p0-api-tool.mjs` |
| 基础 UI、复制、重试、滚动、新建/切换中断、输入框、主题、移动端、reasoning 面板、流式协议错误、草稿清理 | `tests/cdp/ui-scenarios.mjs` |
| 真实接口基础 UI | `tests/cdp/real-scenarios.mjs` |
| 会话上下文、重命名、清空、删除 | `tests/cdp/conversation-context-real.mjs` |
| Markdown fixture 渲染 | `tests/cdp/markdown-rendering.mjs` |
| Markdown 真实接口渲染 | `tests/cdp/markdown-real.mjs` |
| 代码高亮 fixture 渲染 | `tests/cdp/highlight-rendering.mjs` |

## 执行命令

默认不截图：

```bash
node tests/cdp/run-cdp-regression.mjs p0
node tests/cdp/run-cdp-regression.mjs p1
node tests/cdp/run-cdp-regression.mjs ui
node tests/cdp/run-cdp-regression.mjs markdown
node tests/cdp/run-cdp-regression.mjs highlight
node tests/cdp/run-cdp-regression.mjs all-mock
```

统一 runner 会写入机器可读汇总，例如 `.tmp/cdp-results/p0.json`、`.tmp/cdp-results/all-mock.json`。汇总文件包含 suite 名称、开始/结束时间、每个脚本的名称、路径和脚本末尾 JSON 结果，后续结果文档应优先从该文件提取。

需要截图时：

```bash
CDP_SCREENSHOTS=1 node tests/cdp/run-cdp-regression.mjs all-mock
```

真实接口只在明确要求时执行：

```bash
node tests/cdp/run-cdp-regression.mjs real
```

若要验证 SQLite 存储路径，使用临时数据目录，避免污染现有本地 JSON 数据：

```bash
REAL_SQLITE_DIR=$(mktemp -d /tmp/chatbot-real-sqlite-XXXXXX)
CONVERSATION_STORE=sqlite \
CONVERSATION_DATA_DIR="$REAL_SQLITE_DIR" \
CONVERSATION_DB_PATH="$REAL_SQLITE_DIR/sqlite/conversations.sqlite3" \
CDP_REAL_SCRIPT_RETRIES=1 \
node tests/cdp/run-cdp-regression.mjs real
```
