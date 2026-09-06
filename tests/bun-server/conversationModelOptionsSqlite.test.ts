import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { afterAll, test } from 'bun:test'
import type { ConversationModelOptions } from '../../bun-server/types/conversation.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-model-options-sqlite-'))
const databasePath = path.join(dataDir, 'sqlite', 'conversations.sqlite3')
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = databasePath
process.env.CONVERSATION_STORE = 'sqlite'
process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://provider.mock/chat/completions'
process.env.LLM_MODEL = 'deepseek-v4-flash'
process.env.DEEPSEEK_API_KEY = 'sqlite-model-options-key'

await mkdir(path.dirname(databasePath), { recursive: true })
const legacyDb = new Database(databasePath)
legacyDb.exec(`
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    title_manually_edited INTEGER NOT NULL,
    messages TEXT NOT NULL,
    summary TEXT
  );
  CREATE TABLE storage_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)
legacyDb.prepare(`
  INSERT INTO conversations
    (id, title, created_at, updated_at, title_manually_edited, messages, summary)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  'conv_sqlite_legacy_model_options',
  'SQLite legacy',
  '2026-08-13T00:00:00.000Z',
  '2026-08-13T00:00:00.000Z',
  1,
  JSON.stringify([{ role: 'user', content: 'legacy sqlite message' }]),
  null,
)
legacyDb.close(true)

const {
  clearConversation,
  closeConversationStore,
  getConversation,
  updateConversationModelOptions,
} = await import('../../bun-server/utils/conversationStore.ts')

const options: ConversationModelOptions = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  reasoningEnabled: true,
  reasoningEffort: 'max',
  temperature: 0.1,
  maxTokens: 8192,
}

afterAll(async () => {
  closeConversationStore()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('SQLite adds model_options idempotently and persists it across reopen without reordering', async () => {
  const legacy = await getConversation('conv_sqlite_legacy_model_options')
  assert.equal(legacy?.modelOptions, undefined)
  assert.equal(legacy?.messages[0]?.content, 'legacy sqlite message')

  const updated = await updateConversationModelOptions(legacy!.id, options)
  assert.deepEqual(updated?.modelOptions, options)
  assert.equal(updated?.updatedAt, legacy?.updatedAt)

  closeConversationStore()
  assert.deepEqual((await getConversation(legacy!.id))?.modelOptions, options)
  closeConversationStore()
  assert.deepEqual((await getConversation(legacy!.id))?.modelOptions, options)

  closeConversationStore()
  const inspectionDb = new Database(databasePath)
  const columns = inspectionDb.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  assert.equal(columns.filter((column) => column.name === 'model_options').length, 1)
  inspectionDb.close(true)
})

test('SQLite malformed model_options JSON does not hide the conversation and clear preserves valid options', async () => {
  closeConversationStore()
  const mutationDb = new Database(databasePath)
  mutationDb.prepare('UPDATE conversations SET model_options = ? WHERE id = ?').run(
    '{not-json',
    'conv_sqlite_legacy_model_options',
  )
  mutationDb.close(true)

  const malformed = await getConversation('conv_sqlite_legacy_model_options')
  assert.equal(malformed?.modelOptions, undefined)
  assert.equal(malformed?.messages[0]?.content, 'legacy sqlite message')

  await updateConversationModelOptions(malformed!.id, options)
  const cleared = await clearConversation(malformed!.id)
  assert.deepEqual(cleared?.modelOptions, options)
  assert.deepEqual(cleared?.messages, [])
})
