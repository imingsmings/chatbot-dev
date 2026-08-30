import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import {
  getPublicModelCatalog,
  readDisabledModelIds
} from '../../server/utils/llm/modelCatalog.ts'
import {
  getProviderConfig,
  normalizeOpenAIResponsesEndpoint
} from '../../server/utils/llm/providerConfig.ts'

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv }
})

after(() => {
  process.env = originalEnv
})

test('OpenAI endpoint normalization accepts a base URL, v1 URL, or full Responses URL', () => {
  assert.equal(
    normalizeOpenAIResponsesEndpoint('https://api.example.com/'),
    'https://api.example.com/v1/responses'
  )
  assert.equal(
    normalizeOpenAIResponsesEndpoint('https://api.example.com/v1'),
    'https://api.example.com/v1/responses'
  )
  assert.equal(
    normalizeOpenAIResponsesEndpoint('https://api.example.com/v1/responses/'),
    'https://api.example.com/v1/responses'
  )
  assert.throws(
    () => normalizeOpenAIResponsesEndpoint('file:///tmp/responses'),
    /仅支持 http\/https/
  )
})

test('provider config rejects non-http DeepSeek endpoints', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.DEEPSEEK_ENDPOINT = 'ftp://deepseek.example/chat/completions'
  assert.throws(() => getProviderConfig('deepseek'), /仅支持 http\/https/)
})

test('provider config keeps legacy DeepSeek defaults and isolates OpenAI settings', () => {
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'https://deepseek.example/chat/completions'
  process.env.LLM_MODEL = 'deepseek-v4-pro'
  process.env.DEEPSEEK_API_KEY = 'deepseek-key'
  process.env.OPENAI_ENDPOINT = 'https://openai.example/'
  process.env.OPENAI_MODEL = 'gpt-5.6-luna'
  process.env.OPENAI_API_KEY = 'openai-key'

  assert.deepEqual(getProviderConfig('deepseek'), {
    id: 'deepseek',
    endpoint: 'https://deepseek.example/chat/completions',
    apiKey: 'deepseek-key',
    defaultModel: 'deepseek-v4-pro'
  })
  assert.deepEqual(getProviderConfig('openai'), {
    id: 'openai',
    endpoint: 'https://openai.example/v1/responses',
    apiKey: 'openai-key',
    defaultModel: 'gpt-5.6-luna'
  })
})

test('public model catalog exposes provider-specific capabilities without credentials', () => {
  process.env.LLM_DISABLED_MODELS = ' deepseek-v4-pro, GPT-5.6-SOL,deepseek-v4-pro '
  const catalog = getPublicModelCatalog()
  const openai = catalog.find((provider) => provider.id === 'openai')
  const luna = openai?.models.find((model) => model.id === 'gpt-5.6-luna')
  const sol = openai?.models.find((model) => model.id === 'gpt-5.6-sol')
  const pro = catalog
    .find((provider) => provider.id === 'deepseek')
    ?.models.find((model) => model.id === 'deepseek-v4-pro')
  const serialized = JSON.stringify(catalog)

  assert.deepEqual(catalog.map((provider) => provider.id), ['deepseek', 'openai'])
  assert.equal(luna?.capabilities.reasoningSummary, true)
  assert.equal(luna?.capabilities.temperature, false)
  assert.equal(luna?.capabilities.maxOutputTokens, 128000)
  assert.equal(luna?.capabilities.contextWindowTokens, 400000)
  assert.equal(luna?.disabled, false)
  assert.equal(sol?.disabled, true)
  assert.equal(pro?.disabled, true)
  assert.deepEqual([...readDisabledModelIds()], ['deepseek-v4-pro', 'gpt-5.6-sol'])
  assert(!serialized.includes('apiKey'))
})
