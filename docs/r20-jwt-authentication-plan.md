# R20 JWT 单用户认证方案

状态：2026-08-19 完成并验证；静态、单元、构建、审计、全量 mock、真实 Provider 全量和 Docker 门禁均通过。

本文定义个人学习和局域网内部使用场景下的单用户认证边界。JWT 是访问令牌格式，不等同于完整认证系统；本阶段同时覆盖凭据校验、令牌生命周期、Cookie 安全、撤销、限速、前端恢复和部署配置。

## 直接价值

- 阻止同一局域网中的未授权设备直接读取、导出、修改或删除会话，以及消耗已配置的模型 API。
- 学习密码哈希、JWT、Refresh Token 轮换、CSRF/XSS 边界、Session 撤销和前后端 401 恢复，而不扩展为多用户产品。
- 保持现有单 Node HTTPS、React SPA、NDJSON v2、file/SQLite 会话存储和 Docker Volume 架构。

## 范围

- 单个固定用户，用户名和密码哈希由服务端环境变量配置。
- 短期 JWT Access Token 用于 `Authorization: Bearer` 鉴权。
- 长期 JWT Refresh Token 只保存在 `HttpOnly` Cookie 中，并执行轮换、重放检测和服务端撤销。
- 登录、刷新、退出、启动恢复、过期恢复、失败限速和跨标签页退出同步。
- 除健康检查和认证入口外，保护全部 `/api/*`。

## 非目标

- 注册、邀请、找回密码、邮箱或短信验证码。
- OAuth、OIDC、第三方登录和设备授权流程。
- 多用户数据隔离、用户表、角色、RBAC、管理员后台和审计平台。
- 面向公网的 WAF、分布式限流、集中身份平台和多实例 Session 共享。

## 选定架构

### 令牌模型

- Access Token：JWT，默认 15 分钟有效；登录或刷新接口通过 JSON 返回，React 只保存在内存，不写入 `localStorage`、`sessionStorage`、IndexedDB、日志或导出文件。
- Refresh Token：JWT，默认 7 天有效；仅通过名为 `chatbot_refresh` 的 `HttpOnly` Cookie 传输，不暴露给 JavaScript。
- Refresh Cookie：生产环境固定 `Secure`、`SameSite=Strict`、`Path=/api/auth`；开发环境只有在非 production 且显式配置时允许关闭 `Secure`。
- 签名算法固定为 `HS256`，Access/Refresh 使用不同的至少 32 字节随机 secret；验证时固定算法、issuer、audience 和 token type，拒绝算法降级。
- Access claims 至少包含 `sub`、`sid`、`jti`、`iss`、`aud`、`iat`、`exp` 和 `token_use=access`。
- Refresh claims 至少包含 `sub`、`sid`、`family_id`、`jti`、`iss`、`aud`、`iat`、`exp` 和 `token_use=refresh`。

### Refresh Session 与撤销

- 新增独立认证 Session Store，默认使用 `/app/data/auth-sessions.sqlite3`，不混入会话消息表，也不受 `CONVERSATION_STORE=file|sqlite` 切换影响。
- 认证库只保存 refresh `jti` 摘要、session/family ID、固定用户 subject、签发与过期时间、轮换目标和撤销时间；不保存密码、完整 JWT、API key、客户端画像或聊天内容。
- 每次刷新都让旧 refresh `jti` 失效并签发新 token；旧 token 再次出现时撤销整个 token family，要求重新登录。
- 退出登录撤销当前 family 并清除 Cookie。受保护请求除验证 JWT 外还检查 `sid` 的服务端活性，因此对应 Access Token 在 logout、重放撤销或运维撤销后立即被拒绝；浏览器同时通过退出广播清除各标签页内存令牌。
- Docker Volume 备份会包含认证 Session Store。迁移到其他机器或恢复旧备份后必须轮换 Refresh secret 或执行“撤销全部 Session”，避免恢复历史登录状态。

### 密码与配置

- 密码只以 Argon2id 哈希形式保存在 `server/.env`，不存明文，也不进入镜像、Volume、日志和 Git。
- 提供本地 CLI 生成密码哈希；CLI 只输出哈希，不写入 `.env`。
- `AUTH_ENABLED=true` 时缺少用户名、密码哈希或任一 JWT secret 必须启动失败；`AUTH_ENABLED=false` 保留兼容和紧急回退能力，但部署文档必须明确这会重新开放局域网访问。
- 建议配置：

```text
AUTH_ENABLED=true
AUTH_USERNAME=local-user
AUTH_PASSWORD_HASH=<argon2id hash>
AUTH_ACCESS_TOKEN_SECRET=<random secret>
AUTH_REFRESH_TOKEN_SECRET=<different random secret>
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_SECONDS=604800
AUTH_COOKIE_SECURE=true
```

### 依赖选择

- `jose`：签发和验证 JWT，固定算法和标准 claims。
- `argon2`：Argon2id 密码哈希与校验；实施前验证 Node 22、macOS ARM64 和 Debian slim ARM64/AMD64 安装兼容性。
- `cookie-parser`：读取 Refresh Cookie。
- `express-rate-limit`：限制登录失败和刷新滥用；当前单实例使用内存计数，不声称支持分布式一致性。

实际锁定版本为 `jose@6.2.9`、`argon2@0.45.1` 和
`express-rate-limit@8.6.2`；`cookie-parser@1.4.7` 继续复用既有依赖。Argon2
原生构建通过根 pnpm allowBuilds 显式允许，其他未授权 lifecycle script 保持禁用。

依赖版本必须由根 pnpm workspace 和唯一 lockfile 管理，并通过 production dependency audit 与 Docker 构建。

## HTTP 契约

| 方法与路径 | 认证 | 行为 |
| --- | --- | --- |
| `GET /api/auth/status` | 无 | 只返回认证开关，用于新旧后端兼容与前端启动门禁 |
| `POST /api/auth/login` | 无 | 校验用户名/密码，创建 family，返回 Access Token 并设置 Refresh Cookie |
| `POST /api/auth/refresh` | Refresh Cookie | 校验、轮换 Refresh Token，返回新 Access Token |
| `POST /api/auth/logout` | Refresh Cookie | 撤销当前 family，清除 Refresh Cookie；重复调用保持幂等 |
| `GET /api/health` | 无 | 保留 Docker 健康检查，不返回认证配置、用户名或 Session 信息 |
| 其他 `/api/*` | Bearer Access Token | 验证签名、claims、过期时间和 token type 后进入现有路由 |

- 登录失败统一返回通用 `401`，不暴露用户名是否存在；达到限制返回 `429` 和稳定的重试时间。
- Access Token 缺失、过期、签名错误或 claims 错误统一返回结构化 `401`；权限模型未引入，因此不伪造 `403` 语义。
- Refresh 和 logout 依赖 Cookie，必须校验同源 `Origin`；Access Token 放在 Authorization Header 中，不依赖跨站 Cookie。
- 认证错误不得进入 NDJSON 流。ask 在建立流之前完成鉴权；流建立后 Access Token 到期不强制中断当前回答。

## 前端状态设计

- 应用启动先进入认证恢复态，通过 Refresh Cookie 换取内存 Access Token；成功后才请求 runtime config 和会话列表。
- 未登录只显示实际登录界面，不挂载聊天数据 hooks，不预取受保护 API。
- 登录按钮在请求期间禁用并显示等待状态，快速点击只产生一个登录请求。
- 所有 API 请求统一附带内存 Access Token；接近过期时提前刷新，多个并发请求共用一个 refresh promise。
- 收到认证 `401` 时最多刷新并重放一次；刷新失败清空认证和聊天页面状态并回到登录页，不进入无限重试。
- ask 重放必须复用原 requestId，且只在服务端认证中间件明确拒绝、业务控制器尚未执行时允许；NDJSON 已开始后不自动重发。
- 使用 `BroadcastChannel` 或等价浏览器事件同步退出，清除其他标签页的内存 Access Token。
- 登录页覆盖加载、错误、限速、Session 过期和服务不可用状态；密码输入不回显、不持久化。

## 安全边界

- 生产认证只允许在 HTTPS 下启用；HTTP production 配置必须启动失败。
- 所有密码和令牌比较使用依赖提供的安全实现，不手写 JWT 解析或密码哈希算法。
- 日志仅记录 requestId、结果类别、限速状态和非敏感 Session ID 摘要，不记录 Authorization、Cookie、密码、JWT payload 或完整 IP 组合画像。
- 保留现有 Markdown 净化和禁止原始 HTML/图片边界，降低持久化 XSS 获取内存 Access Token 的风险。
- Refresh Cookie 的 CSRF 防护由 `SameSite=Strict`、限定 Path 和同源 Origin 校验共同承担，不能只依赖其中一项。

## 存储与部署影响

- 会话 file/SQLite schema、导入导出 schema v1、NDJSON v2 和 Provider adapters 不变。
- `/app/data/auth-sessions.sqlite3` 进入既有 Docker Volume 和完整卷备份；恢复验证需要同时检查认证库可打开，但不得在健康响应中暴露路径或 Session 数。
- `server/.env` 增加认证配置，继续由宿主机手动维护，不进入镜像和备份。
- TLS 挂载、端口和局域网地址不变。部署顺序增加密码哈希生成、两个 JWT secret 生成、认证配置校验和未登录访问验收。

## 测试矩阵

### 单元与服务端

- 正确/错误密码、损坏 Argon2id 哈希、低于 `m=19456,t=2,p=1` 的参数、短于 16 bytes 的 salt、短于 32 bytes 的摘要、缺失配置和 production 非 HTTPS fail-fast。
- Access/Refresh 正常签发；过期、篡改、错误算法、错误 issuer/audience/type、secret 混用全部拒绝。
- Refresh 单次轮换、并发刷新、旧 token 重放导致 family 撤销、logout 幂等和全部 Session 撤销。
- 登录限速达到阈值、`Retry-After`、窗口恢复和不同测试主体隔离。
- 未认证访问所有受保护 API 返回 JSON `401`；`/api/health` 保持可用且无敏感信息。
- Access Token 到期前建立的 NDJSON 流正常完成；到期后的新请求必须刷新或返回 `401`。

### 前端与 CDP

- 初次登录、错误密码、限速、刷新恢复、刷新失败、退出和刷新页面恢复。
- 登录/刷新/退出按钮防重复点击；并发 API 只触发一次刷新。
- 未登录不加载会话；Session 过期后清理聊天状态并回登录页；重新登录后恢复持久化会话。
- 普通聊天、停止、摘要、上下文预览、搜索、导入导出和模型配置在认证开启后保持原语义。
- Cookie 属性、Access Token 不进入 Web Storage、页面 DOM、下载文件或日志。
- 默认使用 mock Provider，不调用真实模型、不生成截图；认证实现不要求真实 Provider 门禁。

### Docker

- 缺失认证 secret 时 fail-fast，完整配置后容器 healthy。
- 未登录 API 拒绝、登录成功、刷新轮换、容器重启后的 Session Store 可用、退出撤销和 Volume 备份恢复均有断言。
- 验证新增依赖没有破坏非 root Node 进程、ARM64/AMD64 构建和运行镜像体积门禁。

## 验收标准

- 未登录设备无法读取或修改会话，也不能调用 Provider；健康检查仍可用。
- 浏览器存储和日志中不存在 Access/Refresh Token、密码或认证 secret。
- JWT 验证固定算法和标准 claims；Refresh 轮换、重放检测、撤销和限速均有自动化证据。
- 登录、刷新和退出的 UI 异步状态完整，快速点击与并发刷新不会重复提交。
- 现有 check、unit、build、全量 mock、受影响 UI CDP、Docker smoke 和 production audit 全部通过。
- 文档、`.env.example`、部署手册、架构、功能清单和回归用例同步更新后，才能把 R20 标记为完成。

## 实施顺序

1. 配置、Argon2id CLI、JWT claims 与认证 Session Store。
2. 登录/刷新/退出控制器、限速、Origin 校验和统一鉴权中间件。
3. React 认证状态、登录界面、单飞刷新和 401 恢复。
4. 单元、API、CDP、Docker、备份恢复和依赖审计。
5. 更新部署配置并在现有局域网环境显式启用认证。

## 已实施模块

- 服务端：`authConfig`、Argon2id/JWT/Origin 安全模块、独立 Session SQLite、认证 service/controller/middleware/routes、限速和 health/shutdown 集成。
- 前端：`AuthGate`、登录页、内存 Token `AuthClient`、Web Locks/BroadcastChannel 协调、统一 `apiFetch`、桌面与移动注销入口。
- 运维：密码哈希、随机 secret、撤销全部 Session CLI；production 缺失认证配置、非 HTTPS 或非 Secure Cookie 均 fail-fast。
- 测试：Node 配置/JWT/Session/API 用例、Vitest 客户端并发刷新用例、认证专项 CDP、全量 mock 兼容、认证开启的 Docker 与真实 Provider runner。

## 2026-08-19 验证记录

- `pnpm run test:unit`：服务端 134/134、客户端 102/102。
- `pnpm run check`：server/client typecheck 与客户端标准/类型感知 lint 通过。
- `pnpm run build`：React production build 通过，共转换 2170 个模块。
- `pnpm run audit:production`：无已知漏洞。
- `pnpm run test:cdp:authentication`：未登录门禁、限速反馈、内存 Token、并发 401 单次刷新/重放和注销通过。
- `pnpm run test:cdp:all-mock`：17 组场景全部通过。
- `pnpm run test:cdp:all-real`：认证开启下 DeepSeek 主链/上下文/Markdown、OpenAI Responses，以及 DeepSeek Flash/Pro 与 Off/Low/Medium/High 共 8 组参数矩阵全部通过；测试会话均已清理，未截图。
- `pnpm run test:docker`：通过。最新镜像为 252,725,252 bytes（低于 300MB），且不含 pnpm/Corepack 缓存；认证 fail-fast、HTTPS Secure Cookie、API 保护、Session 跨重启与新卷恢复、logout 撤销、SQLite、备份恢复、非 root 进程和优雅停机均通过。隔离测试容器、卷和网络已清理。

## 回滚

- 代码回滚使用上一可用镜像并复用原会话 Volume；新增认证库是独立文件，旧版本会忽略它。
- 紧急情况下可设置 `AUTH_ENABLED=false`，但这会恢复未认证局域网访问，只能作为临时回退并在验收记录中明确风险。
- 认证异常优先撤销全部 Session 或轮换 Refresh secret，不修改、清空或迁移聊天会话数据。
