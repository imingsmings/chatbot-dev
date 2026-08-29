# R22 请求一致性与原子导入验收记录

日期：2026-08-29

## 落地范围

- 会话新增可选 `requests` 增量字段，保存 requestId、规范化 payload 指纹、会话绑定、`processing/completed/stopped/failed`、时间和持久化消息范围；旧会话不需要迁移即可读取。
- ask 在 Provider 调用前持久化 `processing`。完成或手动停止时，用户/assistant 消息与请求终态在同一次 file mutation 或 SQLite transaction 中提交。
- 相同 requestId 的并发提交返回 409；相同 payload 的顺序或重启后重放不调用 Provider、不追加消息，只返回 NDJSON `done` 供客户端回拉原结果。不同会话或 payload 复用同一 requestId 返回 409。
- 新增受认证保护的 `GET /api/requests/:requestId`。非活动的遗留 `processing` 收敛为 `failed`；活动查询会短暂等待完成再返回最新终态。
- React 流在异常 EOF、网络错误或超时后先查询请求结果；若为 `completed/stopped`，恢复本地终态并重新加载持久化会话。
- JSON/ZIP 导入改为完整预检、准备和整批提交。file 使用 staging + backup + rename + rollback；SQLite 使用单事务；ZIP 会话批次失败会清理本批全部新附件。
- `skip/duplicate/overwrite`、schema v1 JSON、schema v2 ZIP 和附件 ID 重映射保持兼容；duplicate 会清除源请求绑定，避免 requestId 绑定到复制出的新会话。

## 自动验证

- `pnpm run check`：通过。
- `pnpm test:server`：160/160 通过。
- `pnpm --dir client test:unit -- ../tests/client/hooks/useChatStream.test.tsx`：26 个文件、113/113 通过。
- `node --test tests/server/conversationAtomicImport.test.ts`：file/SQLite 首项、中间项、末项故障注入 2/2 通过。
- `node --test tests/server/requestPersistence.test.ts`：file/SQLite 终态、重复 finalize、存储重开 2/2 通过。
- `node --test tests/server/requestIdempotencyApi.test.ts`：顺序重放、并发提交、payload 冲突、查询和 stale processing 3/3 通过。
- `pnpm test:cdp:request-recovery`：通过；Mock 断言结果查询 1 次、答案持久化 1 份、最后一条 assistant 无恢复错误。

## 未在本轮执行

- Docker 容器重启/新 Volume：沿用当前 Docker 暂缓边界，未修改或清理现有 Volume。
- 真实 Provider：R22 不改变 Provider 请求协议，未获得本轮真实付费调用确认，因此未执行。

## 回滚边界

- 新字段全部可选；关闭前端自动结果查询后，旧会话与原 ask/取消读取路径仍可工作。
- SQLite 只增量添加可空 `requests` 列，不重写旧行；file 会话继续是可读 JSON。
- 回滚应用版本前先备份 `/app/data`；不得通过清空数据库或 Docker Volume 回滚。
