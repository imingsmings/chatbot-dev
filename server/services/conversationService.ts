import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../utils/conversationStore.ts'
import type {
  Conversation,
  ConversationSearchResult,
  ConversationSummary,
  ConversationTitleUpdateResult
} from '../types/conversation.ts'

const SEARCH_SNIPPET_RADIUS = 42

function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function includesQuery(value: string, normalizedQuery: string): boolean {
  return value.toLowerCase().includes(normalizedQuery)
}

function createMessageSnippet(content: string, normalizedQuery: string): string {
  const normalizedContent = content.toLowerCase()
  const matchIndex = normalizedContent.indexOf(normalizedQuery)

  if (matchIndex === -1) {
    return content.slice(0, SEARCH_SNIPPET_RADIUS * 2)
  }

  const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS)
  const end = Math.min(content.length, matchIndex + normalizedQuery.length + SEARCH_SNIPPET_RADIUS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''

  return `${prefix}${content.slice(start, end)}${suffix}`
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

async function searchConversationSummaries(query: unknown): Promise<ConversationSearchResult[]> {
  const rawQuery = normalizeSearchQuery(query)

  if (!rawQuery) {
    return []
  }

  const normalizedQuery = rawQuery.toLowerCase()
  const summaries = await listConversations()
  const conversations = await Promise.all(summaries.map((summary) => getConversation(summary.id)))
  const results: ConversationSearchResult[] = []

  for (const conversation of conversations) {
    if (!conversation) {
      continue
    }

    const summary: ConversationSummary = {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length
    }

    if (includesQuery(conversation.title, normalizedQuery)) {
      results.push({
        ...summary,
        matchedIn: 'title',
        snippet: conversation.title
      })
      continue
    }

    const matchedMessage = conversation.messages.find((message) => includesQuery(message.content, normalizedQuery))

    if (matchedMessage) {
      results.push({
        ...summary,
        matchedIn: 'message',
        snippet: createMessageSnippet(matchedMessage.content, normalizedQuery)
      })
    }
  }

  return results.sort((left, right) => {
    if (left.matchedIn !== right.matchedIn) {
      return left.matchedIn === 'title' ? -1 : 1
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
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
  searchConversationSummaries,
  updateConversationTitle
}
