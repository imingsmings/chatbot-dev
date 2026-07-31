import type { ModelRequestOptions } from '@/types/chat'

export const MAX_MODEL_TOKENS = 65536

export function parseModelSettingsDraft(input: {
  maxTokens: string
  reasoningEffort: string
  reasoningEnabled: boolean
  temperature: string
}): ModelRequestOptions {
  const options: ModelRequestOptions = {
    reasoningEnabled: input.reasoningEnabled,
    reasoningEffort: input.reasoningEffort,
  }

  if (input.temperature !== '') {
    const temperature = Number(input.temperature)
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error('temperature 必须是 0 到 2 之间的数字')
    }
    options.temperature = temperature
  }

  if (input.maxTokens !== '') {
    const maxTokens = Number(input.maxTokens)
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_MODEL_TOKENS) {
      throw new Error(`max tokens 必须是 1 到 ${MAX_MODEL_TOKENS} 之间的整数`)
    }
    options.maxTokens = maxTokens
  }

  return options
}
