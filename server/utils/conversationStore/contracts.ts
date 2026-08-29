import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationModelOptions,
  ConversationRequestRecord,
  ConversationRequestStatus,
  ConversationSummary,
  StoredMessage
} from '../../types/conversation.ts'

export const DEFAULT_TITLE = '新的聊天'

export type ConversationStore = {
  checkHealth: () => Promise<void>
  listConversations: () => Promise<ConversationSummary[]>
  getConversation: (id: string) => Promise<Conversation | null>
  createConversation: (
    title?: unknown,
    modelOptions?: ConversationModelOptions
  ) => Promise<Conversation>
  renameConversation: (id: string, title: unknown) => Promise<Conversation | null>
  appendMessages: (id: string, messages: StoredMessage[]) => Promise<Conversation | null>
  beginRequest: (
    id: string,
    request: ConversationRequestRecord
  ) => Promise<ConversationRequestRecord | null>
  findRequest: (requestId: string) => Promise<{
    conversationId: string
    request: ConversationRequestRecord
  } | null>
  finalizeRequest: (
    id: string,
    requestId: string,
    status: Exclude<ConversationRequestStatus, 'processing'>,
    messages?: StoredMessage[]
  ) => Promise<ConversationRequestRecord | null>
  updateSummary: (
    id: string,
    summary: ConversationContextSummary | null
  ) => Promise<Conversation | null>
  updateModelOptions: (
    id: string,
    options: ConversationModelOptions
  ) => Promise<Conversation | null>
  importConversation: (
    conversation: Conversation,
    strategy: ConversationImportConflictStrategy
  ) => Promise<ConversationImportItemResult>
  importConversations: (
    conversations: Conversation[],
    strategy: ConversationImportConflictStrategy
  ) => Promise<ConversationImportItemResult[]>
  clearConversation: (id: string) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<boolean>
  close?: () => void
}
