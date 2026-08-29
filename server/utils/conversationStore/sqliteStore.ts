import { randomUUID } from 'node:crypto'
import { constants, mkdirSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationModelOptions,
  ConversationRequestRecord,
  ConversationRequestStatus,
  StoredMessage
} from '../../types/conversation.ts'
import { DEFAULT_TITLE, type ConversationStore } from './contracts.ts'
import {
  readConversationFilesForMigration,
  readLegacyConversationAggregate
} from './migration.ts'
import {
  applyAppendedMessages,
  assertUniqueRequestBindings,
  cloneConversation,
  createId,
  createImportedDuplicate,
  normalizeConversation,
  now,
  summarizeConversation
} from './normalization.ts'
import {
  CONVERSATIONS_DIR,
  FILE_DATA_DIR,
  LEGACY_DATA_FILE,
  ROOT_CONVERSATIONS_DIR,
  ROOT_LEGACY_DATA_FILE,
  SQLITE_DB_PATH
} from './paths.ts'

const requireNodeModule = createRequire(import.meta.url)
const SQLITE_JSON_MIGRATION_KEY = 'json_migration_completed'
const SQLITE_HEALTH_KEY_PREFIX = 'health_probe_'

type SqliteConversationRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  title_manually_edited: number
  messages: string
  summary: string | null
  model_options: string | null
  requests: string | null
}

type SqliteConversationStoreOptions = {
  beforeImportCommit?: (index: number) => void
}

let migrationPromise: Promise<void> | null = null
let sqliteDb: DatabaseSync | null = null
let sqliteDatabaseSync: (new (location: string) => DatabaseSync) | null = null

function getSqliteDatabaseSync(): new (location: string) => DatabaseSync {
  if (sqliteDatabaseSync) return sqliteDatabaseSync

  try {
    const sqliteModule = requireNodeModule('node:sqlite') as {
      DatabaseSync: new (location: string) => DatabaseSync
    }
    sqliteDatabaseSync = sqliteModule.DatabaseSync
    return sqliteDatabaseSync
  } catch (error: unknown) {
    throw new Error(
      'SQLite 存储需要当前 Node.js 支持 node:sqlite；请升级 Node.js，或显式设置 CONVERSATION_STORE=file',
      { cause: error }
    )
  }
}

function getSqliteDb(): DatabaseSync {
  if (sqliteDb) return sqliteDb

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
      summary TEXT,
      model_options TEXT,
      requests TEXT
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
  if (!columns.some((column) => column.name === 'model_options')) {
    db.exec('ALTER TABLE conversations ADD COLUMN model_options TEXT')
  }
  if (!columns.some((column) => column.name === 'requests')) {
    db.exec('ALTER TABLE conversations ADD COLUMN requests TEXT')
  }
  sqliteDb = db
  return sqliteDb
}

function getSqliteMeta(key: string): string | null {
  const row = getSqliteDb().prepare('SELECT value FROM storage_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
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

function withSqliteTransaction<T>(callback: () => T): T {
  const db = getSqliteDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function conversationFromSqliteRow(row: SqliteConversationRow): Conversation {
  let modelOptions: unknown
  if (row.model_options) {
    try {
      modelOptions = JSON.parse(row.model_options) as unknown
    } catch {
      modelOptions = undefined
    }
  }

  return normalizeConversation(
    {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      titleManuallyEdited: Boolean(row.title_manually_edited),
      messages: JSON.parse(row.messages) as unknown,
      summary: row.summary ? (JSON.parse(row.summary) as unknown) : undefined,
      modelOptions,
      requests: row.requests ? (JSON.parse(row.requests) as unknown) : undefined
    },
    row.id
  )
}

function upsertConversation(conversation: Conversation): void {
  getSqliteDb()
    .prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, title_manually_edited, messages, summary, model_options, requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        title_manually_edited = excluded.title_manually_edited,
        messages = excluded.messages,
        summary = excluded.summary,
        model_options = excluded.model_options,
        requests = excluded.requests
    `)
    .run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.titleManuallyEdited ? 1 : 0,
      JSON.stringify(conversation.messages),
      conversation.summary ? JSON.stringify(conversation.summary) : null,
      conversation.modelOptions ? JSON.stringify(conversation.modelOptions) : null,
      conversation.requests ? JSON.stringify(conversation.requests) : null
    )
}

function insertConversationIfAbsent(conversation: Conversation): void {
  getSqliteDb()
    .prepare(`
      INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, title_manually_edited, messages, summary, model_options, requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversation.id,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.titleManuallyEdited ? 1 : 0,
      JSON.stringify(conversation.messages),
      conversation.summary ? JSON.stringify(conversation.summary) : null,
      conversation.modelOptions ? JSON.stringify(conversation.modelOptions) : null,
      conversation.requests ? JSON.stringify(conversation.requests) : null
    )
}

async function readJsonConversationsForMigration(): Promise<Conversation[]> {
  const migrationOptions = {
    skipMalformed: true,
    malformedLabel: 'SQLite migration source'
  }
  const conversations = [
    ...(await readConversationFilesForMigration(CONVERSATIONS_DIR, migrationOptions)),
    ...(await readConversationFilesForMigration(ROOT_CONVERSATIONS_DIR, migrationOptions)),
    ...(await readLegacyConversationAggregate(LEGACY_DATA_FILE, migrationOptions)),
    ...(await readLegacyConversationAggregate(`${LEGACY_DATA_FILE}.migrated`, migrationOptions)),
    ...(await readLegacyConversationAggregate(ROOT_LEGACY_DATA_FILE, migrationOptions)),
    ...(await readLegacyConversationAggregate(`${ROOT_LEGACY_DATA_FILE}.migrated`, migrationOptions))
  ]
  const uniqueConversations = new Map<string, Conversation>()

  for (const conversation of conversations) {
    if (!uniqueConversations.has(conversation.id)) {
      uniqueConversations.set(conversation.id, conversation)
    }
  }

  return [...uniqueConversations.values()]
}

async function migrateJsonStore(): Promise<void> {
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    getSqliteDb()
    if (getSqliteMeta(SQLITE_JSON_MIGRATION_KEY) === '1') return

    const conversations = await readJsonConversationsForMigration()
    withSqliteTransaction(() => {
      for (const conversation of conversations) {
        insertConversationIfAbsent(conversation)
      }
      setSqliteMeta(SQLITE_JSON_MIGRATION_KEY, '1')
      setSqliteMeta('json_migration_source_dir', FILE_DATA_DIR)
      setSqliteMeta('json_migration_imported_count', String(conversations.length))
    })
  })()

  return migrationPromise
}

function getConversationSync(id: string): Conversation | null {
  const row = getSqliteDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
    | SqliteConversationRow
    | undefined
  return row ? conversationFromSqliteRow(row) : null
}

async function listConversations() {
  await migrateJsonStore()
  const rows = getSqliteDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as SqliteConversationRow[]
  return rows.map((row) => summarizeConversation(conversationFromSqliteRow(row)))
}

async function checkHealth(): Promise<void> {
  await migrateJsonStore()
  await access(path.dirname(SQLITE_DB_PATH), constants.W_OK)
  await access(SQLITE_DB_PATH, constants.R_OK | constants.W_OK)

  const db = getSqliteDb()
  const key = `${SQLITE_HEALTH_KEY_PREFIX}${process.pid}_${randomUUID()}`
  const value = now()

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO storage_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, value)
    const row = db.prepare('SELECT value FROM storage_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (row?.value !== value) {
      throw new Error('SQLite 存储健康检查内容不一致')
    }
  } finally {
    db.exec('ROLLBACK')
  }
}

async function getConversation(id: string): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  return conversation ? cloneConversation(conversation) : null
}

async function createConversation(
  title: unknown = DEFAULT_TITLE,
  modelOptions?: ConversationModelOptions
): Promise<Conversation> {
  await migrateJsonStore()
  const timestamp = now()
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE
  const conversation: Conversation = {
    id: createId(),
    title: normalizedTitle,
    createdAt: timestamp,
    updatedAt: timestamp,
    titleManuallyEdited: normalizedTitle !== DEFAULT_TITLE,
    messages: [],
    ...(modelOptions ? { modelOptions: { ...modelOptions } } : {})
  }
  upsertConversation(conversation)
  return cloneConversation(conversation)
}

async function renameConversation(id: string, title: unknown): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  const nextTitle = typeof title === 'string' ? title.trim() : ''
  if (!conversation || !nextTitle) return null

  conversation.title = nextTitle
  conversation.titleManuallyEdited = true
  conversation.updatedAt = now()
  upsertConversation(conversation)
  return cloneConversation(conversation)
}

async function appendMessages(
  id: string,
  messages: StoredMessage[]
): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  if (!conversation) return null

  upsertConversation(applyAppendedMessages(conversation, messages))
  return cloneConversation(conversation)
}

async function beginRequest(
  id: string,
  request: ConversationRequestRecord
): Promise<ConversationRequestRecord | null> {
  await migrateJsonStore()
  return withSqliteTransaction(() => {
    const conversation = getConversationSync(id)
    if (!conversation) return null
    const existing = conversation.requests?.find(({ requestId }) => requestId === request.requestId)
    if (existing) return { ...existing }
    conversation.requests = [...(conversation.requests ?? []), { ...request }]
    upsertConversation(conversation)
    return { ...request }
  })
}

async function findRequest(requestId: string): Promise<{
  conversationId: string
  request: ConversationRequestRecord
} | null> {
  await migrateJsonStore()
  const rows = getSqliteDb()
    .prepare('SELECT * FROM conversations WHERE requests IS NOT NULL')
    .all() as SqliteConversationRow[]
  for (const row of rows) {
    const request = conversationFromSqliteRow(row).requests?.find(
      (item) => item.requestId === requestId
    )
    if (request) return { conversationId: row.id, request: { ...request } }
  }
  return null
}

async function finalizeRequest(
  id: string,
  requestId: string,
  status: Exclude<ConversationRequestStatus, 'processing'>,
  messages: StoredMessage[] = []
): Promise<ConversationRequestRecord | null> {
  await migrateJsonStore()
  return withSqliteTransaction(() => {
    const conversation = getConversationSync(id)
    if (!conversation) return null
    const request = conversation.requests?.find((item) => item.requestId === requestId)
    if (!request) return null
    if (request.status !== 'processing') return { ...request }
    if (messages.length) {
      request.messageStartIndex = conversation.messages.length
      request.messageCount = messages.length
      applyAppendedMessages(conversation, messages)
    }
    request.status = status
    request.updatedAt = now()
    upsertConversation(conversation)
    return { ...request }
  })
}

async function updateSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  if (!conversation) return null

  if (summary) {
    conversation.summary = { ...summary }
  } else {
    delete conversation.summary
  }
  conversation.updatedAt = now()
  upsertConversation(conversation)
  return cloneConversation(conversation)
}

async function updateModelOptions(
  id: string,
  options: ConversationModelOptions
): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  if (!conversation) return null

  conversation.modelOptions = { ...options }
  upsertConversation(conversation)
  return cloneConversation(conversation)
}

async function importConversation(
  sourceConversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  await migrateJsonStore()
  const conversation = normalizeConversation(sourceConversation)
  const existing = getConversationSync(conversation.id)

  if (existing && strategy === 'skip') {
    return { sourceId: sourceConversation.id, conversationId: null, status: 'skipped' }
  }

  if (existing && strategy === 'duplicate') {
    const duplicate = createImportedDuplicate(conversation)
    upsertConversation(duplicate)
    return {
      sourceId: sourceConversation.id,
      conversationId: duplicate.id,
      status: 'duplicated'
    }
  }

  upsertConversation(conversation)
  return {
    sourceId: sourceConversation.id,
    conversationId: conversation.id,
    status: existing ? 'overwritten' : 'created'
  }
}

async function importConversations(
  sourceConversations: Conversation[],
  strategy: ConversationImportConflictStrategy,
  options: SqliteConversationStoreOptions = {}
): Promise<ConversationImportItemResult[]> {
  await migrateJsonStore()
  return withSqliteTransaction(() => {
    const sourceIds = new Set<string>()
    const items = sourceConversations.map((sourceConversation, index): ConversationImportItemResult => {
      if (sourceIds.has(sourceConversation.id)) {
        throw new Error(`批次包含重复会话 ID：${sourceConversation.id}`)
      }
      sourceIds.add(sourceConversation.id)
      options.beforeImportCommit?.(index)
      const conversation = normalizeConversation(sourceConversation)
      const existing = getConversationSync(conversation.id)
      if (existing && strategy === 'skip') {
        return { sourceId: sourceConversation.id, conversationId: null, status: 'skipped' }
      }
      if (existing && strategy === 'duplicate') {
        const duplicate = createImportedDuplicate(conversation)
        upsertConversation(duplicate)
        return {
          sourceId: sourceConversation.id,
          conversationId: duplicate.id,
          status: 'duplicated'
        }
      }
      upsertConversation(conversation)
      return {
        sourceId: sourceConversation.id,
        conversationId: conversation.id,
        status: existing ? 'overwritten' : 'created'
      }
    })
    const rows = getSqliteDb().prepare('SELECT * FROM conversations').all() as SqliteConversationRow[]
    assertUniqueRequestBindings(rows.map(conversationFromSqliteRow))
    return items
  })
}

async function clearConversation(id: string): Promise<Conversation | null> {
  await migrateJsonStore()
  const conversation = getConversationSync(id)
  if (!conversation) return null

  conversation.messages = []
  delete conversation.summary
  delete conversation.requests
  conversation.updatedAt = now()
  upsertConversation(conversation)
  return cloneConversation(conversation)
}

async function deleteConversation(id: string): Promise<boolean> {
  await migrateJsonStore()
  const result = getSqliteDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
  return result.changes > 0
}

function close(): void {
  if (!sqliteDb) return

  try {
    sqliteDb.close()
  } finally {
    sqliteDb = null
    migrationPromise = null
  }
}

export function createSqliteConversationStore(
  options: SqliteConversationStoreOptions = {}
): ConversationStore {
  return {
    checkHealth,
    listConversations,
    getConversation,
    createConversation,
    renameConversation,
    appendMessages,
    beginRequest,
    findRequest,
    finalizeRequest,
    updateSummary,
    updateModelOptions,
    importConversation,
    importConversations: (conversations, strategy) =>
      importConversations(conversations, strategy, options),
    clearConversation,
    deleteConversation,
    close
  }
}
