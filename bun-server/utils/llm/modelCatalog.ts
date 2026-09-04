import type { LlmModelDescriptor, LlmProviderDescriptor, LlmProviderId } from '../../types/llm.ts'

const PROVIDERS: readonly LlmProviderDescriptor[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    models: [
      {
        provider: 'deepseek',
        id: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: false,
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          temperature: true,
          maxOutputTokens: 65536,
          contextWindowTokens: 131072,
          inputModalities: ['text']
        }
      },
      {
        provider: 'deepseek',
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: false,
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          temperature: true,
          maxOutputTokens: 65536,
          contextWindowTokens: 131072,
          inputModalities: ['text']
        }
      },
      {
        provider: 'deepseek',
        id: 'deepseek-v4-flash-vision-exp',
        label: 'DeepSeek V4 Flash Vision Exp',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: false,
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          temperature: true,
          maxOutputTokens: 65536,
          contextWindowTokens: 131072,
          inputModalities: ['text', 'image'],
          imageDetailLevels: ['auto', 'low', 'original'],
          experimental: true
        }
      }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-5.6-terra',
    models: [
      {
        provider: 'openai',
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: true,
          reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          temperature: false,
          maxOutputTokens: 128000,
          contextWindowTokens: 400000,
          inputModalities: ['text']
        }
      },
      {
        provider: 'openai',
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: true,
          reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          temperature: false,
          maxOutputTokens: 128000,
          contextWindowTokens: 400000,
          inputModalities: ['text']
        }
      },
      {
        provider: 'openai',
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        capabilities: {
          tools: true,
          reasoning: true,
          reasoningSummary: true,
          reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          temperature: false,
          maxOutputTokens: 128000,
          contextWindowTokens: 400000,
          inputModalities: ['text']
        }
      }
    ]
  }
]

const PROVIDER_IDS = new Set<LlmProviderId>(PROVIDERS.map((provider) => provider.id))
const MAX_MODEL_TOKENS = Math.max(
  ...PROVIDERS.flatMap((provider) => provider.models.map((model) => model.capabilities.maxOutputTokens))
)

function isLlmProviderId(value: string): value is LlmProviderId {
  return PROVIDER_IDS.has(value as LlmProviderId)
}

function getProviderDescriptor(providerId: LlmProviderId): LlmProviderDescriptor {
  const provider = PROVIDERS.find((item) => item.id === providerId)
  if (!provider) {
    throw new Error(`Unsupported LLM provider: ${providerId}`)
  }
  return provider
}

function getCatalogDefaultModelId(providerId: LlmProviderId): string {
  const provider = getProviderDescriptor(providerId)
  if (!provider.models.some((model) => model.id === provider.defaultModel)) {
    throw new Error(`LLM provider ${providerId} has an invalid catalog default`)
  }
  return provider.defaultModel
}

function getModelDescriptor(
  providerId: LlmProviderId,
  modelId: string
): LlmModelDescriptor | undefined {
  return getProviderDescriptor(providerId).models.find((model) => model.id === modelId)
}

function findModelDescriptor(modelId: string): LlmModelDescriptor | undefined {
  return PROVIDERS.flatMap((provider) => provider.models).find((model) => model.id === modelId)
}

function readDisabledModelIds(value = process.env.LLM_DISABLED_MODELS): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((modelId) => modelId.trim().toLowerCase())
      .filter(Boolean)
  )
}

function isModelDisabled(modelId: string): boolean {
  return readDisabledModelIds().has(modelId.trim().toLowerCase())
}

function getPublicModelCatalog(): LlmProviderDescriptor[] {
  const disabledModelIds = readDisabledModelIds()
  return PROVIDERS.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({
      ...model,
      disabled: disabledModelIds.has(model.id),
      capabilities: {
        ...model.capabilities,
        reasoningEfforts: [...model.capabilities.reasoningEfforts],
        inputModalities: [...model.capabilities.inputModalities],
        imageDetailLevels: model.capabilities.imageDetailLevels
          ? [...model.capabilities.imageDetailLevels]
          : undefined
      }
    }))
  }))
}

export {
  MAX_MODEL_TOKENS,
  findModelDescriptor,
  getCatalogDefaultModelId,
  getModelDescriptor,
  getProviderDescriptor,
  getPublicModelCatalog,
  isLlmProviderId,
  isModelDisabled,
  readDisabledModelIds
}
