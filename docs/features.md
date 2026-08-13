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

- DeepSeek V4 Flash 与 DeepSeek V4 Pro；当前 `deepseek-v4-pro` 别名对应 DeepSeek-V4-Pro-0813。
- OpenAI Responses 模型目录。
- 按模型能力显示和发送 temperature、max tokens、reasoning enabled/effort。
- 每个会话保存独立的 provider、model、reasoning、temperature 和 max tokens；刷新、切换、清空、分支和重启后恢复，失效模型安全回退。
- 运行时目录异常或为空时使用安全的 DeepSeek fallback，不崩溃。
- 流式正文、reasoning、耗时、停止、错误和后续恢复；DeepSeek/OpenAI 完成事件缺失时不发送成功 `done` 且不落库。
- 同一会话禁止并发 ask；客户端快速连续提交只发出一次。
- 成功或确认停止后回拉服务端详情；只有已保存消息可编辑或重新生成。

## 工具

- 和风天气：城市、今天/明天/后天或 ISO 日期。
- 当前时间：可选 IANA timezone。
- 计算器：安全语法解析，不使用 `eval`。
- tool_start/tool_result 状态流式展示；失败不会把整次请求变成未处理 500。

## 上下文

- 最近历史消息数和字符预算。
- 当前问题不计入历史预算且始终完整保留。
- 手动生成/重新生成会话摘要。
- 摘要生成期间会话发生变化时拒绝写入陈旧摘要。
- 摘要参与上下文后只发送其覆盖边界之后的原始消息；导入和存储中的越界计数会安全截断。
- 摘要只增量处理覆盖边界后的新增消息，单次输入受字符预算限制；没有新增消息时不调用模型。
- 上下文预览显示实际 prompt、摘要覆盖数、摘要后消息数、最终选择范围、模型能力和工具数量，不泄漏凭据。

## 导入导出

- 单会话 Markdown 导出。
- 全量 JSON schema v1 备份。
- 导入前完整校验；支持 skip、duplicate、overwrite。
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

- `pnpm run build` 完成静态检查并生成 React `client/dist`。
- Express 同源托管前端与 `/api/*`，支持 SPA HTML GET 回退。
- Node HTTPS 直接读取可配置证书/私钥；校验证书有效期与密钥匹配。
- 缺少前端构建或 TLS 配置非法时 fail-fast。
- `index.html` 禁止缓存，hash assets 使用长期 immutable cache。
- 基础安全响应头：禁用框架标识、`nosniff`、禁止 frame、同源 referrer；HTTPS 响应包含 HSTS。
- Docker 单容器部署：Node 直接提供 HTTPS、React 和 `/api/*`，环境变量运行时注入、TLS 只读挂载、会话数据卷持久化。
- `/api/health` 探测当前 file conversations 目录或 SQLite 数据库的真实读写能力。

## 明确不包含

- 登录、权限、多用户隔离。
- 管理后台、计费和商业化。
- 登录、限流、WAF、集中日志、自动证书续期等公共互联网平台能力；当前 HTTPS 交付面向个人/内网部署。
- 多租户模型网关、复杂 observability 或通用 Agent 平台。
- 语音输入当前仅为不可用占位，不视为已交付功能。
