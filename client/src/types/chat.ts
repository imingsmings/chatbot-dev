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

export type ConversationDetail = ConversationSummary & {
  titleManuallyEdited?: boolean
  messages: StoredMessage[]
}
