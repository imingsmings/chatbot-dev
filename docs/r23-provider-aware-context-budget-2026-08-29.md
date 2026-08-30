# R23 Provider-aware 上下文预算验收记录

日期：2026-08-29

最终真实验证：2026-08-30

## 结论

R23 已完成代码、单元/API、React、构建、全量 Mock 和全量真实 Provider 浏览器门禁。Docker 按用户要求不在本阶段验证。

本阶段提供的是本地可配置、可解释的保守预检，不宣称复刻各 Provider 的精确 tokenizer，也不把估算值当作计费 usage。

## 进入证据

旧实现按消息数和 JavaScript 字符数选择历史。自动化实验使用两条同为 2,000 字符的输入：ASCII 在 5,000 token 本地上限下可通过，而中文输入按 JSON UTF-8 保守估算会超限。相同字符数不能稳定代表当前兼容链路的输入规模，因此满足 R23 的进入条件。完整实验见 [实验记录](experiments.md#2026-08-29-字符数无法预测模型上下文边界)。

## 已实现范围

- 模型目录为 DeepSeek/OpenAI 模型声明本地上下文上限；兼容 endpoint 可通过 `DEEPSEEK_CONTEXT_WINDOW_TOKENS` / `OPENAI_CONTEXT_WINDOW_TOKENS` 覆盖。
- 统一预算包含 system、摘要、历史、当前问题、图片、工具定义、请求 framing、工具续调预留和输出预留。
- 文本按 JSON 字符串序列化后的 UTF-8 字节作一 token/byte 保守上界；图片按 Provider、尺寸和 detail 估算。
- `maxTokens` 作为输出预留；未显式设置时使用当前模型目录的最大输出值，避免把输出空间全部让给输入。
- 预算不足时按“较早历史图片 -> 摘要正文 -> 最旧历史消息”裁剪；当前问题和当前图片不静默丢弃。
- 摘要正文即使被预算移除，`sourceMessageCount` 覆盖边界仍保持，已摘要历史不会重新进入 prompt。
- 固定输入仍超限时，在首次 Provider 请求前抛出内部 `ContextBudgetExceededError`，并以既有 NDJSON v2 `error.message` 返回可读原因；工具执行后使用实际 calls/reasoning/results 在续调前再次检查。
- 上下文预览和 React 弹窗显示上限、输入/输出/总估算、剩余空间、各组成项、摘要状态和旧护栏/token 预算各自的裁剪数。
- 消息数/字符数与图片数量/字节限制保留为二级护栏；未引入 RAG、Embedding、向量数据库或文档检索。

## 本地上限边界

当前 `131072`（DeepSeek）和 `400000`（OpenAI）是项目本地模型目录的部署配置，不作为相同名称在所有兼容 endpoint 上的外部事实。endpoint 限制不同时必须用环境变量覆盖，并通过上下文预览确认实际生效值。

## 验收覆盖

### 静态、单元和构建

- `pnpm run test:context`：23/23，通过 DeepSeek/OpenAI profile、中文/ASCII、裁剪顺序、固定输入超限且 Provider 零调用、摘要覆盖、图片和工具续调复检。
- `pnpm run test:unit`：服务端 168/168、React 114/114，通过。
- `pnpm run build`：server/client typecheck、两档 Oxlint 和 React production build 通过。
- `git diff --check`：通过。

### Mock 浏览器

- `pnpm run test:cdp:context-debug`：上下文上限、预算组成、裁剪统计和 390px 布局通过。
- `pnpm run test:cdp:image-attachments`：图片上传、持久化显示、刷新、分支、停止和移动端通过。
- `CDP_SCRIPT_RETRIES=0 pnpm run test:cdp:all-mock`：18/18 脚本一次通过；每个脚本 `attempts=1`，无自动重试。
- `node tests/cdp/upstream-abort.mjs`：4 个取消/切换场景通过，上游均在完整响应前关闭，临时进程与测试会话完成清理。

### 真实 Provider

- `CDP_SCREENSHOTS=0 CDP_REAL_SCRIPT_RETRIES=0 pnpm run test:cdp:all-real`：最终单次总门禁通过，`all-real`、`real-model-options`、`real-vision` 三个隔离套件均一次成功，无自动重试。
- DeepSeek V4 Pro 真实上下文预览使用 `deepseek-utf8-conservative-v1`：输入估算 3,851、输出预留 4,096、总估算 7,947，低于 131,072 本地窗口；选中 4 条持久化历史，问题和工具预算均非零。
- OpenAI Responses 的文本、reasoning、Function Calling、停止和恢复通过；DeepSeek V4 Flash/Pro 的 off/low/medium/high 共 8 组参数全部通过模型、推理开关、推理强度和内容断言。
- Vision 使用 Downloads 下 34,429 字节真实图片：图片预算 896、输入估算 4,667、输出预留 65,536、总估算 70,203，低于 131,072 本地窗口；图片识别、刷新、分支、纯图片、停止/恢复、1,466 字符完整识别、390px 布局和包含 5 个附件的 schema v2 ZIP 均通过。
- 脚本使用临时 file store、临时认证凭据和隔离端口；最终输出确认测试会话、附件、浏览器 Profile 与临时服务均已清理，常规截图关闭。

### Docker

按用户要求暂不验证，不运行构建、启动、重启或 Volume 门禁。本阶段没有修改持久化 schema，Docker 风险主要是环境变量未覆盖兼容 endpoint 的真实上下文上限。

## Code Review

收口审查已发现并修复以下问题：

1. 原始 UTF-8 字节没有覆盖 JSON 控制字符转义，已改为按 JSON 序列化后的字节估算。
2. 初始裁剪顺序会先移除最近历史再考虑摘要，已固定为优先移除摘要正文且不回退覆盖边界。
3. 工具续调只用静态预留不足以覆盖异常大的工具结果，已加入第二阶段前的实际复检。
4. 图片 CDP 只等待容器而未等待受保护图片加载，已改为等待真实 `<img>`。
5. Roadmap 剪贴板场景使用滚动后的旧坐标，已改为稳定触发已定位按钮并继续读取真实剪贴板内容。
6. 上游中断测试的异步响应观察和子进程退出存在短时竞争，已补可观测等待和进程组清理。
7. Vision 真实用例在 React 输入状态尚未提交时直接派发 `submit`，可能只留下输入文本而未发出请求；已改为等待真实发送按钮可用后点击，并用提交前消息计数断言新回答，分支完成改由持久化终态确认。

最终静态检查、无重试全量 Mock、无重试全量真实门禁和收口 Code Review 均已完成，本记录关闭。

## 回滚

- 可回滚 `contextBudgetService` 的统一预算调用并恢复 R22 的历史消息/字符选择；会话、附件和导入导出 schema 无需迁移。
- 环境变量覆盖无效时删除对应 `*_CONTEXT_WINDOW_TOKENS` 即恢复本地目录默认值。
- 回滚前保留新增预览字段的客户端兼容处理或同步回滚前后端，避免旧客户端读取缺失字段。
