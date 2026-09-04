import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'
import { readDefaultModelOptions } from '../utils/modelOptions.ts'
import { getPublicModelCatalog } from '../utils/llm/modelCatalog.ts'
import { getProviderConfig } from '../utils/llm/providerConfig.ts'

function getRuntimeInfo() {
  const modelOptions = readDefaultModelOptions()
  const selectedConfig = getProviderConfig(modelOptions.provider)
  const providers = getPublicModelCatalog().map((provider) => {
    const config = getProviderConfig(provider.id)
    return {
      ...provider,
      configured: Boolean(config.endpoint && config.apiKey),
      endpointConfigured: Boolean(config.endpoint),
      apiKeyConfigured: Boolean(config.apiKey),
      defaultModel: config.defaultModel
    }
  })

  return {
    profile: {
      name: process.env.APP_PROFILE_NAME?.trim() || 'User',
      avatarUrl: process.env.APP_PROFILE_AVATAR_URL?.trim() || ''
    },
    provider: modelOptions.provider,
    model: modelOptions.model ?? null,
    storageBackend: readConversationStoreKind(),
    endpointConfigured: Boolean(selectedConfig.endpoint),
    apiKeyConfigured: Boolean(selectedConfig.apiKey),
    providers,
    defaults: {
      temperature: modelOptions.temperature ?? null,
      maxTokens: modelOptions.maxTokens ?? null,
      reasoningEnabled: modelOptions.reasoningEnabled,
      reasoningEffort: modelOptions.reasoningEffort
    }
  }
}

export {
  getRuntimeInfo
}
