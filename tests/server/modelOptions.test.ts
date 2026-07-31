import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { parseModelRequestOptions, resolveModelOptions } from '../../server/utils/modelOptions.ts'
import { validateStartupConfig } from '../../server/utils/runtimeConfig.ts'

const originalEnv = { ...process.env }

after(() => {
  process.env = originalEnv
})

test('model request options validate accepted ranges and reject invalid values', () => {
  assert.deepEqual(parseModelRequestOptions({
    temperature: 0.4,
    maxTokens: 2048,
    reasoningEnabled: false,
    reasoningEffort: 'high'
  }), {
    temperature: 0.4,
    maxTokens: 2048,
    reasoningEnabled: false,
    reasoningEffort: 'high'
  })

  assert.throws(() => parseModelRequestOptions({ temperature: 2.1 }), /temperature/)
  assert.throws(() => parseModelRequestOptions({ maxTokens: 0 }), /maxTokens/)
  assert.throws(() => parseModelRequestOptions({ reasoningEnabled: 'yes' }), /reasoningEnabled/)
  assert.throws(() => parseModelRequestOptions({ reasoningEffort: '../high' }), /reasoningEffort/)
})

test('request options override environment defaults independently', () => {
  process.env.LLM_TEMPERATURE = '0.8'
  process.env.LLM_MAX_TOKENS = '4096'
  process.env.LLM_REASONING_ENABLED = 'false'
  process.env.LLM_REASONING_EFFORT = 'medium'

  assert.deepEqual(resolveModelOptions({ temperature: 0.1, reasoningEnabled: true }), {
    temperature: 0.1,
    maxTokens: 4096,
    reasoningEnabled: true,
    reasoningEffort: 'medium'
  })
})

test('startup validation uses the same max-token boundary as request options', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'https://mock.local/chat/completions'
  process.env.LLM_MODEL = 'mock-model'
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.CONVERSATION_STORE = 'file'
  process.env.LLM_MAX_TOKENS = '65537'

  assert.throws(() => validateStartupConfig(), /LLM_MAX_TOKENS 必须是 1 到 65536 之间的整数/)

  process.env.LLM_MAX_TOKENS = '65536'
  assert.doesNotThrow(() => validateStartupConfig())
})
