import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import type { ConversationStore } from '../../bun-server/utils/conversationStore/contracts.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-request-persistence-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = path.join(dataDir, 'requests.sqlite3')

const { createFileConversationStore } = await import(
  '../../bun-server/utils/conversationStore/fileStore.ts'
)
const { createSqliteConversationStore } = await import(
  '../../bun-server/utils/conversationStore/sqliteStore.ts'
)

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

async function verifyRequestPersistence(
  createStore: () => ConversationStore,
  reopen: (store: ConversationStore) => ConversationStore
): Promise<void> {
  let store = createStore()
  const conversation = await store.createConversation('request persistence')
  const createdAt = '2026-08-29T00:00:00.000Z'
  const request = {
    requestId: `request_${conversation.id.slice(-12)}`,
    requestHash: 'a'.repeat(64),
    status: 'processing' as const,
    createdAt,
    updatedAt: createdAt
  }

  assert.deepEqual(await store.beginRequest(conversation.id, request), request)
  assert.deepEqual(await store.beginRequest(conversation.id, request), request)
  const completed = await store.finalizeRequest(
    conversation.id,
    request.requestId,
    'completed',
    [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer', status: 'completed' }
    ]
  )
  assert.equal(completed?.status, 'completed')
  assert.equal(completed?.messageStartIndex, 0)
  assert.equal(completed?.messageCount, 2)

  await store.finalizeRequest(
    conversation.id,
    request.requestId,
    'completed',
    [
      { role: 'user', content: 'duplicate question' },
      { role: 'assistant', content: 'duplicate answer', status: 'completed' }
    ]
  )
  assert.deepEqual(
    (await store.getConversation(conversation.id))?.messages.map(({ content }) => content),
    ['question', 'answer']
  )

  store = reopen(store)
  const found = await store.findRequest(request.requestId)
  assert.equal(found?.conversationId, conversation.id)
  assert.equal(found?.request.status, 'completed')
  assert.equal((await store.getConversation(conversation.id))?.messages.length, 2)

  const stoppedAt = '2026-08-29T00:01:00.000Z'
  await store.beginRequest(conversation.id, {
    requestId: `${request.requestId}_stop`,
    requestHash: 'b'.repeat(64),
    status: 'processing',
    createdAt: stoppedAt,
    updatedAt: stoppedAt
  })
  const stopped = await store.finalizeRequest(
    conversation.id,
    `${request.requestId}_stop`,
    'stopped'
  )
  assert.equal(stopped?.status, 'stopped')
  assert.equal((await store.getConversation(conversation.id))?.messages.length, 2)
  store.close?.()
}

test('file store keeps request terminal state and prevents duplicate message append after reopen', async () => {
  await verifyRequestPersistence(
    () => createFileConversationStore(),
    () => createFileConversationStore()
  )
})

test('SQLite store keeps request terminal state and prevents duplicate message append after reopen', async () => {
  await verifyRequestPersistence(
    () => createSqliteConversationStore(),
    (store) => {
      store.close?.()
      return createSqliteConversationStore()
    }
  )
})
