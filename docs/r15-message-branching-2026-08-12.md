# R15 消息分支验收记录

日期：2026-08-12（Asia/Shanghai）

## 结论

R15 选定的单一范围“编辑历史用户消息、重新生成回答和必要会话分支”已完成并通过验收。编辑或重新生成都会创建普通独立会话；父会话、父摘要和父会话后续消息保持不变。此次交付没有新增依赖、父子关系 schema、备份版本或 SQLite 表迁移。

## 交付边界

### 后端与存储

- `POST /api/conversations/:id/branches` 接受 `messageIndex` 和待发送问题；目标必须是已保存的 user message。
- 分支只复制目标索引之前的消息，保留其中的 reasoning、生成元数据和裁剪工具轨迹；目标消息、后续消息与 summary 均不复制。
- 分支标题追加一个 `（分支）`，重复分支不叠加后缀，长标题保持在产品上限内。
- 分支通过现有 store import 原子创建，file/SQLite 共享语义；校验失败不会产生部分会话。

### 前端交互

- 已保存用户消息提供“编辑”，使用多行对话框并明确说明原会话不变；取消、空白或内容未变化时不创建分支。
- 已完成以及有正文的 stopped assistant 提供“重新生成”，从最近一条已保存用户消息创建分支。
- 新分支被选中后，前端以显式 branch ID 复用既有 NDJSON v2 ask 流，避免 React 状态切换时序把回答误发到父会话。
- 生成期间编辑、重新生成、输入与会话切换保持互斥；复制仍保持可用。分支创建失败显示可恢复错误，父会话和当前内容不变。
- error assistant 继续使用原地“重试”；尚未持久化的失败 optimistic user message 不显示编辑入口。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:client` | 18 files，68 / 68 通过 |
| `pnpm run test:server` | 110 / 110 通过 |
| `node --test tests/server/conversationBranch.test.ts tests/server/conversationBranchSqlite.test.ts` | 3 / 3 通过 |
| `pnpm run build:client` | 通过，Vite 8 生产构建成功 |
| `pnpm run test:cdp:ui` | 4 / 4 UI 入口通过 |
| `pnpm run test:cdp:all-mock` | 13 / 13 去重子脚本通过 |
| `git diff --check` | 通过 |

浏览器关键断言包括：编辑后会话数由 1 变 2，重新生成后由 2 变 3；父会话四条消息逐字段不变；第一个分支保留编辑后的回答；第二个分支保存重新生成回答；分支失败后会话数仍为 3，当前回答仍可见。流式期间 composer、编辑和重新生成禁用，停止和复制遵循原有交互。

所有模型响应均来自本地 mock；未调用真实 DeepSeek/OpenAI、天气或生产集成，也未生成截图。
