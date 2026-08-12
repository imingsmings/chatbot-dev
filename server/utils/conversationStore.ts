import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'
import type {
  Conversation,
  ConversationContextSummary,
  ConversationImportConflictStrategy,
  ConversationImportItemResult,
  ConversationSummary,
  StoredMessage
} from '../types/conversation.ts'
import { DEFAULT_TITLE, type ConversationStore } from './conversationStore/contracts.ts'
import { createFileConversationStore } from './conversationStore/fileStore.ts'
import { createSqliteConversationStore } from './conversationStore/sqliteStore.ts'

const fileStore = createFileConversationStore()
const sqliteStore = createSqliteConversationStore()

function getStore(): ConversationStore {
  return readConversationStoreKind() === 'sqlite' ? sqliteStore : fileStore
}

function closeConversationStore(): void {
  sqliteStore.close?.()
}

async function checkConversationStoreHealth(): Promise<void> {
  await getStore().checkHealth()
}

async function listConversations(): Promise<ConversationSummary[]> {
  return getStore().listConversations()
}

async function getConversation(id: string): Promise<Conversation | null> {
  return getStore().getConversation(id)
}

async function createConversation(title: unknown = DEFAULT_TITLE): Promise<Conversation> {
  return getStore().createConversation(title)
}

async function renameConversation(id: string, title: unknown): Promise<Conversation | null> {
  return getStore().renameConversation(id, title)
}

async function appendMessages(
  id: string,
  messages: StoredMessage[]
): Promise<Conversation | null> {
  return getStore().appendMessages(id, messages)
}

async function updateConversationSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  return getStore().updateSummary(id, summary)
}

async function importConversation(
  conversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  return getStore().importConversation(conversation, strategy)
}

async function clearConversation(id: string): Promise<Conversation | null> {
  return getStore().clearConversation(id)
}

async function deleteConversation(id: string): Promise<boolean> {
  return getStore().deleteConversation(id)
}

export {
  DEFAULT_TITLE,
  appendMessages,
  checkConversationStoreHealth,
  clearConversation,
  closeConversationStore,
  createConversation,
  deleteConversation,
  getConversation,
  importConversation,
  listConversations,
  renameConversation,
  updateConversationSummary
}
