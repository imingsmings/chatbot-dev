import crypto from 'node:crypto'
import path from 'node:path'
import { MAX_AUTO_TITLE_LENGTH } from '../../config/productLimits.ts'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationSummary,
  StoredMessage
} from '../../types/conversation.ts'
import { DEFAULT_TITLE } from './contracts.ts'
import { CONVERSATIONS_DIR } from './paths.ts'

export function now(): string {
  return new Date().toISOString()
}

export function createId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return `conv_${crypto.randomUUID()}`
  }

  return `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function recoverConversationId(value: unknown): string {
  const payload = JSON.stringify(value) ?? String(value)
  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24)
  return `conv_recovered_${digest}`
}

export function getConversationFilePath(id: string): string | null {
  if (!/^conv_[a-zA-Z0-9_-]+$/.test(id)) {
    return null
  }

  return path.join(CONVERSATIONS_DIR, `${id}.json`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback
}

export function normalizeMessage(message: unknown): StoredMessage {
  const rawMessage = isRecord(message) ? message : {}
  const role = rawMessage.role === 'assistant' ? 'assistant' : 'user'
  const normalizedMessage: StoredMessage = {
    role,
    content: typeof rawMessage.content === 'string' ? rawMessage.content : ''
  }

  if (role === 'assistant' && typeof rawMessage.reasoningContent === 'string') {
    normalizedMessage.reasoningContent = rawMessage.reasoningContent
  }

  if (
    role === 'assistant' &&
    typeof rawMessage.reasoningDurationMs === 'number' &&
    Number.isFinite(rawMessage.reasoningDurationMs) &&
    rawMessage.reasoningDurationMs >= 0
  ) {
    normalizedMessage.reasoningDurationMs = rawMessage.reasoningDurationMs
  }

  return normalizedMessage
}

function normalizeConversationSummary(
  value: unknown,
  fallbackUpdatedAt: string,
  messageCount: number
): ConversationContextSummary | undefined {
  if (!isRecord(value) || typeof value.content !== 'string' || !value.content.trim()) {
    return undefined
  }

  const sourceMessageCount =
    typeof value.sourceMessageCount === 'number' &&
    Number.isInteger(value.sourceMessageCount) &&
    value.sourceMessageCount >= 0
      ? value.sourceMessageCount
      : 0

  return {
    content: value.content.trim(),
    sourceMessageCount: Math.min(sourceMessageCount, messageCount),
    updatedAt: normalizeTimestamp(value.updatedAt, fallbackUpdatedAt)
  }
}

export function normalizeConversation(conversation: unknown, expectedId?: string): Conversation {
  const rawConversation = isRecord(conversation) ? conversation : {}
  const createdAt = normalizeTimestamp(rawConversation.createdAt, now())
  const updatedAt = normalizeTimestamp(rawConversation.updatedAt, createdAt)
  const title =
    typeof rawConversation.title === 'string' && rawConversation.title.trim()
      ? rawConversation.title.trim()
      : DEFAULT_TITLE

  const normalized: Conversation = {
    id:
      expectedId ??
      (typeof rawConversation.id === 'string' && getConversationFilePath(rawConversation.id)
        ? rawConversation.id
        : recoverConversationId(rawConversation)),
    title,
    createdAt,
    updatedAt,
    titleManuallyEdited: Boolean(rawConversation.titleManuallyEdited),
    messages: Array.isArray(rawConversation.messages)
      ? rawConversation.messages.map(normalizeMessage)
      : []
  }

  const summary = normalizeConversationSummary(rawConversation.summary, updatedAt, normalized.messages.length)
  if (summary) {
    normalized.summary = summary
  }

  return normalized
}

export function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    summary: conversation.summary ? { ...conversation.summary } : undefined
  }
}

export function summarizeConversation(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  }
}

function createTitleFromQuestion(question: string): string {
  const text = question.trim()
  if (!text) return DEFAULT_TITLE
  return text.length > MAX_AUTO_TITLE_LENGTH
    ? `${text.slice(0, MAX_AUTO_TITLE_LENGTH)}...`
    : text
}

export function sortConversationSummaries(
  conversations: Conversation[]
): ConversationSummary[] {
  return conversations
    .map(summarizeConversation)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function applyAppendedMessages(
  conversation: Conversation,
  messages: StoredMessage[]
): Conversation {
  const normalizedMessages = messages.map(normalizeMessage)
  conversation.messages.push(...normalizedMessages)

  const firstUserMessage = normalizedMessages.find((message) => message.role === 'user')
  if (!conversation.titleManuallyEdited && conversation.title === DEFAULT_TITLE && firstUserMessage) {
    conversation.title = createTitleFromQuestion(firstUserMessage.content)
  }

  conversation.updatedAt = now()
  return conversation
}

export function createImportedDuplicate(conversation: Conversation): Conversation {
  const timestamp = now()
  return {
    ...cloneConversation(conversation),
    id: createId(),
    title: `${conversation.title} (导入)`,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
