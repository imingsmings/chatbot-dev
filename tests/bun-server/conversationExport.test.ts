import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterAll, test } from 'bun:test'

const originalEnv = {
  CONVERSATION_DATA_DIR: process.env.CONVERSATION_DATA_DIR,
  CONVERSATION_STORE: process.env.CONVERSATION_STORE
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-export-test-data-'))
process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

const { createNewConversation, findConversation } = await import('../../bun-server/services/conversationService.ts')
const {
  EXPORT_SCHEMA_VERSION,
  exportAllConversationsAsJson,
  exportConversationAsMarkdown
} = await import('../../bun-server/services/conversationExportService.ts')
const {
  exportAllConversations,
  exportConversationMarkdown
} = await import('../../bun-server/controllers/conversationController.ts')
const conversationRouter = (await import('../../bun-server/routes/conversations.ts')).default
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

test('exportConversationAsMarkdown exports a readable conversation with reasoning details', async () => {
  const conversation = await createNewConversation('Export Markdown Test')
  await appendMessages(conversation.id, [
    { role: 'user', content: '请解释这段代码' },
    {
      role: 'assistant',
      content: '这是导出的回答正文。',
      reasoningContent: '先分析上下文，再给出结论。',
      reasoningDurationMs: 123,
      status: 'completed',
      generation: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        finishReason: 'stop',
        firstTokenLatencyMs: 45,
        totalDurationMs: 678,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
      },
      toolTrace: [{
        name: 'calculate',
        success: true,
        durationMs: 2,
        summary: '计算结果：42'
      }]
    }
  ])
  const before = await findConversation(conversation.id)

  const exported = await exportConversationAsMarkdown(conversation.id)
  const after = await findConversation(conversation.id)

  assert(exported)
  assert.equal(exported.filename, 'export-markdown-test.md')
  assert(exported.content.includes('# Export Markdown Test'))
  assert(exported.content.includes(`会话 ID：\`${conversation.id}\``))
  assert(exported.content.includes('## 1. 用户'))
  assert(exported.content.includes('请解释这段代码'))
  assert(exported.content.includes('## 2. 助手'))
  assert(exported.content.includes('<summary>思考过程 (123ms)</summary>'))
  assert(exported.content.includes('先分析上下文，再给出结论。'))
  assert(exported.content.includes('这是导出的回答正文。'))
  assert(exported.content.includes('<summary>生成详情</summary>'))
  assert(exported.content.includes('- Provider：deepseek'))
  assert(exported.content.includes('- 模型：deepseek-v4-flash'))
  assert(exported.content.includes('- 推理强度：max'))
  assert(exported.content.includes('- 总 token：30'))
  assert(exported.content.includes('calculate · 成功 · 2ms：计算结果：42'))
  assert.deepEqual(after?.messages, before?.messages)
  assert.equal(after?.updatedAt, before?.updatedAt)
})

test('exportAllConversationsAsJson preserves full conversation data for backup', async () => {
  const conversation = await createNewConversation('Export JSON Backup')
  await appendMessages(conversation.id, [
    {
      role: 'assistant',
      content: 'json backup answer',
      reasoningContent: 'json backup reasoning',
      reasoningDurationMs: 9,
      status: 'stopped',
      generation: {
        provider: 'openai',
        model: 'gpt-5.6-terra',
        firstTokenLatencyMs: 12,
        totalDurationMs: 34
      }
    }
  ])

  const exported = await exportAllConversationsAsJson()
  const parsed = JSON.parse(exported.content) as typeof exported.backup
  const exportedConversation = parsed.conversations.find((item) => item.id === conversation.id)

  assert.equal(exported.backup.schemaVersion, EXPORT_SCHEMA_VERSION)
  assert.equal(parsed.schemaVersion, EXPORT_SCHEMA_VERSION)
  assert.equal(parsed.source, 'chatbot-local')
  assert.match(exported.filename, /^chatbot-conversations-\d{4}-\d{2}-\d{2}\.json$/)
  assert(exportedConversation)
  assert.equal(exportedConversation.title, 'Export JSON Backup')
  assert.equal(exportedConversation.messages[0]?.reasoningContent, 'json backup reasoning')
  assert.equal(exportedConversation.messages[0]?.reasoningDurationMs, 9)
  assert.equal(exportedConversation.messages[0]?.status, 'stopped')
  assert.equal(exportedConversation.messages[0]?.generation?.provider, 'openai')
  assert.equal(exportedConversation.messages[0]?.generation?.usage, undefined)
  assert.deepEqual(exportedConversation.modelOptions, conversation.modelOptions)
})

test('conversation export controllers set attachment headers and 404 missing conversation', async () => {
  const conversation = await createNewConversation('Controller Export')
  await appendMessages(conversation.id, [
    { role: 'user', content: 'controller export body' }
  ])

  const markdownResponse = await callController(exportConversationMarkdown, { id: conversation.id })
  assert.equal(markdownResponse.statusCode, 200)
  assert.equal(markdownResponse.headers['Content-Type'], 'text/markdown; charset=utf-8')
  assert.equal(markdownResponse.headers['Content-Disposition'], 'attachment; filename="controller-export.md"')
  assert(markdownResponse.body.includes('controller export body'))

  const missingResponse = await callController(exportConversationMarkdown, { id: 'conv_missing_export' })
  assert.equal(missingResponse.statusCode, 404)
  assert.deepEqual(missingResponse.jsonBody, { message: '会话不存在' })

  const jsonResponse = await callController(exportAllConversations)
  assert.equal(jsonResponse.statusCode, 200)
  assert.equal(jsonResponse.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.match(jsonResponse.headers['Content-Disposition'] || '', /^attachment; filename="chatbot-conversations-\d{4}-\d{2}-\d{2}\.json"$/)
  assert(JSON.parse(jsonResponse.body).conversations.some((item: { id: string }) => item.id === conversation.id))
})

test('conversation export routes are registered before dynamic conversation id route', () => {
  type RouteLayer = {
    route?: {
      path: string
      methods: Record<string, boolean>
    }
  }
  const routeLayers = (conversationRouter as unknown as { stack: RouteLayer[] }).stack.filter(
    (layer) => layer.route
  )
  const exportAllRouteIndex = routeLayers.findIndex(
    (layer) => layer.route?.path === '/conversations/export.json' && layer.route.methods.get
  )
  const exportMarkdownRouteIndex = routeLayers.findIndex(
    (layer) => layer.route?.path === '/conversations/:id/export.md' && layer.route.methods.get
  )
  const dynamicRouteIndex = routeLayers.findIndex(
    (layer) => layer.route?.path === '/conversations/:id' && layer.route.methods.get
  )

  assert(exportAllRouteIndex >= 0, 'GET /conversations/export.json route is not registered')
  assert(exportMarkdownRouteIndex >= 0, 'GET /conversations/:id/export.md route is not registered')
  assert(dynamicRouteIndex >= 0, 'GET /conversations/:id route is not registered')
  assert(
    exportAllRouteIndex < dynamicRouteIndex,
    'GET /conversations/export.json must be registered before GET /conversations/:id'
  )
})

async function callController(
  handler: typeof exportConversationMarkdown | typeof exportAllConversations,
  params: Record<string, string> = {}
): Promise<{
  body: string
  headers: Record<string, string>
  jsonBody: unknown
  statusCode: number
}> {
  let body = ''
  const headers: Record<string, string> = {}
  let jsonBody: unknown
  let statusCode = 200
  type TestResponse = {
    setHeader: (name: string, value: string) => TestResponse
    send: (payload: string) => TestResponse
    status: (code: number) => TestResponse
    json: (payload: unknown) => TestResponse
  }
  type TestRequestHandler = (
    req: { params: Record<string, string> },
    res: TestResponse,
    next: (err?: unknown) => void
  ) => void | Promise<void>
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value
      return response
    },
    send(payload: string) {
      body = payload
      return response
    },
    status(code: number) {
      statusCode = code
      return response
    },
    json(payload: unknown) {
      jsonBody = payload
      return response
    }
  }

  await (handler as unknown as TestRequestHandler)(
    { params },
    response,
    (err?: unknown) => {
      if (err) {
        throw err
      }
    }
  )

  return {
    body,
    headers,
    jsonBody,
    statusCode
  }
}
