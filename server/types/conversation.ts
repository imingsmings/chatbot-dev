import type { ChatCompletionToolCall } from './tools.ts'

export type StoredMessageRole = 'user' | 'assistant'

export type PromptMessageRole = StoredMessageRole | 'system' | 'tool'

export type StoredMessage = {
  role: StoredMessageRole
  content: string
  reasoningContent?: string
  reasoningDurationMs?: number
}

export type PromptMessage = {
  role: PromptMessageRole
  content: string | null
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: ChatCompletionToolCall[]
}

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  titleManuallyEdited: boolean
  messages: StoredMessage[]
}

export type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type ConversationTitleUpdateResult =
  | {
      error: 'empty_title'
      conversation?: never
    }
  | {
      conversation: Conversation | null
      error?: never
    }
