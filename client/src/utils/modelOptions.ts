import type {
  ConversationModelOptions,
  ModelDescriptor,
  ModelRequestOptions,
  RuntimeInfo,
  RuntimeProvider,
} from '#types/chat'

function isUsableModel(model: ModelDescriptor | null | undefined): model is ModelDescriptor {
  return Boolean(
    model &&
    typeof model.provider === 'string' &&
    typeof model.id === 'string' &&
    model.id.trim() &&
    typeof model.label === 'string' &&
    model.label.trim() &&
    model.capabilities &&
    Array.isArray(model.capabilities.reasoningEfforts) &&
    model.capabilities.reasoningEfforts.length > 0 &&
    model.capabilities.reasoningEfforts.every(
      (effort) => typeof effort === 'string' && effort.trim().length > 0,
    ) &&
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
          models: provider.models
            .filter((model) => isUsableModel(model) && model.provider === provider.id)
            .map((model) => ({
              ...model,
              capabilities: {
                ...model.capabilities,
                reasoningEfforts: [...model.capabilities.reasoningEfforts],
                inputModalities: model.capabilities.inputModalities?.includes('text')
                  ? [...model.capabilities.inputModalities]
                  : ['text'] as Array<'text' | 'image'>,
                imageDetailLevels: model.capabilities.imageDetailLevels
                  ? [...model.capabilities.imageDetailLevels]
                  : undefined,
              },
            })),
        }))
        .filter((provider) => provider.models.length > 0)
    : []

  return providers
}

function getModelDescriptor(
  runtime: RuntimeInfo | null,
  options: ModelRequestOptions,
): ModelDescriptor | null {
  const providers = getRuntimeProviders(runtime)
  if (providers.length === 0) return null
  const requested = providers
    .filter((provider) => provider.configured)
    .flatMap((provider) => provider.models)
    .find((model) => model.id === options.model && (!options.provider || model.provider === options.provider))
  if (requested && !requested.disabled) return requested

  const runtimeProvider = providers
    .find((provider) => provider.id === runtime?.provider && provider.configured)
  const runtimeModel = runtimeProvider?.models.find((model) => model.id === runtime?.model)
  if (runtimeModel && !runtimeModel.disabled) return runtimeModel

  const runtimeProviderDefault = runtimeProvider?.models.find(
    (model) => model.id === runtimeProvider.defaultModel && !model.disabled,
  )
  if (runtimeProviderDefault) return runtimeProviderDefault

  const runtimeProviderFallback = runtimeProvider?.models.find((model) => !model.disabled)
  if (runtimeProviderFallback) return runtimeProviderFallback

  const configuredDefaultModel = providers
    .filter((provider) => provider.configured)
    .map((provider) => provider.models.find(
      (model) => model.id === provider.defaultModel && !model.disabled,
    ))
    .find((model) => model !== undefined)
  if (configuredDefaultModel) return configuredDefaultModel

  const configuredModel = providers
    .filter((provider) => provider.configured)
    .flatMap((provider) => provider.models)
    .filter((model) => !model.disabled)
    .at(0)
  return configuredModel ?? providers.flatMap((provider) => provider.models)
    .find((model) => !model.disabled) ?? null
}

function getInitialModelOptions(runtime: RuntimeInfo): ConversationModelOptions | null {
  const model = getModelDescriptor(runtime, {
    provider: runtime.provider,
    model: runtime.model ?? undefined,
  })
  if (!model) return null

  return {
    provider: model.provider,
    model: model.id,
    temperature: model.capabilities.temperature
      ? runtime.defaults.temperature ?? undefined
      : undefined,
    maxTokens: runtime.defaults.maxTokens !== null && runtime.defaults.maxTokens <= model.capabilities.maxOutputTokens
      ? runtime.defaults.maxTokens
      : undefined,
    reasoningEnabled: model.capabilities.reasoning && runtime.defaults.reasoningEnabled,
    reasoningEffort: model.capabilities.reasoningEfforts.includes(runtime.defaults.reasoningEffort)
      ? runtime.defaults.reasoningEffort
      : model.capabilities.reasoningEfforts.includes('medium') ? 'medium' : model.capabilities.reasoningEfforts[0],
  }
}

function resolveConversationModelOptions(
  runtime: RuntimeInfo,
  storedOptions?: ModelRequestOptions | null,
): ConversationModelOptions | null {
  const fallback = getInitialModelOptions(runtime)
  if (!storedOptions) return fallback

  const provider = getRuntimeProviders(runtime).find(
    (item) => item.id === storedOptions.provider && item.configured,
  )
  const model = provider?.models.find(
    (item) => item.id === storedOptions.model && !item.disabled,
  )
  if (
    !model ||
    typeof storedOptions.reasoningEnabled !== 'boolean' ||
    (storedOptions.reasoningEnabled && !model.capabilities.reasoning) ||
    typeof storedOptions.reasoningEffort !== 'string' ||
    !model.capabilities.reasoningEfforts.includes(storedOptions.reasoningEffort) ||
    (storedOptions.temperature !== undefined && (
      !model.capabilities.temperature ||
      !Number.isFinite(storedOptions.temperature) ||
      storedOptions.temperature < 0 ||
      storedOptions.temperature > 2
    )) ||
    (storedOptions.maxTokens !== undefined && (
      !Number.isInteger(storedOptions.maxTokens) ||
      storedOptions.maxTokens < 1 ||
      storedOptions.maxTokens > model.capabilities.maxOutputTokens
    ))
  ) {
    return fallback
  }

  return {
    provider: model.provider,
    model: model.id,
    reasoningEnabled: storedOptions.reasoningEnabled,
    reasoningEffort: storedOptions.reasoningEffort,
    ...(storedOptions.temperature === undefined ? {} : { temperature: storedOptions.temperature }),
    ...(storedOptions.maxTokens === undefined ? {} : { maxTokens: storedOptions.maxTokens }),
  }
}

function isModelOptionsUsable(
  runtime: RuntimeInfo | null,
  options: ModelRequestOptions,
): boolean {
  if (!runtime) return false
  return getRuntimeProviders(runtime).some(
    (provider) =>
      provider.configured &&
      provider.id === options.provider &&
      provider.models.some((model) => model.id === options.model && !model.disabled),
  )
}

function modelSupportsImages(
  runtime: RuntimeInfo | null,
  options: ModelRequestOptions,
): boolean {
  return getModelDescriptor(runtime, options)?.capabilities.inputModalities?.includes('image') === true
}

function getImageModelSupportMessage(runtime: RuntimeInfo | null): string {
  const imageModel = getRuntimeProviders(runtime)
    .filter((provider) => provider.configured)
    .flatMap((provider) => provider.models)
    .find((model) => !model.disabled && model.capabilities.inputModalities?.includes('image'))

  return imageModel
    ? `当前模型不支持图片，请切换到 ${imageModel.label}。`
    : '当前没有已配置且可用的图片模型。'
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
    reasoningEnabled: model.capabilities.reasoning
      ? options.reasoningEnabled
      : false,
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
  if (model && input.reasoningEnabled && !model.capabilities.reasoning) {
    throw new Error(`${model.label} does not support Reasoning`)
  }
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
    if (!model) {
      throw new Error('Model catalog is unavailable')
    }
    const maxTokens = Number(input.maxTokens)
    const maximum = model.capabilities.maxOutputTokens
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > maximum) {
      throw new Error(`Max Tokens must be an integer between 1 and ${maximum}`)
    }
    options.maxTokens = maxTokens
  }

  return options
}

export {
  getInitialModelOptions,
  getImageModelSupportMessage,
  getModelDescriptor,
  getRuntimeProviders,
  isModelOptionsUsable,
  modelSupportsImages,
  resolveConversationModelOptions,
  selectModelOptions,
}
