# 回归测试矩阵

当前测试对象是唯一的 React 客户端、Node Express 后端和独立 `Bun.serve` 后端。默认使用 mock、fixture 和临时存储，不调用真实模型、天气或生产集成，不生成截图。

## 交付门禁

| 门禁 | 命令 | 证明内容 |
| --- | --- | --- |
| Bun 工具链守卫 | `bun run test:toolchain` | 根 package manager/workspace/catalog/lock、脚本调度、45 个 `bun:test` 文件，以及 Bun 后端不存在 `node:sqlite`、Express/Busboy 依赖或 Node HTTP/HTTPS 运行时导入 |
| 静态检查 | `bun run check` | Node/Bun Server 与 Client 共享 TS 7、普通/类型感知 Oxlint |
| Node 后端单测 | `bun run test:server` | API、存储、Provider、工具、上下文和异常边界 |
| Bun 后端测试 | `bun run test:bun-server` | 逐文件隔离执行 Bun 兼容测试，避免全局 mock/模块缓存互相污染 |
| Node/Bun 契约对照 | `bun run test:backend-parity` | file/SQLite 的健康、运行配置、会话、NDJSON v2、重命名和重启持久化归一化对照 |
| SQLite 运行时兼容 | `bun run test:sqlite-runtime-compatibility` | Node 写入 → Bun 读取/更新 → Node 回读同一 SQLite 数据库，且运行时切换不重放 Provider 请求 |
| Bun HTTP/HTTPS 运行时 | `bun run test:bun-http-runtime` | 真实 `Bun.serve` HTTPS、TLS、安全头、运行时 SQLite、SIGTERM 优雅退出和临时文件清理 |
| React 单测 | `bun run test:client` | reducers、hooks、API、协议、Markdown、组件 |
| 全部单测 | `bun run test:unit` | Node/Bun 后端 + React |
| 生产构建 | `bun run build:client` | Vite 8 bundle、chunk 拆分、无 Vue runtime |
| 生产托管 | `tests/server/clientHosting.test.ts` + `tests/bun-server/clientHosting.test.ts` | 两套运行时的构建 fail-fast、SPA、API 隔离、缓存和安全头 |
| HTTPS 配置 | Node/Bun `deploymentConfig.test.ts` + `test:bun-http-runtime` | production defaults、路径、布尔/端口、证书异常和真实 Bun TLS 启停 |
| Docker 容器 | `bun run test:docker` | Compose、运行镜像约束、证书覆盖、HTTPS、live/ready、SQLite、附件、requestId 跨重启重放、停止备份、新卷恢复、校验和、源卷不变和 SIGTERM |
| Docker 页面 | `bun run test:cdp:docker-ui` | 容器 HTTPS 页面、登录、附件缩略图/受保护原图预览、历史图片续问、模型控件和横向溢出；截图可选 |
| 浏览器回归 | `bun run test:cdp:all-mock` | 完整 React UI/API mock 矩阵 |
| Bun 浏览器回归 | `bun run test:cdp:all-mock:bun` | 将真实后端、取消和 P0 API 场景切换到 Bun；其余 UI 继续复用同一 Mock 契约 |
| 运行时观测基准 | `bun run benchmark:backends` | 同机冷启动、空闲 RSS、健康接口 P50/P95 和首个流块；只报告、不作为跨机器硬门禁 |
| 图片附件浏览器专项 | `bun run test:cdp:image-attachments` | 上传、文本加图/仅图片、受保护预览、刷新、失败重试、模型拦截、分支、停止和 390px 边界 |
| 真实接口套件 | `bun run test:cdp:all-real` | 隔离端口/临时 file store；DeepSeek V4 Pro UI/上下文/Markdown、OpenAI Responses、DeepSeek Flash/Pro 8 组参数，以及使用固定非隐私图片的 DeepSeek Vision 识图/刷新/分支/仅图片/停止/ZIP；需明确确认 |
| 依赖审计 | `bun run audit:production` | `bun.lock` 中全部 workspace 依赖的 high/critical 漏洞，要求 0 |

2026-09-04 的 Bun 交付通过 `check`、Node 177 项、Bun 45 个测试文件、React 119 项、契约对照、生产构建、无重试 Bun `all-mock` 及 DeepSeek/OpenAI 真实功能门禁。Docker 未执行；真实总入口清理问题的修复采用 Node/Bun 进程组单测和聚焦 CDP 自动退出验证，详细证据边界见 [R24 验收记录](r24-bun-server-2026-09-04.md)。

同日 R25 将本地工具链迁移到 Bun 1.4：冻结安装、工具链守卫、`check`、Node 177 项、原生 Bun 174 项、React 119 项、契约对照、Vite 构建和无重试 Bun `all-mock` 通过。图片专项首次暴露 reload 断言可能读取旧 document，增加 document-id 换代门禁后专项与全量均通过。未调用真实 Provider，未运行 Docker，见 [R25 验收记录](r25-bun-toolchain-2026-09-04.md)。

2026-09-05 的 R26 将 Bun 会话库与认证 Session Store 切换到 `bun:sqlite`：聚焦 SQLite/认证 25 项、工具链守卫 4 项、`check`、Node 177 项、Bun 174 项、React 119 项、file/SQLite 契约对照、Node → Bun → Node 数据库兼容、Vite 构建、生产依赖审计和无重试 18/18 Bun `all-mock` 通过。未调用真实 Provider，未运行 Docker，见 [R26 验收记录](r26-bun-sqlite-2026-09-05.md)。

同日 R27 将 Bun HTTP/HTTPS 边界迁移到 `Bun.serve`：工具链守卫 5 项、`check`、Node 177 项、Bun 175 项、React 119 项、真实 Bun HTTPS/SIGTERM、file/SQLite 契约对照、数据库双向兼容、Vite 构建、生产依赖审计和无重试 18/18 Bun `all-mock` 通过。首次全量 Mock 暴露测试观察器晚于空会话创建的竞态，补充按服务端空会话回查后完整重跑通过；业务取消断言未削弱。未调用真实 Provider，未运行 Docker，见 [R27 验收记录](r27-bun-http-runtime-2026-09-05.md)。

## React 单元边界

| 范围 | 关键断言 |
| --- | --- |
| conversation reducer | 不可变 upsert/sort；删除 active 立即清空 ID、summary、messages、模型配置；选择/应用/清空恢复配置；服务端详情映射真实 `persistedIndex` 和生成元数据 |
| useConversations | Strict Mode 初始化去重；选择乱序；删除后继加载失败不保留已删除详情；创建分支后选中新会话 |
| useConversationModelOptions | runtime/详情乱序、A/B 恢复、乐观保存、服务端规范化、快速点击、失败回滚/重试和切换后过期响应隔离 |
| useChatStream | delta/reasoning/tool/done；显式新分支 ID；取消完成握手；取消未完成时保持发送锁且确认后立即重试；成功/停止后详情回拉；丢失 done 后请求终态查询与持久化答案恢复；首包/流空闲超时；协议错误后恢复；卸载清理 |
| message branching | 多行编辑、取消/未修改、最近用户消息定位、分支创建失败恢复 |
| stream protocol | v2 六类事件；拆包；未知/损坏 JSON；负耗时；空 tool/error 字段 |
| model catalog | 服务端下发的未知模型 ID/标签/能力可直接使用；disabled 安全回退；空/损坏目录不合成客户端模型且 fail-closed |
| Markdown | HTML/图片禁用；外链安全；代码语言与净化；stream/complete 模式 |
| UI components | 模型设置能力约束、摘要可用性、有效消息操作、对话框/主题等生命周期 |
| custom prompt templates | Unicode 变量、schema v1、localStorage 恢复、CRUD、损坏数据、非覆盖导入和导出 |

## 后端单元边界

除运行时选择 helper 外，`tests/server/` 与 `tests/bun-server/` 分别导入各自后端源码；下表行为边界对两套实现均成立。

| 范围 | 关键断言 |
| --- | --- |
| context | Provider-aware DeepSeek/OpenAI 配置、JSON UTF-8 保守估算、统一输入/输出预算、旧消息/字符二级护栏、历史图片→摘要→最旧消息裁剪顺序、固定输入超限、工具续调复检、摘要覆盖不回退和预览明细 |
| file store | CRUD、搜索、导入导出、摘要；40 路同会话写不丢失；原子写无临时残留；payload ID/时间损坏恢复 |
| SQLite | CRUD、搜索、导入导出、摘要、临时 DB、损坏 JSON 跳过和 migration 后重开 |
| conversation branch | file/SQLite 前缀与元数据一致；父会话不变；摘要不继承；非法索引/问题原子失败 |
| chat persistence | 会话在回答完成前删除时拒绝假成功；不完整 Provider 流不落库且后续请求恢复 |
| summary | 空/不存在、持久化、清空；边界后增量滚动、输入预算、无新增时零调用、stopped 排除并推进边界；完整消息快照竞态；shutdown 取消上游 |
| request registry | requestId 校验、同会话单活动请求、abort 后保持占用、取消等待 `completeRequest`、完成后清理和复用 |
| request persistence | file/SQLite processing/终态、消息与终态原子提交、并发/顺序重放、存储重开、stale processing 失败收敛和受认证查询 |
| atomic import | file staging/backup/rollback 与 SQLite transaction；首项/中间项/末项故障注入后会话快照不变，ZIP 新附件失败整批清理 |
| NDJSON | Web Stream writer 等待下游可写；Provider reader 等待异步事件处理；关闭后不再写入，取消后上游释放且后续请求恢复 |
| test process lifecycle | child exit 等待、脚本超时、进程组终止与临时目录清理 |
| model options | 完整快照、范围/能力/禁用模型、运行时默认、旧会话回填、更新不改排序、file/SQLite 重开、SQLite 幂等增列、损坏字段安全降级 |
| model-options API | 独立 PATCH 400/404/409/200；与 ask/摘要互斥；Provider 失败前仍完成首次绑定；上下文预览只读 |
| provider config | OpenAI URL normalization、非 HTTP/HTTPS 拒绝、默认模型来自服务端 catalog、凭据不公开 |
| provider diagnostics | 非 2xx 结构化字段提取、4 KiB 读取上限、reader 取消、凭据/查询参数脱敏、安全 request id、correlation id 和稳定客户端错误 |
| adapters | DeepSeek `[DONE]` / OpenAI `response.completed` 完成门禁、partial/reasoning/tool EOF、reasoning summary、tool arguments 聚合、call_id continuation |
| tools | 安全计算器、IANA 时间、天气本地日期、网络/HTTP 失败隔离 |
| production hosting | 缺失 build、SPA deep link、静态缓存、`/api` JSON 404、非 GET 不回退 |
| TLS configuration | 生产默认值、`~/` 展开、非法布尔/端口、缺失或损坏证书 fail-fast |
| health | `/live` 不触发深探针；`/ready` 与兼容 `/health` 执行 file/SQLite/Session Store 探针；不可写/运行配置异常 503；恢复后 200；响应不泄漏路径、endpoint 或凭据 |
| authentication config | production 默认启用、HTTP/Secure Cookie/缺失哈希或 secret fail-fast、开发关闭兼容 |
| authentication security | Argon2id 参数与 salt/摘要最小长度、JWT 固定 HS256/issuer/audience/type/expiry、篡改与 secret 混用拒绝 |
| authentication sessions | 原子 Refresh 轮换、并发复用/重放撤销、logout、撤销全部、Access Session 立即失效 |
| authentication API | live/ready/兼容 health 与 status 公开、其他 API 401、同源 Origin、通用登录错误、限速隔离和 Cookie 属性 |

## CDP suites

| Suite | 入口 | 主要覆盖 |
| --- | --- | --- |
| P0 | `bun run test:cdp:p0` | ask/stop/cancel、会话 API、工具、核心 UI |
| P1 | `bun run test:cdp:p1` | UI、Markdown、高亮、边界状态 |
| UI | `bun run test:cdp:ui` | 七个独立入口：会话操作、流式恢复、滚动/布局、流性能、模型菜单、会话模型配置、自定义模板 |
| Stream performance | `bun run test:cdp:stream-performance` | 4KB/24KB/80KB、200 条历史、更新次数、可见延迟、long task、历史行渲染和滚动次数 |
| Request recovery | `bun run test:cdp:request-recovery` | 服务端已保存答案但流缺失 done 时查询一次终态、回拉原回答且不重复持久化 |
| Context | `bun run test:cdp:context-debug` | 实际上下文、模型上限、预算组成/裁剪统计、移动布局 |
| Search | `bun run test:cdp:conversation-search` | 输入、跳转、空/错/竞态 |
| Export | `bun run test:cdp:conversation-export` | 下载、文件名、JSON 备份 |
| Roadmap | `bun run test:cdp:roadmap` | 摘要、导入、模型参数、模板、工具状态、长 Markdown |
| Sidebar | `bun run test:cdp:sidebar-state` | 操作等待态、连点互斥和失败恢复 |
| Model options | `bun run test:cdp:model-options-persistence` | A/B/刷新恢复、保存等待态、单 PATCH、失败回滚/重试、实际 ask 参数、服务端独有模型/能力、禁用状态和空目录 fail-closed |
| Prompt templates | `bun run test:cdp:prompt-templates` | 新增、编辑、二次确认删除、刷新持久化、变量填充、导入导出、损坏文件和 390px 布局 |
| Image attachments | `bun run test:cdp:image-attachments` | 上传完成/失败、图片消息、Blob 预览、刷新、分支复制、文本模型阻止、停止持久化和移动端元素边界 |
| Authentication | `bun run test:cdp:authentication` | 未登录不预载、限速提示、内存 Token、401 单次刷新重放和 logout |
| All mock | `bun run test:cdp:all-mock` | 上述去重后的 18-script 完整集合 |
| Bun all mock | `bun run test:cdp:all-mock:bun` | 复用完整集合并把实际启动的后端切到 `bun-server/`；只使用本地 Mock Provider |

UI 七个入口位于 `tests/cdp/scenarios/ui/`，分别包含会话操作、流式恢复、滚动/布局、流性能、模型菜单、会话模型配置持久化和自定义模板管理的真实场景实现，并复用 `scenarios/ui/harness.mjs` 及底层 CDP helpers。`ui-scenarios.mjs` 只负责按入口调度；任一模块失败都会返回非零退出码并标明所属场景。

### UI 必测边界

- Enter 提交、Shift+Enter 换行、空白与快速连点不发送。
- 新建/切换会话时中止生成，旧响应不能污染新会话。
- 删除/清空当前会话清理草稿和页面状态。
- 编辑历史用户消息和重新生成回答均创建新分支；父会话逐条不变，连续分支保留各自回答，失败不留下额外会话。
- 只有带服务端 `persistedIndex` 的消息显示编辑/重新生成；流成功或停止后 optimistic 行与服务端详情完全对齐。
- 用户接近底部时跟随正文/reasoning/代码块；上滚查看历史时保持位置并显示快速到底按钮，点击后恢复当前流的持续跟随。
- 代码块最后增长时 bottom gap 保持在阈值内。
- 停止、HTTP 失败、网络断开、损坏 NDJSON、缺少 done、Provider 不完整错误和超时后均可恢复；取消确认完成前发送保持禁用，确认后立即重试成功且无短暂 409；若服务端已保存回答但应用 `done` 丢失，结果查询会恢复唯一的持久化回答；用户手动停止且已收到正文或 reasoning 时落为 `stopped`，其他中断的部分内容仅保留在当前 UI 且不落库。
- 刷新后 generation、usage、裁剪工具轨迹和 `stopped` 状态可恢复；缺失 usage 显示未知，`stopped` 不进入上下文或摘要。
- 明暗主题刷新保持；390px 无页面级横向溢出。
- 图标按钮有可读 `aria-label`；Dialog/Dropdown 的 Escape、focus 和 disabled 状态正确。
- 会话配置保存期间发送、摘要、上下文和重复保存入口不可触发；失败回滚后可重试，实际 ask/摘要/上下文请求使用当前会话配置。
- 自定义模板 CRUD、刷新恢复、变量填充、非覆盖导入、导出下载、损坏文件保持原数据和删除二次确认均有可重复浏览器断言。
- 认证开启时未登录不挂载聊天 hooks；登录请求防重复，Access Token 不进入 DOM/Web Storage，并发或 401 恢复只执行一次 Refresh 和一次原请求重放。

## 变更到测试映射

| 变更 | 最小验证 |
| --- | --- |
| React 纯逻辑/hook | `check` + `test:client` |
| UI/交互/布局/滚动 | 上述 + `test:cdp:ui` |
| Markdown/高亮 | `test:client` + `test:cdp:markdown` + `test:cdp:highlight` |
| 流式/取消/超时 | `test:unit` + `test:cdp:p0` + `test:cdp:ui` |
| 流式渲染性能 | 上述 + `test:cdp:stream-performance`；同机 5 次中位数与最差值门禁 |
| file/SQLite/导入 | `test:server` + P0/对应专项 CDP |
| Bun 后端业务或依赖 | `check` + `test:bun-server` + `test:toolchain` + `test:backend-parity` + `test:bun-http-runtime` + `test:cdp:all-mock:bun`；与 Node 数据目录隔离 |
| 会话模型配置 | `test:unit` + `test:cdp:model-options-persistence` + `test:docker`；真实 Provider 不因持久化本身重复调用 |
| 自定义 Prompt 模板 | `check` + `test:client` + `test:cdp:prompt-templates`；不涉及服务端或 Provider |
| 单用户认证/JWT/Session | `check` + `test:unit` + `test:cdp:authentication` + `all-mock` + `test:docker`；最终真实 Provider runner 必须在认证开启下执行 |
| Provider/Function Calling | adapter/tool tests + P0；真实 provider 需另行确认 |
| Provider 非 2xx 诊断 | `check` + provider diagnostics 单测 + adapter/API 错误路径；不得断言或记录原始敏感 body |
| 构建/依赖/入口 | `check` + `build:client` + `all-mock` |
| 托管/HTTPS | Node/Bun deployment/clientHosting tests + `test:bun-http-runtime`；Docker 仍另走 R29 门禁 |
| Dockerfile/Compose/卷运维 | `test:docker`，覆盖临时证书、隔离 volume、校验失败、恢复语义和清理；涉及页面托管时再运行 `test:cdp:docker-ui` |

## 数据与进程清理

- 自动化会话使用明确测试前缀或捕获 ID，结束时只删除本轮创建的数据。
- file/SQLite 测试必须使用 `mkdtemp` 隔离目录。
- runner 启动的 Vite、后端和浏览器 profile 必须在 `finally` 中清理。
- CDP 总 runner 为脚本设置有界超时；超时时终止独立进程组，避免遗留脚本的子服务。
- upstream cancellation 任一 cancel completion、上游释放或落库断言失败时，场景和总 runner 都必须返回非零退出码。
- 测试前检查端口；不停止用户已有进程。
- `.tmp/cdp-results/*.json` 是机器可读结果，不作为源码提交。

## 真实接口

真实 runner 自动使用临时 Argon2id 凭据、独立 JWT secret 和认证 Session DB；浏览器与直接 API 清理请求都先登录，测试结束删除隔离数据目录：

```bash
bun run test:cdp:real
bun run test:cdp:real-model-options
bun run test:cdp:real-openai
bun run test:cdp:real-vision
```

四个专项命令和 `all-real` 都通过 `run-all-real.mjs` 分配随机端口和临时 file store；`all-real` 以 DeepSeek V4 Pro 为默认模型跑 UI/上下文/Markdown，并覆盖 OpenAI Responses；随后跑 Flash 与 Pro 的 Off/Low/Medium/High，最后使用固定非隐私图片跑 Vision 纯文本工具、识图、刷新、分支、仅图片、停止/恢复、完整识别报告、窄屏与 ZIP 门禁。R23 在真实文本上下文中断言所选模型估算器、持久化历史、问题/工具预算和总量不超过本地上限，在 Vision 上下文中额外断言图片预算进入统一估算。8 组参数矩阵是当前代表性兼容门禁，不是所有模型、参数与档位的笛卡尔积；DeepSeek `max` 未包含在该付费矩阵中。已禁用的 GPT-5.6 Sol 只验证禁用状态，不发送真实请求。

R24 在 Bun 后端上完成了一次无脚本重试、无截图的真实功能全量：主套件 4/4、DeepSeek 参数矩阵 8/8 和 Vision 全场景通过。首次总入口在隔离套件结束后需要人工清理测试自建的 Vite 包装进程；修复后 Node/Bun 进程组单测及聚焦 `sidebar-state` CDP 均证明父子进程自动退出，但没有再次运行付费真实全量。该差异属于编排清理证据边界，不影响已经通过的 Provider 功能断言。

真实测试必须说明模型、场景、可能费用、图片来源、截图与否，并清理全部测试会话。未明确要求截图时保持 `CDP_SCREENSHOTS=0`；本次 R21 验收显式使用 `CDP_SCREENSHOTS=1`。

2026-08-13 的 R16 Mock、Docker、DeepSeek/OpenAI 真实接口与审查结果见 [R16 全链路一致性验收记录](r16-consistency-hardening-2026-08-13.md)。

DeepSeek V4 Pro 0813 的启用、8 组真实模型参数矩阵和 Docker 验收见 [DeepSeek V4 Pro 0813 启用与验收记录](deepseek-v4-pro-0813-validation-2026-08-13.md)。

R17 的 file/SQLite、API、React 竞态、14-script mock 和 Docker Volume 证据见 [R17 会话级模型配置持久化验收记录](r17-conversation-model-options-2026-08-13.md)。

R18-R20 的最新完整门禁分别见 [R18 自定义 Prompt 模板验收记录](r18-custom-prompt-templates-2026-08-13.md)、[R19 流式渲染验收记录](r19-streaming-rendering-2026-08-13.md)和 [R20 JWT 单用户认证实施与验证记录](r20-jwt-authentication-plan.md#2026-08-19-验证记录)。

R21 的图片安全、file/SQLite、Mock、真实图片、完整识别输出和截图证据见 [R21 验收记录](r21-multimodal-vision-2026-08-24.md)。

2026-08-31 的取消协调、健康拆分、Provider 诊断、172/115 单测、无重试 18/18 Mock 和全量真实接口证据见 [P1 工程可靠性优化验收记录](engineering-hardening-2026-08-31.md)；Docker 在该轮明确未执行。
