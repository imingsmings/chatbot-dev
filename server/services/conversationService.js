import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../utils/conversationStore.js'

function normalizeTitle(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function listConversationSummaries() {
  return listConversations()
}

async function createNewConversation(title) {
  return createConversation(title)
}

async function findConversation(id) {
  return getConversation(id)
}

async function updateConversationTitle(id, title) {
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

async function removeConversation(id) {
  return deleteConversation(id)
}

async function clearConversationMessages(id) {
  return clearConversation(id)
}

async function clearAllConversations() {
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
