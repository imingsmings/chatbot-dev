# R11 流完整性与摘要覆盖验收记录

日期：2026-08-12

## 结论

R11 已完成并验证。Provider 异常 EOF 不再被当成完整回答；摘要覆盖过的消息不再重复进入模型上下文。应用 NDJSON 仍保持 v2 六类事件，没有新增协议事件或持久化字段。

## 实施结果

- DeepSeek 仅以 `[DONE]`、OpenAI Responses 仅以 `response.completed` 作为成功完成证据。
- 部分正文、仅 reasoning、未完成工具参数后 EOF 均产生可恢复 `error`，不发送 `done`，也不持久化本轮问答。
- 前端保留已经接收的部分正文与错误提示；下一次发送可正常完成。
- 摘要后的上下文窗口从安全截断后的 `sourceMessageCount` 开始，继续应用消息数和字符数限制。
- schema v1 导入、file store 和 SQLite store 对越界摘要计数进行截断。
- 上下文预览展示摘要覆盖消息数、摘要后原始消息数和最终选择的会话消息序号范围。

## 自动化证据

- `pnpm run test:unit`：server 97/97、client 55/55 通过。
- `pnpm run check`：server/client typecheck 与 client 普通/类型感知 lint 通过。
- `pnpm run build:client`：Vite 生产构建通过。
- `pnpm run test:cdp:p0`：P0 API、上游取消和四个 UI 场景入口全部通过；不完整流断言包含部分 `delta`、`error`、无 `done`、消息数不变和恢复成功。
- `pnpm run test:cdp:context-debug`：桌面/390px 移动端覆盖统计、消息选择、无敏感配置泄漏和无页面横向溢出全部通过。
- `git diff --check`：通过。

全部 Provider 测试使用本地 mock。未获得真实 Provider 调用授权，因此没有调用真实 DeepSeek/OpenAI；这不影响本阶段 mock 协议和应用行为验收结论。
