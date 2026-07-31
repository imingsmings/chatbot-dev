import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-summary-file-'))
const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
const requests: Array<Record<string, unknown>> = []

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'
process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://127.0.0.1/mock-summary'
process.env.LLM_MODEL = 'summary-test-model'
process.env.DEEPSEEK_API_KEY = 'summary-test-key'
process.env.CONTEXT_MAX_HISTORY_MESSAGES = '1'

before(() => {
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(String(options.body || '{}')) as Record<string, unknown>)
    return new Response(JSON.stringify({
      choices: [{ message: { content: '用户正在实现本地聊天项目，已经完成上下文窗口。下一步需要验证摘要。' } }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

after(async () => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { generateConversationSummary } = await import('../../server/services/conversationSummaryService.ts')
const { buildContextMessages } = await import('../../server/services/contextService.ts')
const {
  appendMessages,
  clearConversation,
  createConversation,
  getConversation
} = await import('../../server/utils/conversationStore.ts')

test('manual summary generation persists and participates in managed context', async () => {
  const conversation = await createConversation('Summary test')
  await appendMessages(conversation.id, [
    { role: 'user', content: '正在实现本地聊天项目' },
    { role: 'assistant', content: '先完成上下文窗口' }
  ])

  const result = await generateConversationSummary(conversation.id, {
    temperature: 0.2,
    maxTokens: 600,
    reasoningEnabled: true
  })

  assert(result.conversation)
  assert.equal(result.conversation.summary?.sourceMessageCount, 2)
  assert.match(result.conversation.summary?.content || '', /本地聊天项目/)

  const stored = await getConversation(conversation.id)
  assert.deepEqual(stored?.summary, result.conversation.summary)

  const context = buildContextMessages(stored!, '继续做什么？')
  assert.equal(context.summaryIncluded, true)
  assert.equal(context.selectedHistoryMessages, 1)
  assert(context.messages.some((message) => message.role === 'system' && message.content?.includes('本地聊天项目')))

  assert.equal(requests.length, 1)
  assert.equal(requests[0].temperature, 0.2)
  assert.equal(requests[0].max_tokens, 600)
  assert.deepEqual(requests[0].thinking, { type: 'disabled' })
})

test('clearing a conversation also clears the persisted summary', async () => {
  const conversation = await createConversation('Summary clear')
  await appendMessages(conversation.id, [{ role: 'user', content: '需要摘要' }])
  await generateConversationSummary(conversation.id)

  const cleared = await clearConversation(conversation.id)
  assert.equal(cleared?.messages.length, 0)
  assert.equal(cleared?.summary, undefined)
})

test('empty and missing conversations return explicit summary errors', async () => {
  const empty = await createConversation('Empty summary')
  assert.deepEqual(await generateConversationSummary(empty.id), { error: 'empty' })
  assert.deepEqual(await generateConversationSummary('conv_missing_summary'), { error: 'not_found' })
})
