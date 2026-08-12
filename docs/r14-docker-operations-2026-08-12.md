# R14 Docker 运维验收记录

日期：2026-08-12（Asia/Shanghai）

## 结论

R14 已完成并通过验收。Docker 服务现在具备停止后完整 `/app/data` volume 备份、带双层 SHA-256 的新 volume 恢复、显式数据卷切换、宿主机 TLS 源路径覆盖和独立存储感知健康检查。原 volume 始终作为未修改的回滚点；工具不会自动复制 `.env`、API key、TLS 私钥或 mkcert 根 CA 私钥。

## 交付边界

### 备份与恢复

- `docker:backup` 拒绝仍被运行中容器挂载的 volume，以只读方式读取完整数据目录并生成 tar。
- manifest 保存 archive SHA-256、稳定数据树 SHA-256、逐文件大小/SHA-256 和条目清单，因此 SQLite 主文件及当时存在的 WAL/SHM sidecar 都位于同一备份边界。
- 打包前后重复检查运行容器并复算源数据树，变化时删除本轮不完整产物并失败。
- `docker:restore` 在创建 volume 前验证 archive；已存在目标名直接拒绝。
- 新 volume 带本次恢复唯一标签，解包前反查所有权以关闭 `volume create` 并发竞态；恢复后复算数据树，不一致时只清理本轮新建 volume。
- `compose.data-volume.yaml` 仅将 `/app/data` 改为操作者指定的 external volume。切换不会删除或覆盖源 volume。

### TLS 与健康检查

- Compose 新增 `CHATBOT_TLS_CERT_SOURCE` / `CHATBOT_TLS_KEY_SOURCE`；未设置时继续使用 `~/devhttps/dev-cert.pem` 和 `dev-key.pem`。
- bind mount 仍为只读，entrypoint 仍先复制为受限权限再以 UID/GID 1000 的 `node` 用户启动服务。
- `/api/health` 检查启动级运行配置、当前会话存储读取和 `/app/data` 唯一探针的写入/读回/删除。
- 正常返回 200；配置或存储失败返回 503。响应只有 `status` 和两个稳定检查状态，不包含 endpoint、凭据、证书/数据路径或底层异常。

### 局域网迁移

- `docs/docker-deployment.md` 给出源机冻结与取证、目标机 env/TLS 重建、镜像构建、新卷恢复、局域网证书信任、语义验收和回滚流程。
- 普通停止和回滚明确禁止 `docker compose down -v`；恢复失败时使用另一个新 volume 名重试，源 volume 保留。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| Docker/备份脚本 `node --check` | 通过 |
| `pnpm run check` | 通过 |
| `node --test ./tests/server/health.test.ts` | 3 / 3 通过 |
| `pnpm run test:server` | 107 / 107 通过 |
| `pnpm run build:client` | 通过，Vite 8 生产构建成功 |
| `pnpm run test:docker` | 通过，最终隔离验收 14 组关键断言通过 |
| `git diff --check` | 通过 |

Docker 验收使用临时自签证书、随机 HTTPS 端口、临时 env、独立 Compose project、独立源/恢复 volume 和 mock Provider，证明：

- 默认与覆盖 TLS source 均可解析，实际 mount 指向临时证书；
- 容器 healthy，Node 进程为非 root；
- `/api/health` 正常 200、数据目录不可写 503、权限恢复后再次 200；
- 运行中的源 volume 拒绝备份，SIGTERM 停止为 0 后允许备份；
- manifest 包含 SQLite 数据目录、archive 和 tree SHA-256；损坏 SHA-256 不创建目标 volume；
- 已存在目标 volume 拒绝覆盖；
- 新 volume 恢复后，会话列表和详情逐字段等于恢复前，包括消息、reasoning、summary、status、generation usage 和 tool trace；
- 切换到恢复卷后原 volume 仍存在；`finally` 后按测试前缀检查无容器、volume 或临时备份残留。

Docker 首轮断言暴露了 macOS Docker Desktop 对 `/var` bind source 的 `/host_mnt/private/var` 表示差异。断言改为比较解析后的真实路径，没有放宽文件目标或只读挂载语义；修正后完整 Docker 验收重复通过。

所有 Provider 行为均为本地 mock；未调用真实 DeepSeek/OpenAI、天气或生产集成，未读取正式 volume，也未生成截图。
