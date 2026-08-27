import type { ChatCompletionToolCall } from './tools.ts'
import type { GenerationMetadata, StoredToolTrace } from './generation.ts'

export type StoredMessageRole = 'user' | 'assistant'

export type PromptMessageRole = StoredMessageRole | 'system' | 'tool'

export type ImageAttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/webp'
export type ImageAttachmentDetail = 'auto' | 'low' | 'original'

export type ImageAttachment = {
  id: string
  kind: 'image'
  filename: string
  mediaType: ImageAttachmentMediaType
  byteSize: number
  width: number
  height: number
  detail: ImageAttachmentDetail
}

export type PromptTextContentBlock = {
  type: 'text'
  text: string
}

export type PromptImageContentBlock = {
  type: 'image_url'
  image_url: {
    url: string
    detail: ImageAttachmentDetail
  }
}

export type PromptContentBlock = PromptTextContentBlock | PromptImageContentBlock

export type StoredMessage = {
  role: StoredMessageRole
  content: string
  reasoningContent?: string
  reasoningDurationMs?: number
  status?: 'completed' | 'stopped'
  generation?: GenerationMetadata
  toolTrace?: StoredToolTrace[]
  attachments?: ImageAttachment[]
}

export type ConversationContextSummary = {
  content: string
  sourceMessageCount: number
  updatedAt: string
}

export type ConversationModelOptions = {
  provider: 'deepseek' | 'openai'
  model: string
  reasoningEnabled: boolean
  reasoningEffort: string
  temperature?: number
  maxTokens?: number
}

export type PromptMessage = {
  role: PromptMessageRole
  content: string | null
  attachments?: ImageAttachment[]
  reasoning_content?: string
  tool_call_id?: string
  tool_calls?: ChatCompletionToolCall[]
}

export type LlmPromptMessage = Omit<PromptMessage, 'content' | 'attachments'> & {
  content: string | PromptContentBlock[] | null
}

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  titleManuallyEdited: boolean
  messages: StoredMessage[]
  summary?: ConversationContextSummary
  modelOptions?: ConversationModelOptions
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

export type ConversationTitleUpdateResult =
  | {
      error: 'empty_title' | 'title_too_long'
      conversation?: never
    }
  | {
      conversation: Conversation | null
      error?: never
    }

export type ConversationImportConflictStrategy = 'skip' | 'duplicate' | 'overwrite'

export type ConversationImportItemResult = {
  sourceId: string
  conversationId: string | null
  status: 'created' | 'duplicated' | 'overwritten' | 'skipped'
}

export type ConversationImportResult = {
  total: number
  created: number
  duplicated: number
  overwritten: number
  skipped: number
  items: ConversationImportItemResult[]
}
