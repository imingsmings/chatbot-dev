import { importConversation } from '../utils/conversationStore.ts'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_IMPORT_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
} from '../config/productLimits.ts'
import { EXPORT_SCHEMA_VERSION } from './conversationExportService.ts'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportResult,
  StoredMessage
} from '../types/conversation.ts'

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
