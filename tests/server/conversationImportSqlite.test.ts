import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-import-sqlite-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = path.join(dataDir, 'import.sqlite3')
process.env.CONVERSATION_STORE = 'sqlite'

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { importConversationBackup } = await import('../../server/services/conversationImportService.ts')
const { getConversation, listConversations } = await import('../../server/utils/conversationStore.ts')

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
    messages: [{ role: 'assistant', content: 'sqlite original', reasoningContent: 'reasoning' }]
  }]
}

test('SQLite import applies conflict strategies without losing reasoning data', async () => {
  assert.equal((await importConversationBackup(baseBackup)).created, 1)
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.reasoningContent, 'reasoning')
  assert.equal((await importConversationBackup(baseBackup, 'skip')).skipped, 1)
  assert.equal((await importConversationBackup(baseBackup, 'duplicate')).duplicated, 1)
  assert.equal((await listConversations()).length, 2)

  const overwriteBackup = structuredClone(baseBackup)
  overwriteBackup.conversations[0].messages[0].content = 'sqlite overwritten'
  assert.equal((await importConversationBackup(overwriteBackup, 'overwrite')).overwritten, 1)
  assert.equal((await getConversation('conv_import_sqlite'))?.messages[0]?.content, 'sqlite overwritten')
})
