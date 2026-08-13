# R18 自定义 Prompt 模板验收记录

日期：2026-08-13

## 范围

- 保留现有 6 个内置 Prompt 模板，并增加自定义模板新增、编辑、删除、应用和变量替换。
- 使用当前浏览器 localStorage 保存自定义模板，支持 versioned JSON 导入导出。
- 对损坏数据、容量限制、重复内容、ID 冲突、刷新恢复和移动布局建立自动化回归。

## 交付语义

| 范围 | 当前语义 |
| --- | --- |
| 内置模板 | 继续随源码发布，只读且不写入用户存储 |
| 自定义模板 | 名称与内容可编辑；应用时只填入输入框，不自动发送 |
| 变量 | `{变量名}` 按首次出现顺序去重；独占一行时使用多行输入 |
| 本地存储 | schema v1，key 为 `chatbot-custom-prompt-templates`；只在成功写入后更新 React 状态 |
| 导入 | 完整校验；相同名称与内容跳过；ID 冲突生成新 ID，不覆盖本地模板 |
| 导出 | JSON 只包含自定义模板、schema version 和导出时间 |
| 删除 | 第一次点击进入确认态，第二次显式确认后才删除 |
| 边界 | 不写入会话、file/SQLite、Docker Volume，不进入 Provider 请求 |

## 限制

- 最多 100 个自定义模板。
- 名称最多 80 字符，内容最多 20000 字符，变量最多 20 个。
- 导入文件最多 3 MB。
- localStorage 被浏览器清理时只能通过先前导出的 JSON 恢复；不提供服务端或跨设备自动同步。

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:server` | 122/122 通过 |
| `pnpm run test:client` | 22 files / 87 tests 通过 |
| `pnpm run build` | 通过；Vite 8 production bundle 成功 |
| `pnpm run test:cdp:prompt-templates` | 通过；CRUD、刷新、变量、导入导出、损坏数据、二次删除确认和 390px 布局 |
| `pnpm run test:cdp:all-mock` | 15/15 scripts 通过 |
| `pnpm run test:cdp:all-real` | 真实 UI、会话上下文、Markdown 和 OpenAI Responses 4/4 scripts 通过 |
| `pnpm run test:cdp:real-model-options` | DeepSeek V4 Flash / V4 Pro × Off / Low / Medium / High，8/8 组合通过 |
| `pnpm run audit:production` | 0 个已知生产依赖漏洞 |

mock/CDP 使用临时 Chrome profile，不调用真实 Provider，不生成截图。真实 Provider 全量回归在列明付费范围并取得用户确认后执行，同样不生成截图；所有测试会话、临时会话存储、Chrome profile 和隔离服务均在结束时清理。

真实模型矩阵首次执行时，`DeepSeek V4 Flash + Low` 遇到一次上游长时间无响应，脚本在 240 秒先于服务端 300 秒超时退出。真实回归入口现会只读取 `server/.env` 中的 `LLM_TIMEOUT_MS`，将模型等待窗口设为至少“服务端超时 + 15 秒”，且不会读取或输出密钥；随后完整重跑 8 个组合全部通过。

## 兼容与回滚

- 没有服务端 API、持久化 schema、SQLite 或 NDJSON 变更；旧浏览器数据为空时继续显示全部内置模板。
- localStorage 数据损坏时保留明确错误状态，不把损坏条目当作模板执行。
- 回滚时删除 R18 前端模块和 `chatbot-custom-prompt-templates` key 即可；会话和 Docker 数据无需迁移。

## 非目标

- 不实现模板云同步、共享、市场、版本历史或团队权限。
- 不把模板变量扩展为代码执行、条件表达式或模型工具调用。
