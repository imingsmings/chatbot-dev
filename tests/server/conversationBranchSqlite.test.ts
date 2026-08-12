import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import type { Conversation } from '../../server/types/conversation.ts'

const requireNodeModule = createRequire(import.meta.url)
const sqliteAvailable = (() => {
  try {
    requireNodeModule('node:sqlite')
    return true
  } catch {
    return false
  }
})()
const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-branch-sqlite-'))
const sqliteDbPath = path.join(dataDir, 'sqlite', 'conversations.sqlite3')
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = sqliteDbPath
process.env.CONVERSATION_STORE = 'sqlite'

if (sqliteAvailable) {
  await mkdir(path.dirname(sqliteDbPath), { recursive: true })
}

const { createConversationBranch } = await import(
  '../../server/services/conversationService.ts'
)
const {
  closeConversationStore,
  getConversation,
  importConversation,
} = await import('../../server/utils/conversationStore.ts')

after(async () => {
  closeConversationStore()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test(
  'SQLite branch preserves prefix metadata and leaves the source unchanged',
  { skip: sqliteAvailable ? false : 'node:sqlite is not available in this Node.js runtime' },
  async () => {
    const source: Conversation = {
      id: 'conv_branch_sqlite_source',
      title: 'SQLite 分支测试',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:01:00.000Z',
      titleManuallyEdited: false,
      messages: [
        { role: 'user', content: '第一问' },
        {
          role: 'assistant',
          content: '第一答',
          reasoningContent: '推理',
          reasoningDurationMs: 12,
          status: 'completed',
          generation: {
            provider: 'openai',
            model: 'gpt-test',
            totalDurationMs: 20,
            usage: { totalTokens: 8 },
          },
          toolTrace: [{
            name: 'getCurrentTime',
            success: true,
            durationMs: 1,
            summary: '当前时间',
          }],
        },
        { role: 'user', content: '第二问' },
        { role: 'assistant', content: '第二答', status: 'completed' },
      ],
      summary: {
        content: 'SQLite 原摘要',
        sourceMessageCount: 4,
        updatedAt: '2026-08-12T00:02:00.000Z',
      },
    }
    assert.equal((await importConversation(source, 'skip')).status, 'created')
    const originalBefore = await getConversation(source.id)

    const result = await createConversationBranch(source.id, 2)
    assert(!('error' in result))
    assert(originalBefore)
    assert.deepEqual(result.conversation.messages, originalBefore.messages.slice(0, 2))
    assert.equal(result.conversation.summary, undefined)
    assert.equal(result.conversation.title, 'SQLite 分支测试（分支）')
    assert.deepEqual(await getConversation(source.id), originalBefore)
    assert.deepEqual(await getConversation(result.conversation.id), result.conversation)
    assert((await stat(sqliteDbPath)).size > 0)
  },
)
