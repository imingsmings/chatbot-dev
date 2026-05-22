export type StoredMessageRole = 'user' | 'assistant'

export type PromptMessageRole = StoredMessageRole | 'system' | 'tool'

export type StoredMessage = {
  role: StoredMessageRole
  content: string
}

export type PromptMessage = {
  role: PromptMessageRole
  content: string
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
