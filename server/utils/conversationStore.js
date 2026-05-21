import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = process.env.CONVERSATION_DATA_DIR || path.join(__dirname, '..', 'data')
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations')
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'conversations.json')
const DEFAULT_TITLE = '新的聊天'

let migrationPromise = null
const writeQueues = new Map()

function now() {
  return new Date().toISOString()
}

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return `conv_${crypto.randomUUID()}`
  }

  return `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function getConversationFilePath(id) {
  if (!/^conv_[a-zA-Z0-9_-]+$/.test(id)) {
    return null
  }

  return path.join(CONVERSATIONS_DIR, `${id}.json`)
}

function normalizeMessage(message) {
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: typeof message.content === 'string' ? message.content : ''
  }
}

function normalizeConversation(conversation) {
  const createdAt = conversation.createdAt || now()
  const updatedAt = conversation.updatedAt || createdAt
  const title = typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title.trim() : DEFAULT_TITLE

  return {
    id: conversation.id || createId(),
    title,
    createdAt,
    updatedAt,
    titleManuallyEdited: Boolean(conversation.titleManuallyEdited),
    messages: Array.isArray(conversation.messages) ? conversation.messages.map(normalizeMessage) : []
  }
}

function cloneConversation(conversation) {
  return {
    ...conversation,
    messages: [...conversation.messages]
  }
}

function summarizeConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  }
}

function createTitleFromQuestion(question) {
  const text = question.trim()
  if (!text) return DEFAULT_TITLE
  return text.length > 18 ? `${text.slice(0, 18)}...` : text
}

async function ensureConversationDir() {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true })
}

async function writeConversationFile(conversation) {
  await ensureConversationDir()

  const filePath = getConversationFilePath(conversation.id)
  if (!filePath) {
    throw new Error('会话 ID 不合法')
  }

  const previousWrite = writeQueues.get(conversation.id) || Promise.resolve()
  const nextWrite = previousWrite.then(() =>
    fs.writeFile(filePath, `${JSON.stringify(conversation, null, 2)}\n`, 'utf8')
  )
  writeQueues.set(conversation.id, nextWrite.catch(() => {}))
  await nextWrite
}

async function readConversationFile(id) {
  await migrateLegacyStore()

  const filePath = getConversationFilePath(id)
  if (!filePath) return null

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return normalizeConversation(JSON.parse(raw))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function readAllConversations() {
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

async function migrateLegacyStore() {
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    await ensureConversationDir()

    let raw
    try {
      raw = await fs.readFile(LEGACY_DATA_FILE, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }

    const data = JSON.parse(raw)
    const conversations = Array.isArray(data.conversations) ? data.conversations.map(normalizeConversation) : []

    for (const conversation of conversations) {
      await writeConversationFile(conversation)
    }

    await fs.rename(LEGACY_DATA_FILE, `${LEGACY_DATA_FILE}.migrated`)
  })()

  return migrationPromise
}

async function listConversations() {
  const conversations = await readAllConversations()
  return conversations
    .map(summarizeConversation)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

async function getConversation(id) {
  const conversation = await readConversationFile(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createConversation(title = DEFAULT_TITLE) {
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

async function renameConversation(id, title) {
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

async function appendMessages(id, messages) {
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

async function clearConversation(id) {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  conversation.messages = []
  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function deleteConversation(id) {
  await migrateLegacyStore()

  const filePath = getConversationFilePath(id)
  if (!filePath) return false

  try {
    await fs.unlink(filePath)
    writeQueues.delete(id)
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
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
