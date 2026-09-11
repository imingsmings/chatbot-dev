# 全端回归补测（2026-09-08）

## 本轮结论

用户明确要求补跑此前未重跑的全量 Mock、全部真实专项、Docker 和真机测试。本轮没有使用上午 [OpenAI 专项通过记录](openai-retest-2026-09-08.md) 替代新的执行结果。

**结果未全绿：全量 Mock 20/20，通过的真实脚本 6/7；Docker 修正测试定位后完整通过；真机因设备不可用未执行。** 自动重试与常规截图均关闭，所有首轮失败保留。

| 范围 | 实际执行结果 |
| --- | --- |
| `test:cdp:all-mock` | 20/20，每个脚本 attempt=1、exitCode=0；北京时间 08:32:07 至 08:35:46 |
| `test:cdp:all-real` | 08:36:00 至 08:42:54；UI、上下文、Markdown 通过，OpenAI 失败，入口退出码 1，后续脚本未自动执行 |
| `test:cdp:real-mobile` | 单次通过，退出码 0；3 次真实请求，完成、取消回执、停止内容持久化、恢复、切换清草稿与刷新恢复 |
| `test:cdp:real-model-options` | 单次通过，退出码 0；Flash/Pro × off/low/medium/high，8/8 |
| `test:cdp:real-vision` | 单次通过，退出码 0；识图、图片字节/预算、刷新、分支、仅图片、停止/恢复、5 份附件 ZIP 与 390px 布局 |
| `test:docker` | 首轮在旧上下文 UI 定位失败；修正测试后完整复跑，退出码 0，21 项断言通过 |
| `test:toolchain` | 7/7 |
| 脚本语法与 `git diff --check` | 通过 |
| iOS/Android 真机 | 未执行：登记的 iPhone 14 Pro Max 为 unavailable；当前无 Android 调试工具 |

移动、参数、Vision 三个独立入口用于补齐总入口中断后尚未执行的脚本，不是对失败 OpenAI 的付费重试。没有重新运行全量单元测试、独立本地 build/audit/HTTP-runtime 门禁；其历史结果仍见 [9 月 7 日记录](full-stack-regression-2026-09-07.md)。本轮确实重新构建并运行了 Docker 镜像。

## UI 与浏览器范围

- Chrome CDP：320/375/390/430px 手机、768/820px 平板，浅色和暗色；821/1024/1280px 工作区断点，以及既有桌面场景。
- 自动断言正文 14px、空输入区 52px、发送图标 32px/热区 44px、加号无边框、模型入口不重复、面板不越界、历史滚动不跳动、切换清草稿、失败恢复和附件安全显示。
- 全量 Mock 覆盖上游释放、API/工具、会话与分支、流式协议/恢复/性能、模型持久化、模板、Markdown/高亮安全、上下文、搜索、导入导出、认证与附件。
- 真实 Provider 使用隔离账号与存储，并非每个 Provider 与每个视口的笛卡尔积。Chrome 触屏/视口模拟不算 iOS Safari、Android Chrome、原生软键盘或系统文件选择器的真机证据。

## OpenAI 失败

失败脚本：`tests/cdp/openai-responses-real.mjs`，阶段为 `stop`，模型为 GPT-5.6 Luna / high。

1. 首个请求观察到流式正文；CDP 首批数据 7222ms，278 个数据块，12921 字节，最后数据在 21006ms。工具 API 步骤随后返回，但整项末尾的汇总断言因后续失败未执行，不将这部分计为完整专项通过。
2. 为人工停止场景发起长回答请求后，浏览器记录为 **0 块、0 字节，无 responseReceived，15007ms 后 net::ERR_ABORTED**，UI 显示“响应超时或连接中断”。此时尚未进行人工停止操作。
3. 自动取消接口返回 200，`cancelled=true`、`completed=true`。后端日志记录 client_closed，3 个测试会话最终删除均返回 204。
4. 脚本在等待“有部分正文且仍生成中”的条件时未快速识别错误终态，约 240 秒后才报断言等待超时。人工停止/部分保存/恢复子场景未完成，不能声称其本轮通过。

代码核查：`client/src/hooks/useChatStream.ts` 的默认 15 秒计时在发起请求前启动，仅在读到响应块时重置。当前证据证明首批响应等待会触发这个前端保护；不能仅凭浏览器记录判断静默来自 Provider、代理还是服务端转发。没有修改业务超时、协议、模型档位或断言来让测试通过。

建议后续先记录脱敏的上游首事件与转发时序，再区分首事件等待期限和流中空闲期限；同时给停止/恢复等待补充终态错误快失败。本轮不继续付费重试。上午专项通过与本轮失败均保留，超时问题仍未解决。

## Docker 修正与结果

- `tests/docker/container-smoke.mjs`：生成独立临时 Compose image override，测试镜像使用 `chatbot-docker-test-<pid>:local`；备份清单携带该测试镜像，恢复沿用清单。结束后关闭 Mock、删除临时目录并清理测试镜像，不覆盖 `chatbot:local`。
- `tests/cdp/docker-ui.mjs`：等待预算数据就绪，展开“模型参数”，从中文 `dt/dd` 读取“上下文窗口”和“总量”，保留 80000 token 的原始断言。首轮失败原因是旧英文标题/旧 span 定位，不是把 80000 的断言放宽。
- 完整复跑镜像为 188538609 字节；验证 Bun 1.4 非 root、HTTPS/TLS、认证、liveness/readiness、SQLite/附件/requestId 重启、SIGTERM、运行卷备份拒绝、校验和保护、新卷恢复、受保护图片浏览器预览、上下文预算和测试源卷 hash 不变。
- Docker 使用真实容器与浏览器，但 Provider 为本地 Mock。没有使用个人数据 canary 或在现有生产服务中调用真实 Provider。
- 对现有 7001 容器前后做结构化比较：容器 ID、镜像 ID、启动时间、重启次数、挂载相同，`chatbot:local` 标签仍指向原镜像。挂载数组仅输出顺序不同，按 Destination 排序后比较通过。

## 命令与证据

```sh
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9446 bun run test:cdp:all-mock
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9447 CDP_REAL_VISION_PORT=9448 CDP_REAL_OPENAI_EVIDENCE_DIR=.tmp/full-stack-regression-2026-09-08/openai bun run test:cdp:all-real
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9447 bun run test:cdp:real-mobile
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9447 bun run test:cdp:real-model-options
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 CDP_REAL_VISION_PORT=9448 bun run test:cdp:real-vision
CDP_SCREENSHOTS=0 bun run test:docker
bun run test:toolchain
node --check tests/cdp/docker-ui.mjs
node --check tests/docker/container-smoke.mjs
git diff --check
```

归档目录：`.tmp/full-stack-regression-2026-09-08/`。`summary.json` 明确标记未全部通过；`all-real.json` 与 `openai/network.json` 保留失败；`docker.log` 是失败首轮，`docker-recheck.log` / `docker-recheck.json` 是修正后的完整通过；其他入口均有独立日志和 JSON。网络诊断不保存请求正文、响应正文或凭据。

测试 runner、后端、Vite、CDP 浏览器、临时会话/存储/profile 已清理，测试 Docker 镜像/卷/网络无残留；日志和结果作为诊断证据保留。未修改业务代码，未提交、推送或更新个人长期记忆。
