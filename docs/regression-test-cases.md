# 回归测试矩阵

当前测试对象是唯一的 React 客户端与 Express 后端。默认使用 mock、fixture 和临时存储，不调用真实模型、天气或生产集成，不生成截图。

## 交付门禁

| 门禁 | 命令 | 证明内容 |
| --- | --- | --- |
| 静态检查 | `pnpm run check` | Server/Client 共享 TS 7、普通/类型感知 Oxlint |
| 后端单测 | `pnpm run test:server` | API、存储、Provider、工具、上下文和异常边界 |
| React 单测 | `pnpm run test:client` | reducers、hooks、API、协议、Markdown、组件 |
| 全部单测 | `pnpm run test:unit` | 后端 + React |
| 生产构建 | `pnpm run build:client` | Vite 8 bundle、chunk 拆分、无 Vue runtime |
| 生产托管 | `tests/server/clientHosting.test.ts` | 构建 fail-fast、SPA、API 隔离、缓存和安全头 |
| HTTPS 配置 | `tests/server/deploymentConfig.test.ts` | production defaults、路径、布尔/端口和证书异常 |
| Docker 容器 | `pnpm run test:docker` | Compose、镜像、HTTPS、SPA、API 404、SQLite 重启持久性和 SIGTERM |
| Docker 页面 | `pnpm run test:cdp:docker-ui` | 容器 HTTPS 页面、侧栏、输入区、模型控件和横向溢出；截图可选 |
| 浏览器回归 | `pnpm run test:cdp:all-mock` | 完整 React UI/API mock 矩阵 |
| 真实接口全量 | `pnpm run test:cdp:all-real` | 隔离端口/临时 file store；真实 UI、上下文、Markdown、OpenAI reasoning/工具/停止恢复；需明确确认 |
| 生产依赖审计 | `pnpm run audit:production` | 根 workspace 全部生产依赖，要求 0 已知漏洞 |

## React 单元边界

| 范围 | 关键断言 |
| --- | --- |
| conversation reducer | 不可变 upsert/sort；删除 active 立即清空 ID、summary、messages |
| useConversations | Strict Mode 初始化去重；选择乱序；删除后继加载失败不保留已删除详情 |
| useChatStream | delta/reasoning/tool/done；手工取消一次；首包/流空闲超时；协议错误后恢复；卸载清理 |
| stream protocol | v2 六类事件；拆包；未知/损坏 JSON；负耗时；空 tool/error 字段 |
| model catalog | provider/model 能力；disabled；空/损坏运行目录 fallback |
| Markdown | HTML/图片禁用；外链安全；代码语言与净化；stream/complete 模式 |
| UI components | 模型设置能力约束、摘要可用性、有效消息操作、对话框/主题等生命周期 |

## 后端单元边界

| 范围 | 关键断言 |
| --- | --- |
| context | 消息数/字符预算、完整边界消息、空历史、当前问题不裁剪、摘要参与 |
| file store | CRUD、搜索、导入导出、摘要；40 路同会话写不丢失；原子写无临时残留；payload ID/时间损坏恢复 |
| SQLite | CRUD、搜索、导入导出、摘要、临时 DB、损坏 JSON 跳过和 migration 后重开 |
| chat persistence | 会话在回答完成前删除时拒绝假成功 |
| summary | 空/不存在、持久化、清空；完整消息快照竞态；shutdown 取消上游 |
| request registry | requestId 校验、同会话单活动请求、全部取消和完成清理 |
| NDJSON | backpressure 不误判关闭；destroyed/writableEnded 不再写入 |
| test process lifecycle | child exit 等待、脚本超时、进程组终止与临时目录清理 |
| model options | 范围、能力、禁用模型、启动配置一致性 |
| provider config | OpenAI URL normalization、非 HTTP/HTTPS 拒绝、凭据不公开 |
| adapters | DeepSeek/OpenAI SSE、reasoning summary、tool arguments 聚合、call_id continuation |
| tools | 安全计算器、IANA 时间、天气本地日期、网络/HTTP 失败隔离 |
| production hosting | 缺失 build、SPA deep link、静态缓存、`/api` JSON 404、非 GET 不回退 |
| TLS configuration | 生产默认值、`~/` 展开、非法布尔/端口、缺失或损坏证书 fail-fast |

## CDP suites

| Suite | 入口 | 主要覆盖 |
| --- | --- | --- |
| P0 | `pnpm run test:cdp:p0` | ask/stop/cancel、会话 API、工具、核心 UI |
| P1 | `pnpm run test:cdp:p1` | UI、Markdown、高亮、边界状态 |
| UI | `pnpm run test:cdp:ui` | 四个独立入口：会话操作、流式恢复、滚动/布局、模型菜单 |
| Context | `pnpm run test:cdp:context-debug` | 实际上下文、统计、移动布局 |
| Search | `pnpm run test:cdp:conversation-search` | 输入、跳转、空/错/竞态 |
| Export | `pnpm run test:cdp:conversation-export` | 下载、文件名、JSON 备份 |
| Roadmap | `pnpm run test:cdp:roadmap` | 摘要、导入、模型参数、模板、工具状态、长 Markdown |
| Sidebar | `pnpm run test:cdp:sidebar-state` | 操作等待态、连点互斥和失败恢复 |
| All mock | `pnpm run test:cdp:all-mock` | 上述去重后的 13-script 完整集合 |

UI 四个入口位于 `tests/cdp/scenarios/ui/`。它们通过 `CDP_UI_GROUP` 选择原有断言分组，并统一复用 `helpers/browser.mjs`、`helpers/cdpClient.mjs` 和 `helpers/services.mjs`；任一失败会直接显示所属场景，不必从单个大型 UI 输出中反查。

### UI 必测边界

- Enter 提交、Shift+Enter 换行、空白与快速连点不发送。
- 新建/切换会话时中止生成，旧响应不能污染新会话。
- 删除/清空当前会话清理草稿和页面状态。
- 用户接近底部时跟随正文/reasoning/代码块；上滚查看历史时保持位置。
- 代码块最后增长时 bottom gap 保持在阈值内。
- 停止、HTTP 失败、网络断开、损坏 NDJSON、缺少 done 和超时后均可恢复。
- 明暗主题刷新保持；390px 无页面级横向溢出。
- 图标按钮有可读 `aria-label`；Dialog/Dropdown 的 Escape、focus 和 disabled 状态正确。

## 变更到测试映射

| 变更 | 最小验证 |
| --- | --- |
| React 纯逻辑/hook | `check` + `test:client` |
| UI/交互/布局/滚动 | 上述 + `test:cdp:ui` |
| Markdown/高亮 | `test:client` + `test:cdp:markdown` + `test:cdp:highlight` |
| 流式/取消/超时 | `test:unit` + `test:cdp:p0` + `test:cdp:ui` |
| file/SQLite/导入 | `test:server` + P0/对应专项 CDP |
| Provider/Function Calling | adapter/tool tests + P0；真实 provider 需另行确认 |
| 构建/依赖/入口 | `check` + `build:client` + `all-mock` |
| 托管/HTTPS | deployment/clientHosting tests + 生产 HTTPS 本机冒烟 |
| Dockerfile/Compose | `test:docker`；涉及页面托管时再运行 `test:cdp:docker-ui` |

## 数据与进程清理

- 自动化会话使用明确测试前缀或捕获 ID，结束时只删除本轮创建的数据。
- file/SQLite 测试必须使用 `mkdtemp` 隔离目录。
- runner 启动的 Vite、后端和浏览器 profile 必须在 `finally` 中清理。
- CDP 总 runner 为脚本设置有界超时；超时时终止独立进程组，避免遗留脚本的子服务。
- 测试前检查端口；不停止用户已有进程。
- `.tmp/cdp-results/*.json` 是机器可读结果，不作为源码提交。

## 真实接口

仅在用户明确确认时执行：

```bash
pnpm run test:cdp:real
pnpm run test:cdp:real-model-options
pnpm run test:cdp:real-openai
```

真实测试必须说明模型、场景、可能费用、截图与否，并清理全部测试会话。未明确要求截图时保持 `CDP_SCREENSHOTS=0`。

2026-08-10 的最新 Mock、Docker 与审查结果见 [全面 Code Review 与回归记录](code-review-2026-08-10.md)。
