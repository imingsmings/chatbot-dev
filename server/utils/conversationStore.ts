import crypto from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationSummary,
  StoredMessage
} from '../types/conversation.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const requireNodeModule = createRequire(import.meta.url)
const DATA_DIR = process.env.CONVERSATION_DATA_DIR || path.join(__dirname, '..', 'data')
const FILE_DATA_DIR = process.env.CONVERSATION_FILE_DATA_DIR || path.join(DATA_DIR, 'file')
const CONVERSATIONS_DIR = path.join(FILE_DATA_DIR, 'conversations')
const LEGACY_DATA_FILE = path.join(FILE_DATA_DIR, 'conversations.json')
const ROOT_CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations')
const ROOT_LEGACY_DATA_FILE = path.join(DATA_DIR, 'conversations.json')
const SQLITE_DB_PATH = process.env.CONVERSATION_DB_PATH || path.join(DATA_DIR, 'sqlite', 'conversations.sqlite3')
const DEFAULT_TITLE = '新的聊天'
const SQLITE_JSON_MIGRATION_KEY = 'json_migration_completed'

type StoreKind = 'file' | 'sqlite'

type ConversationStore = {
  listConversations: () => Promise<ConversationSummary[]>
  getConversation: (id: string) => Promise<Conversation | null>
  createConversation: (title?: unknown) => Promise<Conversation>
  renameConversation: (id: string, title: unknown) => Promise<Conversation | null>
  appendMessages: (id: string, messages: StoredMessage[]) => Promise<Conversation | null>
  updateSummary: (id: string, summary: ConversationContextSummary | null) => Promise<Conversation | null>
  importConversation: (
    conversation: Conversation,
    strategy: ConversationImportConflictStrategy
  ) => Promise<ConversationImportItemResult>
  clearConversation: (id: string) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<boolean>
}

type SqliteConversationRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  title_manually_edited: number
  messages: string
  summary: string | null
}

let fileMigrationPromise: Promise<void> | null = null
let sqliteMigrationPromise: Promise<void> | null = null
let sqliteDb: DatabaseSync | null = null
let sqliteDatabaseSync: (new (location: string) => DatabaseSync) | null = null
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

function getStoreKind(): StoreKind {
  const rawKind = (process.env.CONVERSATION_STORE || 'file').trim().toLowerCase()

  if (!rawKind || rawKind === 'file' || rawKind === 'json' || rawKind === 'fs') {
    return 'file'
  }

  if (rawKind === 'sqlite' || rawKind === 'sqlite3') {
    return 'sqlite'
  }

  throw new Error(`Unsupported CONVERSATION_STORE: ${process.env.CONVERSATION_STORE}`)
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

function normalizeConversationSummary(value: unknown): ConversationContextSummary | undefined {
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
    sourceMessageCount,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now()
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

  const normalized: Conversation = {
    id: typeof rawConversation.id === 'string' ? rawConversation.id : createId(),
    title,
    createdAt,
    updatedAt,
    titleManuallyEdited: Boolean(rawConversation.titleManuallyEdited),
    messages: Array.isArray(rawConversation.messages) ? rawConversation.messages.map(normalizeMessage) : []
  }

  const summary = normalizeConversationSummary(rawConversation.summary)
  if (summary) {
    normalized.summary = summary
  }

  return normalized
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    summary: conversation.summary ? { ...conversation.summary } : undefined
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

function sortConversationSummaries(conversations: Conversation[]): ConversationSummary[] {
  return conversations
    .map(summarizeConversation)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

function applyAppendedMessages(conversation: Conversation, messages: StoredMessage[]): Conversation {
  const normalizedMessages = messages.map(normalizeMessage)
  conversation.messages.push(...normalizedMessages)

  const firstUserMessage = normalizedMessages.find((message) => message.role === 'user')
  if (!conversation.titleManuallyEdited && conversation.title === DEFAULT_TITLE && firstUserMessage) {
    conversation.title = createTitleFromQuestion(firstUserMessage.content)
  }

  conversation.updatedAt = now()
  return conversation
}

function createImportedDuplicate(conversation: Conversation): Conversation {
  const timestamp = now()
  return {
    ...cloneConversation(conversation),
    id: createId(),
    title: `${conversation.title} (导入)`,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function isSamePath(firstPath: string, secondPath: string): boolean {
  return path.resolve(firstPath) === path.resolve(secondPath)
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

async function writeConversationFileIfAbsent(conversation: Conversation): Promise<void> {
  await ensureConversationDir()

  const filePath = getConversationFilePath(conversation.id)
  if (!filePath) {
    throw new Error('会话 ID 不合法')
  }

  try {
    await fs.access(filePath)
    return
  } catch (err: unknown) {
    if (!isNodeError(err) || err.code !== 'ENOENT') {
      throw err
    }
  }

  await writeConversationFile(conversation)
}

async function readConversationFile(id: string): Promise<Conversation | null> {
  await migrateLegacyFileStore()

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

async function readAllConversationFiles(): Promise<Conversation[]> {
  await migrateLegacyFileStore()
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

async function importConversationFilesIntoFileStore(sourceDir: string): Promise<void> {
  if (isSamePath(sourceDir, CONVERSATIONS_DIR) || !existsSync(sourceDir)) {
    return
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const filePath = path.join(sourceDir, entry.name)
    const raw = await fs.readFile(filePath, 'utf8')
    await writeConversationFileIfAbsent(normalizeConversation(JSON.parse(raw)))
  }
}

async function importLegacyAggregateIntoFileStore(filePath: string, options: { renameAfterImport: boolean }): Promise<void> {
  let raw
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return
    throw err
  }

  const data = JSON.parse(raw) as unknown
  const conversations =
    isRecord(data) && Array.isArray(data.conversations) ? data.conversations.map(normalizeConversation) : []

  for (const conversation of conversations) {
    await writeConversationFileIfAbsent(conversation)
  }

  if (options.renameAfterImport) {
    await fs.rename(filePath, `${filePath}.migrated`)
  }
}

async function migrateLegacyFileStore(): Promise<void> {
  if (fileMigrationPromise) return fileMigrationPromise

  fileMigrationPromise = (async () => {
    await ensureConversationDir()
    await importConversationFilesIntoFileStore(ROOT_CONVERSATIONS_DIR)
    await importLegacyAggregateIntoFileStore(LEGACY_DATA_FILE, { renameAfterImport: true })
    await importLegacyAggregateIntoFileStore(`${LEGACY_DATA_FILE}.migrated`, { renameAfterImport: false })
    await importLegacyAggregateIntoFileStore(ROOT_LEGACY_DATA_FILE, { renameAfterImport: true })
    await importLegacyAggregateIntoFileStore(`${ROOT_LEGACY_DATA_FILE}.migrated`, { renameAfterImport: false })
  })()

  return fileMigrationPromise
}

async function listFileConversations(): Promise<ConversationSummary[]> {
  return sortConversationSummaries(await readAllConversationFiles())
}

async function getFileConversation(id: string): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createFileConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  await migrateLegacyFileStore()

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

async function renameFileConversation(id: string, title: unknown): Promise<Conversation | null> {
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

async function appendFileMessages(id: string, messages: StoredMessage[]): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  await writeConversationFile(applyAppendedMessages(conversation, messages))

  return cloneConversation(conversation)
}

async function updateFileSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  if (summary) {
    conversation.summary = { ...summary }
  } else {
    delete conversation.summary
  }
  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function importFileConversation(
  sourceConversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  await migrateLegacyFileStore()

  const conversation = normalizeConversation(sourceConversation)
  const existing = await readConversationFile(conversation.id)

  if (existing && strategy === 'skip') {
    return {
      sourceId: sourceConversation.id,
      conversationId: null,
      status: 'skipped'
    }
  }

  if (existing && strategy === 'duplicate') {
    const duplicate = createImportedDuplicate(conversation)
    await writeConversationFile(duplicate)
    return {
      sourceId: sourceConversation.id,
      conversationId: duplicate.id,
      status: 'duplicated'
    }
  }

  await writeConversationFile(conversation)
  return {
    sourceId: sourceConversation.id,
    conversationId: conversation.id,
    status: existing ? 'overwritten' : 'created'
  }
}

async function clearFileConversation(id: string): Promise<Conversation | null> {
  const conversation = await readConversationFile(id)

  if (!conversation) {
    return null
  }

  conversation.messages = []
  delete conversation.summary
  conversation.updatedAt = now()
  await writeConversationFile(conversation)

  return cloneConversation(conversation)
}

async function deleteFileConversation(id: string): Promise<boolean> {
  await migrateLegacyFileStore()

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

function getSqliteDb(): DatabaseSync {
  if (sqliteDb) {
    return sqliteDb
  }

  mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true })
  const DatabaseSyncConstructor = getSqliteDatabaseSync()
  const db = new DatabaseSyncConstructor(SQLITE_DB_PATH)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title_manually_edited INTEGER NOT NULL,
      messages TEXT NOT NULL,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'summary')) {
    db.exec('ALTER TABLE conversations ADD COLUMN summary TEXT')
  }
  sqliteDb = db
  return sqliteDb
}

function getSqliteDatabaseSync(): new (location: string) => DatabaseSync {
  if (sqliteDatabaseSync) {
    return sqliteDatabaseSync
  }

  try {
    const sqliteModule = requireNodeModule('node:sqlite') as {
      DatabaseSync: new (location: string) => DatabaseSync
    }
    sqliteDatabaseSync = sqliteModule.DatabaseSync
    return sqliteDatabaseSync
  } catch (err: unknown) {
    throw new Error(
      'SQLite 存储需要当前 Node.js 支持 node:sqlite；请升级 Node.js，或改用默认 CONVERSATION_STORE=file',
      { cause: err }
    )
  }
}

function getSqliteMeta(key: string): string | null {
  const row = getSqliteDb()
    .prepare('SELECT value FROM storage_meta WHERE key = ?')
    .get(key) as { value: string } | undefined
  return typeof row?.value === 'string' ? row.value : null
}

function setSqliteMeta(key: string, value: string): void {
  getSqliteDb()
    .prepare(`
      INSERT INTO storage_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(key, value, now())
}

function withSqliteTransaction<T>(fn: () => T): T {
  const db = getSqliteDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function conversationFromSqliteRow(row: SqliteConversationRow): Conversation {
  return normalizeConversation({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    titleManuallyEdited: Boolean(row.title_manually_edited),
    messages: JSON.parse(row.messages) as unknown,
    summary: row.summary ? JSON.parse(row.summary) as unknown : undefined
  })
}

function upsertSqliteConversation(conversation: Conversation): void {
  getSqliteDb()
    .prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, title_manually_edited, messages, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        title_manually_edited = excluded.title_manually_edited,
        messages = excluded.messages,
        summary = excluded.summary
    `)
    .run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.titleManuallyEdited ? 1 : 0,
      JSON.stringify(conversation.messages),
      conversation.summary ? JSON.stringify(conversation.summary) : null
    )
}

function insertSqliteConversationIfAbsent(conversation: Conversation): void {
  getSqliteDb()
    .prepare(`
      INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, title_manually_edited, messages, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.titleManuallyEdited ? 1 : 0,
      JSON.stringify(conversation.messages),
      conversation.summary ? JSON.stringify(conversation.summary) : null
    )
}

async function readJsonConversationFilesForSqliteMigration(sourceDir: string): Promise<Conversation[]> {
  if (!existsSync(sourceDir)) {
    return []
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(sourceDir, entry.name)
        const raw = await fs.readFile(filePath, 'utf8')
        return normalizeConversation(JSON.parse(raw))
      })
  )
}

async function readLegacyJsonConversations(filePath: string): Promise<Conversation[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as unknown
    return isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations.map(normalizeConversation)
      : []
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return []
    throw err
  }
}

async function readJsonConversationsForSqliteMigration(): Promise<Conversation[]> {
  const conversations = [
    ...(await readJsonConversationFilesForSqliteMigration(CONVERSATIONS_DIR)),
    ...(await readJsonConversationFilesForSqliteMigration(ROOT_CONVERSATIONS_DIR)),
    ...(await readLegacyJsonConversations(LEGACY_DATA_FILE)),
    ...(await readLegacyJsonConversations(`${LEGACY_DATA_FILE}.migrated`)),
    ...(await readLegacyJsonConversations(ROOT_LEGACY_DATA_FILE)),
    ...(await readLegacyJsonConversations(`${ROOT_LEGACY_DATA_FILE}.migrated`))
  ]
  const uniqueConversations = new Map<string, Conversation>()

  for (const conversation of conversations) {
    if (!uniqueConversations.has(conversation.id)) {
      uniqueConversations.set(conversation.id, conversation)
    }
  }

  return [...uniqueConversations.values()]
}

async function migrateJsonToSqliteStore(): Promise<void> {
  if (sqliteMigrationPromise) return sqliteMigrationPromise

  sqliteMigrationPromise = (async () => {
    getSqliteDb()

    if (getSqliteMeta(SQLITE_JSON_MIGRATION_KEY) === '1') {
      return
    }

    const conversations = await readJsonConversationsForSqliteMigration()
    withSqliteTransaction(() => {
      for (const conversation of conversations) {
        insertSqliteConversationIfAbsent(conversation)
      }
      setSqliteMeta(SQLITE_JSON_MIGRATION_KEY, '1')
      setSqliteMeta('json_migration_source_dir', FILE_DATA_DIR)
      setSqliteMeta('json_migration_imported_count', String(conversations.length))
    })
  })()

  return sqliteMigrationPromise
}

function getSqliteConversationSync(id: string): Conversation | null {
  const row = getSqliteDb()
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(id) as SqliteConversationRow | undefined

  return row ? conversationFromSqliteRow(row) : null
}

async function listSqliteConversations(): Promise<ConversationSummary[]> {
  await migrateJsonToSqliteStore()

  const rows = getSqliteDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as SqliteConversationRow[]

  return rows.map((row) => summarizeConversation(conversationFromSqliteRow(row)))
}

async function getSqliteConversation(id: string): Promise<Conversation | null> {
  await migrateJsonToSqliteStore()

  const conversation = getSqliteConversationSync(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createSqliteConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  await migrateJsonToSqliteStore()

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

  upsertSqliteConversation(conversation)

  return cloneConversation(conversation)
}

async function renameSqliteConversation(id: string, title: unknown): Promise<Conversation | null> {
  await migrateJsonToSqliteStore()

  const conversation = getSqliteConversationSync(id)
  const nextTitle = typeof title === 'string' ? title.trim() : ''

  if (!conversation || !nextTitle) {
    return null
  }

  conversation.title = nextTitle
  conversation.titleManuallyEdited = true
  conversation.updatedAt = now()
  upsertSqliteConversation(conversation)

  return cloneConversation(conversation)
}

async function appendSqliteMessages(id: string, messages: StoredMessage[]): Promise<Conversation | null> {
  await migrateJsonToSqliteStore()

  const conversation = getSqliteConversationSync(id)

  if (!conversation) {
    return null
  }

  upsertSqliteConversation(applyAppendedMessages(conversation, messages))

  return cloneConversation(conversation)
}

async function updateSqliteSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  await migrateJsonToSqliteStore()

  const conversation = getSqliteConversationSync(id)
  if (!conversation) {
    return null
  }

  if (summary) {
    conversation.summary = { ...summary }
  } else {
    delete conversation.summary
  }
  conversation.updatedAt = now()
  upsertSqliteConversation(conversation)

  return cloneConversation(conversation)
}

async function importSqliteConversation(
  sourceConversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  await migrateJsonToSqliteStore()

  const conversation = normalizeConversation(sourceConversation)
  const existing = getSqliteConversationSync(conversation.id)

  if (existing && strategy === 'skip') {
    return {
      sourceId: sourceConversation.id,
      conversationId: null,
      status: 'skipped'
    }
  }

  if (existing && strategy === 'duplicate') {
    const duplicate = createImportedDuplicate(conversation)
    upsertSqliteConversation(duplicate)
    return {
      sourceId: sourceConversation.id,
      conversationId: duplicate.id,
      status: 'duplicated'
    }
  }

  upsertSqliteConversation(conversation)
  return {
    sourceId: sourceConversation.id,
    conversationId: conversation.id,
    status: existing ? 'overwritten' : 'created'
  }
}

async function clearSqliteConversation(id: string): Promise<Conversation | null> {
  await migrateJsonToSqliteStore()

  const conversation = getSqliteConversationSync(id)

  if (!conversation) {
    return null
  }

  conversation.messages = []
  delete conversation.summary
  conversation.updatedAt = now()
  upsertSqliteConversation(conversation)

  return cloneConversation(conversation)
}

async function deleteSqliteConversation(id: string): Promise<boolean> {
  await migrateJsonToSqliteStore()

  const result = getSqliteDb()
    .prepare('DELETE FROM conversations WHERE id = ?')
    .run(id)

  return result.changes > 0
}

function getStore(): ConversationStore {
  if (getStoreKind() === 'sqlite') {
    return {
      listConversations: listSqliteConversations,
      getConversation: getSqliteConversation,
      createConversation: createSqliteConversation,
      renameConversation: renameSqliteConversation,
      appendMessages: appendSqliteMessages,
      updateSummary: updateSqliteSummary,
      importConversation: importSqliteConversation,
      clearConversation: clearSqliteConversation,
      deleteConversation: deleteSqliteConversation
    }
  }

  return {
    listConversations: listFileConversations,
    getConversation: getFileConversation,
    createConversation: createFileConversation,
    renameConversation: renameFileConversation,
    appendMessages: appendFileMessages,
    updateSummary: updateFileSummary,
    importConversation: importFileConversation,
    clearConversation: clearFileConversation,
    deleteConversation: deleteFileConversation
  }
}

async function listConversations(): Promise<ConversationSummary[]> {
  return getStore().listConversations()
}

async function getConversation(id: string): Promise<Conversation | null> {
  return getStore().getConversation(id)
}

async function createConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  return getStore().createConversation(title)
}

async function renameConversation(id: string, title: unknown): Promise<Conversation | null> {
  return getStore().renameConversation(id, title)
}

async function appendMessages(id: string, messages: StoredMessage[]): Promise<Conversation | null> {
  return getStore().appendMessages(id, messages)
}

async function updateConversationSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  return getStore().updateSummary(id, summary)
}

async function importConversation(
  conversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  return getStore().importConversation(conversation, strategy)
}

function getConversationStoreKind(): StoreKind {
  return getStoreKind()
}

async function clearConversation(id: string): Promise<Conversation | null> {
  return getStore().clearConversation(id)
}

async function deleteConversation(id: string): Promise<boolean> {
  return getStore().deleteConversation(id)
}

export {
  DEFAULT_TITLE,
  appendMessages,
  clearConversation,
  createConversation,
  deleteConversation,
  getConversationStoreKind,
  getConversation,
  importConversation,
  listConversations,
  renameConversation,
  updateConversationSummary
}
