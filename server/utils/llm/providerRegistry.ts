import deepseekAdapter from './adapters/deepseek.ts'
import openaiAdapter from './adapters/openai.ts'
import type { LlmAdapter, LlmProviderId } from '../../types/llm.ts'

const adapters = new Map<LlmProviderId, LlmAdapter>([
  ['deepseek', deepseekAdapter],
  ['openai', openaiAdapter]
])

function getProviderAdapter(provider: LlmProviderId): LlmAdapter {
  const adapter = adapters.get(provider)
  if (!adapter) {
    throw new Error(`Provider ${provider} 尚未启用`)
  }
  return adapter
}

function hasProviderAdapter(provider: LlmProviderId): boolean {
  return adapters.has(provider)
}

export {
  getProviderAdapter,
  hasProviderAdapter
}
