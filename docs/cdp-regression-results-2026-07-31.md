# 2026-07-31 Regression Results

## 结论

Vue 基线功能、UI 状态和输入到模型返回的完整链路已通过静态检查、Node 测试、全量 mock/CDP 和历史真实接口/CDP 验证。R8 React 并行验收随后复用了同一业务语义的 mock/CDP 场景；本轮没有重新调用真实模型或真实工具服务。

- `pnpm run check`：通过。
- `pnpm run lint:client`：通过，0 warning / 0 error。
- `pnpm run build:client`：通过。
- `pnpm run test:unit`：49/49 通过，包含 9 个客户端纯逻辑/parity tests。
- `pnpm run test:cdp:all-mock`：10/10 脚本通过，资源清理修复后复跑通过。
- `pnpm run test:cdp:real`：3/3 脚本通过，资源清理修复后复跑通过。

## R8 React 并行验收

最终证据（2026-07-31）：

- `pnpm run typecheck:client:react`：通过，TypeScript 7 零错误。
- `pnpm run lint:client:react`：通过，普通和类型感知 Oxlint 均为零 warning / 零 error。
- `pnpm run test:client:react`：12 files / 40 tests 全部通过。
- `pnpm run build:client:react`：通过；最大产物 chunk 为 Markdown 207.78 kB，无 Vue runtime chunk。
- `pnpm run test:cdp:react:all-mock`：10/10 脚本首次执行全部退出码 0。
- `pnpm run test:cdp:all-mock`：使用同一套双兼容 helper 复跑 Vue，10/10 脚本首次执行全部退出码 0。
- Vue typecheck、lint 和 build 继续通过；根 `dev:client`、`build:client` 未切换。

React 和 Vue 的机器结果分别保存在 `.tmp/cdp-results/react-all-mock.json` 与 `.tmp/cdp-results/vue-all-mock.json`；两者 `allPassed` 均为 `true`。视觉对照、viewport、测量值和最终截图清单见 [`../design-qa.md`](../design-qa.md)。R8 验收全部使用 mock、fixture 和临时存储，没有调用真实模型、真实天气 API 或生产集成。

## 2026-08-01 DeepSeek V4 模型切换复验

- 模型菜单改为官方模型 ID `deepseek-v4-flash` 与 `deepseek-v4-pro`；旧 `deepseek-chat` / `deepseek-reasoner` 不再作为可选项。
- `pnpm run test:unit`：50/50 通过；React `pnpm run test:client:react`：12 files / 41 tests 通过。
- Server、React、Vue typecheck 通过；双端 lint 和 build 通过。
- React Roadmap CDP：选择 Pro 后，summary 与 `/ask` 请求均携带 `model=deepseek-v4-pro`。
- Vue Roadmap CDP：保留原客户端入口，summary 与 `/ask` 请求均携带默认 `model=deepseek-v4-flash`。
- 两套 CDP 均使用 mock，没有调用真实 DeepSeek API，也没有生成截图。

## 2026-08-01 双端全量与真实接口复验

执行范围与结论：

- Server、Vue、React typecheck 通过；双端 lint、build 通过；Node 50/50、React 12 files / 41 tests 通过。
- Vue 与 React 的 `all-mock` 各 10/10 脚本通过。abort 专项改用可配置隔离端口 `5184`，没有停止占用 `5174` 的既有用户进程。
- Vue 真实 UI、真实上下文、真实 Markdown 三套脚本通过；React 使用相同业务断言完成真实 UI、真实上下文和真实 Markdown 验证。
- 真实 UI 每端均观察到 7 次 `/ask`、4 次 abort；停止、停止后继续、新建中断和滚动位置保护通过。
- 两端的同会话上下文、跨会话隔离、刷新持久化、重命名、清空和删除通过。
- 两端的标题、列表、代码、表格、链接、复制、流式中间态、刷新恢复、390px 布局和危险 HTML 清洗通过。

真实模型/推理强度矩阵：

| 模型 | 强度 | reasoning 字符 | 完成耗时 | 结果 |
| --- | --- | ---: | ---: | --- |
| `deepseek-v4-flash` | 关闭 | 0 | 1091 ms | 通过 |
| `deepseek-v4-flash` | 低 | 315 | 1685 ms | 通过 |
| `deepseek-v4-flash` | 中 | 901 | 4391 ms | 通过 |
| `deepseek-v4-flash` | 高 | 351 | 1873 ms | 通过 |
| `deepseek-v4-pro` | 关闭 | 0 | 1668 ms | 通过 |
| `deepseek-v4-pro` | 低 | 178 | 2079 ms | 通过 |
| `deepseek-v4-pro` | 中 | 201 | 2169 ms | 通过 |
| `deepseek-v4-pro` | 高 | 200 | 2294 ms | 通过 |

矩阵 8/8 通过：每项的 UI 标签、`/ask.options.model`、`reasoningEnabled`、`reasoningEffort` 和正文标记均正确；关闭档不产生 reasoning，低/中/高均收到 reasoning。真实模型输出存在随机性，reasoning 长度和耗时不用于判断强度大小关系。

本轮共观察到 46 次真实 `/ask` 流程，包含为修正测试测量方式而进行的矩阵复验；中止请求可能产生部分 token 消耗。全部真实测试使用 `7011` 隔离后端和临时 file store，测试会话与临时目录已清理；原 `7001` 后端、`5174` 前端和用户会话未改动。本轮按确认不生成截图。

## 全量 Mock

最终复跑时间：2026-07-31 10:50 至 10:53（Asia/Shanghai）。

通过的脚本：

1. `tests/cdp/upstream-abort.mjs`
2. `tests/cdp/p0-api-tool.mjs`
3. `tests/cdp/ui-scenarios.mjs`
4. `tests/cdp/markdown-rendering.mjs`
5. `tests/cdp/highlight-rendering.mjs`
6. `tests/cdp/context-debug.mjs`
7. `tests/cdp/conversation-search.mjs`
8. `tests/cdp/conversation-export.mjs`
9. `tests/cdp/roadmap-features.mjs`
10. `tests/cdp/sidebar-operation-state.mjs`

关键断言：

- 前端 abort、cancel API、后端 registry 和 provider stream 均释放。
- 普通流式回答、reasoning、工具开始/结果和 `done` 按 NDJSON v2 渲染。
- 空问题、非法 requestId、重复 requestId、损坏 SSE/NDJSON 和空模型响应可控失败并可恢复。
- 新建、切换、重命名、删除、清空、导入、导出和停止均有等待或禁用状态。
- 上述异步操作连续触发三次时，每类网络请求计数仍为 1。
- 导入导出和会话操作完成或失败后，控件恢复可用。
- Markdown、安全净化、高亮、长代码、表格和 390px 移动端布局通过。

## 真实接口

最终复跑时间：2026-07-31 10:53 至 10:55（Asia/Shanghai）。

通过的脚本：

1. `tests/cdp/real-scenarios.mjs`
2. `tests/cdp/conversation-context-real.mjs`
3. `tests/cdp/markdown-real.mjs`

关键断言：

- 真实普通问答、流式中止、停止后继续、新建时取消和滚动行为通过。
- 真实 UI 共观察到 7 次 ask、4 次 abort，停止后的后续请求正常完成。
- 同会话上下文可用，不同会话上下文隔离；重命名、清空和删除通过。
- 真实 Markdown 的标题、列表、代码、表格、链接、复制、持久化和移动端布局通过。
- script、远程图片和 `javascript:` 链接未进入最终 DOM。

## 数据隔离

- 真实测试前后会话文件列表一致。
- 既有 file/SQLite 共 9 个数据文件的 SHA-256 前后一致。
- 测试新建会话由脚本按基线 ID 和测试前缀清理，没有删除或修改既有会话。
- 单元与 CDP 脚本会在 `finally`/`after` 中回收临时数据目录和 Chrome profile；从零基线复跑后，系统临时目录中的 `chatbot-*` 项仍为 0。
- 验收结束后测试端口无监听，Vite、Express、Chrome/CDP 和 mock provider 无残留进程。
- 本轮未保留测试截图或临时恢复备份。
