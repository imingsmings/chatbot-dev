import { isLlmProviderId } from './modelCatalog.ts'
import type { LlmProviderConfig, LlmProviderId } from '../../types/llm.ts'

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-5.6-terra'
}

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.startsWith('replace_with_')) {
    return undefined
  }
  return trimmed
}

function readDefaultProvider(): LlmProviderId {
  const value = (process.env.LLM_PROVIDER || 'deepseek').trim().toLowerCase()
  if (!isLlmProviderId(value)) {
    throw new Error(`Unsupported LLM provider: ${value}`)
  }
  return value
}

function parseHttpEndpoint(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`LLM endpoint 仅支持 http/https：${url.protocol}`)
  }
  return url
}

function normalizeOpenAIResponsesEndpoint(value: string): string {
  const url = parseHttpEndpoint(value)
  const pathname = url.pathname.replace(/\/$/, '')

  if (pathname.endsWith('/responses')) {
    url.pathname = pathname
    return url.toString()
  }

  url.pathname = pathname.endsWith('/v1')
    ? `${pathname}/responses`
    : `${pathname}/v1/responses`
  return url.toString()
}

function readProviderEndpoint(provider: LlmProviderId): string | undefined {
  const defaultProvider = readDefaultProvider()
  const legacyEndpoint = provider === defaultProvider
    ? configuredValue(process.env.LLM_ENDPOINT)
    : undefined
  const endpoint = provider === 'openai'
    ? configuredValue(process.env.OPENAI_ENDPOINT) ?? legacyEndpoint
    : configuredValue(process.env.DEEPSEEK_ENDPOINT) ?? legacyEndpoint

  if (!endpoint) {
    return undefined
  }

  if (provider === 'openai') {
    return normalizeOpenAIResponsesEndpoint(endpoint)
  }

  return parseHttpEndpoint(endpoint).toString()
}

function readProviderModel(provider: LlmProviderId): string {
  const defaultProvider = readDefaultProvider()
  const legacyModel = provider === defaultProvider
    ? configuredValue(process.env.LLM_MODEL)
    : undefined
  const model = provider === 'openai'
    ? configuredValue(process.env.OPENAI_MODEL) ?? legacyModel ?? DEFAULT_MODELS.openai
    : configuredValue(process.env.DEEPSEEK_MODEL) ?? legacyModel ?? DEFAULT_MODELS.deepseek

  return model
}

function readProviderApiKey(provider: LlmProviderId): string | undefined {
  return provider === 'openai'
    ? configuredValue(process.env.OPENAI_API_KEY)
    : configuredValue(process.env.DEEPSEEK_API_KEY)
}

function getProviderConfig(provider: LlmProviderId): LlmProviderConfig {
  return {
    id: provider,
    endpoint: readProviderEndpoint(provider),
    apiKey: readProviderApiKey(provider),
    defaultModel: readProviderModel(provider)
  }
}

function assertProviderConfigured(config: LlmProviderConfig): asserts config is LlmProviderConfig & {
  endpoint: string
  apiKey: string
} {
  if (!config.endpoint) {
    throw new Error(`${config.id} endpoint 未配置`)
  }
  if (!config.apiKey) {
    throw new Error(`${config.id} API key 未配置`)
  }
}

export {
  assertProviderConfigured,
  configuredValue,
  getProviderConfig,
  normalizeOpenAIResponsesEndpoint,
  readDefaultProvider
}
