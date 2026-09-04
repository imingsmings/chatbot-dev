import assert from 'node:assert/strict'
import { test } from 'bun:test'

import {
  MAX_PROVIDER_ERROR_BYTES,
  ProviderHttpError,
  createProviderHttpError,
  extractProviderErrorFields,
} from '../../bun-server/utils/llm/providerDiagnostics.ts'

test('provider diagnostics extract structured fields and redact credentials', () => {
  const fields = extractProviderErrorFields(JSON.stringify({
    error: {
      code: 'invalid_api_key',
      type: 'authentication_error',
      message: 'Bearer secret-token api_key=sk-super-secret-token password=hunter2',
    },
  }))

  assert.equal(fields.code, 'invalid_api_key')
  assert.equal(fields.type, 'authentication_error')
  assert.match(fields.detail ?? '', /\[REDACTED\]/)
  assert.doesNotMatch(fields.detail ?? '', /secret-token|super-secret|hunter2/)
  assert.deepEqual(extractProviderErrorFields('<html>upstream failure</html>'), {})
})

test('provider HTTP errors expose a safe reference and log bounded structured diagnostics', async () => {
  const originalConsoleError = console.error
  const logs: unknown[][] = []
  console.error = (...values: unknown[]) => {
    logs.push(values)
  }

  try {
    const error = await createProviderHttpError({
      response: new Response(JSON.stringify({
        error: {
          code: 'rate_limit',
          message: 'Rate limited for token=sk-sensitive-value',
          type: 'rate_limit_error',
        },
      }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'x-request-id': 'provider-request-123' },
      }),
      provider: 'deepseek',
      signal: new AbortController().signal,
      abortUpstream: () => undefined,
      correlationId: 'internal-correlation-123',
    })

    assert(error instanceof ProviderHttpError)
    assert.match(error.message, /HTTP 429/)
    assert.match(error.message, /参考 ID：internal-correlation-123/)
    assert.doesNotMatch(error.message, /sk-sensitive-value/)
    assert.deepEqual(error.diagnostic, {
      correlationId: 'internal-correlation-123',
      provider: 'deepseek',
      providerRequestId: 'provider-request-123',
      status: 429,
      code: 'rate_limit',
      detail: 'Rate limited for token=[REDACTED]',
      type: 'rate_limit_error',
    })
    assert.equal(logs.length, 1)
    const serializedLog = JSON.stringify(logs)
    assert.match(serializedLog, /internal-correlation-123|provider-request-123/)
    assert.doesNotMatch(serializedLog, /sk-sensitive-value/)
  } finally {
    console.error = originalConsoleError
  }
})

test('provider diagnostics cancel an error body after reaching the read limit', async () => {
  const originalConsoleError = console.error
  let bodyCancelled = false
  console.error = () => undefined

  try {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PROVIDER_ERROR_BYTES))
      },
      cancel() {
        bodyCancelled = true
      },
    }), { status: 502 })

    await createProviderHttpError({
      response,
      provider: 'deepseek',
      signal: new AbortController().signal,
      abortUpstream: () => undefined,
      correlationId: 'bounded-body-correlation',
    })

    assert.equal(bodyCancelled, true)
  } finally {
    console.error = originalConsoleError
  }
})
