import type {
  DeepSeekModelId,
  ModelDescriptor,
  ModelRequestOptions,
  RuntimeInfo,
  RuntimeProvider,
} from '#types/chat'

export const MAX_MODEL_TOKENS = 128000
export const DEFAULT_DEEPSEEK_MODEL: DeepSeekModelId = 'deepseek-v4-flash'
export const DEEPSEEK_MODELS = [
  { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
  { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
] as const satisfies ReadonlyArray<{ label: string; value: DeepSeekModelId }>

export function normalizeDeepSeekModelId(model: string | null | undefined): DeepSeekModelId {
  return DEEPSEEK_MODELS.some((item) => item.value === model)
    ? model as DeepSeekModelId
    : DEFAULT_DEEPSEEK_MODEL
}

const fallbackDeepSeekCapabilities = {
  tools: true,
  reasoning: true,
  reasoningSummary: false,
  reasoningEfforts: ['low', 'medium', 'high', 'max'],
  temperature: true,
  maxOutputTokens: 65536,
}

function createFallbackProvider(runtime: RuntimeInfo | null): RuntimeProvider {
  return {
    id: 'deepseek',
    label: 'DeepSeek',
    configured: runtime?.provider === 'deepseek' ? runtime.apiKeyConfigured && runtime.endpointConfigured : true,
    endpointConfigured: runtime?.endpointConfigured ?? true,
    apiKeyConfigured: runtime?.apiKeyConfigured ?? true,
    defaultModel: runtime?.model || DEFAULT_DEEPSEEK_MODEL,
    models: DEEPSEEK_MODELS.map((model) => ({
      provider: 'deepseek',
      id: model.value,
      label: model.label,
      capabilities: {
        ...fallbackDeepSeekCapabilities,
        reasoningEfforts: [...fallbackDeepSeekCapabilities.reasoningEfforts],
      },
    })),
  }
}

function isUsableModel(model: ModelDescriptor | null | undefined): model is ModelDescriptor {
  return Boolean(
    model &&
    typeof model.provider === 'string' &&
    typeof model.id === 'string' &&
    model.id.trim() &&
    typeof model.label === 'string' &&
    model.capabilities &&
    Array.isArray(model.capabilities.reasoningEfforts) &&
    typeof model.capabilities.maxOutputTokens === 'number' &&
    Number.isFinite(model.capabilities.maxOutputTokens) &&
    model.capabilities.maxOutputTokens > 0,
  )
}

function getRuntimeProviders(runtime: RuntimeInfo | null): RuntimeProvider[] {
  const providers = Array.isArray(runtime?.providers)
    ? runtime.providers
        .filter((provider) => provider != null && Array.isArray(provider.models))
        .map((provider) => ({
          ...provider,
          models: provider.models.filter(isUsableModel),
        }))
        .filter((provider) => provider.models.length > 0)
    : []

  return providers.length > 0 ? providers : [createFallbackProvider(runtime)]
}

function getModelDescriptor(
  runtime: RuntimeInfo | null,
  options: ModelRequestOptions,
): ModelDescriptor {
  const providers = getRuntimeProviders(runtime)
  const requested = providers
    .flatMap((provider) => provider.models)
    .find((model) => model.id === options.model && (!options.provider || model.provider === options.provider))
  if (requested && !requested.disabled) return requested

  const runtimeModel = providers
    .flatMap((provider) => provider.models)
    .find((model) => model.id === runtime?.model && model.provider === runtime.provider)
  if (runtimeModel && !runtimeModel.disabled) return runtimeModel

  const configuredModel = providers
    .filter((provider) => provider.configured)
    .flatMap((provider) => provider.models)
    .filter((model) => !model.disabled)
    .at(0)
  return configuredModel ?? providers.flatMap((provider) => provider.models)
    .find((model) => !model.disabled) ?? providers[0].models[0]
}

function getInitialModelOptions(runtime: RuntimeInfo): ModelRequestOptions {
  const model = getModelDescriptor(runtime, {
    provider: runtime.provider,
    model: runtime.model ?? undefined,
  })

  return {
    provider: model.provider,
    model: model.id,
    temperature: model.capabilities.temperature
      ? runtime.defaults.temperature ?? undefined
      : undefined,
    maxTokens: runtime.defaults.maxTokens !== null && runtime.defaults.maxTokens <= model.capabilities.maxOutputTokens
      ? runtime.defaults.maxTokens
      : undefined,
    reasoningEnabled: runtime.defaults.reasoningEnabled,
    reasoningEffort: model.capabilities.reasoningEfforts.includes(runtime.defaults.reasoningEffort)
      ? runtime.defaults.reasoningEffort
      : model.capabilities.reasoningEfforts.includes('medium') ? 'medium' : model.capabilities.reasoningEfforts[0],
  }
}

function selectModelOptions(
  options: ModelRequestOptions,
  model: ModelDescriptor,
): ModelRequestOptions {
  const reasoningEffort = options.reasoningEffort &&
    model.capabilities.reasoningEfforts.includes(options.reasoningEffort)
    ? options.reasoningEffort
    : model.capabilities.reasoningEfforts.includes('medium')
      ? 'medium'
      : model.capabilities.reasoningEfforts[0]

  return {
    ...options,
    provider: model.provider,
    model: model.id,
    reasoningEffort,
    ...(model.capabilities.temperature ? {} : { temperature: undefined }),
    ...(options.maxTokens !== undefined && options.maxTokens > model.capabilities.maxOutputTokens
      ? { maxTokens: undefined }
      : {}),
  }
}

export function parseModelSettingsDraft(input: {
  maxTokens: string
  reasoningEffort: string
  reasoningEnabled: boolean
  temperature: string
}, model?: ModelDescriptor): ModelRequestOptions {
  const options: ModelRequestOptions = {
    reasoningEnabled: input.reasoningEnabled,
    reasoningEffort: input.reasoningEffort,
  }

  if (input.temperature !== '') {
    if (model && !model.capabilities.temperature) {
      throw new Error(`${model.label} does not support Temperature`)
    }
    const temperature = Number(input.temperature)
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be between 0 and 2')
    }
    options.temperature = temperature
  }

  if (input.maxTokens !== '') {
    const maxTokens = Number(input.maxTokens)
    const maximum = model?.capabilities.maxOutputTokens ?? MAX_MODEL_TOKENS
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > maximum) {
      throw new Error(`Max Tokens must be an integer between 1 and ${maximum}`)
    }
    options.maxTokens = maxTokens
  }

  return options
}

export {
  getInitialModelOptions,
  getModelDescriptor,
  getRuntimeProviders,
  selectModelOptions,
}
