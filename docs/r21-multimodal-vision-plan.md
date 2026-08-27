# R21 图片附件与多模态理解

状态：功能与非 Docker 验收已完成。静态、单元/API、构建、全量 Mock 和全量真实 Provider 均已通过；Docker 实机新 Volume 恢复门禁按用户要求暂缓。

## 目标与价值

- 接入 `deepseek-v4-flash-vision-exp`，支持纯文本、文本加图片和仅图片消息。
- 学习并验证上传安全、多模态消息建模、Provider 能力约束、附件生命周期、上下文预算和容器数据恢复。
- 保持项目的个人学习、内部使用定位，不扩展为通用文件平台或多模态网关。

## 已确认决策

1. Vision 模型是文本与图片双模态模型，图片是可选输入；选择该模型后，纯文本聊天必须默认可用。
2. 浏览器使用 `multipart/form-data` 上传图片；服务端将原始文件保存在 `/app/data/attachments`，SQLite/会话 JSON 只保存附件元数据和引用。
3. 首期调用 DeepSeek 时由服务端临时读取本地文件并转换为 Base64 Data URL；Base64 不进入浏览器持久化、SQLite 或导出 JSON。
4. DeepSeek Files API 暂不接入。只有重复上传开销、图片大小或请求体限制形成实际问题时，才作为 Provider 传输缓存单独评估；本地文件始终是数据源。
5. 现有 Provider SSE 到应用 NDJSON v2 的输出协议保持不变；上传是独立普通 HTTP 请求，不增加附件流式事件。
6. 全局默认模型继续使用 `deepseek-v4-flash`；Vision 模型作为实验性可选模型，并继续受现有禁用模型配置控制。
7. 当前图片请求不得静默降级到不支持图片的模型；纯文本请求仍遵循现有模型兼容与回退规则。

Provider 的模型标识、内容块格式、大小限制和功能兼容性在实施前必须重新核对 [DeepSeek 图像理解文档](https://api-docs.deepseek.com/zh-cn/guides/vision/) 与 [Files API 文档](https://api-docs.deepseek.com/zh-cn/guides/files_api/)。实验模型可能变更或下线，不能把当前文档快照视为长期稳定契约。

## 首期范围

### 模型能力

- 模型目录显式声明 `inputModalities: ['text', 'image']`、支持的图片 detail 级别和 `experimental` 状态。
- 纯文本消息沿用现有字符串 `content` 和流式链路。
- 消息包含图片时，DeepSeek adapter 才将用户消息转换为文本块与图片块数组。
- 仅图片消息允许发送；默认不注入用户不可见的合成文本。若最小真实接口验证证明 Provider 强制要求文本，再记录兼容处理。
- 不支持图片的模型遇到当前消息附件时，在发送前明确提示切换模型，不由前端静默切换。

### 上传与展示

- 支持文件选择、粘贴和拖放图片。
- 展示上传中、可发送、失败、删除和重试状态；上传未完成时禁止发送。
- 发送条件改为“文本非空或至少一张图片上传完成”。
- 上传、发送、删除和重试按钮需要请求互斥与快速连点保护。
- 用户消息展示缩略图，支持预览；受认证保护的图片通过 `apiFetch` 获取 Blob URL，并在卸载或替换时释放。
- 刷新、重新进入会话、停止生成、重新生成、历史消息分支后，附件引用和 UI 状态保持一致。

### 文件和接口边界

建议首期接口：

```text
POST   /api/conversations/:id/attachments
GET    /api/conversations/:id/attachments/:attachmentId
DELETE /api/conversations/:id/attachments/:attachmentId
POST   /api/conversations/:id/ask
```

`ask` 请求增加 `attachmentIds`；附件上传、读取和删除接口均沿用现有认证，并校验附件与会话的绑定关系。

建议消息元数据：

```ts
type ImageAttachment = {
  id: string
  kind: 'image'
  filename: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  width: number
  height: number
  detail: 'auto' | 'low' | 'original'
}

type StoredMessage = {
  // existing fields
  attachments?: ImageAttachment[]
}
```

附件模块负责路径生成、原子落盘、读取、引用检查和孤儿清理；controller 不直接操作文件，Provider adapter 不负责附件持久化。

### 安全与容量

- 首期只接受 JPEG、PNG 和 WebP；根据文件实际字节识别格式，不只信任扩展名和请求头。
- 单张图片最大 `6 MiB`，单条消息最多 `4` 张，单边最大 `4096` 像素。
- 发送给 Provider 的当前和历史图片合计最多 `4` 张；最终组装后的 Base64 JSON 请求体控制在 `40 MiB` 内。
- 文件名只作为展示元数据，服务端路径使用生成的附件 ID，防止路径穿越和同名覆盖。
- 上传失败、请求取消和会话删除后的未引用文件进入有界 TTL/引用扫描清理，不能立即误删仍被分支引用的附件。
- 不接受外部图片 URL，避免 SSRF、不可重复内容和局域网地址探测。

### 上下文与持久化

- 文本上下文继续使用现有摘要覆盖边界、消息数和字符预算。
- 图片采用独立数量与字节预算，不能用当前字符计数假装覆盖图片成本。
- 当前图片只能发送给支持图片的模型；历史图片在图片预算内重发，切换到文本模型时仅保留明确的文本占位说明。
- 成功完成和手动停止都按现有消息状态语义保存附件引用；异常 EOF 仍不得落成成功消息。
- 编辑、重试、重新生成和会话分支必须保留正确附件引用，父会话不可被修改。
- file/SQLite 两种会话存储均需支持可选附件元数据，旧数据在缺少 `attachments` 时保持兼容。

### 导入导出与 Docker

- Docker Volume 继续持久化整个 `/app/data`，因此数据库和附件可一起备份、校验和恢复。
- 便携导出升级为 schema v2 ZIP，包含 `manifest.json` 与 `attachments/`；继续兼容 schema v1 JSON 导入。
- Markdown 导出只列出附件名称和引用信息，不宣称包含图片二进制。
- 恢复到新 Volume 后必须验证会话、缩略图、原图读取和再次发送均可用。

## 实施阶段

| 子阶段 | 范围 | 当前证据 |
| --- | --- | --- |
| R21.0 | 官方协议 fixture、模型目录、能力类型、DeepSeek thinking + tools 兼容探针 | 已实现；纯文本字符串请求和含图片 content blocks 均有 adapter/真实请求形状测试 |
| R21.1 | multipart 上传、格式/尺寸校验、本地附件存储、认证读取和删除 | 已实现；JPEG/PNG/WebP 魔数、尺寸、超限、跨会话、TTL、孤儿和健康探针均有 Node/API 测试 |
| R21.2 | Composer 上传状态、缩略图/预览、发送条件、adapter 多模态映射 | 已实现；选择/粘贴/拖放、失败重试、受保护 Blob、文本加图、仅图片和不支持模型均有组件/CDP 断言 |
| R21.3 | 刷新、停止、重试、重新生成、分支、上下文图片预算 | 已实现；file/SQLite、当前图片优先、最多 4 张、分支复制、父会话不变和移动端均已验证 |
| R21.4 | schema v2 导入导出、Docker Volume 备份恢复、完整回归 | schema v2 ZIP、校验和、路径/绑定/回滚、全量 Mock 与真实 Provider 已通过；Docker 实机门禁按用户要求暂缓 |

## 2026-08-24 实施与验收进度

- 服务端新增附件 service/controller、multipart 路由、真实字节格式与尺寸识别、原子文件/sidecar 保存、会话绑定、引用状态、TTL/孤儿清理和健康检查。
- DeepSeek adapter 仅在消息含图片时构造 Base64 Data URL content blocks；纯文本继续保持 `content: string`，最终请求体受 40 MiB 门禁保护。
- file/SQLite 消息均只保存附件元数据；上下文为图片独立计数/字节预算，文本模型使用明确占位且拒绝当前图片请求。
- 编辑/重新生成创建普通分支并复制附件文件，父会话不变；停止状态、刷新、重新进入和详情回拉均保留附件。
- 全量备份使用 schema v2 ZIP（`manifest.json` + `attachments/`），保留 schema v1 JSON 导入；校验路径、SHA-256、元数据绑定和失败回滚。
- React 支持选择、粘贴、拖放、上传/删除/失败重试、缩略图、认证 Blob 读取、预览、模型能力提示和窄屏布局；全量导入/导出入口明确标为 JSON/ZIP 与 ZIP。
- `pnpm run check`、`pnpm run test:unit`（server 152/152、client 112/112）、`pnpm run build:client` 和 `git diff --check` 已通过。
- `CDP_SCREENSHOTS=1 pnpm run test:cdp:all-mock` 已通过 18 个脚本；R21 专项保存上传、完成、预览、失败、模型拦截、停止和 390px 布局截图。
- `CDP_SCREENSHOTS=1 pnpm run test:cdp:all-real` 已通过 DeepSeek/OpenAI 真实 UI、上下文、Markdown、工具、停止/恢复、8 组模型选项与 Vision 门禁。
- Vision 使用固定 `books.jpeg`（34,429 bytes），校验 SHA-256、书堆/容器识别、历史图片上下文、刷新、分支、仅图片、停止/恢复、完整识别报告、390px 布局与 ZIP；最终完整报告为 1,851 个可见字符。
- Docker 构建、部署和新 Volume 恢复未在本轮执行；现有整卷 `/app/data` 备份设计会覆盖 `attachments/`，仍需之后以实机门禁证明。

完整验收证据见 [R21 图片附件与 Vision 验收记录](r21-multimodal-vision-2026-08-24.md)。

## 验收要求

- 纯文本：Vision 模型下不上传图片也能完成 reasoning、工具调用、停止和流式恢复。
- 多模态：文本加图片与仅图片能够正确构造 Provider 请求，并显示流式正文和 thinking。
- UI：上传等待、失败重试、删除、快速连点、切换模型、刷新和窄屏布局都有自动化断言。
- 存储：file/SQLite、分支、会话删除、孤儿清理、schema v1 兼容和 schema v2 完整导出均有测试。
- 安全：伪造 MIME、超限尺寸、路径穿越、未授权读取和跨会话附件引用被拒绝。
- 容错：上传取消、生成停止、Provider `400`、异常 EOF 和后续恢复路径可重复验证。
- Docker：新 Volume 恢复后附件与会话一致，既有无附件会话不受影响。
- 真实 Provider：只在明确确认后使用固定、无隐私图片执行最小门禁；测试数据、附件和临时服务在结束后清理。

## 非目标

- PDF、Office、网页等文档文本提取。
- OCR 管线、向量数据库、Embedding、RAG 和跨文件检索。
- 图片生成、图片编辑、视频、音频和实时摄像头。
- 外部图片 URL、首期 DeepSeek Files API 和通用多 Provider 附件网关。
- 多用户附件隔离、对象存储、CDN 和公开上传服务。

## 回滚边界

- 模型目录可通过现有禁用模型配置关闭 Vision 模型。
- 关闭模型不会删除本地附件或修改已有会话。
- schema v2 导出必须保留 schema v1 导入兼容；实现阶段若数据格式变化，需要先提供备份和恢复验证。
- 真实模型调用、Docker 部署和破坏性数据清理仍分别需要明确授权；关闭 Vision 模型不会删除已保存附件。
