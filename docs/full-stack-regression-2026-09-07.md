# UI 全端回归验收（2026-09-07）

后续：2026-09-08 的 [OpenAI 专项复测](openai-retest-2026-09-08.md) 一次执行通过，补齐流式、工具、停止与恢复证据；本文件保留 9 月 7 日实际失败及复测过程，不将其改写成当日全量通过。

## 范围与授权

用户确认执行全量 Mock 与真实测试。对象为 `main` / `a328940` 上未提交的桌面与移动版 UI 改造，使用 React 客户端与唯一 Bun 后端；本次测试修正不改业务代码、协议或存储格式。

- 手机：Chrome CDP 320/375/390/430px，浅色与暗色。
- 平板与断点：768/820px 移动布局，821/1024px 桌面布局。
- 桌面：1280/1440px，以及既有滚动、菜单、上下文和布局场景。
- 真实 Provider：DeepSeek 文本、OpenAI Responses、DeepSeek Flash/Pro 参数矩阵和 Vision；不是每个视口与每个 Provider 的笛卡尔积。
- 不运行 Docker，不触碰已有 7001 服务；不代表 Safari/WebKit、iOS/Android 真机、原生软键盘或系统文件选择器验证。
- 禁用脚本自动重试与常规截图；只有失败时允许诊断截图。修正测试后显式复跑与首次失败分别保留记录。

## 已执行的本地门禁

| 命令 | 结果 |
| --- | --- |
| `bun run test:unit` | Bun 179/179，46 文件；React 137/137，30 文件 |
| `bun run test:toolchain` | 7/7；入口调整后已重跑 |
| `bun run build` | 通过，含前后端类型检查、标准与类型感知 lint、生产构建 |
| `bun run test:bun-http-runtime` | 实际 Bun HTTPS 与 SIGTERM 优雅退出通过 |
| `bun run audit:production` | 498 包，high/critical 为 0；另有 2 项低于 high 门槛，不等于零漏洞 |
| `git diff --check` | 通过 |

## 浏览器执行记录

首次完整 `all-mock`：20/20，每个脚本一次执行、exitCode=0。加入平板与断点矩阵后重新执行同一完整套件，仍为 20/20、每项一次通过（北京时间 14:11:06 至 14:14:46）。

真实测试最终为 **6/7 个脚本通过，1 个失败**，不是无中断 `all-real` 全绿。总入口首轮在滚动前置条件失败，第二轮在上下文刷新竞态失败；修正后第三轮 UI/上下文/Markdown 通过，但 OpenAI 超时中断。随后使用独立专项入口执行其余场景和显式复测。所有运行均关闭自动重试。

| 真实脚本 | 最终结果与关键证据 |
| --- | --- |
| `real-scenarios.mjs` | 通过；7 次请求，4 次浏览器 abort；历史位置 0 → 0、距底部 3400px；停止后续问和实际剪贴板通过 |
| `conversation-context-real.mjs` | 通过；会话 A/B 隔离、上下文预算、重命名、刷新、清空和删除 |
| `markdown-real.mjs` | 通过；标题/列表/代码/表格、危险内容清洗、用户纯文本、流式完成、刷新、剪贴板、390px 横向溢出 |
| `mobile-real.mjs` | 原条件显式复测通过；3 次真实请求、取消 200 且 `cancelled/completed=true`、requestId stopped、6 条历史保留、清草稿、刷新恢复、52px 输入区、无 Runtime 异常 |
| `model-options-real.mjs` | Flash/Pro × off/low/medium/high，8/8 通过；UI 设置、实际请求参数和响应标记一致 |
| `vision-real.mjs` | 通过；纯文本工具、识图、图片字节校验、预算、刷新、独立分支、仅图片、停止/恢复、完整识别报告、390px 布局、5 份附件 ZIP 校验 |
| `openai-responses-real.mjs` | 失败；GPT-5.6 Luna / high 两次实际请求均显示“响应超时或连接中断”，最后一次退出码 1；工具调用、停止与恢复子场景因前置失败未执行 |

### 真实失败与边界

- OpenAI 首次实际请求超时后，原条件复测先暴露脚本提交竞态：配置仍在保存时使用合成 submit，页面正确拦截，实际请求数为 0。人工关闭该测试浏览器，让 runner 清理并记录失败；这轮不计为 Provider 调用。补齐保存完成等待并改为 CDP 点击可用发送按钮后，再次实际请求仍超时，故保留失败，不继续付费重试。
- OpenAI 的超时触发路径与前端 15 秒流空闲保护相符，日志可见请求关闭、取消回执和用户错误提示。当前证据不能区分 Provider 长时间静默、代理链路问题与超时策略不匹配；没有修改业务超时、降档或削弱断言。下一步应采集脱敏的上游首事件/事件间隔、后端转发和浏览器接收时序，再决定修复。
- 移动真实首轮的恢复问题：页面与后端均保存了正确的新问题，模型以 completed / stop 返回 3022 字的上一题列表，而非目标标记。相同提示词、模型和参数显式复测通过。该次答非所问属于尚不能定位根因的响应稳定性风险，不因复测成功删除证据。
- 真实测试覆盖 Chrome 模拟视口和实际 Provider，不声称真机、多浏览器全覆盖，也不声称所有真实子场景均已执行。

### 测试修正

1. `real-scenarios.mjs`：原测试直接设置 `scrollTop`，未触发用户滚动意图。改用 CDP 滚轮，并要求真实回答长度与容器高度增长后，历史位置偏差小于 8px、距底部大于 200px。第二轮实测位置 0 → 0，底部距离 2891px。同时补齐剪贴板实际内容、续问消息数与新建中断增量断言。
2. `conversation-context-real.mjs`：刷新前后使用 document marker 确认新页面替换，等待认证/会话就绪，防止从旧 DOM 得到通过条件后点击新页面的空列表；每次续问必须匹配新增的最后一条回答，不再用整个页面已有文本代替回答检查。会话隔离改为明确断言。
3. `markdown-real.mjs`：补齐正文结构、安全清洗、用户纯文本、流式完成、刷新、剪贴板和移动溢出断言，避免只打印状态。刷新等待同样增加文档换代门禁。`vision-real.mjs` 同步刷新门禁。
4. `mobile-real.mjs`：新增真实触屏主链路，模型面板保存到后端后进行 3 次真实请求（完成、部分输出后停止、恢复）；断言取消完成回执、浏览器 abort、requestId 终态、历史持久化、切换清草稿和刷新恢复。停止按钮也含 `send-btn`，故空闲检查使用发送按钮语义标签并排除停止按钮。
5. `model-options-real.mjs`：补齐本地化模型参数选择辅助函数所需的 `assert` 导入。
6. `run-all-real.mjs`：显式隔离 file/SQLite/附件/认证 DB 路径，增加移动专项及兼容既有 `real` 套件别名。`run-cdp-regression.mjs` 与 `package.json` 接入移动真实入口。
7. `mobile-chat-layout.mjs` / `workspace-layout.mjs`：增加 768/820/821/1024px 断点检查，保留原有布局、热区和交互断言。
8. `openai-responses-real.mjs`：配置保存完成且菜单关闭后才发送，使用 CDP 点击可用的发送按钮并验证请求计数增长；出现终态错误立即失败，避免继续等待正文。`mobile-real.mjs` 同样等待发送落地与生成结束，再校验输出标记；错误响应不再空等 240 秒。

## 可复跑入口

```sh
bun run test:unit
bun run test:toolchain
bun run build
bun run test:bun-http-runtime
bun run audit:production
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9440 bun run test:cdp:all-mock
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9438 CDP_REAL_VISION_PORT=9439 bun run test:cdp:all-real
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9444 bun run test:cdp:real-mobile
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9442 bun run test:cdp:real-model-options
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 CDP_REAL_VISION_PORT=9443 bun run test:cdp:real-vision
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9438 bun run test:cdp:real-openai
```

真实测试需已配置 Provider 凭据且获得费用授权；后端与 Vite 端口由 runner 分配。单独移动真实入口为 `bun run test:cdp:real-mobile`。

## 证据与清理

本轮日志与机器结果位于 `.tmp/full-stack-regression-2026-09-07/`，不是提交源码。`summary.json` 汇总来源文件及最终 6/7 真实脚本结果，顶层 `allPassed=false`；`all-real-attempt-1.*` 至 `all-real-attempt-3.*` 保存总入口的失败及已通过子项，不以旧日期的 `.tmp/cdp-results/` 文件冒充本轮结果。

- `all-mock-expanded.json`：扩展断点后的 20/20 完整 Mock。
- `real-model-options.json`、`real-vision.json`：参数与 Vision 通过记录。
- `real-mobile-attempt-1.json` / `real-mobile.log`：首次答非所问；`real-mobile-recheck.json` / `real-mobile-recheck.log`：原条件复测通过。
- `real-openai-recheck-unsent.json` / `real-openai-recheck.log`：0 次 Provider 请求的脚本竞态及人工结束；`real-openai-final.json` / `real-openai-final.log`：修正发送门禁后实际调用仍超时。
- `.tmp/cdp-mobile-real/failure.png`：首轮失败诊断图；未生成常规验收截图。

测试后重新执行 `check`、11 个变更脚本语法检查与 `git diff --check`，均通过。最终核验没有测试 runner、指定 CDP 浏览器或测试监听端口残留；本轮近期隔离存储与 Chrome profile 目录匹配数为 0。已有 7001 Docker 监听保持原状，未清理用户会话。没有提交或推送代码。
