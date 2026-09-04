import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'
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

async function createConversation(
  title: unknown = DEFAULT_TITLE,
  modelOptions?: ConversationModelOptions
): Promise<Conversation> {
  return getStore().createConversation(title, modelOptions)
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

async function beginConversationRequest(
  id: string,
  request: ConversationRequestRecord
): Promise<ConversationRequestRecord | null> {
  return getStore().beginRequest(id, request)
}

async function findConversationRequest(requestId: string): Promise<{
  conversationId: string
  request: ConversationRequestRecord
} | null> {
  return getStore().findRequest(requestId)
}

async function finalizeConversationRequest(
  id: string,
  requestId: string,
  status: Exclude<ConversationRequestStatus, 'processing'>,
  messages?: StoredMessage[]
): Promise<ConversationRequestRecord | null> {
  return getStore().finalizeRequest(id, requestId, status, messages)
}

async function updateConversationSummary(
  id: string,
  summary: ConversationContextSummary | null
): Promise<Conversation | null> {
  return getStore().updateSummary(id, summary)
}

async function updateConversationModelOptions(
  id: string,
  options: ConversationModelOptions
): Promise<Conversation | null> {
  return getStore().updateModelOptions(id, options)
}

async function importConversation(
  conversation: Conversation,
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult> {
  return getStore().importConversation(conversation, strategy)
}

async function importConversations(
  conversations: Conversation[],
  strategy: ConversationImportConflictStrategy
): Promise<ConversationImportItemResult[]> {
  return getStore().importConversations(conversations, strategy)
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
  beginConversationRequest,
  checkConversationStoreHealth,
  clearConversation,
  closeConversationStore,
  createConversation,
  deleteConversation,
  getConversation,
  findConversationRequest,
  finalizeConversationRequest,
  importConversation,
  importConversations,
  listConversations,
  renameConversation,
  updateConversationModelOptions,
  updateConversationSummary
}
