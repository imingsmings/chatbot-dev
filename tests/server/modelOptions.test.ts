import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  normalizeConversationModelOptions,
  parseConversationModelOptions,
  parseModelRequestOptions,
  resolveModelOptions,
} from '../../server/utils/modelOptions.ts'
import { validateStartupConfig, validateWeatherConfig } from '../../server/utils/runtimeConfig.ts'

const originalEnv = { ...process.env }

after(() => {
  process.env = originalEnv
})

test('model request options validate accepted ranges and reject invalid values', () => {
  assert.deepEqual(parseModelRequestOptions({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    temperature: 0.4,
    maxTokens: 2048,
    reasoningEnabled: false,
    reasoningEffort: 'high'
  }), {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    temperature: 0.4,
    maxTokens: 2048,
    reasoningEnabled: false,
    reasoningEffort: 'high'
  })

  assert.throws(() => parseModelRequestOptions({ temperature: 2.1 }), /temperature/)
  assert.throws(() => parseModelRequestOptions({ maxTokens: 0 }), /maxTokens/)
  assert.throws(() => parseModelRequestOptions({ reasoningEnabled: 'yes' }), /reasoningEnabled/)
  assert.throws(() => parseModelRequestOptions({ reasoningEffort: '../high' }), /reasoningEffort/)
  assert.throws(() => parseModelRequestOptions({ model: 'deepseek-reasoner' }), /不支持模型/)
  assert.throws(() => parseModelRequestOptions({ model: 'deepseek-v4-ultra' }), /不支持模型/)
  assert.throws(
    () => parseModelRequestOptions({ provider: 'openai', model: 'deepseek-v4-pro' }),
    /不属于 provider/
  )
  assert.throws(
    () => parseModelRequestOptions({ model: 'gpt-5.6-luna', temperature: 0.4 }),
    /不支持 temperature/
  )
})

test('OpenAI request options infer the provider and enforce model capabilities', () => {
  assert.deepEqual(parseModelRequestOptions({
    model: 'gpt-5.6-luna',
    maxTokens: 128000,
    reasoningEnabled: true,
    reasoningEffort: 'xhigh'
  }), {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    maxTokens: 128000,
    reasoningEnabled: true,
    reasoningEffort: 'xhigh'
  })

  assert.throws(
    () => parseModelRequestOptions({ model: 'gpt-5.6-luna', maxTokens: 128001 }),
    /maxTokens/
  )
})

test('conversation model options require and normalize a complete snapshot', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_MODEL = 'deepseek-v4-flash'
  process.env.LLM_DISABLED_MODELS = ''
  assert.deepEqual(parseConversationModelOptions({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    reasoningEnabled: true,
    reasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 4096,
  }), {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    reasoningEnabled: true,
    reasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 4096,
  })
  assert.throws(
    () => parseConversationModelOptions({ provider: 'deepseek', model: 'deepseek-v4-pro' }),
    /缺少 reasoningEnabled/,
  )
  assert.equal(normalizeConversationModelOptions({
    provider: 'deepseek',
    model: 'unknown-model',
    reasoningEnabled: true,
    reasoningEffort: 'max',
  }), undefined)

  process.env.LLM_MODEL = 'private-compatible-model'
  assert.equal(parseConversationModelOptions({
    provider: 'deepseek',
    model: 'private-compatible-model',
    reasoningEnabled: false,
    reasoningEffort: 'max',
  }).model, 'private-compatible-model')
})

test('request options override environment defaults independently', () => {
  process.env.LLM_TEMPERATURE = '0.8'
  process.env.LLM_MAX_TOKENS = '4096'
  process.env.LLM_REASONING_ENABLED = 'false'
  process.env.LLM_REASONING_EFFORT = 'medium'
  process.env.LLM_MODEL = 'deepseek-v4-flash'

  assert.deepEqual(resolveModelOptions({
    model: 'deepseek-v4-pro',
    temperature: 0.1,
    reasoningEnabled: true
  }), {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    temperature: 0.1,
    maxTokens: 4096,
    reasoningEnabled: true,
    reasoningEffort: 'medium'
  })
})

test('startup validation uses the same max-token boundary as request options', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'https://mock.local/chat/completions'
  process.env.LLM_MODEL = 'deepseek-v4-flash'
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.CONVERSATION_STORE = 'file'
  process.env.LLM_MAX_TOKENS = '65537'

  assert.throws(() => validateStartupConfig(), /最大值 65536/)

  process.env.LLM_MAX_TOKENS = '65536'
  assert.doesNotThrow(() => validateStartupConfig())
})

test('startup validation rejects malformed provider context-window overrides', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'https://mock.local/chat/completions'
  process.env.LLM_MODEL = 'deepseek-v4-flash'
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.CONVERSATION_STORE = 'file'
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = 'not-a-number'

  assert.throws(() => validateStartupConfig(), /DEEPSEEK_CONTEXT_WINDOW_TOKENS 必须是正整数/)

  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '131072'
  process.env.OPENAI_CONTEXT_WINDOW_TOKENS = '400000'
  assert.doesNotThrow(() => validateStartupConfig())
})

test('startup validation rejects unsupported OpenAI defaults before serving requests', () => {
  process.env.LLM_PROVIDER = 'openai'
  process.env.LLM_ENDPOINT = 'https://mock.local/v1/responses'
  process.env.LLM_MODEL = 'gpt-5.6-luna'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.CONVERSATION_STORE = 'file'
  process.env.LLM_TEMPERATURE = '0.7'
  delete process.env.LLM_MAX_TOKENS

  assert.throws(() => validateStartupConfig(), /不支持 temperature/)

  delete process.env.LLM_TEMPERATURE
  assert.doesNotThrow(() => validateStartupConfig())
})

test('disabled models are rejected for requests and cannot be the startup default', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'https://mock.local/chat/completions'
  process.env.DEEPSEEK_API_KEY = 'test-key'
  process.env.CONVERSATION_STORE = 'file'
  process.env.LLM_MODEL = 'deepseek-v4-flash'
  process.env.LLM_DISABLED_MODELS = 'deepseek-v4-pro,gpt-5.6-sol'
  delete process.env.LLM_TEMPERATURE
  delete process.env.LLM_MAX_TOKENS

  assert.throws(
    () => parseModelRequestOptions({ model: 'deepseek-v4-pro' }),
    /当前已禁用/
  )
  assert.throws(
    () => parseModelRequestOptions({ model: 'gpt-5.6-sol' }),
    /当前已禁用/
  )
  assert.doesNotThrow(() => parseModelRequestOptions({ model: 'gpt-5.6-luna' }))
  assert.doesNotThrow(() => validateStartupConfig())

  process.env.LLM_MODEL = 'deepseek-v4-pro'
  assert.throws(() => validateStartupConfig(), /当前已禁用/)

  process.env.LLM_MODEL = 'deepseek-v4-flash'
  process.env.LLM_DISABLED_MODELS = 'unknown-model'
  assert.throws(() => validateStartupConfig(), /包含未知模型/)
})

test('weather config accepts only a plain host name', () => {
  process.env.HEFENG_API_KEY = 'test-key'
  process.env.HEFENG_API_HOST = 'weather.example.com'
  assert.doesNotThrow(() => validateWeatherConfig())

  process.env.HEFENG_API_HOST = 'https://weather.example.com/path'
  assert.throws(() => validateWeatherConfig(), /必须是纯主机名/)
})
