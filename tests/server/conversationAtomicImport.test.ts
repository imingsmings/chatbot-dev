import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import type { Conversation } from '../../server/types/conversation.ts'
import type { ConversationStore } from '../../server/utils/conversationStore/contracts.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-atomic-import-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = path.join(dataDir, 'atomic.sqlite3')

const { createFileConversationStore } = await import(
  '../../server/utils/conversationStore/fileStore.ts'
)
const { createSqliteConversationStore } = await import(
  '../../server/utils/conversationStore/sqliteStore.ts'
)

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

function conversation(id: string, content: string): Conversation {
  return {
    id,
    title: id,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    titleManuallyEdited: true,
    messages: [{ role: 'user', content }]
  }
}

async function snapshot(store: ConversationStore): Promise<string> {
  const summaries = await store.listConversations()
  const details = await Promise.all(
    summaries.map(({ id }) => store.getConversation(id))
  )
  return JSON.stringify(details.sort((a, b) => (a?.id ?? '').localeCompare(b?.id ?? '')))
}

async function verifyRollback(
  createStore: (failureIndex?: number) => ConversationStore
): Promise<void> {
  const seedStore = createStore()
  await seedStore.importConversations([
    conversation('conv_atomic_existing', 'before')
  ], 'skip')
  const before = await snapshot(seedStore)
  const batch = [
    conversation('conv_atomic_existing', 'after'),
    conversation('conv_atomic_created_1', 'created one'),
    conversation('conv_atomic_created_2', 'created two')
  ]

  for (const failureIndex of [0, 1, 2]) {
    const store = createStore(failureIndex)
    await assert.rejects(
      store.importConversations(batch, 'overwrite'),
      new RegExp(`injected import failure ${failureIndex}`)
    )
    assert.equal(await snapshot(store), before)
  }
  seedStore.close?.()
}

test('file import rolls back the whole batch on first, middle and last commit failure', async () => {
  await verifyRollback((failureIndex) => createFileConversationStore(
    failureIndex === undefined
      ? {}
      : {
          beforeImportCommit(index) {
            if (index === failureIndex) throw new Error(`injected import failure ${index}`)
          }
        }
  ))
})

test('SQLite import rolls back the whole transaction on first, middle and last write failure', async () => {
  await verifyRollback((failureIndex) => createSqliteConversationStore(
    failureIndex === undefined
      ? {}
      : {
          beforeImportCommit(index) {
            if (index === failureIndex) throw new Error(`injected import failure ${index}`)
          }
        }
  ))
})
