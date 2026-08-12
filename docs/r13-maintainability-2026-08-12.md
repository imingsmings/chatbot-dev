# R13 维护性拆分验收记录

日期：2026-08-12（Asia/Shanghai）

## 结论

R13 已完成并通过验收。此次变更只调整模块与测试责任边界；HTTP API、会话持久化格式、NDJSON v2 事件类型和用户可见交互保持不变。未新增依赖、状态管理库、ORM 或 UI 改版。

## 交付边界

### 前端编排

- `useChatAppController` 保留为 `App.tsx` 的唯一页面装配入口。
- `useConversationOperations` 管理会话 CRUD、切换和侧栏操作互斥。
- `useConversationTransfer` 管理 Markdown/JSON 导出与 JSON 备份导入。
- `useConversationInsights` 管理上下文预览、摘要和异步竞态保护。

### 存储

- `server/utils/conversationStore.ts` 保持原导出不变，作为 facade 选择 file/SQLite store。
- `server/utils/conversationStore/` 分为公共契约、路径、规范化、迁移读取、file store 和 SQLite store。
- file store 继续使用同会话 mutation queue 与临时文件 + rename；SQLite 继续使用 WAL、固定参数化 SQL 和幂等 JSON migration metadata。

### 协议与 CDP

- `shared/chatStreamProtocol.ts` 是前后端共用的 NDJSON v2 常量与事件联合；运行时校验仍由客户端负责。
- UI CDP 拆为 `conversation-operations`、`stream-recovery`、`layout-scroll`、`model-menu` 四个入口。
- 四个入口共享 browser、CDP client 和 process helpers；`all-mock` 对它们去重后执行一次。

## 验收证据

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:server` | 87 / 87 通过 |
| `pnpm run test:client` | 16 files，55 / 55 通过 |
| `pnpm run build:client` | 通过，Vite 8 生产构建成功 |
| `pnpm run test:cdp:ui` | 4 / 4 拆分入口通过 |
| `pnpm run test:cdp:all-mock` | 13 / 13 子脚本通过 |
| `pnpm run test:docker` | 通过，隔离 Compose project/随机端口/临时 volume |
| `git diff --check` | 通过 |

CDP 关键断言包括：新建/切换上游中止计数均为 1；流式代码块增长后 `bottomGap=0`；390px viewport 无页面级横向溢出；协议、网络、超时和停止错误后可继续请求。测试只使用 mock/fixture 和临时数据，没有调用真实模型、天气或生产集成，也没有生成截图。

Docker 首次构建发现根 `shared/` 未复制到镜像；随后在 build/runtime 两阶段补齐并完整复跑通过。最终 smoke 同时证明非 root Node、HTTPS React 托管、API JSON 404、SQLite 跨重启和 SIGTERM 优雅退出。
