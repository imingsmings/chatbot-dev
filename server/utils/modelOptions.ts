import {
  findModelDescriptor,
  getModelDescriptor,
  isLlmProviderId,
  isModelDisabled,
  MAX_MODEL_TOKENS
} from './llm/modelCatalog.ts'
import { getProviderConfig, readDefaultProvider } from './llm/providerConfig.ts'
import type { EffectiveModelOptions, LlmProviderId, ModelRequestOptions } from '../types/llm.ts'
import type { ConversationModelOptions } from '../types/conversation.ts'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])
const MAX_REASONING_EFFORT_LENGTH = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  const parsed = parseOptionalNumber(value)
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined
}

function readProviderEnv(provider: LlmProviderId, suffix: string, legacyName: string): string | undefined {
  const providerValue = process.env[`${provider.toUpperCase()}_${suffix}`]
  if (providerValue !== undefined && providerValue.trim() !== '') {
    return providerValue
  }

  return provider === readDefaultProvider() ? process.env[legacyName] : undefined
}

function readDefaultModelOptions(provider = readDefaultProvider()): EffectiveModelOptions {
  const config = getProviderConfig(provider)
  return {
    provider,
    model: config.defaultModel,
    temperature: parseOptionalNumber(readProviderEnv(provider, 'TEMPERATURE', 'LLM_TEMPERATURE')),
    maxTokens: parseOptionalInteger(readProviderEnv(provider, 'MAX_TOKENS', 'LLM_MAX_TOKENS')),
    reasoningEnabled: parseBoolean(
      readProviderEnv(provider, 'REASONING_ENABLED', 'LLM_REASONING_ENABLED'),
      true
    ),
    reasoningEffort: readProviderEnv(provider, 'REASONING_EFFORT', 'LLM_REASONING_EFFORT')?.trim() ||
      (provider === 'openai' ? 'medium' : 'max')
  }
}

function validateEffectiveModelOptions(
  options: EffectiveModelOptions,
  requestOptions: ModelRequestOptions = {}
): void {
  const descriptor = getModelDescriptor(options.provider, options.model)
  if (isModelDisabled(options.model)) {
    throw new Error(`${descriptor?.label ?? options.model} 当前已禁用`)
  }
  if (!descriptor) {
    const configuredDefaultModel = getProviderConfig(options.provider).defaultModel
    if (requestOptions.model !== undefined && options.model !== configuredDefaultModel) {
      throw new Error(`${options.provider} 不支持模型 ${options.model}`)
    }
    return
  }

  if (options.maxTokens !== undefined && options.maxTokens > descriptor.capabilities.maxOutputTokens) {
    throw new Error(
      `maxTokens 不能超过 ${descriptor.label} 的最大值 ${descriptor.capabilities.maxOutputTokens}`
    )
  }

  if (options.temperature !== undefined && !descriptor.capabilities.temperature) {
    throw new Error(`${descriptor.label} 不支持 temperature 参数`)
  }

  if (options.reasoningEnabled && !descriptor.capabilities.reasoning) {
    throw new Error(`${descriptor.label} 不支持 reasoning`)
  }

  if (
    options.reasoningEnabled &&
    !descriptor.capabilities.reasoningEfforts.includes(options.reasoningEffort)
  ) {
    throw new Error(
      `${descriptor.label} 的 reasoningEffort 必须是 ${descriptor.capabilities.reasoningEfforts.join('、')}`
    )
  }
}

function parseModelRequestOptions(value: unknown): ModelRequestOptions {
  if (value === undefined || value === null) {
    return {}
  }

  if (!isRecord(value)) {
    throw new Error('模型参数必须是对象')
  }

  const options: ModelRequestOptions = {}

  if (value.provider !== undefined && value.provider !== null) {
    if (typeof value.provider !== 'string' || !isLlmProviderId(value.provider.trim().toLowerCase())) {
      throw new Error('provider 必须是 deepseek 或 openai')
    }
    options.provider = value.provider.trim().toLowerCase() as LlmProviderId
  }

  if (value.model !== undefined && value.model !== null) {
    if (typeof value.model !== 'string' || !value.model.trim()) {
      throw new Error('model 必须是非空字符串')
    }
    const model = findModelDescriptor(value.model.trim())
    if (!model) {
      throw new Error(`不支持模型 ${value.model.trim()}`)
    }
    if (options.provider && options.provider !== model.provider) {
      throw new Error(`模型 ${model.id} 不属于 provider ${options.provider}`)
    }
    options.provider = model.provider
    options.model = model.id
  }

  if (value.temperature !== undefined && value.temperature !== null) {
    if (
      typeof value.temperature !== 'number' ||
      !Number.isFinite(value.temperature) ||
      value.temperature < 0 ||
      value.temperature > 2
    ) {
      throw new Error('temperature 必须是 0 到 2 之间的数字')
    }
    options.temperature = value.temperature
  }

  if (value.maxTokens !== undefined && value.maxTokens !== null) {
    if (
      typeof value.maxTokens !== 'number' ||
      !Number.isInteger(value.maxTokens) ||
      value.maxTokens < 1 ||
      value.maxTokens > MAX_MODEL_TOKENS
    ) {
      throw new Error(`maxTokens 必须是 1 到 ${MAX_MODEL_TOKENS} 之间的整数`)
    }
    options.maxTokens = value.maxTokens
  }

  if (value.reasoningEnabled !== undefined) {
    if (typeof value.reasoningEnabled !== 'boolean') {
      throw new Error('reasoningEnabled 必须是布尔值')
    }
    options.reasoningEnabled = value.reasoningEnabled
  }

  if (value.reasoningEffort !== undefined && value.reasoningEffort !== null) {
    if (
      typeof value.reasoningEffort !== 'string' ||
      !value.reasoningEffort.trim() ||
      value.reasoningEffort.trim().length > MAX_REASONING_EFFORT_LENGTH ||
      !/^[a-z0-9_-]+$/i.test(value.reasoningEffort.trim())
    ) {
      throw new Error('reasoningEffort 必须是长度不超过 32 的字母、数字、下划线或连字符')
    }
    options.reasoningEffort = value.reasoningEffort.trim()
  }

  validateEffectiveModelOptions(resolveModelOptions(options), options)
  return options
}

function resolveModelOptions(overrides: ModelRequestOptions = {}): EffectiveModelOptions {
  const provider = overrides.provider ??
    (overrides.model ? findModelDescriptor(overrides.model)?.provider : undefined) ??
    readDefaultProvider()
  const defaults = readDefaultModelOptions(provider)
  const options = {
    provider,
    model: overrides.model ?? defaults.model,
    temperature: overrides.temperature ?? defaults.temperature,
    maxTokens: overrides.maxTokens ?? defaults.maxTokens,
    reasoningEnabled: overrides.reasoningEnabled ?? defaults.reasoningEnabled,
    reasoningEffort: overrides.reasoningEffort ?? defaults.reasoningEffort
  }

  validateEffectiveModelOptions(options, overrides)
  return options
}

function toConversationModelOptions(options: EffectiveModelOptions): ConversationModelOptions {
  return {
    provider: options.provider,
    model: options.model,
    reasoningEnabled: options.reasoningEnabled,
    reasoningEffort: options.reasoningEffort,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens })
  }
}

function parseConversationModelOptions(value: unknown): ConversationModelOptions {
  if (!isRecord(value)) {
    throw new Error('会话模型配置必须是对象')
  }

  for (const field of ['provider', 'model', 'reasoningEnabled', 'reasoningEffort'] as const) {
    if (value[field] === undefined || value[field] === null) {
      throw new Error(`会话模型配置缺少 ${field}`)
    }
  }

  const rawProvider = value.provider
  const rawModel = value.model
  const provider = typeof rawProvider === 'string' && isLlmProviderId(rawProvider.trim().toLowerCase())
    ? rawProvider.trim().toLowerCase() as LlmProviderId
    : undefined
  const configuredDefaultModel = provider ? getProviderConfig(provider).defaultModel : undefined
  const requestValue =
    provider &&
    typeof rawModel === 'string' &&
    rawModel.trim() === configuredDefaultModel &&
    !findModelDescriptor(rawModel.trim())
      ? { ...value, provider, model: undefined }
      : value
  const requestOptions = parseModelRequestOptions(requestValue)
  if (configuredDefaultModel && requestValue !== value) {
    requestOptions.model = configuredDefaultModel
  }
  return toConversationModelOptions(resolveModelOptions(requestOptions))
}

function normalizeConversationModelOptions(value: unknown): ConversationModelOptions | undefined {
  try {
    return parseConversationModelOptions(value)
  } catch {
    return undefined
  }
}

function readDefaultConversationModelOptions(): ConversationModelOptions {
  return toConversationModelOptions(readDefaultModelOptions())
}

export {
  type EffectiveModelOptions,
  MAX_MODEL_TOKENS,
  normalizeConversationModelOptions,
  parseConversationModelOptions,
  parseModelRequestOptions,
  readDefaultConversationModelOptions,
  readDefaultModelOptions,
  resolveModelOptions,
  toConversationModelOptions,
  validateEffectiveModelOptions
}
