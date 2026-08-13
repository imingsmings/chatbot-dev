# R17 会话级模型配置持久化验收记录

日期：2026-08-13

## 范围

- 为每个会话保存完整 provider、model、reasoning enabled/effort、temperature 和 max tokens 快照。
- 贯通 file/SQLite、独立 PATCH、首次 ask 绑定、分支、清空、schema v1 导入导出和 Markdown 元信息。
- 在 React 中恢复 A/B 会话配置，处理 runtime/详情乱序、快速点击、保存失败、会话切换和过期响应。
- 验证旧数据、失效模型、Docker 重启、完整 Volume 备份与新 Volume 恢复。

## 交付语义

| 范围 | 当前语义 |
| --- | --- |
| 新会话 | 服务端创建时绑定当前运行时完整默认配置 |
| 旧会话 | 无字段时安全显示运行时默认；首次保存或 ask 在 Provider 前绑定 |
| 保存 API | `PATCH /conversations/:id/model-options`，提供 400/404/409/200，且不改变 `updatedAt` |
| file | 同会话 mutation queue 内原子更新 JSON；损坏配置只降级可选字段 |
| SQLite | 启动时幂等增加可空 `model_options`；参数化读写，损坏 JSON 不影响消息 |
| 清空/分支 | 清空保留配置；分支深复制父会话配置但不继承摘要 |
| 导入导出 | schema v1 可选字段向后兼容；duplicate/overwrite/skip 保持语义；Markdown 输出绑定配置元信息 |
| React | 详情优先恢复；乐观保存；单次有效 PATCH；失败回滚；A/B 切换丢弃迟到响应 |
| 请求门禁 | 保存期间禁用发送、摘要、上下文和重复保存；无可用 Provider 时不可发送 |
| 失效模型 | 已禁用、删除或未配置模型回退到当前可用默认值，不向失效模型发请求 |

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:unit` | server 122/122；client 77/77 |
| `pnpm run build` | 通过 |
| `pnpm run test:cdp:model-options-persistence` | 通过；A/B、刷新、等待态、单 PATCH、回滚/重试、实际 ask 参数、失效模型回退 |
| `pnpm run test:cdp:context-debug` | 通过；实际上下文预览请求携带当前会话完整配置且保持只读 |
| `pnpm run test:cdp:roadmap` | 通过；摘要和 ask 使用保存后的 OpenAI 配置 |
| `pnpm run test:cdp:all-mock` | 14 个脚本全部通过 |
| `pnpm run test:docker` | 通过；SQLite 会话配置跨重启保持，完整 Volume 备份到新 Volume 后语义一致 |
| `pnpm run audit:production` | 0 个已知生产依赖漏洞 |

浏览器测试使用 mock、临时存储和临时 Chrome profile，不调用真实 Provider，不截图。R17 不改变 Provider 协议或模型请求参数，因此没有为持久化重复执行付费真实模型矩阵；DeepSeek V4 Pro 0813 的既有真实全量证据保持独立记录。

## 兼容与回滚

- 旧 file JSON、旧 SQLite 行和缺少字段的 schema v1 备份无需一次性迁移。
- 新程序读取损坏、未知、禁用或越界配置时只忽略该字段；会话消息仍可读取。
- 回退旧程序时 SQLite 新列会被忽略；旧程序 overwrite 新备份可能丢失可选字段，这是已记录的降级边界。
- 若回滚 R17 代码，不需要删除 `model_options` 列；恢复代码后可继续读取现有合法快照。

## 非目标

- 不改变 Provider SSE、NDJSON v2、Function Calling、取消或 assistant generation 语义。
- 不增加全局偏好页、自动选模、模型用量统计、多用户同步或通用模型网关。
