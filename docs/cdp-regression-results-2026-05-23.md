# CDP 回归测试结果 2026-05-23

> 历史快照：命令、用例数量、Vue 文件和真实模型范围只对应 2026-05-23 当时的代码。当前测试入口与授权边界以[回归测试矩阵](regression-test-cases.md)为准。

## 范围

本轮覆盖 docs 后续测试优化、架构与代码 review 整改、SQLite 存储新增、JSON 到 SQLite 迁移、mock 全量回归、真实接口全量回归、前后端类型检查和前端构建。

默认未截图。真实接口测试按本轮目标明确要求执行，并使用临时 SQLite 数据目录，避免污染现有 `server/data`。

## 最终结论

| 范围 | 命令 | 结果 | 关键结论 |
| --- | --- | --- | --- |
| 服务端类型检查 | `pnpm --dir server typecheck` | 通过 | SQLite 懒加载、存储接口和 LLM 相关类型通过 |
| 前端类型检查 | `pnpm --dir client type-check` | 通过 | AppDialog、App.vue、stream composable 类型通过 |
| 前端构建 | `pnpm --dir client build` | 通过 | Vite production build 通过，127 个模块完成转换 |
| CDP 脚本语法 | `for f in tests/cdp/*.mjs tests/cdp/helpers/*.mjs; do node --check "$f" || exit 1; done` | 通过 | 新增 helpers、runner、SQLite/P0/real 脚本语法通过 |
| whitespace | `git diff --check` | 通过 | 未发现尾随空白或补丁格式问题 |
| mock 全量 | `node tests/cdp/run-cdp-regression.mjs all-mock` | 通过 | 结果写入 `.tmp/cdp-results/all-mock.json`，每个子脚本均解析到 JSON result |
| 真实接口全量 SQLite | `CONVERSATION_STORE=sqlite CONVERSATION_DATA_DIR="$REAL_SQLITE_DIR" CONVERSATION_DB_PATH="$REAL_SQLITE_DIR/sqlite/conversations.sqlite3" CDP_REAL_SCRIPT_RETRIES=1 node tests/cdp/run-cdp-regression.mjs real` | 通过 | 结果写入 `.tmp/cdp-results/real.json`，真实 UI、上下文、Markdown 均通过 |

## mock 全量覆盖

`all-mock` 最终覆盖以下子脚本：

| 子脚本 | 关键覆盖 | 结果 |
| --- | --- | --- |
| `tests/cdp/upstream-abort.mjs` | 流式中停止、首 token 前停止、新建聊天自动中断、上游慢响应中断；断言前端 request canceled、上游 closeBeforeEnd、不持久化完整问答 | 通过 |
| `tests/cdp/p0-api-tool.mjs` | 会话 API、JSON 文件存储、legacy migration、损坏 JSON、tool 成功/失败/未知/非法 arguments、strict tool preamble、reasoning 持久化、SQLite 迁移/ask/CRUD | 通过 |
| `tests/cdp/ui-scenarios.mjs` | 应用内 modal、复制、重试、滚动策略、会话切换/新建中断、草稿清理、reasoning、主题、移动端、错误恢复 | 通过 |
| `tests/cdp/markdown-rendering.mjs` | Markdown 标题/列表/代码/表格/引用/链接、安全清洗、用户消息纯文本、流式中间态、复制、移动端 | 通过 |
| `tests/cdp/highlight-rendering.mjs` | JS/TS/JSON/Bash/Python/SQL、Go/C/C++/Rust、JSX/MJS/TSX、fallback、非法 JSON、长代码、移动端 | 通过 |

新增 SQLite 断言：

- `P0-36`: 首次启用 SQLite 时从 `conversations/*.json`、`conversations.json` 导入；保留 `reasoningContent`；写入 `storage_meta`；重启幂等。
- `P0-37`: SQLite 下 `/ask` 返回协议 header，用户和 assistant 消息落库，自动标题生成，重启后可读。
- `P0-38`: SQLite 下重命名、清空、删除正常；默认文件 JSON 实现仍可通过原 P0/P1 覆盖。

## 真实接口覆盖

真实接口回归使用隔离环境：

```bash
REAL_SQLITE_DIR=$(mktemp -d /tmp/chatbot-real-sqlite-XXXXXX)
CONVERSATION_STORE=sqlite \
CONVERSATION_DATA_DIR="$REAL_SQLITE_DIR" \
CONVERSATION_DB_PATH="$REAL_SQLITE_DIR/sqlite/conversations.sqlite3" \
CDP_REAL_SCRIPT_RETRIES=1 \
node tests/cdp/run-cdp-regression.mjs real
```

| 子脚本 | 关键覆盖 | 结果 |
| --- | --- | --- |
| `tests/cdp/real-scenarios.mjs` | 真实停止、停止后继续发送、滚动位置保持、新建聊天中断、临时会话清理 | 通过 |
| `tests/cdp/conversation-context-real.mjs` | 真实上下文隔离、刷新、重命名、清空、删除、临时会话清理 | 通过 |
| `tests/cdp/markdown-real.mjs` | 真实 Markdown 最终态、流式中间态、复制原文、移动端布局、安全清洗、临时会话清理 | 通过 |

真实 Markdown 中间态不再依赖模型在流式中已经输出完整标题或 marker，只断言存在 assistant 行、仍在生成、无错误态；完整 Markdown 结构在最终态验证。

## Code Review 修复记录

| 发现点 | 风险 | 修复 | 复测 |
| --- | --- | --- | --- |
| `node:sqlite` 顶层导入 | 即使默认使用文件 JSON，低版本 Node 也可能在启动时因缺少 `node:sqlite` 失败 | 改成仅在 `CONVERSATION_STORE=sqlite` 时通过 `createRequire` 懒加载，并给出明确错误信息 | `server typecheck`、`all-mock`、`real(SQLite)` 通过 |
| runner JSON 结果提取只取最后一个 `{` | 子脚本输出 trailing logs 时，suite JSON 中 `scripts[].result` 可能为 `null` | 改为从输出末尾做平衡括号扫描，稳定提取最后一个完整 JSON object | `all-mock.json`、`real.json` 均有子脚本 result |
| strict tool decision 改动影响旧中断断言 | tool 决策阶段不提前 flush 后，旧脚本等待可见 assistant token 会误判 | 上游中断脚本改为等待真实 mock upstream request，再断言 request cancel 和 closeBeforeEnd | `all-mock` 通过 |
| 真实回归依赖模型具体长度/marker | 真实模型输出节奏变化会导致误报 | 真实 UI 使用 DOM fixture 验证滚动锁定，真实 Markdown 中间态改为状态机断言 | `real(SQLite)` 通过 |
| 原生弹窗不利于 CDP 稳定断言 | prompt/confirm/alert 无法统一主题、键盘和移动端状态 | 替换为 `AppDialog.vue`，脚本改为操作应用内 modal | `ui`、`all-mock` 通过 |

## 临时数据与截图

- mock/CDP 测试创建的会话均由脚本按测试前缀或捕获 id 清理。
- 真实接口回归使用临时 SQLite 数据目录，不写入现有 `server/data`。
- 2026-05-23 本轮未请求截图，因此未保存关键截图；2026-05-24 流式补测截图见下节。

## 2026-05-24 流式回归修复补测

问题：

- 严格 tool decision 缓冲导致无 tool 的普通回答只在上游结束后一次性 flush。
- 前端能收到 `reasoning_delta`，但收不到普通回答 `delta`，超过 `STREAM_IDLE_TIMEOUT_MS` 后显示“响应超时或连接中断”。

修复：

- `callLLMStreamWithTools` 改为 `120ms` 短窗口缓冲。
- 窗口内出现 `toolCallDeltas` 时丢弃待发送 preamble。
- 普通 content 持续超过窗口时解锁，后续按 `delta` 流式写给前端。

已完成验证：

| 范围 | 命令 | 结果 | 关键结论 |
| --- | --- | --- | --- |
| 服务端类型检查 | `pnpm --dir server typecheck` | 通过 | `callLLMStreamWithTools` 类型通过 |
| 前端类型检查 | `pnpm --dir client type-check` | 通过 | `useChatStream` 当前协议解析类型保持通过 |
| 前端构建 | `pnpm --dir client build` | 通过 | Vite production build 通过，127 个模块完成转换 |
| P0 脚本语法 | `node --check tests/cdp/p0-api-tool.mjs` | 通过 | 新增 `P0-39` 语法通过 |
| 核心算法 mock 直测 | `LLM_ENDPOINT=http://127.0.0.1:7019/chat/completions node --input-type=module ...` | 通过 | 普通回答产生 2 次 content callback，首次约 `194ms`；tool preamble 未经 content callback 泄漏 |
| mock 全量截图回归 | `CDP_SCREENSHOTS=1 node tests/cdp/run-cdp-regression.mjs all-mock` | 通过 | `.tmp/cdp-results/all-mock.json`，5 个子脚本全部 1 次通过 |
| 真实接口全量 SQLite 截图回归 | `CONVERSATION_STORE=sqlite CONVERSATION_DATA_DIR="$REAL_SQLITE_DIR" CONVERSATION_DB_PATH="$REAL_SQLITE_DIR/sqlite/conversations.sqlite3" CDP_SCREENSHOTS=1 CDP_REAL_SCRIPT_RETRIES=1 node tests/cdp/run-cdp-regression.mjs real` | 通过 | `.tmp/cdp-results/real.json`，真实 UI/上下文/Markdown 全部 1 次通过 |
| 真实 tool smoke | 临时 SQLite 后端 + `/conversations/:id/ask` + 真实天气工具 | 通过 | `protocol = 1`，`deltaCount = 62`，`hasDone = true`，真实天气日志成功，测试会话已删除 |

新增覆盖：

- `P0-39`: tool-choice 请求中先收到 reasoning，最终没有 tool call 时，普通回答必须产生多个 `delta`，且第一个 `delta` 早于 `done`。

全量结果：

- `all-mock`: `2026-05-24T05:16:50.429Z` 到 `2026-05-24T05:18:09.139Z`，覆盖 upstream abort、P0 API/tool、UI、Markdown、Highlight。
- `real`: `2026-05-24T05:18:46.603Z` 到 `2026-05-24T05:20:49.954Z`，使用临时 SQLite 目录 `/tmp/chatbot-real-sqlite-3cKhXW`。
- 临时 SQLite 校验：`conversation_count = 3`，`json_migration_completed = 1`，`json_migration_imported_count = 0`，`json_migration_source_dir = /tmp/chatbot-real-sqlite-3cKhXW/file`。
- `P0-39` 关键值：`deltaCount = 2`，`firstDeltaAtMs = 181`，`doneAtMs = 365`。
- 模拟超时场景：`ui-scenarios.mjs` 的 `timeoutRecoveryState.hasTimeout = true` 且 `hasRecovery = true`。
- 真实 tool smoke 使用临时 SQLite 目录 `/tmp/chatbot-real-tool-sqlite-28jxTG`，结束后 `conversation_count = 0`；后端日志包含 `天气查询成功`。

关键流式截图：

- mock Markdown 流式中间态：`.tmp/cdp-markdown-screenshots/08-streaming-mid-render.png`。
- mock Markdown 流式完成态：`.tmp/cdp-markdown-screenshots/09-streaming-done-render.png`。
- mock Highlight 流式中间态：`.tmp/cdp-highlight-screenshots/09-streaming-mid.png`。
- mock 上游中断前流式态：`.tmp/cdp-upstream-abort-screenshots/01-tc01-streaming-before-stop.png`。
- 真实 UI 生成中状态：`.tmp/cdp-real-screenshots/01-real-generating-stop-button.png`。
- 真实 Markdown 流式中间态：`.tmp/cdp-markdown-real-screenshots/08-real-streaming-mid-render.png`。
- 真实 Markdown 流式完成态：`.tmp/cdp-markdown-real-screenshots/09-real-streaming-done-render.png`。
