import assert from 'node:assert/strict'
import { afterAll, test } from 'bun:test'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
process.env.LLM_MODEL = 'deepseek-v4-flash'
process.env.DEEPSEEK_API_KEY = 'timeout-test-key'
process.env.LLM_TIMEOUT_MS = '20'

afterAll(() => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
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
