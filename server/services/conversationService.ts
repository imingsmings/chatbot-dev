import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../utils/conversationStore.ts'
import type { Conversation, ConversationSummary, ConversationTitleUpdateResult } from '../types/conversation.ts'

function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function listConversationSummaries(): Promise<ConversationSummary[]> {
  return listConversations()
}

async function createNewConversation(title: unknown): Promise<Conversation> {
  return createConversation(title)
}

async function findConversation(id: string): Promise<Conversation | null> {
  return getConversation(id)
}

async function updateConversationTitle(id: string, title: unknown): Promise<ConversationTitleUpdateResult> {
  const nextTitle = normalizeTitle(title)

  if (!nextTitle) {
    return {
      error: 'empty_title'
    }
  }

  const conversation = await renameConversation(id, nextTitle)
  return {
    conversation
  }
}

async function removeConversation(id: string): Promise<boolean> {
  return deleteConversation(id)
}

async function clearConversationMessages(id: string): Promise<Conversation | null> {
  return clearConversation(id)
}

async function clearAllConversations(): Promise<void> {
  const conversations = await listConversations()
  await Promise.all(conversations.map((conversation) => clearConversation(conversation.id)))
}

export {
  clearAllConversations,
  clearConversationMessages,
  createNewConversation,
  findConversation,
  listConversationSummaries,
  removeConversation,
  updateConversationTitle
}
