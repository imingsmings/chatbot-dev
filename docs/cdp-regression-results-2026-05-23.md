# CDP 回归测试结果 2026-05-23

## 范围

本轮覆盖当前修改功能、mock 全量、真实接口全量、构建和类型检查。

默认不截图。真实接口仅在本轮目标明确要求后执行。

## 最终结论

| 范围 | 命令 | 最终结果 | 通过次数 | 备注 |
| --- | --- | --- | --- | --- |
| P0 核心回归 | `node tests/cdp/run-cdp-regression.mjs p0` | 通过 | 1 | review 修复后复跑通过 |
| mock 全量 | `node tests/cdp/run-cdp-regression.mjs all-mock` | 通过 | 2 | UI、Markdown、Highlight、P0 API/tool、取消链路均通过 |
| 真实接口全量 | `node tests/cdp/run-cdp-regression.mjs real` | 通过 | 2 | 最终覆盖 Real UI、Real context、Real Markdown |
| Markdown fixture | `node tests/cdp/run-cdp-regression.mjs markdown` | 通过 | 1 | 协议 header 修复后通过 |
| Highlight fixture | `node tests/cdp/run-cdp-regression.mjs highlight` | 通过 | 1 | 协议 header 修复后通过 |
| UI root script | `pnpm run test:cdp:ui` | 通过 | 1 | sandbox 下首次绑定端口被拒绝，提权后通过 |
| 服务端类型检查 | `pnpm --dir server typecheck` | 通过 | 2 | chatService review 修复前后均通过 |
| 前端构建 | `pnpm --dir client build` | 通过 | 2 | Vue type-check + Vite build 通过 |
| 语法和 whitespace | `node --check ...` / `git diff --check` | 通过 | 多次 | touched CDP 脚本均检查通过 |

## 失败与修复记录

| 失败点 | 原因 | 处理 | 复测 |
| --- | --- | --- | --- |
| UI 刷新恢复当前会话失败 | mock 会话数据没有跨 reload 持久，且 mock 列表未按 `updatedAt` 排序 | `tests/cdp/ui-scenarios.mjs` 增加持久 mock store，并按后端契约排序 | `ui` 通过，`all-mock` 通过 |
| 侧栏大量会话不可滚动 | `.sidebar` 未限制高度，子滚动容器被父容器撑开 | `client/src/assets/app.css` 为 `.sidebar` 增加 `min-height: 0` 和 `overflow: hidden` | `ui` 大量会话滚动断言通过 |
| 流式中断后部分正文被错误文案覆盖 | `MessageList` 在 `error` 状态优先渲染错误文案，隐藏已收到正文 | `MessageList.vue` 改为有正文时保留 Markdown 正文，并在下方显示错误状态 | `ui` 的中途网络断开、复制、重试断言通过 |
| Markdown 流式 fixture 不进入正常渲染 | mock `/ask` 缺少 `X-Chat-Stream-Protocol: 1` | `markdown-rendering.mjs` 补协议 header | `markdown` 通过，`all-mock` 通过 |
| Highlight 流式 fixture 不进入正常渲染 | mock `/ask` 缺少 `X-Chat-Stream-Protocol: 1` | `highlight-rendering.mjs` 补协议 header | `highlight` 通过，`all-mock` 通过 |
| 真实接口首次失败 | runner 只启动 Vite，未启动后端，`/api` proxy 到 `127.0.0.1:7001` 被拒绝 | `run-cdp-regression.mjs` 为 real suite 增加 backend 自动启动 | `real` 通过 |
| 真实 UI selector 失败 | 脚本依赖 `.message-text`，但 stopped/error/reasoning 结构变化后 selector 过窄 | `real-scenarios.mjs` 改为按 assistant 行和文本断言 | `real` 通过 |
| 普通 assistant 消息写入空 `reasoningContent` | chatService 总是传入空字符串 | 仅在有 reasoning 时写 `reasoningContent`，仅在有 duration 时写 `reasoningDurationMs` | `p0`、`real`、服务端 typecheck 通过 |
| runner 停止后端有 lifecycle 噪音 | 通过 `pnpm --dir server start` 启动，SIGTERM 被 pnpm 视为 lifecycle failure | runner 改为直接 `node ./bin/www.ts` 启动后端 | `real` 通过，噪音消失 |
| root UI 脚本首次验证失败 | sandbox 拒绝本地 Vite 端口绑定，非产品或脚本逻辑失败 | 按审批流提权后重跑 | `pnpm run test:cdp:ui` 通过 |

## 覆盖场景摘要

- 停止生成：流式中停止、首 token 前停止、上游慢响应停止、新建聊天中断、tool answer 阶段停止。
- 会话：列表、详情、新建、重命名、删除、清空、标题规则、上下文隔离、刷新恢复、旧数据迁移、损坏 JSON。
- tool/function calling：成功、失败、未知 tool、非法 arguments、tool 上下文、reasoning 回灌。
- 前端交互：复制、已复制状态、失败重试、自动滚动策略、suggestion、主题、输入框、多会话切换、生成中操作。
- 渲染：Markdown、安全清洗、用户消息纯文本、代码高亮、Go/C/C++/Rust/JSX/MJS/TSX、大括号、注释、移动端布局。
- 真实接口：真实停止、继续发送、滚动、上下文隔离、真实 Markdown、复制、移动端和测试数据清理。

## 测试资产变更

- `tests/cdp/run-cdp-regression.mjs`: 新增 `ui` suite，real suite 自动启动后端。
- `tests/cdp/ui-scenarios.mjs`: 覆盖 `UI-01` 到 `UI-40`。
- `tests/cdp/markdown-rendering.mjs`: 补齐协议 header。
- `tests/cdp/highlight-rendering.mjs`: 补齐协议 header。
- `tests/cdp/real-scenarios.mjs`: 适配当前消息 DOM 结构。
- `docs/regression-test-cases.md`: 补齐 P0/P1/UI/P2 场景和脚本映射。

## 后续测试优化

- 将各 CDP 脚本公共 CDP client、等待、截图、输入、服务启动逻辑抽成共享 helper，降低脚本维护成本。
- 为真实接口测试增加机器可读 JSON 汇总文件，避免只能从 console 输出人工整理。
- 增加专门的“长 tool preamble 后再 tool_call”场景，用于验证 tool 决策阶段内容缓冲策略的边界。
- 对真实接口测试增加可配置超时和重试策略，降低真实模型偶发慢响应导致的误报。
