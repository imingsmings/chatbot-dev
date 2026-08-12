# R16 全链路一致性验收记录

日期：2026-08-13

## 范围

- 修复 optimistic UI 消息与持久化消息索引混用导致的编辑/重新生成错位。
- 消除取消、上游释放、停止落库和前端详情恢复之间的固定等待竞态。
- 让 `/api/health` 探测当前 file/SQLite store 的真实读写能力。
- 将摘要改为覆盖边界后的有预算增量滚动，并在无新增内容时跳过模型调用。
- 拆分 UI CDP 场景，补齐 upstream fail-fast 与双 provider 真实全量门禁。

## 设计结果

| 范围 | 当前语义 |
| --- | --- |
| UI 消息定位 | 服务端详情映射 `persistedIndex`；optimistic 行不能编辑或重新生成 |
| 流结束恢复 | 成功或确认手动停止后回拉详情，以落库消息替换当前会话 UI |
| 取消 | registry abort 后继续占用，ask `finally` 完成时通知；cancel 返回 `completed` 后前端回拉 |
| file health | 在实际 conversations 目录写入、读回并删除探针 |
| SQLite health | 在当前 DB 内 `BEGIN IMMEDIATE`、写读探针并 `ROLLBACK` |
| 摘要 | 只处理 `sourceMessageCount` 后新增消息；默认 24000 字符输入预算、最多 1024 tokens |
| UI CDP | 四个独立场景模块复用 harness；总 runner 对子场景失败返回非零 |
| 真实接口 | OpenAI 全链路与 DeepSeek Flash 四档 reasoning 分批隔离运行 |

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:unit` | server 114/114；client 71/71 |
| `pnpm run build` | 通过 |
| `pnpm run test:cdp:all-mock` | 全部通过；upstream cancellation 4/4 且 fail-fast |
| `pnpm run test:docker` | 通过；HTTPS、SQLite、health 503/恢复、SIGTERM、备份/新卷恢复 |
| `pnpm run audit:production` | 0 个已知生产依赖漏洞 |
| `pnpm run test:cdp:all-real` | OpenAI 四个真实脚本通过；DeepSeek Flash Off/Low/Medium/High 4/4 通过 |

真实接口测试使用随机 backend/Vite 端口、临时 file store 和临时 Chrome profile，不截图。所有测试会话、临时数据和测试服务均在退出时清理；已禁用的 DeepSeek V4 Pro 与 GPT-5.6 Sol 未发送真实请求。

## 已知边界

- OpenAI endpoint 在工具组合下可能不给 reasoning summary；请求参数必须正确，reasoning 正文存在性不作为稳定门禁。
- 500ms 是前端等待取消确认的异常降级上限，不代表服务端完成；正常路径以 cancel `completed` 为准。
- file queue 和 SQLite 连接仍是单 Node 进程语义，不支持多实例横向扩容。
- 本轮不改变 NDJSON v2、SQLite 表结构、备份 schema 或部署拓扑。
