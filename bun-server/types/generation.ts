export type GenerationProviderId = 'deepseek' | 'openai'

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export type GenerationMetadata = {
  provider: GenerationProviderId
  model: string
  finishReason?: string
  firstTokenLatencyMs?: number
  totalDurationMs: number
  usage?: TokenUsage
}

export type StoredToolTrace = {
  name: string
  success: boolean
  durationMs: number
  summary: string
}
