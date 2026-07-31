import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-summary-sqlite-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = path.join(dataDir, 'summary.sqlite3')
process.env.CONVERSATION_STORE = 'sqlite'

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const {
  createConversation,
  getConversation,
  updateConversationSummary
} = await import('../../server/utils/conversationStore.ts')

test('SQLite persists and reloads conversation summaries', async () => {
  const conversation = await createConversation('SQLite summary')
  const summary = {
    content: 'SQLite summary content',
    sourceMessageCount: 4,
    updatedAt: '2026-07-31T00:00:00.000Z'
  }

  await updateConversationSummary(conversation.id, summary)
  assert.deepEqual((await getConversation(conversation.id))?.summary, summary)

  await updateConversationSummary(conversation.id, null)
  assert.equal((await getConversation(conversation.id))?.summary, undefined)
})
