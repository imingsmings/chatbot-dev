# Docker 验证记录（2026-08-10）

> 历史快照：镜像 ID、401.1 MB 体积和测试结果只对应 R10 初始交付，不代表当前含认证版本。当前操作手册见 [Docker 局域网部署](docker-deployment.md)，最新完整门禁见 [R20 验证记录](r20-jwt-authentication-plan.md#2026-08-19-验证记录)。

## 结论

R10 单 Node Docker 局域网部署已完成并通过自动化与运行态验收。Docker 容器验收使用 mock provider；另经用户授权运行了隔离数据目录的真实 OpenAI 全量回归。没有调用真实 DeepSeek，也没有修改真实会话数据。

## 交付镜像

| 项目 | 结果 |
| --- | --- |
| 标签 | `chatbot:local` |
| 镜像 ID | `sha256:a5a3d8aec1c0838999597ed985a4b86e6c4173bc842fd6f333544ed755ec99a4` |
| 平台 | `linux/arm64` |
| 大小 | `401119947` bytes（约 401.1 MB） |
| HTTPS | Node/Express 直接终止 |
| 应用进程 | UID/GID 1000 的 `node` 用户 |
| 数据 | `/app/data` named volume，覆盖 SQLite WAL/SHM |

镜像边界：包含 server、server 生产依赖和 `client/dist`；不包含 `.env`、TLS 私钥、`server/data`、Git 元数据或测试目录。

## 自动化结果

| 命令 | 结果 | 关键断言 |
| --- | --- | --- |
| `pnpm run check` | 通过 | server/client typecheck 与 React lint |
| `pnpm run test:server` | 通过 | 87/87，含 SQLite migration、摘要竞态/停机取消、NDJSON 与测试进程生命周期 |
| `pnpm run test:unit` | 通过 | server 87/87；client 55/55 |
| `pnpm run build:client` | 通过 | React 生产构建成功 |
| `pnpm run test:docker` | 通过 | Compose、healthy、非 root、HTTPS、JSON 404、SQLite restart、SIGTERM exit 0 |
| `pnpm run test:cdp:docker-ui` | 通过 | HTTPS 页面、输入区、侧栏、模型控件、无横向溢出、无服务错误 |
| `pnpm run test:cdp:all-mock` | 通过 | 完整 React UI/API mock 回归矩阵 |
| `pnpm run test:cdp:all-real` | 通过 | 4 个真实脚本；隔离端口/数据；UI、上下文、Markdown、OpenAI reasoning/工具/停止恢复 |

真实接口门禁使用 `pnpm run test:cdp:all-real`，只在明确授权后运行。启动器自动分配 backend/Vite 端口，使用临时 file store，并在退出时删除测试数据；该入口串行覆盖真实 UI、上下文、Markdown 和 OpenAI Responses 的 reasoning 参数、Function Calling、停止与恢复。当前 endpoint 在 tools 组合下可能返回空 reasoning summary，门禁记录该证据但不把上游可选内容作为稳定断言，详见 [实验记录](experiments.md)。

`test:docker` 使用随机端口、独立 Compose project、独立 SQLite volume 和临时 env；`finally` 删除测试 project、volume 与临时配置。

全面审查后的静态、Mock 和 Docker 复验见 [Code Review 记录](code-review-2026-08-10.md)。该次复验没有再次调用真实模型接口。

## 运行态与局域网

最终截图实例使用独立 project `chatbot-screenshot` 和宿主机端口 `7443`。验证时：

- 容器状态为 `healthy`，端口为 `0.0.0.0:7443 -> 7001/tcp`；
- `https://192.168.0.120:7443/api/runtime-config` 从宿主机局域网地址返回 200；
- 证书校验通过，runtime config 返回 mock 验证所需的 DeepSeek Flash 与 SQLite 配置；
- 应用界面成功恢复预置会话、reasoning 和 Markdown 内容。

`192.168.0.120` 是本次验证时的 DHCP 地址，不应作为永久部署地址写入配置。日常使用默认仍为 `https://<当前宿主机局域网 IP>:7001`。

本轮正式 Compose project `chatbot` 已使用 `chatbot:local` 启动：

- `CONVERSATION_STORE=sqlite`，`chatbot_chatbot-data` 命名卷挂载到 `/app/data`；
- 初次切换时 file store 的 7 个 JSON 会话已导入新 SQLite，metadata 记录导入数为 7；
- 全面审查后容器换用新镜像，复用 `chatbot_chatbot-data`；重建前后 SQLite 均为 7 条且 health 为 `healthy`；
- `https://192.168.0.120:7001/` 和 `/api/runtime-config` 均返回 200。

## 截图

- `.tmp/docker-screenshots/docker-chatbot-desktop.png`：容器内 React 应用界面。
- `.tmp/docker-screenshots/docker-desktop-container.jpg`：Docker Desktop Container 详情、端口、状态和日志。
- `.tmp/docker-screenshots/docker-desktop-images.jpg`：Docker Desktop Images 中的 `chatbot:local` 镜像。

截图记录的是本次 Docker 交付过程中的历史界面；全面审查后的最终镜像未重新截图。当前交付镜像 ID 以本页“交付镜像”和最终 `docker image inspect chatbot:local` 结果为准。

截图实例、临时 volume、测试 env 和本轮构建产生的 dangling images 在验收后清理；交付镜像 `chatbot:local` 和截图保留。

## 未调用的边界

本轮已按用户授权调用真实 OpenAI-compatible Responses 接口；没有调用真实 DeepSeek。正式自用前仍需在 Git ignore 的 `server/.env` 中配置所选默认 provider 的 endpoint/API key；若局域网设备尚未信任 mkcert 根 CA，浏览器会报告证书不受信任。
