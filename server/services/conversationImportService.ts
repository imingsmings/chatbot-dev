import { importConversation } from '../utils/conversationStore.ts'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_IMPORT_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_STORED_TOOL_TRACE_ITEMS,
  MAX_STORED_TOOL_TRACE_SUMMARY_LENGTH,
} from '../config/productLimits.ts'
import { EXPORT_SCHEMA_VERSION } from './conversationExportService.ts'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportResult,
  StoredMessage
} from '../types/conversation.ts'
import type { GenerationMetadata, StoredToolTrace, TokenUsage } from '../types/generation.ts'
import { parseConversationModelOptions } from '../utils/modelOptions.ts'

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

function parseStoredMessage(value: unknown, index: number): StoredMessage {
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

function parseConversation(value: unknown, index: number): Conversation {
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
    messages: value.messages.map(parseStoredMessage)
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
  const conversations = backupValue.conversations.map(parseConversation)
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

export {
  importConversationBackup,
  parseConflictStrategy
}
