import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-sqlite-migration-'))
const conversationsDir = path.join(dataDir, 'file', 'conversations')
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'sqlite'

await mkdir(conversationsDir, { recursive: true })
await writeFile(
  path.join(conversationsDir, 'conv_valid_migration.json'),
  JSON.stringify({
    id: 'conv_payload_id_is_ignored',
    title: 'Valid migration source',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    titleManuallyEdited: true,
    messages: [{ role: 'user', content: 'preserve me' }],
  }),
  'utf8',
)
await writeFile(path.join(conversationsDir, 'conv_malformed_migration.json'), '{not-json', 'utf8')
await writeFile(path.join(dataDir, 'file', 'conversations.json.migrated'), '{also-not-json', 'utf8')

after(async () => {
  closeConversationStore()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const {
  closeConversationStore,
  createConversation,
  getConversation,
  listConversations,
} = await import('../../server/utils/conversationStore.ts')

test('SQLite migration skips malformed JSON while preserving valid conversations', async () => {
  const summaries = await listConversations()

  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]?.id, 'conv_valid_migration')
  assert.equal((await getConversation('conv_valid_migration'))?.messages[0]?.content, 'preserve me')
  assert.equal(await getConversation('conv_payload_id_is_ignored'), null)

  const created = await createConversation('Store remains writable')
  assert.equal((await getConversation(created.id))?.title, 'Store remains writable')

  closeConversationStore()
  assert.equal((await getConversation(created.id))?.title, 'Store remains writable')
})
