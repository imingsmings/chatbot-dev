export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

export type ThemeMode = 'light' | 'dark'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoningText?: string
  reasoningDurationMs?: number
  status: MessageStatus
  error?: string
}

export type StoredMessage = {
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  reasoningDurationMs?: number
}

export type ConversationSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type ConversationSearchMatchLocation = 'title' | 'message'

export type ConversationSearchResult = ConversationSummary & {
  matchedIn: ConversationSearchMatchLocation
  snippet?: string
}

export type ConversationDetail = ConversationSummary & {
  titleManuallyEdited?: boolean
  messages: StoredMessage[]
}

export type PromptMessageRole = StoredMessage['role'] | 'system' | 'tool'

export type ContextPreviewMessage = {
  role: PromptMessageRole
  content: string | null
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: unknown[]
}

export type ContextPreview = {
  conversationId: string
  question: string
  messages: ContextPreviewMessage[]
  stats: {
    totalHistoryMessages: number
    selectedHistoryMessages: number
    droppedHistoryMessages: number
    selectedHistoryChars: number
    maxHistoryMessages: number
    maxHistoryChars: number
  }
  model: {
    provider: string
    model: string | null
    endpointConfigured: boolean
    apiKeyConfigured: boolean
    reasoningEnabled: boolean
    reasoningEffort: string
    stream: true
    toolChoice: 'auto'
  }
  tools: {
    count: number
    definitions: unknown[]
  }
}
