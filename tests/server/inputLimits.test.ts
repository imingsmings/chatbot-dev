import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
} from '../../server/config/productLimits.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-input-limits-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { askConversation } = await import('../../server/controllers/chatController.ts')
const {
  createConversation: createConversationController,
  previewConversationContext,
  searchConversations,
} = await import('../../server/controllers/conversationController.ts')
const { importConversationBackup } = await import('../../server/services/conversationImportService.ts')
const { createNewConversation, updateConversationTitle } = await import(
  '../../server/services/conversationService.ts'
)

function createResponse() {
  let statusCode = 200
  let body: unknown
  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    json(payload: unknown) {
      body = payload
      return response
    },
  }
  return { response, read: () => ({ statusCode, body }) }
}

const next = ((error?: unknown) => {
  if (error) throw error
}) as never

test('conversation title and search limits reject oversized input', async () => {
  const tooLongTitle = 'a'.repeat(MAX_CONVERSATION_TITLE_LENGTH + 1)
  assert.deepEqual(await updateConversationTitle('conv_missing', tooLongTitle), {
    error: 'title_too_long',
  })

  const create = createResponse()
  await createConversationController(
    { body: { title: tooLongTitle } } as Parameters<typeof createConversationController>[0],
    create.response as Parameters<typeof createConversationController>[1],
    next,
  )
  assert.deepEqual(create.read(), {
    statusCode: 400,
    body: { message: `会话名称不能超过 ${MAX_CONVERSATION_TITLE_LENGTH} 个字符` },
  })

  const search = createResponse()
  await searchConversations(
    { query: { q: 'q'.repeat(MAX_SEARCH_QUERY_LENGTH + 1) } } as Parameters<typeof searchConversations>[0],
    search.response as Parameters<typeof searchConversations>[1],
    next,
  )
  assert.equal(search.read().statusCode, 400)
})

test('ask and context preview reject oversized questions before model work', async () => {
  const tooLongQuestion = 'q'.repeat(MAX_QUESTION_LENGTH + 1)
  const ask = createResponse()
  await askConversation(
    {
      body: { question: tooLongQuestion, requestId: 'request_limits_123' },
      params: { id: 'conv_missing' },
    } as Parameters<typeof askConversation>[0],
    ask.response as Parameters<typeof askConversation>[1],
    next,
  )
  assert.equal(ask.read().statusCode, 400)

  const conversation = await createNewConversation('Context limits')
  const preview = createResponse()
  await previewConversationContext(
    {
      body: { question: tooLongQuestion, options: {} },
      params: { id: conversation.id },
    } as Parameters<typeof previewConversationContext>[0],
    preview.response as Parameters<typeof previewConversationContext>[1],
    next,
  )
  assert.equal(preview.read().statusCode, 400)
})

test('import validates title limits before writing any conversation', async () => {
  await assert.rejects(
    importConversationBackup({
      schemaVersion: 1,
      source: 'chatbot-local',
      exportedAt: '2026-08-09T00:00:00.000Z',
      conversations: [{
        id: 'conv_oversized_import',
        title: 'x'.repeat(MAX_CONVERSATION_TITLE_LENGTH + 1),
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        titleManuallyEdited: true,
        messages: [],
      }],
    }),
    /title 不能超过/,
  )
})
