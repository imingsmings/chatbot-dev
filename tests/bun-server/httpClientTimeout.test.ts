import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'
import { startBunTestServer } from './helpers/bunTestServer.ts'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-heartbeat-timeout-'))

process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
process.env.LLM_MODEL = 'deepseek-v4-flash'
process.env.DEEPSEEK_API_KEY = 'timeout-test-key'
process.env.LLM_TIMEOUT_MS = '20'
process.env.AUTH_ENABLED = 'false'
process.env.CONVERSATION_STORE = 'file'
process.env.CONVERSATION_DATA_DIR = dataDir
process.env.NODE_ENV = 'test'

afterAll(async () => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const { callLLM } = await import('../../bun-server/utils/llm/index.ts')

test('LLM timeout remains active after headers while the response body stalls', async () => {
  let streamCancelled = false
  globalThis.fetch = async () => new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        streamCancelled = true
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

  await assert.rejects(
    callLLM([{ role: 'user', content: 'timeout after headers' }]),
    /请求超时，请稍候重试/,
  )
  assert.equal(streamCancelled, true)
})

test('accepted ask sends a heartbeat while the provider deadline still fails and releases the request', async () => {
  const { createApp } = await import('../../bun-server/app.ts')
  const { createConversation, getConversation, findConversationRequest } = await import('../../bun-server/utils/conversationStore.ts')
  const server = startBunTestServer(createApp({ validateRuntime: false, clientHosting: { enabled: false, distDir: '' } }))
  let providerAborted = false
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith('http://mock.local/')) return originalFetch(input, init)
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        providerAborted = true
        reject(new DOMException('Aborted', 'AbortError'))
      }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    })
  }
  try {
    const conversation = await createConversation('heartbeat provider deadline')
    const requestId = 'request_heartbeat_timeout_123'
    const response = await originalFetch(`${server.origin}/api/conversations/${conversation.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'silent provider', requestId }),
      signal: AbortSignal.timeout(2_000),
    })
    assert.equal(response.status, 200)
    const payload = await response.text()
    assert.ok(payload.startsWith('\n'))
    assert.deepEqual(payload.trim().split('\n').map((line) => JSON.parse(line)), [
      { type: 'error', message: '请求超时，请稍候重试' },
    ])
    assert.equal(providerAborted, true)
    assert.equal((await findConversationRequest(requestId))?.request.status, 'failed')
    assert.equal((await getConversation(conversation.id))?.messages.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    await server.close()
  }
})
