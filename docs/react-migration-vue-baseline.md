# 归档：Vue 迁移基线

本文仅保留历史索引，不再是当前运行或测试契约。

- 2026-07-31：Vue 行为基线用于 React 并行实现的 parity 验收。
- 2026-08-09：用户明确决定删除 Vue，React 接管标准 `client/`。
- Vue SFC、Volar/vue-tsc、Vue 依赖和 Vue-only tests 已从工作区移除。
- 当前实现、命令和回滚方式以 [React 迁移收口记录](react-migration-plan.md) 为准。
- 用户会话 file/SQLite 格式和后端 API 未随前端切换改变。

旧实现需要审计时从 Git 历史读取，不在当前源码树保留第二套客户端。
