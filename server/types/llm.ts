import type { PromptMessage } from './conversation.ts'

export type LlmStreamEvent = {
  done?: boolean
  content?: string
}

export type LlmAdapter = {
  name: string
  buildHeaders: () => Record<string, string>
  buildBody: (input: {
    model: string | undefined
    prompt: PromptMessage[]
    stream: boolean
  }) => unknown
  parseResponse: (data: unknown) => string
  parseStreamLine: (line: string) => LlmStreamEvent | null
}

export type LlmCallOptions = {
  signal?: AbortSignal
}

export type LlmStreamCallback = (chunk: string) => void
