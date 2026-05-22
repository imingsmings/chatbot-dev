import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Conversation, ConversationSummary, StoredMessage } from '../types/conversation.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = process.env.CONVERSATION_DATA_DIR || path.join(__dirname, '..', 'data')
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations')
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'conversations.json')
const DEFAULT_TITLE = '新的聊天'

let migrationPromise: Promise<void> | null = null
const writeQueues = new Map<string, Promise<void>>()

function now(): string {
  return new Date().toISOString()
}

function createId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return `conv_${crypto.randomUUID()}`
  }

  return `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function getConversationFilePath(id: string): string | null {
  if (!/^conv_[a-zA-Z0-9_-]+$/.test(id)) {
    return null
  }

  return path.join(CONVERSATIONS_DIR, `${id}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function normalizeMessage(message: unknown): StoredMessage {
  const rawMessage = isRecord(message) ? message : {}

  return {
    role: rawMessage.role === 'assistant' ? 'assistant' : 'user',
    content: typeof rawMessage.content === 'string' ? rawMessage.content : ''
  }
}

function normalizeConversation(conversation: unknown): Conversation {
  const rawConversation = isRecord(conversation) ? conversation : {}
  const createdAt = typeof rawConversation.createdAt === 'string' ? rawConversation.createdAt : now()
  const updatedAt = typeof rawConversation.updatedAt === 'string' ? rawConversation.updatedAt : createdAt
  const title =
    typeof rawConversation.title === 'string' && rawConversation.title.trim()
      ? rawConversation.title.trim()
      : DEFAULT_TITLE

  return {
    id: typeof rawConversation.id === 'string' ? rawConversation.id : createId(),
    title,
    createdAt,
    updatedAt,
    titleManuallyEdited: Boolean(rawConversation.titleManuallyEdited),
    messages: Array.isArray(rawConversation.messages) ? rawConversation.messages.map(normalizeMessage) : []
  }
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [...conversation.messages]
  }
}

function summarizeConversation(conversation: Conversation): ConversationSummary {
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
  return text.length > 18 ? `${text.slice(0, 18)}...` : text
}

async function ensureConversationDir(): Promise<void> {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true })
}

async function writeConversationFile(conversation: Conversation): Promise<void> {
  await ensureConversationDir()

  const filePath = getConversationFilePath(conversation.id)
  if (!filePath) {
    throw new Error('会话 ID 不合法')
  }

  const previousWrite = writeQueues.get(conversation.id) || Promise.resolve()
  const nextWrite = previousWrite.catch(() => undefined).then(() =>
    fs.writeFile(filePath, `${JSON.stringify(conversation, null, 2)}\n`, 'utf8')
  )
  writeQueues.set(conversation.id, nextWrite)
  try {
    await nextWrite
  } finally {
    if (writeQueues.get(conversation.id) === nextWrite) {
      writeQueues.delete(conversation.id)
    }
  }
}

async function readConversationFile(id: string): Promise<Conversation | null> {
  await migrateLegacyStore()

  const filePath = getConversationFilePath(id)
  if (!filePath) return null

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return normalizeConversation(JSON.parse(raw))
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null
    throw err
  }
}

async function readAllConversations(): Promise<Conversation[]> {
  await migrateLegacyStore()
  await ensureConversationDir()

  const entries = await fs.readdir(CONVERSATIONS_DIR, { withFileTypes: true })
  const conversations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(CONVERSATIONS_DIR, entry.name)
        const raw = await fs.readFile(filePath, 'utf8')
        return normalizeConversation(JSON.parse(raw))
      })
  )

  return conversations
}

async function migrateLegacyStore(): Promise<void> {
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    await ensureConversationDir()

    let raw
    try {
      raw = await fs.readFile(LEGACY_DATA_FILE, 'utf8')
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return
      throw err
    }

    const data = JSON.parse(raw) as unknown
    const conversations =
      isRecord(data) && Array.isArray(data.conversations) ? data.conversations.map(normalizeConversation) : []

    for (const conversation of conversations) {
      await writeConversationFile(conversation)
    }

    await fs.rename(LEGACY_DATA_FILE, `${LEGACY_DATA_FILE}.migrated`)
  })()

  return migrationPromise
}

async function listConversations(): Promise<ConversationSummary[]> {
  const conversations = await readAllConversations()
  return conversations
    .map(summarizeConversation)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

async function getConversation(id: string): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  await migrateLegacyStore()

  const timestamp = now()
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE
  const conversation = {
    id: createId(),
    title: normalizedTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
    titleManuallyEdited: normalizedTitle !== DEFAULT_TITLE,
    messages: []
  }

  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function renameConversation(id: string, title: unknown): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)
  const nextTitle = typeof title === 'string' ? title.trim() : ''

  if (!conversation || !nextTitle) {
    return null
  }

  conversation.title = nextTitle
  conversation.titleManuallyEdited = true
  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function appendMessages(id: string, messages: StoredMessage[]): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  const normalizedMessages = messages.map(normalizeMessage)
  conversation.messages.push(...normalizedMessages)

  const firstUserMessage = normalizedMessages.find((message) => message.role === 'user')
  if (!conversation.titleManuallyEdited && conversation.title === DEFAULT_TITLE && firstUserMessage) {
    conversation.title = createTitleFromQuestion(firstUserMessage.content)
  }

  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function clearConversation(id: string): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  conversation.messages = []
  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function deleteConversation(id: string): Promise<boolean> {
  await migrateLegacyStore()

  const filePath = getConversationFilePath(id)
  if (!filePath) return false

  try {
    await fs.unlink(filePath)
    writeQueues.delete(id)
    return true
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return false
    throw err
  }
}

export {
  DEFAULT_TITLE,
  appendMessages,
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
}
