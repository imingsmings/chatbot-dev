# R12 生成元数据与停止持久化验收记录

日期：2026-08-12

## 结论

R12 已完成并验证。完整回答可回看 provider/model、结束原因、首 token 延迟、总耗时、实际 usage 和裁剪工具轨迹；有正文的用户手动停止刷新后保持 `stopped`，但不会冒充完整回答进入后续上下文。NDJSON 保持 v2，备份保持 schema v1，SQLite 不需要表迁移。

## 实施结果

- DeepSeek 通过 `stream_options.include_usage` 获取完整流 usage；OpenAI Responses 从 `response.completed.response.usage` 读取 input/output/total、reasoning 和 cached token。字段映射依据 [DeepSeek Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion) 与 [OpenAI Responses streaming events](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta)。
- 工具两阶段回答聚合所有已完成 Provider 请求共同提供的 token 字段；任何阶段缺少某字段时，该字段保持未知，不补 0。
- assistant message 新增可选 `status`、`generation` 和 `toolTrace`。工具轨迹最多 20 项、摘要最多 240 字符，不保存工具参数、凭据、请求头、原始 SSE 或 continuation state。
- 用户点击停止会先发送带 `manual` 原因的取消请求，再中止浏览器 fetch。有正文时保存 user + `stopped` assistant；首 token 前停止不保存。
- timeout、transition、unmount 和异常 EOF 不触发 stopped 持久化。新建/切换会话不会把旧请求的部分正文写入旧会话。
- `stopped` assistant 从后续原始上下文和新摘要中排除；context preview 增加 `excludedStoppedMessages`。
- JSON 备份/导入、Markdown 导出、file/SQLite、React 会话恢复和消息级生成详情支持相同字段。旧会话和旧 schema v1 备份继续读取。

## 自动化证据

- `pnpm run check`：server/client typecheck 与 client 普通/类型感知 lint 通过。
- `pnpm run test:server`：104/104 通过，覆盖 DeepSeek/OpenAI usage、无工具/多工具、手动停止/空停止、异常 EOF、上下文/摘要、file/SQLite 和 schema v1 导入导出。
- `pnpm --dir client test:unit`：58/58 通过，覆盖取消原因、持久化映射、工具耗时和未知 usage UI。
- `pnpm run build:client`：Vite 生产构建通过。
- `pnpm run test:cdp:p0`：上游中断、P0 API/工具和四组 UI 场景通过。有正文手动停止落 2 条消息且刷新恢复；首 token 前停止为 0；transition 为 0；完整工具回答聚合 usage 且轨迹不含参数。
- `pnpm run test:cdp:context-debug`：桌面/390px 的 `Stopped Excluded`、消息选择和无敏感配置泄漏断言通过。
- `git diff --check`：通过。

全部 Provider 行为测试使用本地 mock。未调用真实 DeepSeek/OpenAI，也没有真实计费或生产集成验证。
