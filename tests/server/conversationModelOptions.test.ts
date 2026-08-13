import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { Conversation, ConversationModelOptions } from '../../server/types/conversation.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-model-options-file-'))
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'
process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://provider.mock/chat/completions'
process.env.LLM_MODEL = 'deepseek-v4-flash'
process.env.DEEPSEEK_API_KEY = 'model-options-test-key'

const { createApp } = await import('../../server/app.ts')
const { createNewConversation, createConversationBranch } = await import(
  '../../server/services/conversationService.ts'
)
const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
const {
  appendMessages,
  clearConversation,
  getConversation,
  importConversation,
  listConversations,
  updateConversationModelOptions,
} = await import('../../server/utils/conversationStore.ts')
const { completeRequest, registerRequest } = await import('../../server/utils/requestRegistry.ts')

const proOptions: ConversationModelOptions = {
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  reasoningEnabled: true,
  reasoningEffort: 'high',
  temperature: 0.2,
  maxTokens: 4096,
}

let origin = ''
let server: http.Server

before(async () => {
  const app = createApp({ validateRuntime: false, clientHosting: { enabled: false, distDir: '' } })
  server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  globalThis.fetch = originalFetch
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

async function patchModelOptions(id: string, options: unknown) {
  return originalFetch(`${origin}/api/conversations/${encodeURIComponent(id)}/model-options`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options }),
  })
}

function legacyConversation(id: string): Conversation {
  return {
    id,
    title: `Legacy ${id}`,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    titleManuallyEdited: true,
    messages: [{ role: 'user', content: 'legacy message' }],
  }
}

test('new conversations bind defaults and file updates preserve timestamps, clear and branches', async () => {
  const conversation = await createNewConversation('Persist options')
  assert.deepEqual(conversation.modelOptions, {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEnabled: true,
    reasoningEffort: 'max',
  })
  const originalUpdatedAt = conversation.updatedAt

  const updated = await updateConversationModelOptions(conversation.id, proOptions)
  assert.deepEqual(updated?.modelOptions, proOptions)
  assert.equal(updated?.updatedAt, originalUpdatedAt)
  assert.equal((await listConversations())[0]?.updatedAt, originalUpdatedAt)
  assert.deepEqual((await getConversation(conversation.id))?.modelOptions, proOptions)

  await appendMessages(conversation.id, [{ role: 'user', content: 'branch source' }])
  const branchResult = await createConversationBranch(conversation.id, 0)
  assert('conversation' in branchResult)
  assert.deepEqual(branchResult.conversation.modelOptions, proOptions)
  branchResult.conversation.modelOptions!.reasoningEffort = 'low'
  assert.equal((await getConversation(conversation.id))?.modelOptions?.reasoningEffort, 'high')

  const cleared = await clearConversation(conversation.id)
  assert.deepEqual(cleared?.modelOptions, proOptions)
})

test('stored malformed, unknown, disabled and overflowing options drop only model options', async () => {
  process.env.LLM_DISABLED_MODELS = 'gpt-5.6-sol'
  const conversationsDir = path.join(dataDir, 'file', 'conversations')
  await mkdir(conversationsDir, { recursive: true })
  const invalidOptions = [
    'not-an-object',
    { ...proOptions, model: 'unknown-model' },
    {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      reasoningEnabled: true,
      reasoningEffort: 'medium',
    },
    { ...proOptions, maxTokens: 999_999 },
  ]

  for (const [index, modelOptions] of invalidOptions.entries()) {
    const conversation = legacyConversation(`conv_invalid_model_options_${index}`)
    await writeFile(
      path.join(conversationsDir, `${conversation.id}.json`),
      JSON.stringify({ ...conversation, modelOptions }),
      'utf8',
    )
    const stored = await getConversation(conversation.id)
    assert.equal(stored?.modelOptions, undefined)
    assert.equal(stored?.messages[0]?.content, 'legacy message')
  }
  delete process.env.LLM_DISABLED_MODELS
})

test('context preview is read-only while failed first ask persists the effective legacy binding', async () => {
  const legacy = legacyConversation('conv_legacy_first_binding')
  await importConversation(legacy, 'skip')

  const preview = await originalFetch(`${origin}/api/conversations/${legacy.id}/context-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'preview', options: proOptions }),
  })
  assert.equal(preview.status, 200)
  assert.equal((await getConversation(legacy.id))?.modelOptions, undefined)

  let providerBody: unknown
  try {
    globalThis.fetch = async (_input, init) => {
      providerBody = JSON.parse(String(init?.body)) as unknown
      return new Response('provider failed', { status: 503 })
    }
    await assert.rejects(
      generateConversationAnswer({
        conversation: legacy,
        conversationId: legacy.id,
        question: 'bind before failure',
        signal: new AbortController().signal,
        onDelta: () => undefined,
        modelOptions: proOptions,
      }),
      /Failed to request model/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual((await getConversation(legacy.id))?.modelOptions, proOptions)
  assert.equal((providerBody as { model?: string }).model, proOptions.model)
})

test('model-options PATCH validates input, reports missing and locks against active work', async () => {
  const conversation = await createNewConversation('PATCH model options')
  const invalid = await patchModelOptions(conversation.id, { provider: 'deepseek' })
  assert.equal(invalid.status, 400)

  const missing = await patchModelOptions('conv_missing_model_options', proOptions)
  assert.equal(missing.status, 404)

  const controller = new AbortController()
  assert.equal(registerRequest({
    requestId: 'model_options_lock_test',
    conversationId: conversation.id,
    controller,
    cancel: () => controller.abort(),
  }), true)
  const conflict = await patchModelOptions(conversation.id, proOptions)
  assert.equal(conflict.status, 409)
  completeRequest('model_options_lock_test', controller)

  const updatedAt = conversation.updatedAt
  const success = await patchModelOptions(conversation.id, proOptions)
  assert.equal(success.status, 200)
  const payload = await success.json() as { conversation: Conversation }
  assert.deepEqual(payload.conversation.modelOptions, proOptions)
  assert.equal(payload.conversation.updatedAt, updatedAt)
})
