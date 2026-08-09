import type { PromptMessage } from './conversation.ts'
import type { ChatCompletionToolCall, FunctionToolDefinition, ToolResult } from './tools.ts'

export type LlmProviderId = 'deepseek' | 'openai'

export type LlmModelCapabilities = {
  tools: boolean
  reasoning: boolean
  reasoningSummary: boolean
  reasoningEfforts: string[]
  temperature: boolean
  maxOutputTokens: number
}

export type LlmModelDescriptor = {
  provider: LlmProviderId
  id: string
  label: string
  disabled?: boolean
  capabilities: LlmModelCapabilities
}

export type LlmProviderDescriptor = {
  id: LlmProviderId
  label: string
  models: LlmModelDescriptor[]
}

export type LlmProviderConfig = {
  id: LlmProviderId
  endpoint?: string
  apiKey?: string
  defaultModel: string
}

export type ModelRequestOptions = {
  provider?: LlmProviderId
  model?: string
  temperature?: number
  maxTokens?: number
  reasoningEnabled?: boolean
  reasoningEffort?: string
}

export type LlmToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      type: 'function'
      function: {
        name: string
      }
    }

export type LlmStreamToolCallDelta = {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

export type LlmStreamEvent = {
  done?: boolean
  content?: string
  contentSnapshot?: string
  contentPhase?: 'commentary' | 'final_answer'
  reasoningContent?: string
  reasoningSnapshot?: string
  toolCallDeltas?: LlmStreamToolCallDelta[]
  finishReason?: string
  providerState?: unknown
  error?: string
}

export type LlmStreamWithToolsResult = {
  provider: LlmProviderId
  model: string
  content: string
  reasoningContent: string
  toolCalls: ChatCompletionToolCall[]
  finishReason?: string
  providerState?: unknown
}

export type LlmStreamResult = {
  content: string
  reasoningContent: string
}

export type LlmAdapter = {
  name: LlmProviderId
  buildHeaders: (config: LlmProviderConfig & { apiKey: string }) => Record<string, string>
  buildBody: (input: {
    config: LlmProviderConfig
    prompt: PromptMessage[]
    stream: boolean
    tools?: FunctionToolDefinition[]
    toolChoice?: LlmToolChoice
    options: EffectiveModelOptions
    continuation?: {
      firstResponse: LlmStreamWithToolsResult
      toolResults: ToolResult[]
    }
  }) => unknown
  parseResponse: (data: unknown) => string
  parseStreamLine: (line: string) => LlmStreamEvent | null
  createStreamParser?: () => (line: string) => LlmStreamEvent | null
}

export type LlmCallOptions = {
  signal?: AbortSignal
  tools?: FunctionToolDefinition[]
  toolChoice?: LlmToolChoice
  modelOptions?: ModelRequestOptions
}

export type EffectiveModelOptions = {
  provider: LlmProviderId
  model: string
  temperature?: number
  maxTokens?: number
  reasoningEnabled: boolean
  reasoningEffort: string
}

export type LlmStreamChunkType = 'content' | 'reasoning'

export type LlmStreamCallback = (chunk: string, type?: LlmStreamChunkType) => void
