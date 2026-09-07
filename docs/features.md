# 功能清单

本文是当前产品能力的验收边界，不是未来需求池。

## 会话

- 新建、切换、重命名、清空、删除。
- 首条用户消息自动生成标题；手工标题不再被自动覆盖。
- 删除当前会话后选择下一会话；若下一会话加载失败，不保留已删除详情。
- 刷新后恢复持久化会话，不持久化未发送草稿。
- 标题与消息正文搜索；旧请求不会覆盖新搜索结果。
- 编辑已保存的历史用户消息会创建独立分支并重新回答；已完成或有正文的 stopped 回答可从对应问题重新生成。
- 分支只复制目标用户消息之前的历史，不继承摘要或改写父会话；分支本身仍是普通可搜索、导出和删除的会话。

## 模型与生成

- 服务端 model catalog 是模型 ID、正式标签、Provider 默认值、能力和禁用状态的唯一事实源；当前包含 DeepSeek V4 Flash、DeepSeek V4 Pro、实验性的 DeepSeek V4 Flash Vision Exp 与 OpenAI Responses 模型。具体别名解析由上游控制，项目不把它固定解释为某个日期快照。
- 按模型能力显示和发送 temperature、max tokens、reasoning enabled/effort；不向不支持该参数的模型发送无效字段。
- DeepSeek thinking 模式下 temperature 不生效；接受的 effort 为 `low/high/max`，兼容选项 `medium` 会映射为 `high`。UI 保留这些选项以维持跨 Provider 的统一配置形状。
- 每个会话保存独立的 provider、model、reasoning、temperature 和 max tokens；刷新、切换、清空、分支和重启后恢复，失效模型安全回退。
- React 只消费 `/api/runtime-config` 下发的目录，不内置模型列表、能力上限或禁用状态；运行时目录异常或为空时进入不可发送的安全状态，但仍可浏览会话和编辑未发送草稿，刷新后可恢复。
- 流式正文、reasoning、耗时、停止、错误和后续恢复；DeepSeek/OpenAI 完成事件缺失时不发送成功 `done` 且不落库。
- 同一会话禁止并发 ask；客户端快速连续提交只发出一次。
- ask 的 `requestId`、会话绑定、请求指纹和 `processing/completed/stopped/failed` 状态随会话持久化；并发、顺序重放和存储重开后重放不会追加第二组消息。
- 流异常结束时前端先查询受认证保护的请求结果；服务端已保存答案但浏览器未收到 `done` 时回拉原回答，重启遗留的 `processing` 收敛为 `failed`。
- 手动停止或超时后，当前会话保持发送互斥直到服务端取消完成；确认释放后可立即重试，不经过固定猜测等待窗口。
- 成功或确认停止后回拉服务端详情；只有已保存消息可编辑或重新生成。
- Provider 非 2xx 响应使用最多 4 KiB 的结构化、脱敏诊断；客户端获得 correlation reference，日志不包含完整 Prompt、Cookie、Token 或 API key。

### 图片附件与 Vision

- Vision 模型同时支持纯文本、文本加图片和仅图片；纯文本继续使用字符串 `content`，含图片时才构造 Provider content blocks。
- 支持选择、粘贴和拖放 JPEG/PNG/WebP；单图最多 6 MiB、单边最多 4096px、单条最多 4 张，并按实际字节而不是扩展名识别格式。
- 原图保存在数据目录 `attachments/`，会话只保存元数据与引用；Provider 调用时临时读取为 Base64 Data URL，不持久化 Base64、不接受外部图片 URL。
- 上传、失败重试、删除、受保护缩略图/预览、刷新、停止、重新生成和历史分支均保留一致附件状态；不支持图片的模型会阻止发送并明确提示。
- 图片数量/字节护栏继续限制历史选择；图片 token 估算同时进入统一模型上下文预算，当前图片优先且不会被静默裁剪。分支复制为独立附件 ID 且不修改父会话。

## 工具

- 和风天气：城市、今天/明天/后天或 ISO 日期。
- 当前时间：可选 IANA timezone。
- 计算器：安全语法解析，不使用 `eval`。
- tool_start/tool_result 状态流式展示；失败不会把整次请求变成未处理 500。

## 上下文

- Provider-aware 保守估算把 system、摘要、历史、当前问题、图片、工具定义、请求 framing、工具续调预留和输出预留纳入同一模型上下文预算。
- 本地模型目录给出上下文上限，`DEEPSEEK_CONTEXT_WINDOW_TOKENS` / `OPENAI_CONTEXT_WINDOW_TOKENS` 可覆盖兼容 endpoint 的实际限制；消息数和字符预算保留为二级护栏。
- 预算不足时依次移除较早历史图片、摘要正文和最旧历史消息；当前问题与当前图片不静默裁剪，固定输入仍超限时在调用 Provider 前返回明确错误。
- 手动生成/重新生成会话摘要。
- 摘要生成期间会话发生变化时拒绝写入陈旧摘要。
- 摘要参与上下文后只发送其覆盖边界之后的原始消息；即使摘要因 token 预算被移除也不会重新打开已覆盖历史，导入和存储中的越界计数会安全截断。
- 摘要只增量处理覆盖边界后的新增消息，单次输入受字符预算限制；没有新增消息时不调用模型。
- 工具第一阶段完成后，以实际 tool calls、reasoning 和 tool results 替换续调预留并在第二次 Provider 调用前重新检查上限。
- 上下文预览显示实际 prompt、上下文上限、输入/输出/总估算、剩余空间、各组成项、摘要与历史裁剪原因、模型能力和工具数量，不泄漏凭据。估算用于保守预检，不宣称等同 Provider 精确 tokenizer 用量。

## 导入导出

- 单会话 Markdown 导出。
- 全量 schema v2 ZIP 便携备份，包含 `manifest.json` 与附件二进制；保留 schema v1 JSON 导出 API和导入兼容。
- JSON/ZIP 导入采用完整预检、暂存和整批提交；支持 skip、duplicate、overwrite，ZIP 同时校验路径、绑定、大小和 SHA-256，任一会话失败会回滚本批会话、覆盖目标和新附件。
- file/SQLite、schema v1 备份和 duplicate/overwrite/skip 导入均保留合法的会话模型配置、reasoning 和 summary。
- 自动化使用临时数据目录，不删除用户已有会话。

## Markdown 与交互

- 标题、列表、引用、表格、链接和 fenced code。
- DOMPurify 净化；禁用原始 HTML 与图片；外链 `noopener noreferrer nofollow`。
- 流式文本有界合并、短/长 Markdown 分档刷新、完成态按需高亮、代码复制。
- 明暗主题、桌面与 390px 布局。
- 用户离开底部时不强拉并显示“滚动到底部”按钮；点击后立即到底并恢复后续流式跟随。
- 处于底部时正文、reasoning 和增长中的代码块持续跟随；长历史行不会因当前回答更新而重复渲染。
- 图标统一使用 Lucide React；交互基于 shadcn/ui Base UI。

## 本地配置与资料

### 单用户认证

- production 默认启用认证；固定用户名、Argon2id 密码哈希和两个 JWT secret 只从服务端环境变量读取。
- 未登录时不挂载聊天应用，也不请求 runtime、会话或 Provider；`/api/health/live`、`/api/health/ready`、兼容 `/api/health` 和认证入口保持公开。
- Access Token 默认 15 分钟，只保存在 React 内存并通过 Bearer Header 发送，不进入 Web Storage、DOM 或导出。
- Refresh Token 默认 7 天，只存在 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/api/auth` Cookie；每次使用都会轮换。
- Refresh Token 重放会撤销整个 Session family；logout 和运维撤销会立即使对应 Access Session 失效。
- 登录失败使用统一错误并按 IP + 用户名摘要限速；刷新/退出校验 Origin，生产认证要求 HTTPS。
- 认证 Session 使用独立 SQLite WAL 文件，随 `/app/data` Volume 备份恢复；图片附件同样位于该数据根目录，便携备份另使用 schema v2 ZIP。

### Prompt 模板

- 保留 6 个只读内置模板；自定义模板支持新增、编辑、二次确认删除和直接填入输入框。
- 模板内容使用 `{变量名}` 声明变量，支持中文、字母、数字、下划线和连字符；独占一行的变量自动使用多行输入。
- 自定义模板使用 versioned JSON 保存在当前浏览器 `localStorage`，不会写入会话、file/SQLite、Docker Volume 或 Provider 请求。
- JSON 导出只包含自定义模板；导入前校验版本、数量、ID、名称、内容和变量上限。
- 导入不静默覆盖本地模板：完全相同的模板跳过，ID 冲突但内容不同的数据生成新 ID 后作为副本导入。
- 单模板名称最多 80 字符、内容最多 20000 字符、变量最多 20 个；最多保存 100 个自定义模板，导入文件最多 3 MB。

### 运行配置与存储

- 侧栏姓名和头像由 `/api/runtime-config` 下发，通过 `APP_PROFILE_NAME`、`APP_PROFILE_AVATAR_URL` 配置。
- API key 仅在服务端环境变量中；运行时接口只返回配置状态。
- file 或 SQLite 存储可配置，默认使用本地 SQLite WAL。

## 生产运行

- `bun run build` 完成静态检查并生成 React `client/dist`。
- `bun-server/` 是唯一后端，通过 Bun 1.4 `Bun.serve` 提供 API、认证、存储和 NDJSON v2 协议。
- `Bun.file` 同源托管前端与 `/api/*`，支持 SPA HTML GET 回退。
- Bun HTTPS 直接读取可配置证书/私钥；校验证书有效期与密钥匹配。
- 缺少前端构建或 TLS 配置非法时 fail-fast。
- `index.html` 禁止缓存，hash assets 使用长期 immutable cache。
- 基础安全响应头：禁用框架标识、`nosniff`、禁止 frame、同源 referrer；HTTPS 响应包含 HSTS。
- `start:production` 已使用 Bun；`bun.lock` 是安装、构建和测试的权威锁文件。
- Dockerfile/Compose 使用固定 Bun 1.4.0 slim 镜像、`bun.lock` 与仅后端 production 依赖；容器主进程以非 root `bun` 用户运行。
- Docker 保留 TLS 只读挂载、`/app/data` Volume、liveness/readiness、整卷校验备份和新 Volume 恢复，并由本地 Mock 容器回归覆盖。
- `/api/health/live` 只检查进程可响应；`/api/health/ready` 与兼容 `/api/health` 探测运行配置、当前 file/SQLite 会话 store，以及启用时的认证 Session Store 真实读写能力。

## 明确不包含

- 注册、找回密码、角色权限和多用户隔离。
- 管理后台、计费和商业化。
- WAF、分布式限流、集中日志、自动证书续期等公共互联网平台能力；当前 HTTPS 与单用户认证仍面向个人/内网部署。
- 多租户模型网关、复杂 observability 或通用 Agent 平台。
- 语音输入当前仅为不可用占位，不视为已交付功能。
