import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-vision-flow-'))
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const requests: Array<Record<string, unknown>> = []

Object.assign(process.env, {
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_STORE: 'file',
  DEEPSEEK_API_KEY: 'vision-test-key',
  LLM_ENDPOINT: 'https://mock.local/chat/completions',
  LLM_PROVIDER: 'deepseek',
})

const { createImageAttachment } = await import('../../server/services/attachmentService.ts')
const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
const { createNewConversation } = await import('../../server/services/conversationService.ts')
const { getConversation } = await import('../../server/utils/conversationStore.ts')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

before(() => {
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>)
    const payload = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '看图' } }] })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: '这是一张测试图片。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n')
    return new Response(payload, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
})

after(async () => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
  await rm(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  })
})

test('Vision chat materializes Base64 at request time and persists metadata after completion', async () => {
  const conversation = await createNewConversation('Vision flow')
  const attachment = await createImageAttachment(conversation.id, {
    buffer: PNG_1X1,
    filename: 'vision.png',
    mediaType: 'image/png',
    detail: 'original',
  })
  const deltas: string[] = []

  const result = await generateConversationAnswer({
    conversation,
    conversationId: conversation.id,
    question: '描述图片',
    attachments: [attachment],
    signal: new AbortController().signal,
    onDelta: (chunk) => deltas.push(chunk),
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      reasoningEnabled: true,
      reasoningEffort: 'high',
    },
  })

  assert.equal(result.content, '这是一张测试图片。')
  assert.deepEqual(deltas, ['看图', '这是一张测试图片。'])
  const requestMessages = requests[0].messages as Array<{ role: string; content: unknown }>
  const current = requestMessages.at(-1)
  assert.equal(current?.role, 'user')
  assert.deepEqual(current?.content, [
    { type: 'text', text: '描述图片' },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
        detail: 'original',
      },
    },
  ])

  const persisted = await getConversation(conversation.id)
  assert.deepEqual(persisted?.messages[0]?.attachments, [attachment])
  assert.equal(persisted?.messages[0]?.content, '描述图片')
  assert.equal(persisted?.messages[1]?.content, '这是一张测试图片。')
  assert.equal(persisted?.messages[1]?.generation?.model, 'deepseek-v4-flash-vision-exp')
  assert.deepEqual(persisted?.messages[1]?.generation?.usage, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  })
  assert(!JSON.stringify(persisted).includes('data:image/'))
})

test('Vision keeps text-only request content as a string and text models reject images before provider calls', async () => {
  const textConversation = await createNewConversation('Vision text-only')
  const requestCount = requests.length
  await generateConversationAnswer({
    conversation: textConversation,
    conversationId: textConversation.id,
    question: '纯文本',
    signal: new AbortController().signal,
    onDelta: () => undefined,
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      reasoningEnabled: false,
      reasoningEffort: 'medium',
    },
  })
  const textMessages = requests[requestCount].messages as Array<{ content: unknown }>
  assert.equal(textMessages.at(-1)?.content, '纯文本')

  const rejectedConversation = await createNewConversation('Vision rejected')
  const attachment = await createImageAttachment(rejectedConversation.id, {
    buffer: PNG_1X1,
    filename: 'rejected.png',
    mediaType: 'image/png',
  })
  const callsBeforeRejection = requests.length
  await assert.rejects(generateConversationAnswer({
    conversation: rejectedConversation,
    conversationId: rejectedConversation.id,
    question: 'text model',
    attachments: [attachment],
    signal: new AbortController().signal,
    onDelta: () => undefined,
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      reasoningEnabled: true,
      reasoningEffort: 'high',
    },
  }), /不支持图片/)
  assert.equal(requests.length, callsBeforeRejection)
  assert.equal((await getConversation(rejectedConversation.id))?.messages.length, 0)
})
