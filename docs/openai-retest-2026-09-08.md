# OpenAI 真实链路复测（2026-09-08）

后续状态：同日 08:36 开始的 [全端补测](full-stack-regression-2026-09-08.md) 在 OpenAI 停止场景的首批响应等待期间再次触发 15 秒前端超时。下面保留 08:10 的单次通过事实，不代表问题已修复；较晚的失败证据另行归档。

## 结果

用户要求继续测试，沿用此前确认的真实 Provider 范围，聚焦 [上轮全端回归](full-stack-regression-2026-09-07.md) 中未通过的 OpenAI 专项。

本次 `tests/cdp/openai-responses-real.mjs` **通过**：北京时间 08:10:46 至 08:11:34，attempt=1、exitCode=0、timedOut=false；18 项结果检查均为 true，额外服务端取消及持久化断言通过。没有自动重试、截图、Docker 或真机测试，也没有重新执行昨日全量 Mock 与其他 6 个真实脚本。

| 场景 | 断言与证据 |
| --- | --- |
| 流式回答 | GPT-5.6 Luna / high；观察到流式正文，483 字符正文含结束标记；请求 provider/model/effort 正确，不携带不支持的 temperature，UI 无错误 |
| Function Calling | GPT-5.6 Luna / medium；`calculate` 工具成功，`(12345 * 67) + 89 = 827204`；包含 tool_start、tool_result、delta，终止事件为 done |
| 生成中停止 | 显式选择 GPT-5.6 Luna / high；浏览器 abort 增量为 1，UI 保留 39 字符部分正文和停止状态，无重试按钮；取消返回 200 且 cancelled/completed 均为 true；requestId 终态为 stopped，服务端保存两条消息及 stopped 部分回答 |
| 停止后恢复 | 同一 OpenAI 会话成功回答恢复标记；服务端保留四条消息，旧部分回答仍是 stopped，新回答是 completed |

共执行 4 次应用层 `/ask` 请求，其中 3 次来自浏览器、1 次为工具 API 场景。工具内部可能包含多轮 Provider 请求，这个数量不等于 Provider 计费请求数。

## 时序与边界

本次新增的 CDP Network 记录只包含阶段、相对时间、状态、块数与字节数，不保存请求正文、响应正文、Cookie 或 Authorization。

- 流式回答：浏览器首批数据约 7297ms，75 个数据块、15560 字节。
- 停止场景：首批数据约 5084ms；约 5219ms 网络流结束，取消完成状态已由服务端核验。
- 恢复场景：首批数据约 2493ms。
- 这些是浏览器到应用的 HTTP 观测，不是模型首 token 或 Provider 内部耗时。`maxDataGapMs` 当前包含请求开始至首批数据的等待。
- 完成后的普通流和恢复流在 CDP 中记录 `net::ERR_ABORTED`，不能单看该事件判失败：`client/src/api/readChatStream.ts` 收到协议 done 后主动 `reader.cancel()`。本次同时通过正文标记、无 UI 错误、协议完成及恢复持久化断言。

昨日两次超时本次未复现。没有修改业务代码、超时阈值或为了通过而降低流式测试的思考档位；当前只能结论为本次专项通过，不能据此宣称昨日超时根因已修复。与昨日其他六项合并后，各真实脚本都有分项通过证据，但这不是今天重新执行了无中断 `all-real` 全量。

## 测试改动

仅修改 `tests/cdp/openai-responses-real.mjs` 与验收文档：

- 增加 CDP 请求时序和成功/失败诊断 JSON，失败时保留阶段、模型参数、取消状态和 UI 错误，避免只看到最终超时。
- 停止场景显式选择 OpenAI 模型，避免在 `all-real` 默认 DeepSeek 环境中误测其他 Provider。
- 补充取消完成回执、requestId 终态、停止内容持久化和恢复后历史不被覆盖的 API 断言。

## 执行与清理

```sh
CDP_SCRIPT_RETRIES=0 CDP_REAL_SCRIPT_RETRIES=0 CDP_SCREENSHOTS=0 DEBUG_PORT=9445 CDP_REAL_OPENAI_EVIDENCE_DIR=.tmp/openai-retest-2026-09-08 bun run test:cdp:real-openai
node --check tests/cdp/openai-responses-real.mjs
git diff --check
```

脚本语法、差异空白检查通过。runner 使用随机后端/Vite 端口、临时凭据和独立存储；3 个测试会话删除均返回 204，测试结束后相关进程、监听端口、临时存储和 Chrome profile 无残留。原有 7001 Docker 服务未改动。没有提交或推送。

日志与结果保留在 `.tmp/openai-retest-2026-09-08/`：`real-openai.log`、`result.json`、`network.json`。它们是本轮诊断证据，不作为源码提交；旧的失败记录保持不变。
