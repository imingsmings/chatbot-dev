import type { PromptMessage } from './conversation.ts'
import type { ChatCompletionToolCall, FunctionToolDefinition } from './tools.ts'

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
  reasoningContent?: string
  toolCallDeltas?: LlmStreamToolCallDelta[]
  finishReason?: string
}

export type LlmStreamWithToolsResult = {
  content: string
  reasoningContent: string
  toolCalls: ChatCompletionToolCall[]
  finishReason?: string
}

export type LlmStreamResult = {
  content: string
  reasoningContent: string
}

export type LlmAdapter = {
  name: string
  buildHeaders: () => Record<string, string>
  buildBody: (input: {
    model: string | undefined
    prompt: PromptMessage[]
    stream: boolean
    tools?: FunctionToolDefinition[]
    toolChoice?: LlmToolChoice
  }) => unknown
  parseResponse: (data: unknown) => string
  parseStreamLine: (line: string) => LlmStreamEvent | null
}

export type LlmCallOptions = {
  signal?: AbortSignal
  tools?: FunctionToolDefinition[]
  toolChoice?: LlmToolChoice
}

export type LlmStreamChunkType = 'content' | 'reasoning'

export type LlmStreamCallback = (chunk: string, type?: LlmStreamChunkType) => void
