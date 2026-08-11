# 全面 Code Review 与回归记录（2026-08-10）

## 结论

本轮围绕用户输入到模型返回、会话持久化、UI 异步状态、进程退出和 Docker 运行链路完成静态审查、缺陷修复与全量 Mock 回归。静态检查、87 个后端测试、55 个 React 测试、生产构建、生产依赖审计、10-script Mock CDP、隔离 Docker 冒烟和正式容器 UI CDP 全部通过。

本轮没有调用真实模型接口。真实 provider 的内容质量和上游协议漂移不属于本轮通过结论。

## 已修复问题

| 严重度 | 问题 | 修复与回归 |
| --- | --- | --- |
| 高 | SQLite 首次迁移遇到任一损坏 JSON 时会中止全部迁移和启动 | 按文件跳过语法损坏源，保留有效会话并验证数据库可写、关闭后可重开 |
| 高 | 摘要生成只比较时间和消息数，同长度、同时间戳覆盖可能写入陈旧摘要 | 写入前比较完整消息快照，新增同长度替换竞态测试 |
| 高 | SIGTERM 只取消流式问答，不取消正在调用模型的摘要请求 | 摘要请求接入共享 request registry；关闭时统一 abort，并验证上游 signal 与 registry 清理 |
| 中 | 空会话可以打开摘要；“参数”菜单错误依赖摘要可用性 | 参数始终可访问；摘要按会话、消息、流式和 loading 状态禁用，两处入口保持一致 |
| 中 | 完成态消息显示没有行为或持久化语义的点赞/点踩按钮 | 移除未实现操作，只保留复制和错误重试等有效操作 |
| 中 | Docker/CDP 命令缺少超时或只终止父进程，异常时可能残留服务 | Docker 命令加有界超时和强制终止；CDP 脚本使用独立进程组并执行 TERM/KILL 清理 |
| 中 | P0 测试仍把 file store 当作默认值 | file 专项显式设置 `CONVERSATION_STORE=file`，SQLite 专项保持显式 SQLite |
| 低 | Docker 构建上下文没有通用排除证书/私钥文件 | `.dockerignore` 与 `.gitignore` 增加证书和私钥扩展名 |
| 低 | NDJSON `res.write()` 返回 backpressure 时缺少回归保护 | 新增 backpressure 与已关闭响应测试，确认 backpressure 不等同于连接关闭 |
| 低 | Docker UI 冒烟遗漏模型控件，失败诊断会输出整页本地会话文本 | 增加模型控件断言，诊断仅保留布尔和布局状态 |

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm run check` | 通过；server/client TypeScript 7 与普通/类型感知 lint |
| `pnpm run test:unit` | 通过；server 87/87，React 55/55 |
| `pnpm run build:client` | 通过；Vite 8 生产构建 |
| `pnpm run audit:production` | 通过；0 个已知生产依赖漏洞 |
| `pnpm run test:cdp:all-mock` | 通过；10 个去重脚本覆盖流式、工具、UI、Markdown、高亮、上下文、搜索、导出和操作锁 |
| `pnpm run test:docker` | 通过；独立 project/volume、HTTPS、非 root、SQLite restart、SIGTERM exit 0 |
| `pnpm run test:cdp:docker-ui` | 通过；HTTPS、输入区、侧栏、模型控件、无横向溢出 |
| 正式容器 | `healthy`；新镜像运行；原 volume 继续挂载；SQLite 会话 7 -> 7 |
| 局域网 | `https://192.168.0.120:7001/` 返回 200；IP 为本次 DHCP 地址 |

## 剩余边界

- `node:sqlite` 在 Node 22 仍会打印 experimental warning；当前固定 Node 版本与测试均通过。
- 项目按个人/局域网用途设计，没有登录、多用户隔离或公网防护，不应直接暴露到公网。
- 本轮只证明本地 Mock 协议和既有适配器逻辑；真实 provider 回归仍需单独明确授权。
