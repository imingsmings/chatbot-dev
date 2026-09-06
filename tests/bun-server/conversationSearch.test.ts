import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterAll, test } from 'bun:test'

const originalEnv = {
  CONVERSATION_DATA_DIR: process.env.CONVERSATION_DATA_DIR,
  CONVERSATION_STORE: process.env.CONVERSATION_STORE
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-search-test-data-'))
process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

const {
  createNewConversation,
  findConversation,
  searchConversationSummaries
} = await import('../../bun-server/services/conversationService.ts')
const { searchConversations } = await import('../../bun-server/controllers/conversationController.ts')
const { conversationRoutes } = await import('../../bun-server/routes/conversations.ts')
const { appendMessages } = await import('../../bun-server/utils/conversationStore.ts')

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

test('searchConversationSummaries matches titles and message content', async () => {
  const titleMatch = await createNewConversation('Alpha Roadmap')
  await appendMessages(titleMatch.id, [
    { role: 'user', content: '这条消息不包含关键词' }
  ])

  const messageMatch = await createNewConversation('普通会话')
  await appendMessages(messageMatch.id, [
    { role: 'assistant', content: '这里包含 alpha 搜索内容，用于消息命中' }
  ])

  const ignored = await createNewConversation('无关会话')
  await appendMessages(ignored.id, [
    { role: 'user', content: '没有目标词' }
  ])

  const results = await searchConversationSummaries('alpha')

  assert.equal(results.length, 2)
  assert.equal(results[0].id, titleMatch.id)
  assert.equal(results[0].matchedIn, 'title')
  assert.equal(results[0].snippet, 'Alpha Roadmap')
  assert.equal(results[1].id, messageMatch.id)
  assert.equal(results[1].matchedIn, 'message')
  assert(results[1].snippet?.includes('alpha 搜索内容'))
  assert(!results.some((result) => result.id === ignored.id))
})

test('searchConversationSummaries treats special characters as plain text', async () => {
  const conversation = await createNewConversation('特殊字符搜索')
  await appendMessages(conversation.id, [
    { role: 'user', content: '用户想搜索 [a+b]? 这种内容时不应该触发正则错误' }
  ])

  const results = await searchConversationSummaries('[a+b]?')

  assert(results.some((result) => result.id === conversation.id && result.matchedIn === 'message'))
})

test('searchConversationSummaries returns no results for blank query', async () => {
  assert.deepEqual(await searchConversationSummaries('   '), [])
})

test('searchConversationSummaries does not mutate conversation data', async () => {
  const conversation = await createNewConversation('只读搜索')
  await appendMessages(conversation.id, [
    { role: 'assistant', content: '只读搜索需要保持消息和更新时间不变' }
  ])
  const before = await findConversation(conversation.id)

  await searchConversationSummaries('只读搜索')

  const after = await findConversation(conversation.id)
  assert.equal(after?.updatedAt, before?.updatedAt)
  assert.deepEqual(after?.messages, before?.messages)
})

test('searchConversations controller validates empty query and returns search results', async () => {
  const conversation = await createNewConversation('Controller Search Title')
  await appendMessages(conversation.id, [
    { role: 'user', content: 'controller-search-message' }
  ])

  const blankResponse = await callSearchController('   ')
  assert.equal(blankResponse.statusCode, 400)
  assert.deepEqual(blankResponse.body, { message: '搜索关键词不能为空' })

  const searchResponse = await callSearchController('controller-search-message')
  assert.equal(searchResponse.statusCode, 200)
  assert(Array.isArray(searchResponse.body.conversations))
  assert(
    searchResponse.body.conversations.some(
      (result) => result.id === conversation.id && result.matchedIn === 'message'
    )
  )
})

test('conversation search route is registered before dynamic conversation id route', () => {
  const searchRouteIndex = conversationRoutes.findIndex(
    (route) => route.pattern === '/conversations/search' && route.method === 'GET'
  )
  const dynamicRouteIndex = conversationRoutes.findIndex(
    (route) => route.pattern === '/conversations/:id' && route.method === 'GET'
  )

  assert(searchRouteIndex >= 0, 'GET /conversations/search route is not registered')
  assert(dynamicRouteIndex >= 0, 'GET /conversations/:id route is not registered')
  assert(
    searchRouteIndex < dynamicRouteIndex,
    'GET /conversations/search must be registered before GET /conversations/:id'
  )
})

async function callSearchController(q: string): Promise<{
  body: {
    message?: string
    conversations?: Array<{ id: string; matchedIn: string }>
  }
  statusCode: number
}> {
  let statusCode = 200
  let body: {
    message?: string
    conversations?: Array<{ id: string; matchedIn: string }>
  } = {}
  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    json(payload: typeof body) {
      body = payload
      return response
    }
  }

  await searchConversations(
    { query: { q } } as Parameters<typeof searchConversations>[0],
    response as unknown as Parameters<typeof searchConversations>[1],
    ((err?: unknown) => {
      if (err) {
        throw err
      }
    }) as Parameters<typeof searchConversations>[2]
  )

  return {
    body,
    statusCode
  }
}
