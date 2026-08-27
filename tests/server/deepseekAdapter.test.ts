import assert from 'node:assert/strict'
import test from 'node:test'
import deepseekAdapter from '../../server/utils/llm/adapters/deepseek.ts'

test('DeepSeek adapter accepts SSE data fields with or without a space', () => {
  const payload = JSON.stringify({
    choices: [{
      delta: {
        content: 'answer',
        reasoning_content: 'reasoning'
      }
    }]
  })

  assert.deepEqual(deepseekAdapter.parseStreamLine(`data: ${payload}`), {
    content: 'answer',
    reasoningContent: 'reasoning',
    toolCallDeltas: undefined,
    finishReason: undefined,
    usage: undefined
  })
  assert.deepEqual(deepseekAdapter.parseStreamLine(`data:${payload}`), {
    content: 'answer',
    reasoningContent: 'reasoning',
    toolCallDeltas: undefined,
    finishReason: undefined,
    usage: undefined
  })
  assert.deepEqual(deepseekAdapter.parseStreamLine('data:[DONE]'), {
    done: true
  })
})

test('DeepSeek adapter ignores non-data SSE lines', () => {
  assert.equal(deepseekAdapter.parseStreamLine('data:'), null)
  assert.equal(deepseekAdapter.parseStreamLine(': keep-alive'), null)
  assert.equal(deepseekAdapter.parseStreamLine('event: message'), null)
})

test('DeepSeek adapter sends the request-selected V4 model to the upstream API', () => {
  const body = deepseekAdapter.buildBody({
    config: {
      id: 'deepseek',
      endpoint: 'https://mock.local/chat/completions',
      apiKey: 'test-key',
      defaultModel: 'deepseek-v4-flash'
    },
    prompt: [{ role: 'user', content: 'hello' }],
    stream: true,
    options: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      maxTokens: undefined,
      temperature: undefined,
      reasoningEnabled: true,
      reasoningEffort: 'high'
    }
  }) as Record<string, unknown>

  assert.equal(body.model, 'deepseek-v4-pro')
  assert.deepEqual(body.stream_options, { include_usage: true })
})

test('DeepSeek Vision preserves text-only strings and sends image content blocks unchanged', () => {
  const common = {
    config: {
      id: 'deepseek' as const,
      endpoint: 'https://mock.local/chat/completions',
      apiKey: 'test-key',
      defaultModel: 'deepseek-v4-flash-vision-exp'
    },
    stream: true,
    options: {
      provider: 'deepseek' as const,
      model: 'deepseek-v4-flash-vision-exp',
      maxTokens: undefined,
      temperature: undefined,
      reasoningEnabled: true,
      reasoningEffort: 'high'
    }
  }
  const textBody = deepseekAdapter.buildBody({
    ...common,
    prompt: [{ role: 'user' as const, content: 'text only' }],
  }) as { messages: Array<{ content: unknown }> }
  assert.equal(textBody.messages[0]?.content, 'text only')

  const content = [
    { type: 'text' as const, text: 'identify' },
    {
      type: 'image_url' as const,
      image_url: { url: 'data:image/png;base64,aW1hZ2U=', detail: 'original' as const },
    },
  ]
  const imageBody = deepseekAdapter.buildBody({
    ...common,
    prompt: [{ role: 'user' as const, content }],
  }) as { messages: Array<{ content: unknown }> }
  assert.deepEqual(imageBody.messages[0]?.content, content)
})

test('DeepSeek Vision rejects image request bodies over the local 40 MiB safety boundary', () => {
  const oversizedUrl = `data:image/png;base64,${'a'.repeat(40 * 1024 * 1024)}`
  assert.throws(() => deepseekAdapter.buildBody({
    config: {
      id: 'deepseek',
      endpoint: 'https://mock.local/chat/completions',
      apiKey: 'test-key',
      defaultModel: 'deepseek-v4-flash-vision-exp'
    },
    prompt: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: oversizedUrl, detail: 'auto' } }],
    }],
    stream: true,
    options: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      maxTokens: undefined,
      temperature: undefined,
      reasoningEnabled: true,
      reasoningEffort: 'high'
    }
  }), /图片请求体不能超过 40 MiB/)
})

test('DeepSeek adapter normalizes streamed usage without inventing missing values', () => {
  assert.deepEqual(deepseekAdapter.parseStreamLine(`data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: 17,
      completion_tokens: 9,
      total_tokens: 26,
      prompt_cache_hit_tokens: 4,
      completion_tokens_details: { reasoning_tokens: 3 }
    }
  })}`), {
    finishReason: undefined,
    usage: {
      inputTokens: 17,
      outputTokens: 9,
      totalTokens: 26,
      reasoningTokens: 3,
      cachedInputTokens: 4
    }
  })
})
