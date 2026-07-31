# 2026-07-31 Regression Results

## 结论

本阶段功能、UI 状态和输入到模型返回的完整链路已通过静态检查、Node 测试、全量 mock/CDP 和真实接口/CDP 验证。

- `pnpm run check`：通过。
- `pnpm run lint:client`：通过，0 warning / 0 error。
- `pnpm run build:client`：通过。
- `pnpm run test:unit`：46/46 通过，资源清理修复后复跑通过。
- `pnpm run test:cdp:all-mock`：10/10 脚本通过，资源清理修复后复跑通过。
- `pnpm run test:cdp:real`：3/3 脚本通过，资源清理修复后复跑通过。

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
