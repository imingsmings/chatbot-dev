import { getConversationStoreKind } from '../utils/conversationStore.ts'
import { readDefaultModelOptions } from '../utils/modelOptions.ts'

function hasConfiguredValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return Boolean(trimmed) && !trimmed.startsWith('replace_with_')
}

function getRuntimeInfo() {
  const modelOptions = readDefaultModelOptions()

  return {
    provider: process.env.LLM_PROVIDER?.trim() || 'deepseek',
    model: process.env.LLM_MODEL?.trim() || null,
    storageBackend: getConversationStoreKind(),
    endpointConfigured: hasConfiguredValue(process.env.LLM_ENDPOINT),
    apiKeyConfigured: hasConfiguredValue(process.env.DEEPSEEK_API_KEY),
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
