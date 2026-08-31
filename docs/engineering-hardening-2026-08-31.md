# P1 工程可靠性优化验收记录

日期：2026-08-31

状态：三个 P1 优化项的实现与非 Docker 验收完成。Docker 运行验证按用户最新要求暂缓；本文不把 Docker 脚本覆盖写成容器验收证据。

## 落地范围

### 取消完成与立即重试

- React 以 `requestId -> Promise<boolean>` 记录进行中的取消请求，同一请求只发送一次 cancel API。
- 手动停止和超时都会先启动服务端取消；当前会话保持发送互斥，直到 cancel API 确认 ask 已完成清理，再释放本地请求锁。
- 超时仍会立即中止浏览器 fetch，避免继续读取无效流；UI 解锁不再依赖固定 500ms 猜测窗口。
- 服务端测试验证 cancel endpoint 返回前已释放会话占用，随后使用新 `requestId` 立即重试不会遇到短暂 409。

### Liveness 与 Readiness

- 新增公开 `GET /api/health/live`：只表示 Node 进程仍可处理请求，不执行配置、文件或 SQLite 写探针。
- 新增公开 `GET /api/health/ready`：校验运行配置、当前会话 store 读写能力和启用时的认证 Session Store。
- 保留 `GET /api/health` 作为 readiness 兼容入口，避免已有脚本和局域网部署命令立即失效。
- Compose healthcheck 已切换为轻量 liveness；发布前、切换数据卷后和人工诊断应使用 readiness。

### Provider 非 2xx 诊断

- 非 2xx 响应只读取最多 4 KiB，并优先从结构化 JSON 提取 `error.message`、`message`、`error.code`、`code`、`error.type` 和 `type`。
- 日志在写入前脱敏 Bearer/JWT、`sk-`/`ds-` 类密钥、Cookie、密码和查询参数凭据；不记录完整 Prompt、请求 body 或原始响应 body。
- 日志包含内部 correlation id 和 Provider 返回的安全 request id；客户端只收到 HTTP 状态与可用于定位日志的内部 reference。
- 读取达到 4 KiB 上限时主动取消响应 reader，避免继续消费超大错误体。

### 回归脚本维护

- CDP 流式恢复场景新增“取消确认未完成时发送保持禁用，确认后立即重试成功”的浏览器断言。
- OpenAI 与模型参数真实脚本改为等待目标会话按钮可用并完成切换；首次全量真实运行暴露的是启动自动选中期间的测试同步竞态，不是模型接口失败。修复后专项及全量真实套件均通过。
- Docker smoke 与 Docker UI 脚本已扩展图片附件、请求重放、备份恢复及受保护预览场景，但本轮没有启动 Docker Desktop、构建镜像、创建容器或操作 Volume。

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:unit` | server 172/172；client 115/115 |
| `pnpm run build` | 通过 |
| `CDP_SCREENSHOTS=0 CDP_SCRIPT_RETRIES=0 pnpm run test:cdp:all-mock` | 18/18 脚本无重试通过 |
| `CDP_SCREENSHOTS=0 CDP_REAL_SCRIPT_RETRIES=0 pnpm run test:cdp:real-openai` | 通过 |
| `CDP_SCREENSHOTS=0 CDP_REAL_SCRIPT_RETRIES=0 pnpm run test:cdp:all-real` | 基础 4 个脚本、8 组模型参数和 Vision 全部通过 |
| Docker 容器、页面、镜像与 Volume | 按用户要求未执行，不构成本轮证据 |

真实 runner 使用随机端口、临时 file store、临时认证 Session DB 和自动清理的测试会话。未请求截图，因此本轮设置 `CDP_SCREENSHOTS=0`。机器可读结果位于 `.tmp/cdp-results/`，不进入源码提交。

## 兼容与回滚

- 本轮不修改 NDJSON v2、会话消息 schema、SQLite 会话表或导入导出版本。
- `/api/health` 保持兼容；新监控可逐步切换到 `/live` 与 `/ready`。
- Provider 诊断只改变非 2xx 的内部日志和对外错误详情，不改变成功请求、SSE 解析或模型请求形状。
- 若取消协调出现异常，可回滚客户端 Promise 协调代码；不得通过清空会话数据库、附件目录或 Docker Volume 回滚。

## 暂缓项

- 后续恢复 Docker 验证时，再执行 `pnpm run test:docker` 与按需的 `pnpm run test:cdp:docker-ui`，验证 liveness、readiness、附件新 Volume 恢复、requestId 跨重启重放和源 Volume 不变。
- 在该门禁实际执行前，只能表述为“Docker 脚本已具备覆盖”，不能表述为“当前镜像或 Volume 已通过本轮验证”。
