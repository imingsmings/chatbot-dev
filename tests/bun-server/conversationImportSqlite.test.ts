import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterAll, test } from 'bun:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-import-sqlite-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = path.join(dataDir, 'import.sqlite3')
process.env.CONVERSATION_STORE = 'sqlite'

afterAll(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { importConversationBackup } = await import('../../bun-server/services/conversationImportService.ts')
const { getConversation, listConversations } = await import('../../bun-server/utils/conversationStore.ts')

const baseBackup = {
  schemaVersion: 1,
  source: 'chatbot-local',
  exportedAt: '2026-07-31T00:00:00.000Z',
  conversations: [{
    id: 'conv_import_sqlite',
    title: 'Imported SQLite',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    titleManuallyEdited: true,
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      reasoningEnabled: true,
      reasoningEffort: 'max',
      maxTokens: 8192
    },
    messages: [{
      role: 'assistant',
      content: 'sqlite original',
      reasoningContent: 'reasoning',
      status: 'completed',
      generation: {
        provider: 'openai',
        model: 'gpt-5.6-terra',
        finishReason: 'completed',
        totalDurationMs: 40,
        usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 }
      },
      toolTrace: [{
        name: 'getCurrentTime',
        success: true,
        durationMs: 1,
        summary: 'UTC time'
      }]
    }]
  }]
}

test('SQLite import applies conflict strategies without losing reasoning data', async () => {
  assert.equal((await importConversationBackup(baseBackup)).created, 1)
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.reasoningContent, 'reasoning')
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.generation?.usage?.totalTokens, 12)
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.toolTrace?.[0]?.name, 'getCurrentTime')
  assert.equal((await getConversation('conv_import_sqlite'))?.modelOptions?.model, 'deepseek-v4-pro')
  assert.equal((await importConversationBackup(baseBackup, 'skip')).skipped, 1)
  assert.equal((await importConversationBackup(baseBackup, 'duplicate')).duplicated, 1)
  assert.equal((await listConversations()).length, 2)

  const overwriteBackup = structuredClone(baseBackup)
  overwriteBackup.conversations[0].messages[0].content = 'sqlite overwritten'
  assert.equal((await importConversationBackup(overwriteBackup, 'overwrite')).overwritten, 1)
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.content, 'sqlite overwritten')
})

test('SQLite import clamps summary coverage to the imported message count', async () => {
  const backup = structuredClone(baseBackup)
  backup.conversations[0].id = 'conv_import_summary_clamp_sqlite'
  Object.assign(backup.conversations[0], {
    summary: {
      content: 'legacy sqlite summary',
      sourceMessageCount: 99,
      updatedAt: '2026-07-31T00:00:00.000Z'
    }
  })

  await importConversationBackup(backup)

  assert.equal(
    (await getConversation('conv_import_summary_clamp_sqlite'))?.summary?.sourceMessageCount,
    1
  )
})
