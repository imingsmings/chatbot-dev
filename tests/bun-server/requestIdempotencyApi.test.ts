import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, test } from 'bun:test'
import { startBunTestServer } from './helpers/bunTestServer.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-request-api-'))
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

Object.assign(process.env, {
  AUTH_ENABLED: 'false',
  CONVERSATION_DATA_DIR: dataDir,
  CONVERSATION_STORE: 'file',
  DEEPSEEK_API_KEY: 'request-api-test-key',
  LLM_ENDPOINT: 'http://deepseek.mock/chat/completions',
  LLM_MODEL: 'deepseek-v4-flash',
  LLM_PROVIDER: 'deepseek',
  NODE_ENV: 'test'
})

const { createApp } = await import('../../bun-server/app.ts')
const { beginConversationRequest, createConversation, getConversation } = await import(
  '../../bun-server/utils/conversationStore.ts'
)

let origin = ''
let closeServer: (() => Promise<void>) | null = null
let providerCalls = 0
let providerResponder = async (_init?: RequestInit): Promise<Response> => new Response([
  'data: {"choices":[{"delta":{"content":"持久化答案"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n'
].join(''), {
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' }
})

beforeAll(async () => {
  const server = startBunTestServer(createApp({
    validateRuntime: false,
    clientHosting: { enabled: false, distDir: '' }
  }))
  origin = server.origin
  closeServer = server.close

  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://deepseek.mock/')) {
      providerCalls += 1
      return providerResponder(init)
    }
    return originalFetch(input, init)
  }
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await closeServer?.()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('completed request replay returns persisted result without a second provider call or messages', async () => {
  const conversation = await createConversation('request idempotency API')
  const body = {
    question: '只生成一次',
    requestId: 'request_api_replay_123'
  }
  const ask = () => originalFetch(`${origin}/api/conversations/${conversation.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const first = await ask()
  assert.equal(first.status, 200)
  assert.match(await first.text(), /"type":"done"/)
  assert.equal(providerCalls, 1)
  assert.deepEqual(
    (await getConversation(conversation.id))?.messages.map(({ content }) => content),
    ['只生成一次', '持久化答案']
  )

  const replay = await ask()
  assert.equal(replay.status, 200)
  assert.equal((await replay.text()).trim(), '{"type":"done"}')
  assert.equal(providerCalls, 1)
  assert.equal((await getConversation(conversation.id))?.messages.length, 2)

  const status = await originalFetch(`${origin}/api/requests/${body.requestId}`)
  assert.equal(status.status, 200)
  assert.deepEqual((await status.json()).request, {
    requestId: body.requestId,
    conversationId: conversation.id,
    status: 'completed',
    createdAt: (await getConversation(conversation.id))?.requests?.[0]?.createdAt,
    updatedAt: (await getConversation(conversation.id))?.requests?.[0]?.updatedAt,
    messageStartIndex: 0,
    messageCount: 2
  })

  const conflicting = await originalFetch(`${origin}/api/conversations/${conversation.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, question: '不同问题' })
  })
  assert.equal(conflicting.status, 409)
  assert.match((await conflicting.json()).message, /已绑定/)
  assert.equal(providerCalls, 1)
})

test('concurrent submissions with the same requestId only start one provider request', async () => {
  const conversation = await createConversation('concurrent request idempotency')
  let releaseProvider!: (response: Response) => void
  let markProviderStarted!: () => void
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve
  })
  providerResponder = async () => {
    markProviderStarted()
    return new Promise<Response>((resolve) => {
      releaseProvider = resolve
    })
  }
  const body = JSON.stringify({
    question: '并发只生成一次',
    requestId: 'request_api_concurrent_123'
  })
  const send = () => originalFetch(`${origin}/api/conversations/${conversation.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
  const callsBefore = providerCalls
  const firstPromise = send()
  await providerStarted

  const concurrent = await send()
  assert.equal(concurrent.status, 409)
  assert.match((await concurrent.json()).message, /处理中/)
  assert.equal(providerCalls, callsBefore + 1)

  releaseProvider(new Response([
    'data: {"choices":[{"delta":{"content":"并发答案"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n'
  ].join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  }))
  const first = await firstPromise
  assert.equal(first.status, 200)
  assert.match(await first.text(), /"type":"done"/)
  assert.equal((await getConversation(conversation.id))?.messages.length, 2)
})

test('cancel endpoint releases the conversation before an immediate retry is accepted', async () => {
  const conversation = await createConversation('cancel then immediate retry')
  let markProviderStarted!: () => void
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve
  })
  let upstreamCancelled = false
  providerResponder = async (init) => {
    markProviderStarted()
    const signal = init?.signal
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = () => {
          upstreamCancelled = true
          controller.error(new DOMException('Aborted', 'AbortError'))
        }
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const firstRequestId = 'request_api_cancel_first_123'
  const first = originalFetch(`${origin}/api/conversations/${conversation.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'cancel me', requestId: firstRequestId }),
  })
  await providerStarted

  const cancelled = await originalFetch(`${origin}/api/requests/${firstRequestId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'timeout' }),
  })
  assert.equal(cancelled.status, 200)
  assert.deepEqual(await cancelled.json(), { cancelled: true, completed: true })
  assert.equal(upstreamCancelled, true)
  await (await first).text()

  providerResponder = async () => new Response([
    'data: {"choices":[{"delta":{"content":"重试成功"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
  const retry = await originalFetch(`${origin}/api/conversations/${conversation.id}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'retry immediately',
      requestId: 'request_api_cancel_retry_123',
    }),
  })
  assert.equal(retry.status, 200)
  assert.match(await retry.text(), /"type":"done"/)
  assert.deepEqual(
    (await getConversation(conversation.id))?.messages.map(({ content }) => content),
    ['retry immediately', '重试成功'],
  )
})

test('status lookup marks processing left by a restart as failed', async () => {
  const conversation = await createConversation('stale processing request')
  const timestamp = '2026-08-29T00:00:00.000Z'
  await beginConversationRequest(conversation.id, {
    requestId: 'request_api_stale_123',
    requestHash: 'c'.repeat(64),
    status: 'processing',
    createdAt: timestamp,
    updatedAt: timestamp
  })

  const response = await originalFetch(`${origin}/api/requests/request_api_stale_123`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).request.status, 'failed')
  assert.equal((await getConversation(conversation.id))?.messages.length, 0)
})
