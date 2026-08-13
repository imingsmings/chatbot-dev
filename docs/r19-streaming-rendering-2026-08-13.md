# R19 流式渲染与快速到底验收记录

日期：2026-08-13

## 范围

- 在 NDJSON v2 解析之后、React 状态更新之前增加有界流事件合并，不改变 Provider、后端协议或持久化格式。
- 隔离消息行、消除列表重复扫描，并用开发/测试诊断记录更新、渲染和滚动次数。
- 改为 ResizeObserver + 单一 requestAnimationFrame 的尺寸驱动自动滚动。
- 用户离开底部后显示快速到底按钮；点击立即到底，并在当前流继续增长时恢复跟随。
- 根据同机 Chrome/Vite 基线调整 Markdown 刷新节奏，不实现增量 Markdown 解析器或虚拟列表。

## 交付语义

| 范围 | 当前语义 |
| --- | --- |
| 首段文本 | 第一段非空正文或 reasoning 立即进入 React 状态 |
| 连续文本 | 相邻同类事件最多等待 40ms；100 个事件组或 16384 字符达到任一上限即同步冲刷 |
| 语义边界 | reasoning/正文类型切换保持顺序；tool、done、error 前先冲刷已有文本 |
| 生命周期 | 手动停止保留已接收文本；transition/unmount 丢弃已废弃视图的缓冲并清理 timer |
| 消息列表 | `MessageRow` memo 隔离历史行；持久化用户消息条件只进行一次线性扫描 |
| Markdown | 不超过 40KB 使用 80ms，超过 40KB 使用 160ms；完成态仍全文净化并按需高亮 |
| 自动滚动 | 仅在跟随意图开启时响应内容尺寸变化，同一帧最多安排一次滚动 |
| 快速到底 | 离开 96px 阈值后显示；点击清除旧滚动意图、立即到底并恢复跟随 |
| 诊断 | 只在 Vite dev/test 且显式启用时记录内存 marks，不进入生产 UI、不持久化、不上传 |

## 同机性能结果

固定 mock 在同一 Chrome/Vite 环境各运行 5 次，以下为中位数：

| 场景 | assistant 更新 | 首次可见 | 可见更新 P95 | 历史行渲染 | long task |
| --- | --- | --- | --- | --- | --- |
| 4KB 正文 | 23 -> 9 | 8.1ms -> 7.5ms | 161.1ms -> 102.0ms | 42 -> 0 | 0 -> 0 |
| 24KB Markdown | 63 -> 15 | 8.5ms -> 8.7ms | 261.1ms -> 107.5ms | 122 -> 0 | 0 -> 0 |
| 80KB Markdown | 103 -> 16 | 18.0ms -> 11.1ms | 456.3ms -> 176.1ms | 202 -> 0 | 0 -> 0 |
| 200 条历史 + 8KB | 53 -> 13 | 55.0ms -> 7.1ms | 178.0ms -> 100.3ms | 20502 -> 0 | 3 / 237ms -> 1 / 54ms |

80KB 场景累计 Markdown 渲染由 24.3ms 增至 34.8ms，但换得约 61% 的可见间隔下降，5 次都没有 long task。200 条历史场景剩余的 long task 出现在启动本轮请求后的列表协调窗口；流式期间历史行渲染为 0，但现有诊断没有把该 long task 进一步归因到单一函数。

## 自动化结果

| 门禁 | 结果 |
| --- | --- |
| 流缓冲、reducer、hook、MessageList、auto-scroll 聚焦单测 | 通过；最终计数随全量 client 门禁统一记录 |
| `pnpm run check` | 通过 |
| `pnpm run build` | 通过 |
| `pnpm run test:cdp:stream-performance` | 通过；每场景 5 次，行为边界与性能阈值全部满足 |
| `pnpm run test:cdp:ui` | 通过；七个 UI 模块，包括桌面/390px 快速到底、当前流恢复跟随 |
| `pnpm run test:server` | 122/122 通过 |
| `pnpm run test:client` | 96/96 通过 |
| `pnpm run test:cdp:all-mock` | 16/16 脚本通过 |
| `pnpm run test:docker` | 通过；HTTPS、非 root、健康探针、SQLite 重启、备份恢复与模型配置恢复均通过 |
| `pnpm run test:cdp:docker-ui` | 通过；隔离最新镜像的 HTTPS、composer、sidebar、模型控件和无横向溢出断言均成立 |
| `pnpm run audit:production` | 通过；未发现已知生产依赖漏洞 |
| `CDP_SCREENSHOTS=0 CDP_REAL_MODEL_WAIT_TIMEOUT_MS=330000 CDP_REAL_SCRIPT_RETRIES=1 pnpm run test:cdp:all-real` | 通过；真实 UI、上下文、Markdown、OpenAI Responses 全部通过，DeepSeek Flash/Pro × Off/Low/Medium/High 8/8 通过 |

浏览器测试使用临时 Chrome profile、随机端口和临时 store，默认不生成截图；测试创建的会话、服务与临时目录在批次结束后清理。机器可读结果写入被忽略的 `.tmp/cdp-results/`，不作为运行时数据发布。

真实 Provider 门禁保留了上游波动证据：一次 DeepSeek Pro/Low 运行长时间无终态；随后用 5 秒硬超时做隔离诊断，5010ms 时在已接收 213 个事件、396 个正文字符后正确中止并返回“请求超时，请稍候重试”，证明超时和取消链路有效。最终模型矩阵 8/8 在首次尝试通过。最终聚合门禁中 OpenAI 停止场景第一次未在等待期内产生可见正文，第二次使用相同严格断言通过；结果文件保留两次尝试，没有把首次失败隐藏为一次成功。

## Code review 收口

- 复核事件顺序、时间戳、终止/错误/停止冲刷、transition/unmount 清理、历史行 memo 边界和自动滚动用户意图，未发现未解决的产品逻辑问题。
- 修正性能文档对 200 条历史场景剩余 long task 的过度归因；现有证据只支持“本轮请求启动后的列表协调窗口”，不支持“首次装载历史”。
- 隔离最新镜像首次浏览器验收暴露出测试脚本缺陷：Node `fetch` 无法通过自签名 HTTPS 预检，而 Chrome 阶段本就允许本地证书。预检改为仅对该本地地址使用 `https.get(..., rejectUnauthorized: false)`，并增加 1 秒请求超时；修复后连续两次隔离 Docker UI 验收通过，测试容器和测试卷均已清理。
- 真实 Markdown 回归最初在整条 assistant 消息上查找标记，reasoning 重复标记时可能提前满足等待条件，随后在正文容器查找失败。定位器收紧到 `.message-row.assistant .markdown-message`，继续验证真实正文渲染与净化，不再让 reasoning 误报正文成功。

## 兼容与回滚

- NDJSON v2、Provider adapters、API、会话 schema、file/SQLite 和 Docker Volume 均未改变，无数据迁移。
- 可分别恢复逐事件 dispatch、内联 MessageList、MutationObserver 滚动或旧 Markdown 节流；任何一项回滚都不影响已保存会话。
- 删除快速到底按钮只影响便捷导航，不改变用户上滚后的“不抢回底部”语义。

## 非目标

- 不实现虚拟列表、增量 Markdown AST、逐 token 动画、通用性能平台或生产 telemetry。
- 不改变网络事件频率、Provider 完成事件、取消握手、工具语义或持久化规则。
