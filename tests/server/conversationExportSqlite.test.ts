import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

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

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-export-sqlite-test-data-'))
const sqliteDbPath = path.join(dataDir, 'sqlite', 'conversations.sqlite3')

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_DB_PATH = sqliteDbPath
process.env.CONVERSATION_FILE_DATA_DIR = path.join(dataDir, 'file')
process.env.CONVERSATION_STORE = 'sqlite'

let conversationService: Awaited<typeof import('../../server/services/conversationService.ts')> | null = null
let exportService: Awaited<typeof import('../../server/services/conversationExportService.ts')> | null = null
let storeModule: Awaited<typeof import('../../server/utils/conversationStore.ts')> | null = null

if (sqliteAvailable) {
  await mkdir(path.dirname(sqliteDbPath), { recursive: true })
  conversationService = await import('../../server/services/conversationService.ts')
  exportService = await import('../../server/services/conversationExportService.ts')
  storeModule = await import('../../server/utils/conversationStore.ts')
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

after(async () => {
  restoreEnv()
  await rm(dataDir, { recursive: true, force: true })
})

test(
  'conversation export uses the configured SQLite store and preserves reasoning data',
  { skip: sqliteAvailable ? false : 'node:sqlite is not available in this Node.js runtime' },
  async () => {
    assert(conversationService)
    assert(exportService)
    assert(storeModule)
    const { createNewConversation, findConversation } = conversationService
    const { exportAllConversationsAsJson, exportConversationAsMarkdown } = exportService
    const { appendMessages } = storeModule

    const conversation = await createNewConversation('SQLite Export')
    await appendMessages(conversation.id, [
      { role: 'user', content: 'sqlite export question' },
      {
        role: 'assistant',
        content: 'sqlite export answer',
        reasoningContent: 'sqlite export reasoning',
        reasoningDurationMs: 17,
        status: 'completed',
        generation: {
          provider: 'openai',
          model: 'gpt-5.6-sol',
          finishReason: 'completed',
          firstTokenLatencyMs: 8,
          totalDurationMs: 25,
          usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 }
        },
        toolTrace: [{
          name: 'getCurrentTime',
          success: true,
          durationMs: 1,
          summary: 'UTC time'
        }]
      }
    ])
    const before = await findConversation(conversation.id)

    const markdown = await exportConversationAsMarkdown(conversation.id)
    const json = await exportAllConversationsAsJson()
    const dbStat = await stat(sqliteDbPath)
    const after = await findConversation(conversation.id)
    const exportedConversation = json.backup.conversations.find((item) => item.id === conversation.id)

    assert(markdown)
    assert(markdown.content.includes('sqlite export question'))
    assert(markdown.content.includes('sqlite export reasoning'))
    assert(markdown.content.includes('sqlite export answer'))
    assert(markdown.content.includes('<summary>生成详情</summary>'))
    assert(exportedConversation)
    assert.equal(exportedConversation.messages[1]?.reasoningContent, 'sqlite export reasoning')
    assert.equal(exportedConversation.messages[1]?.reasoningDurationMs, 17)
    assert.equal(exportedConversation.messages[1]?.generation?.usage?.totalTokens, 12)
    assert.equal(exportedConversation.messages[1]?.toolTrace?.[0]?.name, 'getCurrentTime')
    assert.equal(dbStat.isFile(), true)
    assert.deepEqual(after?.messages, before?.messages)
    assert.equal(after?.updatedAt, before?.updatedAt)
  }
)
