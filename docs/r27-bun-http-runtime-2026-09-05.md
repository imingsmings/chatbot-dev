# R27 Bun 原生 HTTP 运行时验收记录

日期：2026-09-05

## 结论

R27 已在非 Docker 范围完成。`bun-server/` 的 HTTP/HTTPS、路由、multipart、静态文件和 NDJSON 输出已从 Express/Node 兼容边界迁移到 Bun 原生能力；现有 API、环境变量、认证、持久化格式、Provider 请求和 NDJSON v2 协议保持兼容。

Node `server/`、默认 `start:production` 和 Docker 链路继续保留，分别作为 R28 删除前的对照/回滚基线，以及 R29 的独立部署迁移范围。本次未调用真实 Provider，也未运行 Docker。

## 实现范围

### HTTP 与路由

- `bun-server/bin/www.ts` 通过 `Bun.serve` 启动 HTTP、HTTPS 或 Unix socket，并保留既有 HOST/PORT/TLS 环境配置、启动级清理和 SIGINT/SIGTERM 优雅停止。
- `bun-server/http/router.ts` 提供有顺序的路由匹配、中间件链、路径参数、查询参数，以及有界 JSON、urlencoded、ZIP 和 multipart 请求体入口。
- `bun-server/http/types.ts` 为现有控制器提供最小请求/响应适配，包括状态码、响应头、Cookie、JSON/二进制响应、关闭通知和 Web Response 转换。
- `bun-server/app.ts` 继续区分公开健康/认证入口与受保护 API，保留安全头、JSON 404、错误映射和开发兼容路由。

### 静态文件与 multipart

- 生产静态托管使用 `Bun.file`，保留缺失构建 fail-fast、HTML `no-cache`、哈希资源 immutable 缓存、SPA 回退和 `/api/*` 隔离。
- 图片上传使用有界 `Request.formData()` 解析；仍要求单张图片、校验字段和 detail、限制正文与文件大小，并保持 400/413/499 错误语义。
- Bun workspace 已删除 Express、Busboy、cookie-parser、morgan、http-errors、express-rate-limit、debug 及对应类型依赖；Node workspace 不在本阶段修改。

### 流式背压与取消

- NDJSON v2 输出改为 `TransformStream`；写入先等待 writer 可写，再等待实际写入完成。
- delta、reasoning、工具事件、done/error 的异步回调贯穿 Provider SSE reader，慢下游会约束继续读取上游的速度。
- 客户端断开、手动停止和异常关闭仍触发上游 AbortSignal、请求完成协调与持久化终态收敛；后续请求恢复语义不变。

### 测试运行时

- Bun API 测试 helper 改为真实 `Bun.serve`，不再用 Node `http.createServer` 承载 Bun 应用。
- 新增真实 HTTPS 运行时门禁：临时生成自签名证书，验证 JSON、安全头、运行时 SQLite、SIGTERM 退出码和临时文件清理。
- 工具链守卫新增 Bun 源码/依赖扫描，拒绝 `node:http`、`node:https`、Express、Busboy 和已移除兼容依赖。

## 兼容与回滚边界

- 不改变 API 路径、请求/响应数据、认证 Cookie/JWT 语义、file/SQLite schema、附件 sidecar 或 NDJSON v2 事件。
- R26 的 Node → Bun → Node 同库门禁继续通过，因此运行时回滚不需要数据库迁移。
- 若 Bun HTTP 边界出现回归，可继续使用现有 Node `server/`；不得通过删除或重建数据目录回滚。
- 两个后端并行时仍必须使用不同端口和数据目录，不得同时写同一 file store 或 SQLite 数据库。

## 验收证据

| 门禁 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 通过；锁文件一致，486 installs / 572 packages，无变更 |
| `bun run check` | 通过；Node/Bun/React TypeScript 与 Oxlint 通过 |
| `bun run test:server` | 通过；177/177 |
| `bun run test:bun-server` | 通过；45 个文件，175/175 |
| `bun run test:client` | 通过；27 个文件，119/119 |
| `bun run test:toolchain` | 通过；5/5，包括 Bun 原生 HTTP/SQLite 依赖与导入守卫 |
| `bun run test:backend-parity` | 通过；file/SQLite API、流事件和重启持久化对照一致 |
| `bun run test:sqlite-runtime-compatibility` | 通过；Node → Bun → Node 同库读取/更新兼容，Provider 不重放 |
| `bun run test:bun-http-runtime` | 通过；真实 Bun HTTPS、HSTS、nosniff、SQLite 与 SIGTERM 优雅退出 |
| `bun run build:client` | 通过；Vite 8.2.0，2173 modules transformed |
| `bun run audit:production` | 通过；519 packages，high/critical 为 0，低于 high 的已知项为 2 |
| `CDP_SCREENSHOTS=0 CDP_SCRIPT_RETRIES=0 bun run test:cdp:all-mock:bun` | 通过；无重试 18/18，本地 Mock Provider，无截图 |

全量 Mock 首次运行在 `upstream-abort` 的“新建会话后取消”准备阶段失败：测试观察器可能晚于前端创建空会话，因而没有记录新 ID。修复为在观察器无结果时从后端回查本次最新空会话，再执行原有取消、上游关闭、持久化和恢复断言；聚焦 4 个取消场景及完整 18/18 套件随后均通过，没有降低业务断言。

## 未执行与后续阶段

- 未调用 DeepSeek/OpenAI 真实 Provider。R27 未改变 Provider body 或 SSE 事件形状，真实功能证据沿用 R24；若后续修改 Provider 适配器，再单独授权运行付费门禁。
- 未运行 Docker，也未切换默认生产入口。R29 需要重新验证 Bun 镜像、TLS、非 root、健康检查、附件、Volume 备份恢复、SIGTERM 和镜像边界。
- R28 的候选范围是删除 Node 后端、Node 测试副本和 Node/Bun parity，只保留单一 Bun 业务实现；该阶段仍需单独实施授权。
