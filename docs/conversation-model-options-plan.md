# 会话级模型配置持久化方案

状态：2026-08-13 实现完成并通过自动化验收。

本文记录会话级模型配置持久化的设计与最终实现。模型、provider、reasoning、temperature 和 max tokens 现在随会话保存在 file/SQLite 中，并贯穿分支、导入导出、刷新、Docker 重启与 Volume 恢复。

## 1. 目标与价值

- 每个会话独立保存模型、provider、reasoning 开关和 effort，刷新或重新进入会话后准确恢复。
- 同步保存 temperature 与 max tokens，避免只修复模型和 effort 后，同类状态仍在刷新时丢失。
- 保持旧 JSON、现有 SQLite 数据、schema v1 备份和会话分支兼容。
- 保存失败、快速连续点击和会话切换时，UI 不显示未落库或其他会话的配置。
- 继续以每条 assistant 消息的 `generation` 记录实际使用模型；会话配置只表示下一次请求的默认选择，不改写历史生成记录。

## 2. 实施前问题

R17 实施前的初始化链路是：

1. `useChatAppController` 请求 `/api/runtime-config`。
2. `getInitialModelOptions(runtime)` 生成页面级 `modelOptions`。
3. `useChatStream`、摘要和上下文预览读取该页面状态。
4. 会话详情、file store、SQLite 和 JSON 备份均不包含会话级模型配置。

因此刷新页面必然重新使用运行时默认值；在同一浏览器会话内切换 A/B 会话时，也无法恢复各自上一次选择。

## 3. 数据模型

新增完整且可选的会话字段：

```ts
type ConversationModelOptions = {
  provider: 'deepseek' | 'openai'
  model: string
  reasoningEnabled: boolean
  reasoningEffort: string
  temperature?: number
  maxTokens?: number
}

type Conversation = {
  // existing fields
  modelOptions?: ConversationModelOptions
}
```

设计约束：

- `provider`、`model`、`reasoningEnabled`、`reasoningEffort` 保存为完整快照，避免读取时依赖不同时间的环境默认值。
- `temperature` 和 `maxTokens` 仅在模型支持且用户设置有效时保存。
- `modelOptions` 不进入 `ConversationSummary`；切换会话仍以详情请求作为恢复配置的唯一依据。
- 修改模型配置不更新 `updatedAt`，避免只调整模型就把旧会话移动到列表顶部。
- 历史 assistant 的 `generation` 不随会话配置改变。

## 4. 默认、继承与兼容语义

| 场景 | 规则 |
| --- | --- |
| 新建会话 | 服务端把当前运行时默认配置解析为完整快照并绑定到新会话 |
| 旧会话无字段 | 页面使用当前运行时默认值；首次保存设置或下一次模型请求时写入完整快照 |
| 切换/刷新 | 加载会话详情后恢复该会话的有效配置 |
| 清空会话 | 清空 messages 和 summary，但保留 `modelOptions` |
| 创建分支 | 新分支继承父会话的 `modelOptions`；父会话不变 |
| 导入/复制 | 保留合法配置；旧备份缺少字段时保持可导入 |
| 模型被禁用/删除 | 当前会话回退到运行时可用默认模型；不允许继续请求失效模型，下一次保存或请求写回有效快照 |
| Provider 未配置 | 回退到已配置且可用的模型；若无可用 Provider，沿用现有不可发送状态和错误提示 |

不采用 `localStorage`：它无法在不同浏览器、Docker Volume 恢复、JSON 备份和 file/SQLite 之间保持会话语义，也无法可靠支持会话分支与导入导出。

## 5. 后端设计

### 5.1 类型与规范化

- 在 `server/types/conversation.ts` 增加 `ConversationModelOptions` 和可选字段。
- 提取可复用的会话配置解析函数，复用现有 model catalog、禁用状态和 `parseModelRequestOptions`/`resolveModelOptions` 规则。
- 持久化读取只接受结构和能力均有效的配置；损坏、未知或已禁用模型不会导致整个会话不可读，而是忽略该字段并走默认回退。
- `cloneConversation`、分支复制和导入 duplicate 必须复制配置对象，不能共享可变引用。

### 5.2 Store 契约

在 `ConversationStore` 增加：

```ts
updateModelOptions(
  id: string,
  options: ConversationModelOptions,
): Promise<Conversation | null>
```

- file store 在既有同会话 mutation queue 中原子改写 JSON。
- SQLite 在同一连接上参数化更新 `model_options`。
- 该操作不修改 `updatedAt`。
- `clearConversation` 保留配置；`deleteConversation` 仍删除整条会话。

### 5.3 SQLite 迁移

为 `conversations` 增加可空 JSON 列：

```sql
ALTER TABLE conversations ADD COLUMN model_options TEXT;
```

启动时继续使用 `PRAGMA table_info(conversations)` 做幂等列检测。读写规则：

- `NULL` 表示旧会话尚未绑定。
- 写入前由服务层完成验证，再 `JSON.stringify`。
- 读取时 JSON 损坏只降级该可选字段，不让其他会话数据不可用。
- 回滚到旧程序时新增列会被忽略，messages、summary 和既有列不受影响。

### 5.4 API

新增独立接口：

```http
PATCH /api/conversations/:id/model-options
Content-Type: application/json

{
  "options": {
    "provider": "openai",
    "model": "gpt-5.6-luna",
    "reasoningEnabled": true,
    "reasoningEffort": "high",
    "maxTokens": 2048
  }
}
```

成功返回完整会话详情：

```json
{
  "conversation": {
    "id": "conv_example",
    "modelOptions": {
      "provider": "openai",
      "model": "gpt-5.6-luna",
      "reasoningEnabled": true,
      "reasoningEffort": "high",
      "maxTokens": 2048
    }
  }
}
```

状态码约定：

- `400`：模型配置格式、能力或范围不合法。
- `404`：会话不存在。
- `409`：该会话正在 ask、摘要或其他互斥操作中时拒绝修改。
- `200`：配置已持久化并返回规范化后的会话详情。

接口必须放在通用 `PATCH /conversations/:id` 之前。标题和模型配置保持不同端点，避免混用 loading、错误语义和校验边界。

### 5.5 模型请求

- ask、摘要和上下文预览继续接收显式 `options`，保持现有 API 兼容。
- 应用前端提交的 options 必须与当前会话 UI 已绑定配置一致。
- 对没有 `modelOptions` 的旧会话，第一次 ask 在调用 Provider 前保存解析后的完整配置；即使 Provider 随后失败，会话选择也不会在刷新后丢失。
- 上下文预览是只读操作，不因为预览而隐式绑定或改写会话。
- 保存配置与 ask 仍服从单会话请求互斥，避免两个请求交错覆盖选择。

## 6. 前端设计

### 6.1 状态边界

新增 `useConversationModelOptions`，负责：

- 根据 runtime info 计算新会话/旧会话的安全默认值。
- 在 `currentConversationId` 或详情中的 `modelOptions` 改变时恢复当前选择。
- 校验存储配置对应的模型是否仍存在、启用且 Provider 可用。
- 保存状态、快速点击互斥、失败回滚和切换会话时的过期响应丢弃。

`useChatAppController` 只装配该 hook，不继续直接管理裸 `setModelOptions`。

### 6.2 会话 reducer

`ConversationState` 增加当前会话配置：

```ts
currentConversationModelOptions?: ConversationModelOptions
```

- `select-conversation` 从详情设置它。
- `apply-conversation-detail` 仅在 ID 等于当前会话时更新它。
- `clear-current-conversation` 保留返回详情中的配置。
- 删除当前会话时一并清空，下一会话详情加载后重新设置。

### 6.3 保存交互

用户在模型菜单或设置弹窗提交配置时：

1. 记录当前会话 ID 和旧配置。
2. 乐观更新当前 UI。
3. 设置 `isModelOptionsSaving=true`，禁用模型菜单、设置提交和重复点击。
4. 调用 model-options PATCH。
5. 仅当响应仍属于当前会话且保存序号最新时应用服务端详情。
6. 失败时仅回滚原会话的当前保存序号，并显示明确错误。
7. `finally` 恢复控件；过期响应不得覆盖已切换会话。

保存期间不禁止阅读和滚动。发送、摘要和上下文预览应等待保存完成或暂时禁用，防止 UI 显示新模型但请求仍使用旧配置。

### 6.4 新建与切换

- 新建会话由服务端返回已绑定默认配置，前端直接采用返回详情。
- 切换会话必须先获取详情，再恢复配置；不能从上一个会话沿用页面状态。
- 删除当前会话后，目标会话配置随其详情恢复。
- 分支返回的详情已经包含继承配置，编辑/重新生成继续使用该配置。

## 7. 导入导出

- 全量 JSON 备份继续使用 schema v1；`modelOptions` 是可选的向后兼容字段。
- 新版本导出合法配置，新版本导入时严格校验字段和模型参数。
- 旧备份没有字段时正常导入。
- 旧程序读取新备份时会忽略未知可选字段；若旧程序执行 overwrite，可能丢失该新字段，这是降级运行的已知边界。
- 单会话 Markdown 导出在元信息中增加当前绑定 Provider、模型和 effort，便于人工复核；历史消息仍以各自 generation 为准。
- Docker 备份不需要新逻辑，完整 `/app/data` Volume 会自然包含 SQLite 新列或 file JSON 字段。

## 8. 文件级实施范围

后端主要修改：

- `server/types/conversation.ts`
- `server/utils/conversationStore/contracts.ts`
- `server/utils/conversationStore/normalization.ts`
- `server/utils/conversationStore/fileStore.ts`
- `server/utils/conversationStore/sqliteStore.ts`
- `server/utils/conversationStore.ts`
- `server/services/conversationService.ts`
- `server/controllers/conversationController.ts`
- `server/routes/conversations.ts`
- `server/services/conversationImportService.ts`
- `server/services/conversationExportService.ts`

前端主要修改：

- `client/src/types/chat.ts`
- `client/src/api/conversations.ts`
- `client/src/reducers/conversationReducer.ts`
- `client/src/hooks/useConversations.ts`
- `client/src/hooks/useChatAppController.ts`
- `client/src/hooks/useConversationModelOptions.ts`（新增）
- `client/src/components/ModelOptionsMenu.tsx`
- `client/src/components/ModelSettingsModal.tsx`

测试继续集中在根 `tests/`，不在源码目录旁新增测试文件。

## 9. 测试矩阵

本节所列场景均已落实；最终门禁和结果见 [R17 会话级模型配置持久化验收记录](r17-conversation-model-options-2026-08-13.md)。

### 9.1 后端与存储

- file/SQLite 新建后保存，关闭并重开 store 后配置一致。
- SQLite 无列数据库自动增列；重复启动幂等。
- 旧 file JSON、旧 SQLite 行和旧 schema v1 备份无字段时正常读取。
- 损坏 JSON、未知模型、已禁用模型和越界参数只降级配置，不损坏会话消息。
- 更新配置不改变 `updatedAt` 和列表排序。
- 清空保留配置，分支继承配置，duplicate/overwrite/skip 语义正确。
- JSON 与 Markdown 导出、file/SQLite 导入保持配置一致。
- ask 首次绑定旧会话；上下文预览不产生写入。
- 活动 ask/摘要期间更新配置返回 409，结束后可恢复。

### 9.2 React 单测

- runtime 默认、会话配置和无效配置回退优先级。
- A/B 会话切换恢复不同模型和 effort。
- 初始化时 runtime 与会话详情乱序不会让默认值覆盖已绑定配置。
- 保存成功采用服务端规范化结果。
- 保存失败回滚并显示错误。
- 快速点击只允许一个有效保存；迟到响应不覆盖新会话。
- 保存中发送、摘要和上下文预览不可触发。
- 删除、清空、新建和分支后的配置状态正确。

### 9.3 CDP 与 Docker

- 在会话 A 选择 OpenAI/High，在会话 B 选择 DeepSeek/Low，往返切换分别恢复。
- 刷新页面后模型菜单标签、设置弹窗和实际 ask options 一致。
- 保存请求有 loading/disabled 状态，快速点击只产生一次有效 PATCH。
- PATCH 失败时 UI 回滚，后续再次保存和发送可恢复。
- 已禁用模型的旧 fixture 回退到 Flash，禁用模型不产生 ask。
- SQLite Docker Volume 重启后配置保持；备份到新 Volume 并恢复后配置一致。
- 默认使用 mock；真实 Provider 只在用户明确授权后验证各一个最小请求，不需要遍历所有 effort。

## 10. 分阶段实施与提交

1. **后端数据与存储**：类型、规范化、file/SQLite、迁移和单测。
2. **API 与导入导出**：PATCH、互斥、旧会话首次绑定、备份兼容和专项测试。
3. **前端状态**：reducer、hook、保存 loading/回滚、切换与刷新单测。
4. **浏览器与 Docker 回归**：A/B 会话、刷新、快速点击、失败恢复和 Volume 持久化。
5. **文档收口**：实现完成后更新架构、功能清单、回归矩阵和 Roadmap 状态。

各阶段已按顺序实现并验证。当前改动尚未提交；SQLite 新增可空列无需删除，旧代码会忽略它。

## 11. 验收标准

- 刷新、切换、重启和 Volume 恢复后，会话模型与 effort 均保持。
- A/B 会话互不污染，新会话使用运行时默认配置，分支继承父会话配置。
- 实际 ask、摘要和上下文预览参数与 UI 当前会话选择一致。
- 保存中有明确等待态并阻止重复操作；失败可回滚和重试。
- 旧数据无需一次性迁移，已禁用/删除模型安全降级。
- file、SQLite、导入导出、Docker、React 单测和 CDP 门禁全部通过。
- Roadmap、架构、功能清单、回归矩阵与 R17 验收记录已同步实现状态。

## 12. 非目标

- 不增加全局模型偏好页、模型使用统计或自动选模。
- 不按单条消息保存“下一次模型配置”；历史实际模型继续由 generation 记录。
- 不改变 Provider SSE、NDJSON v2、Function Calling 或取消协议。
- 不增加登录、多用户配置同步或云端配置服务。
