import crypto from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'
import { getConversation, importConversation } from '../utils/conversationStore.ts'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_IMPORT_CONVERSATIONS,
  MAX_IMAGE_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_PORTABLE_BACKUP_BYTES,
  MAX_STORED_TOOL_TRACE_ITEMS,
  MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH,
} from '../config/productLimits.ts'
import {
  EXPORT_SCHEMA_VERSION,
  PORTABLE_EXPORT_SCHEMA_VERSION,
} from './conversationExportService.ts'
import {
  inspectImage,
  parseStoredRecord,
  removeAttachmentFiles,
  writeStoredAttachment,
  type StoredAttachmentRecord,
} from './attachmentService.ts'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportResult,
  ConversationImportItemResult,
  ImageAttachment,
  StoredMessage
} from '../types/conversation.ts'
import type { GenerationMetadata, StoredToolTrace, TokenUsage } from '../types/generation.ts'
import { parseConversationModelOptions } from '../utils/modelOptions.ts'
import {
  cloneConversation,
  createImportedDuplicate,
} from '../utils/conversationStore/normalization.ts'

const VALID_CONVERSATION_ID = /^conv_[a-zA-Z0-9_-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(record: Record<string, unknown>, name: string): string {
  const value = record[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串`)
  }
  return value.trim()
}

function readTimestamp(record: Record<string, unknown>, name: string): string {
  const value = readRequiredString(record, name)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} 必须是有效时间`)
  }
  return value
}

function readNonNegativeNumber(value: unknown, path: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${path} 必须是非负${integer ? '整数' : '数字'}`)
  }
  return value
}

function parseUsage(value: unknown, path: string): TokenUsage | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)

  const usage: TokenUsage = {}
  const fields = [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'reasoningTokens',
    'cachedInputTokens'
  ] as const
  for (const field of fields) {
    if (value[field] !== undefined) {
      usage[field] = readNonNegativeNumber(value[field], `${path}.${field}`, true)
    }
  }

  return Object.keys(usage).length ? usage : undefined
}

function parseGeneration(value: unknown, path: string): GenerationMetadata | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)
  if (value.provider !== 'deepseek' && value.provider !== 'openai') {
    throw new Error(`${path}.provider 必须是 deepseek 或 openai`)
  }
  if (typeof value.model !== 'string' || !value.model.trim()) {
    throw new Error(`${path}.model 必须是非空字符串`)
  }

  const generation: GenerationMetadata = {
    provider: value.provider,
    model: value.model.trim(),
    totalDurationMs: readNonNegativeNumber(value.totalDurationMs, `${path}.totalDurationMs`)
  }
  if (value.finishReason !== undefined) {
    if (typeof value.finishReason !== 'string' || !value.finishReason.trim()) {
      throw new Error(`${path}.finishReason 必须是非空字符串`)
    }
    generation.finishReason = value.finishReason.trim()
  }
  if (value.firstTokenLatencyMs !== undefined) {
    generation.firstTokenLatencyMs = readNonNegativeNumber(
      value.firstTokenLatencyMs,
      `${path}.firstTokenLatencyMs`
    )
  }
  const usage = parseUsage(value.usage, `${path}.usage`)
  if (usage) generation.usage = usage
  return generation
}

function parseToolTrace(value: unknown, path: string): StoredToolTrace[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`)
  if (value.length > MAX_STORED_TOOL_TRACE_ITEMS) {
    throw new Error(`${path} 不能超过 ${MAX_STORED_TOOL_TRACE_ITEMS} 项`)
  }

  return value.map((item, traceIndex) => {
    const itemPath = `${path}[${traceIndex}]`
    if (!isRecord(item)) throw new Error(`${itemPath} 必须是对象`)
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error(`${itemPath}.name 必须是非空字符串`)
    }
    if (typeof item.success !== 'boolean') {
      throw new Error(`${itemPath}.success 必须是布尔值`)
    }
    if (typeof item.summary !== 'string') {
      throw new Error(`${itemPath}.summary 必须是字符串`)
    }
    if (item.summary.length > MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH) {
      throw new Error(`${itemPath}.summary 不能超过 ${MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH} 个字符`)
    }
    return {
      name: item.name.trim(),
      success: item.success,
      durationMs: readNonNegativeNumber(item.durationMs, `${itemPath}.durationMs`),
      summary: item.summary
    }
  })
}

function parseImageAttachments(value: unknown, path: string): ImageAttachment[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`)
  if (value.length > MAX_IMAGE_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`${path} 不能超过 ${MAX_IMAGE_ATTACHMENTS_PER_MESSAGE} 项`)
  }
  const ids = new Set<string>()
  return value.map((item, attachmentIndex) => {
    const itemPath = `${path}[${attachmentIndex}]`
    if (!isRecord(item)) throw new Error(`${itemPath} 必须是对象`)
    if (typeof item.id !== 'string' || !/^att_[0-9a-f-]{36}$/.test(item.id)) {
      throw new Error(`${itemPath}.id 不合法`)
    }
    if (ids.has(item.id)) throw new Error(`${path} 包含重复附件 ID`)
    ids.add(item.id)
    if (
      item.kind !== 'image' ||
      typeof item.filename !== 'string' ||
      !item.filename.trim() ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(String(item.mediaType)) ||
      typeof item.byteSize !== 'number' ||
      !Number.isInteger(item.byteSize) ||
      item.byteSize < 1 ||
      typeof item.width !== 'number' ||
      !Number.isInteger(item.width) ||
      item.width < 1 ||
      typeof item.height !== 'number' ||
      !Number.isInteger(item.height) ||
      item.height < 1 ||
      !['auto', 'low', 'original'].includes(String(item.detail))
    ) {
      throw new Error(`${itemPath} 元数据不合法`)
    }
    return {
      id: item.id,
      kind: 'image',
      filename: item.filename.trim(),
      mediaType: item.mediaType as ImageAttachment['mediaType'],
      byteSize: item.byteSize,
      width: item.width,
      height: item.height,
      detail: item.detail as ImageAttachment['detail'],
    }
  })
}

function parseStoredMessage(value: unknown, index: number, allowAttachments = false): StoredMessage {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant')) {
    throw new Error(`messages[${index}] 的 role 不合法`)
  }

  if (typeof value.content !== 'string') {
    throw new Error(`messages[${index}] 的 content 必须是字符串`)
  }

  const message: StoredMessage = {
    role: value.role,
    content: value.content
  }

  if (value.role === 'assistant' && value.reasoningContent !== undefined) {
    if (typeof value.reasoningContent !== 'string') {
      throw new Error(`messages[${index}] 的 reasoningContent 必须是字符串`)
    }
    message.reasoningContent = value.reasoningContent
  }

  if (value.role === 'assistant' && value.reasoningDurationMs !== undefined) {
    if (
      typeof value.reasoningDurationMs !== 'number' ||
      !Number.isFinite(value.reasoningDurationMs) ||
      value.reasoningDurationMs < 0
    ) {
      throw new Error(`messages[${index}] 的 reasoningDurationMs 不合法`)
    }
    message.reasoningDurationMs = value.reasoningDurationMs
  }

  if (value.status !== undefined) {
    if (value.role !== 'assistant' || (value.status !== 'completed' && value.status !== 'stopped')) {
      throw new Error(`messages[${index}] 的 status 不合法`)
    }
    message.status = value.status
  }

  if (value.generation !== undefined) {
    if (value.role !== 'assistant') {
      throw new Error(`messages[${index}] 的 generation 只允许用于 assistant`)
    }
    message.generation = parseGeneration(value.generation, `messages[${index}].generation`)
  }

  if (value.toolTrace !== undefined) {
    if (value.role !== 'assistant') {
      throw new Error(`messages[${index}] 的 toolTrace 只允许用于 assistant`)
    }
    message.toolTrace = parseToolTrace(value.toolTrace, `messages[${index}].toolTrace`)
  }

  if (value.attachments !== undefined) {
    if (!allowAttachments || value.role !== 'user') {
      throw new Error(`messages[${index}] 的 attachments 不合法`)
    }
    const attachments = parseImageAttachments(value.attachments, `messages[${index}].attachments`)
    if (attachments.length) message.attachments = attachments
  }

  return message
}

function parseContextSummary(value: unknown): ConversationContextSummary | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error('summary 必须是对象')
  }

  const content = readRequiredString(value, 'content')
  const sourceMessageCount = value.sourceMessageCount
  if (
    typeof sourceMessageCount !== 'number' ||
    !Number.isInteger(sourceMessageCount) ||
    sourceMessageCount < 0
  ) {
    throw new Error('summary.sourceMessageCount 必须是非负整数')
  }

  return {
    content,
    sourceMessageCount,
    updatedAt: readTimestamp(value, 'updatedAt')
  }
}

function parseConversation(value: unknown, index: number, allowAttachments = false): Conversation {
  if (!isRecord(value)) {
    throw new Error(`conversations[${index}] 必须是对象`)
  }

  const id = readRequiredString(value, 'id')
  if (!VALID_CONVERSATION_ID.test(id)) {
    throw new Error(`conversations[${index}] 的 id 不合法`)
  }

  if (!Array.isArray(value.messages)) {
    throw new Error(`conversations[${index}] 的 messages 必须是数组`)
  }

  if (value.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    throw new Error(`conversations[${index}] 的消息数超过 ${MAX_MESSAGES_PER_CONVERSATION}`)
  }

  if (typeof value.titleManuallyEdited !== 'boolean') {
    throw new Error(`conversations[${index}] 的 titleManuallyEdited 必须是布尔值`)
  }

  const conversation: Conversation = {
    id,
    title: readRequiredString(value, 'title'),
    createdAt: readTimestamp(value, 'createdAt'),
    updatedAt: readTimestamp(value, 'updatedAt'),
    titleManuallyEdited: value.titleManuallyEdited,
    messages: value.messages.map((message, messageIndex) =>
      parseStoredMessage(message, messageIndex, allowAttachments)
    )
  }

  if (conversation.title.length > MAX_CONVERSATION_TITLE_LENGTH) {
    throw new Error(
      `conversations[${index}] 的 title 不能超过 ${MAX_CONVERSATION_TITLE_LENGTH} 个字符`,
    )
  }

  const summary = parseContextSummary(value.summary)
  if (summary) {
    conversation.summary = {
      ...summary,
      sourceMessageCount: Math.min(summary.sourceMessageCount, conversation.messages.length)
    }
  }

  if (value.modelOptions !== undefined && value.modelOptions !== null) {
    try {
      conversation.modelOptions = parseConversationModelOptions(value.modelOptions)
    } catch (error) {
      throw new Error(
        `conversations[${index}].modelOptions 不合法：${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  return conversation
}

function parseConflictStrategy(value: unknown): ConversationImportConflictStrategy {
  if (value === undefined || value === null || value === '') {
    return 'skip'
  }

  if (value === 'skip' || value === 'duplicate' || value === 'overwrite') {
    return value
  }

  throw new Error('conflictStrategy 只能是 skip、duplicate 或 overwrite')
}

async function importConversationBackup(
  backupValue: unknown,
  conflictStrategyValue?: unknown
): Promise<ConversationImportResult> {
  if (!isRecord(backupValue)) {
    throw new Error('备份内容必须是 JSON 对象')
  }

  if (backupValue.schemaVersion !== EXPORT_SCHEMA_VERSION || backupValue.source !== 'chatbot-local') {
    throw new Error(`只支持 chatbot-local schemaVersion ${EXPORT_SCHEMA_VERSION} 备份`)
  }

  if (!Array.isArray(backupValue.conversations)) {
    throw new Error('备份 conversations 必须是数组')
  }

  readTimestamp(backupValue, 'exportedAt')

  if (backupValue.conversations.length > MAX_IMPORT_CONVERSATIONS) {
    throw new Error(`单次最多导入 ${MAX_IMPORT_CONVERSATIONS} 个会话`)
  }

  const strategy = parseConflictStrategy(conflictStrategyValue)
  const conversations = backupValue.conversations.map((value, index) =>
    parseConversation(value, index)
  )
  const conversationIds = new Set<string>()
  for (const conversation of conversations) {
    if (conversationIds.has(conversation.id)) {
      throw new Error(`备份中存在重复会话 id：${conversation.id}`)
    }
    conversationIds.add(conversation.id)
  }
  const items = []

  for (const conversation of conversations) {
    items.push(await importConversation(conversation, strategy))
  }

  return {
    total: items.length,
    created: items.filter((item) => item.status === 'created').length,
    duplicated: items.filter((item) => item.status === 'duplicated').length,
    overwritten: items.filter((item) => item.status === 'overwritten').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    items
  }
}

function summarizeImportItems(items: ConversationImportItemResult[]): ConversationImportResult {
  return {
    total: items.length,
    created: items.filter((item) => item.status === 'created').length,
    duplicated: items.filter((item) => item.status === 'duplicated').length,
    overwritten: items.filter((item) => item.status === 'overwritten').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    items,
  }
}

function validateArchiveEntries(buffer: Buffer): Record<string, Uint8Array> {
  if (buffer.length < 1) throw new Error('ZIP 备份不能为空')
  if (buffer.length > MAX_PORTABLE_BACKUP_BYTES) {
    throw new Error(`ZIP 备份不能超过 ${MAX_PORTABLE_BACKUP_BYTES / 1024 / 1024} MiB`)
  }
  let totalOriginalBytes = 0
  return unzipSync(buffer, {
    filter: (file) => {
      const allowed = file.name === 'manifest.json' ||
        /^attachments\/att_[0-9a-f-]{36}\.data$/.test(file.name)
      if (!allowed || file.name.includes('..') || file.name.startsWith('/')) {
        throw new Error(`ZIP 包含不允许的路径：${file.name}`)
      }
      totalOriginalBytes += file.originalSize
      if (totalOriginalBytes > MAX_PORTABLE_BACKUP_BYTES) {
        throw new Error(`ZIP 解压内容不能超过 ${MAX_PORTABLE_BACKUP_BYTES / 1024 / 1024} MiB`)
      }
      return true
    },
  })
}

function remapConversationAttachments(
  conversation: Conversation,
  attachmentIds: Map<string, string>,
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: message.attachments?.map((attachment) => ({
        ...attachment,
        id: attachmentIds.get(attachment.id) ?? attachment.id,
      })),
    })),
  }
}

async function importConversationZip(
  archiveBuffer: Buffer,
  conflictStrategyValue?: unknown,
): Promise<ConversationImportResult> {
  const entries = validateArchiveEntries(archiveBuffer)
  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) throw new Error('ZIP 缺少 manifest.json')

  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(strFromU8(manifestBytes)) as unknown
  } catch {
    throw new Error('manifest.json 不是有效 JSON')
  }
  if (!isRecord(manifestValue)) throw new Error('manifest.json 必须是对象')
  if (
    manifestValue.schemaVersion !== PORTABLE_EXPORT_SCHEMA_VERSION ||
    manifestValue.source !== 'chatbot-local'
  ) {
    throw new Error(`只支持 chatbot-local schemaVersion ${PORTABLE_EXPORT_SCHEMA_VERSION} ZIP 备份`)
  }
  readTimestamp(manifestValue, 'exportedAt')
  if (!Array.isArray(manifestValue.conversations)) throw new Error('manifest conversations 必须是数组')
  if (manifestValue.conversations.length > MAX_IMPORT_CONVERSATIONS) {
    throw new Error(`单次最多导入 ${MAX_IMPORT_CONVERSATIONS} 个会话`)
  }
  if (!Array.isArray(manifestValue.attachments)) throw new Error('manifest attachments 必须是数组')

  const conversations = manifestValue.conversations.map((value, index) =>
    parseConversation(value, index, true)
  )
  const conversationIds = new Set<string>()
  for (const conversation of conversations) {
    if (conversationIds.has(conversation.id)) {
      throw new Error(`备份中存在重复会话 id：${conversation.id}`)
    }
    conversationIds.add(conversation.id)
  }
  const records = new Map<string, { data: Buffer; record: StoredAttachmentRecord }>()
  for (const value of manifestValue.attachments) {
    if (!isRecord(value) || typeof value.path !== 'string') {
      throw new Error('manifest attachment 不合法')
    }
    const record = parseStoredRecord(value)
    if (records.has(record.id)) throw new Error(`manifest 包含重复附件：${record.id}`)
    const expectedPath = `attachments/${record.id}.data`
    if (value.path !== expectedPath) throw new Error(`附件 ${record.id} 的路径不合法`)
    const entry = entries[expectedPath]
    if (!entry) throw new Error(`ZIP 缺少附件文件：${expectedPath}`)
    const data = Buffer.from(entry)
    if (
      data.length !== record.byteSize ||
      crypto.createHash('sha256').update(data).digest('hex') !== record.sha256
    ) {
      throw new Error(`附件 ${record.id} 校验失败`)
    }
    const inspected = inspectImage(data)
    if (
      inspected.mediaType !== record.mediaType ||
      inspected.width !== record.width ||
      inspected.height !== record.height
    ) {
      throw new Error(`附件 ${record.id} 的图片元数据不一致`)
    }
    records.set(record.id, { data, record })
  }

  const referencedIds = new Set<string>()
  for (const conversation of conversations) {
    for (const attachment of conversation.messages.flatMap((message) => message.attachments ?? [])) {
      const stored = records.get(attachment.id)
      if (!stored || stored.record.conversationId !== conversation.id) {
        throw new Error(`会话 ${conversation.id} 的附件 ${attachment.id} 缺失或绑定错误`)
      }
      const expected = {
        id: stored.record.id,
        kind: stored.record.kind,
        filename: stored.record.filename,
        mediaType: stored.record.mediaType,
        byteSize: stored.record.byteSize,
        width: stored.record.width,
        height: stored.record.height,
        detail: stored.record.detail,
      }
      if (JSON.stringify(attachment) !== JSON.stringify(expected)) {
        throw new Error(`会话 ${conversation.id} 的附件 ${attachment.id} 元数据不一致`)
      }
      referencedIds.add(attachment.id)
    }
  }
  if (referencedIds.size !== records.size) throw new Error('manifest 包含未被会话引用的附件')
  const archiveAttachmentPaths = Object.keys(entries).filter((name) => name !== 'manifest.json')
  if (archiveAttachmentPaths.length !== records.size) {
    throw new Error('ZIP 包含未在 manifest 声明的附件文件')
  }

  const strategy = parseConflictStrategy(conflictStrategyValue)
  const items: ConversationImportItemResult[] = []
  for (const source of conversations) {
    const existing = await getConversation(source.id)
    if (existing && strategy === 'skip') {
      items.push({
        sourceId: source.id,
        conversationId: existing.id,
        status: 'skipped',
      })
      continue
    }

    const target = existing && strategy === 'duplicate'
      ? createImportedDuplicate(source)
      : cloneConversation(source)
    const attachmentIds = new Map<string, string>()
    for (const attachment of source.messages.flatMap((message) => message.attachments ?? [])) {
      if (!attachmentIds.has(attachment.id)) {
        attachmentIds.set(attachment.id, `att_${crypto.randomUUID()}`)
      }
    }
    const remapped = remapConversationAttachments(target, attachmentIds)
    const createdAttachmentIds: string[] = []

    try {
      for (const [sourceId, targetId] of attachmentIds) {
        const archived = records.get(sourceId)
        if (!archived) throw new Error(`附件 ${sourceId} 缺失`)
        const record: StoredAttachmentRecord = {
          ...archived.record,
          id: targetId,
          conversationId: remapped.id,
          createdAt: new Date().toISOString(),
        }
        await writeStoredAttachment(record, archived.data)
        createdAttachmentIds.push(targetId)
      }

      const status = existing
        ? strategy === 'duplicate' ? 'duplicated' : 'overwritten'
        : 'created'
      const imported = await importConversation(
        remapped,
        existing && strategy === 'overwrite' ? 'overwrite' : 'skip',
      )
      if (!imported.conversationId) throw new Error(`会话 ${source.id} 导入冲突`)
      items.push({
        sourceId: source.id,
        conversationId: imported.conversationId,
        status,
      })
    } catch (error) {
      await removeAttachmentFiles(createdAttachmentIds)
      throw error
    }
  }

  return summarizeImportItems(items)
}

export {
  importConversationBackup,
  importConversationZip,
  parseConflictStrategy
}
