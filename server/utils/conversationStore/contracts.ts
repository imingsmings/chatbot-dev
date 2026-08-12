import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationSummary,
  StoredMessage
} from '../../types/conversation.ts'

export const DEFAULT_TITLE = '新的聊天'

export type ConversationStore = {
  listConversations: () => Promise<ConversationSummary[]>
  getConversation: (id: string) => Promise<Conversation | null>
  createConversation: (title?: unknown) => Promise<Conversation>
  renameConversation: (id: string, title: unknown) => Promise<Conversation | null>
  appendMessages: (id: string, messages: StoredMessage[]) => Promise<Conversation | null>
  updateSummary: (
    id: string,
    summary: ConversationContextSummary | null
  ) => Promise<Conversation | null>
  importConversation: (
    conversation: Conversation,
    strategy: ConversationImportConflictStrategy
  ) => Promise<ConversationImportItemResult>
  clearConversation: (id: string) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<boolean>
  close?: () => void
}
