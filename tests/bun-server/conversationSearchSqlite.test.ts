import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterAll, test } from 'bun:test'

const requireNodeModule = createRequire(import.meta.url)
const sqliteAvailable = (() => {
  try {
    requireNodeModule('node:sqlite')
    return true
  } catch {
    return false
  }
})()

const originalEnv = {
  CONVERSATION_DATA_DIR: process.env.CONVERSATION_DATA_DIR,
  CONVERSATION_DB_PATH: process.env.CONVERSATION_DB_PATH,
  CONVERSATION_FILE_DATA_DIR: process.env.CONVERSATION_FILE_DATA_DIR,
  CONVERSATION_STORE: process.env.CONVERSATION_STORE
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-search-sqlite-test-data-'))
const sqliteDbPath = path.join(dataDir, 'sqlite', 'conversations.sqlite3')

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = sqliteDbPath
process.env.CONVERSATION_FILE_DATA_DIR = path.join(dataDir, 'file')
process.env.CONVERSATION_STORE = 'sqlite'

let serviceModule: Awaited<typeof import('../../bun-server/services/conversationService.ts')> | null = null
let storeModule: Awaited<typeof import('../../bun-server/utils/conversationStore.ts')> | null = null

if (sqliteAvailable) {
  await mkdir(path.dirname(sqliteDbPath), { recursive: true })
  serviceModule = await import('../../bun-server/services/conversationService.ts')
  storeModule = await import('../../bun-server/utils/conversationStore.ts')
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterAll(async () => {
  restoreEnv()
  await rm(dataDir, { recursive: true, force: true })
})

test.skipIf(!sqliteAvailable)(
  'searchConversationSummaries matches title and message content with SQLite store',
  async () => {
    assert(serviceModule)
    assert(storeModule)
    const { createNewConversation, findConversation, searchConversationSummaries } = serviceModule
    const { appendMessages } = storeModule

    const searchToken = 'sqlite-search-token-7319'
    const titleMatch = await createNewConversation(`SQLite ${searchToken} Title`)
    await appendMessages(titleMatch.id, [
      { role: 'user', content: '标题命中会话的消息不参与匹配' }
    ])

    const messageMatch = await createNewConversation('SQLite Message Carrier')
    await appendMessages(messageMatch.id, [
      { role: 'assistant', content: `这里包含 ${searchToken} 用于 SQLite 消息搜索` }
    ])

    const ignored = await createNewConversation('SQLite Ignored Conversation')
    await appendMessages(ignored.id, [
      { role: 'user', content: '这条消息不应该被 SQLite 搜索命中' }
    ])

    const beforeMessageMatch = await findConversation(messageMatch.id)
    const results = await searchConversationSummaries(searchToken)
    const dbStat = await stat(sqliteDbPath)
    const afterMessageMatch = await findConversation(messageMatch.id)

    assert.equal(results.length, 2)
    assert.equal(results[0].id, titleMatch.id)
    assert.equal(results[0].matchedIn, 'title')
    assert.equal(results[0].snippet, titleMatch.title)
    assert.equal(results[1].id, messageMatch.id)
    assert.equal(results[1].matchedIn, 'message')
    assert(results[1].snippet?.includes(searchToken))
    assert(!results.some((result) => result.id === ignored.id))
    assert.equal(dbStat.isFile(), true)
    assert.equal(afterMessageMatch?.updatedAt, beforeMessageMatch?.updatedAt)
    assert.deepEqual(afterMessageMatch?.messages, beforeMessageMatch?.messages)
  }
)

test.skipIf(!sqliteAvailable)(
  'searchConversationSummaries treats SQLite special-character queries as plain text',
  async () => {
    assert(serviceModule)
    assert(storeModule)
    const { createNewConversation, searchConversationSummaries } = serviceModule
    const { appendMessages } = storeModule

    const conversation = await createNewConversation('SQLite 特殊字符搜索')
    await appendMessages(conversation.id, [
      { role: 'user', content: 'SQLite 用户搜索 [a+b]? 时应该按普通文本匹配' }
    ])

    const results = await searchConversationSummaries('[a+b]?')

    assert(
      results.some((result) => result.id === conversation.id && result.matchedIn === 'message')
    )
  }
)
