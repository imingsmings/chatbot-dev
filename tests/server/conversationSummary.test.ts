import { EventEmitter } from 'node:events'
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
const { summarizeConversation } = await import('../../server/controllers/conversationController.ts')
const { buildContextMessages } = await import('../../server/services/contextService.ts')
const { cancelAllRequests } = await import('../../server/utils/requestRegistry.ts')
const {
  appendMessages,
  clearConversation,
  createConversation,
  getConversation,
  importConversation
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
  assert.equal(context.summaryCoveredMessages, 2)
  assert.equal(context.postSummaryMessages, 0)
  assert.equal(context.selectedHistoryMessages, 0)
  assert.equal(context.selectedHistoryRange, null)
  assert(context.messages.some((message) => message.role === 'system' && message.content?.includes('本地聊天项目')))

  assert.equal(requests.length, 1)
  assert.equal(requests[0].temperature, 0.2)
  assert.equal(requests[0].max_tokens, 600)
  assert.deepEqual(requests[0].thinking, { type: 'disabled' })
})

test('messages added after a summary are the only raw history sent to the model', async () => {
  const conversation = await createConversation('Summary follow-up')
  await appendMessages(conversation.id, [
    { role: 'user', content: '摘要前用户消息' },
    { role: 'assistant', content: '摘要前助手消息' }
  ])
  const summaryResult = await generateConversationSummary(conversation.id)
  assert(summaryResult.conversation)

  await appendMessages(conversation.id, [
    { role: 'user', content: '摘要后用户消息' },
    { role: 'assistant', content: '摘要后助手消息' }
  ])
  const stored = await getConversation(conversation.id)
  const context = buildContextMessages(stored!, '继续提问')
  const content = context.messages.map((message) => message.content || '').join('\n')

  assert.equal(context.summaryCoveredMessages, 2)
  assert.equal(context.postSummaryMessages, 2)
  assert.equal(context.selectedHistoryMessages, 1)
  assert.equal(context.droppedHistoryMessages, 1)
  assert.deepEqual(context.selectedHistoryRange, { start: 4, end: 4 })
  assert(!content.includes('摘要前用户消息'))
  assert(!content.includes('摘要前助手消息'))
  assert(!content.includes('摘要后用户消息'))
  assert(content.includes('摘要后助手消息'))
})

test('regenerating a summary advances the coverage boundary to the latest message', async () => {
  const conversation = await createConversation('Summary regeneration')
  await appendMessages(conversation.id, [
    { role: 'user', content: '第一轮问题' },
    { role: 'assistant', content: '第一轮回答' }
  ])
  const firstSummary = await generateConversationSummary(conversation.id)
  assert.equal(firstSummary.conversation?.summary?.sourceMessageCount, 2)

  await appendMessages(conversation.id, [
    { role: 'user', content: '第二轮问题' },
    { role: 'assistant', content: '第二轮回答' }
  ])
  const regenerated = await generateConversationSummary(conversation.id)
  assert.equal(regenerated.conversation?.summary?.sourceMessageCount, 4)

  const context = buildContextMessages(regenerated.conversation!, '第三轮问题')
  assert.equal(context.summaryCoveredMessages, 4)
  assert.equal(context.postSummaryMessages, 0)
  assert.equal(context.selectedHistoryMessages, 0)
  assert.equal(context.selectedHistoryRange, null)
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

test('summary generation does not overwrite a conversation changed during the model request', async () => {
  const conversation = await createConversation('Summary race')
  await appendMessages(conversation.id, [{ role: 'user', content: 'first version' }])
  const currentFetch = globalThis.fetch
  globalThis.fetch = async () => {
    await appendMessages(conversation.id, [{ role: 'user', content: 'changed meanwhile' }])
    return Response.json({
      choices: [{ message: { content: 'stale summary' } }]
    })
  }

  try {
    assert.deepEqual(
      await generateConversationSummary(conversation.id),
      { error: 'conversation_changed' }
    )
    const stored = await getConversation(conversation.id)
    assert.equal(stored?.summary, undefined)
    assert.equal(stored?.messages.length, 2)
  } finally {
    globalThis.fetch = currentFetch
  }
})

test('summary generation detects same-length message replacement with an unchanged timestamp', async () => {
  const conversation = await createConversation('Summary replacement race')
  const initial = await appendMessages(conversation.id, [
    { role: 'user', content: 'original message' },
  ])
  assert(initial)

  const currentFetch = globalThis.fetch
  globalThis.fetch = async () => {
    await importConversation({
      ...initial,
      messages: [{ role: 'user', content: 'replaced message' }],
    }, 'overwrite')
    return Response.json({
      choices: [{ message: { content: 'stale replacement summary' } }]
    })
  }

  try {
    assert.deepEqual(
      await generateConversationSummary(conversation.id),
      { error: 'conversation_changed' }
    )
    const stored = await getConversation(conversation.id)
    assert.equal(stored?.summary, undefined)
    assert.equal(stored?.messages[0]?.content, 'replaced message')
  } finally {
    globalThis.fetch = currentFetch
  }
})

test('summary generation is cancelled through the shared request registry during shutdown', async () => {
  const conversation = await createConversation('Summary shutdown')
  await appendMessages(conversation.id, [{ role: 'user', content: 'cancel this summary' }])

  const currentFetch = globalThis.fetch
  let upstreamSignal: AbortSignal | undefined
  let markFetchStarted: (() => void) | undefined
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve
  })
  globalThis.fetch = async (_url, options = {}) => {
    upstreamSignal = options.signal ?? undefined
    markFetchStarted?.()
    return new Promise<Response>((_resolve, reject) => {
      upstreamSignal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    })
  }

  const request = Object.assign(new EventEmitter(), {
    body: { options: {} },
    params: { id: conversation.id },
  })
  let responseStatus = 200
  let responseBody: unknown
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status(code: number) {
      responseStatus = code
      return response
    },
    json(payload: unknown) {
      responseBody = payload
      response.writableEnded = true
      return response
    },
  })
  const next = ((error?: unknown) => {
    if (error) throw error
  }) as never

  try {
    const requestPromise = summarizeConversation(
      request as Parameters<typeof summarizeConversation>[0],
      response as Parameters<typeof summarizeConversation>[1],
      next,
    )
    await fetchStarted

    assert.equal(cancelAllRequests('server_shutdown'), 1)
    await requestPromise
    assert.equal(upstreamSignal?.aborted, true)
    assert.equal(responseStatus, 200)
    assert.equal(responseBody, undefined)
    assert.equal(cancelAllRequests(), 0)
  } finally {
    globalThis.fetch = currentFetch
  }
})
