# R21 图片附件与 Vision 验收记录

状态：2026-08-24 功能与非 Docker 验收完成。Docker 构建、部署和新 Volume 恢复按用户要求暂缓，本轮未操作现有容器或持久化数据。

## 交付范围

- JPEG、PNG 和 WebP 的选择、粘贴、拖放、上传、删除、失败重试、缩略图与受保护预览。
- 单张 6 MiB、单消息 4 张、单边 4096px、真实字节格式/尺寸识别、会话归属与认证保护。
- 附件以本地原图为唯一数据源；只在 Provider 请求时转 Base64 Data URL，纯文本仍使用字符串 `content`。
- 文本/图片模型能力约束、最多 4 张的历史图片预算、分支复制、停止状态、file/SQLite 一致性。
- schema v2 ZIP 包含 `manifest.json` 和附件二进制，校验 SHA-256、路径、绑定、ID 重映射和失败回滚；保留 schema v1 JSON 导入。

## 静态与自动化证据

| 命令 | 结果 |
| --- | --- |
| `pnpm run check` | 通过 |
| `pnpm run test:unit` | server 152/152，client 112/112 |
| `pnpm run build:client` | 通过 |
| `git diff --check` | 通过 |
| `CDP_SCREENSHOTS=1 pnpm run test:cdp:all-mock` | 18/18 脚本通过 |
| `CDP_SCREENSHOTS=1 pnpm run test:cdp:all-real` | UI、上下文、Markdown、OpenAI Responses、8 组 DeepSeek 选项和 Vision 全部通过 |

Mock 专项覆盖上传中/完成/失败/重试/删除、不支持模型、文本加图、仅图片、刷新、分支、停止、导入导出与 390px 布局。Node/API 覆盖伪造 MIME、尺寸/大小超限、跨会话读取、TTL/孤儿清理、file/SQLite、并发删除可靠性和导入回滚。

## 真实 Vision 证据

图片来源：`/Users/jason/Downloads/ai-basic-master/03. LLM基础知识/24. [MCP]Resources基础知识/课堂代码/demo/src/assets/books.jpeg`。该图是 500×500 JPEG，34,429 bytes，SHA-256 为 `e8decf4230ec0c622f030ffe6456e5dca03a39b97c5ec3bd20814408f82ef59d`。

- `deepseek-v4-flash-vision-exp` 纯文本消息成功调用 calculator，返回 `PURE-VISION=42`，且没有持久化附件。
- 结构化识图返回 `BOOKS=yes` 和 `VESSEL=yes`；下载原图的 SHA-256 与源图一致。
- 历史上下文精确选中 1 张、34,429 bytes、丢弃 0 张；刷新后缩略图和回答恢复。
- 重新生成创建独立分支和新附件 ID，父会话保持两条消息不变；仅图片消息正常完成。
- 停止生成后 assistant 持久化为 `stopped`，图片引用保留，下一次请求可继续完成。
- 独立当轮图片输入生成 1,851 个可见字符的完整中文识别报告，包含书堆、饮用容器、相对位置、颜色、构图与不确定信息，持久化正文不短于页面渲染文本。
- 便携 ZIP 包含 5 份测试附件，每份的字节数和 SHA-256 全部通过；390px 下主区、消息、附件网格和输入区均在可见边界内。

机器可读结果位于 `.tmp/cdp-results/all-real.json`、`.tmp/cdp-results/real-model-options.json` 和 `.tmp/cdp-results/real-vision.json`；临时结果不进入源码提交。

## 截图

- `.tmp/cdp-real-vision-screenshots/01-real-downloads-image-ready.png`：Downloads 真实图片已上传。
- `.tmp/cdp-real-vision-screenshots/02-real-vision-recognition-completed.png`：书堆和容器识别完成。
- `.tmp/cdp-real-vision-screenshots/03-real-protected-image-preview.png`：认证 Blob 原图预览。
- `.tmp/cdp-real-vision-screenshots/04-real-image-survives-refresh.png`：刷新后图片恢复。
- `.tmp/cdp-real-vision-screenshots/05-real-vision-branch-completed.png`：含图分支完成。
- `.tmp/cdp-real-vision-screenshots/06-real-image-only-completed.png`：仅图片输入完成。
- `.tmp/cdp-real-vision-screenshots/07-real-vision-before-stop.png` 与 `08-real-vision-stopped.png`：停止前后。
- `.tmp/cdp-real-vision-screenshots/09-real-vision-full-recognition-start.png` 与 `10-real-vision-full-recognition-end.png`：完整识别报告开头与结尾。
- `.tmp/cdp-real-vision-screenshots/11-real-vision-mobile.png`：390px 布局。

## 暂缓与风险

- `deepseek-v4-flash-vision-exp` 是实验模型，标识、价格、输入限制和历史图片处理行为可能改变；变更 Provider 请求形状前应重跑 adapter fixture 和最小真实门禁。
- Docker 新 Volume 恢复未本轮执行。现有 R14 备份设计会备份整个 `/app/data`，但附件恢复、缩略图读取和再次发送仍需后续实机证据。
- 回滚时可通过现有禁用模型配置关闭 Vision；关闭模型不删除附件或改写旧会话。
