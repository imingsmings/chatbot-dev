import {
  clearConversation,
  createConversation,
  deleteConversation,
  getConversation,
  importConversation,
  listConversations,
  renameConversation,
  updateConversationModelOptions
} from '../utils/conversationStore.ts'
import { MAX_CONVERSATION_TITLE_LENGTH } from '../config/productLimits.ts'
import { createId, now } from '../utils/conversationStore/normalization.ts'
import type {
  Conversation,
  ConversationSearchResult,
  ConversationSummary,
  ConversationTitleUpdateResult,
  ConversationModelOptions
} from '../types/conversation.ts'
import { readDefaultConversationModelOptions } from '../utils/modelOptions.ts'
import {
  cleanupOrphanedAttachments,
  cloneMessageAttachments,
  removeAttachmentFiles,
} from './attachmentService.ts'
import type { ImageAttachment } from '../types/conversation.ts'

const SEARCH_SNIPPET_RADIUS = 42
const BRANCH_TITLE_SUFFIX = '（分支）'

type ConversationBranchResult =
  | { conversation: Conversation; draftAttachments: ImageAttachment[] }
  | { error: 'not_found' | 'invalid_message' | 'empty_message' }

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
  return createConversation(title, readDefaultConversationModelOptions())
}

function createBranchTitle(title: string): string {
  if (title.endsWith(BRANCH_TITLE_SUFFIX)) {
    return title
  }
  const maximumBaseLength = MAX_CONVERSATION_TITLE_LENGTH - BRANCH_TITLE_SUFFIX.length
  return `${title.slice(0, maximumBaseLength)}${BRANCH_TITLE_SUFFIX}`
}

async function createConversationBranch(
  id: string,
  messageIndex: number,
  question?: string,
): Promise<ConversationBranchResult> {
  const source = await getConversation(id)
  if (!source) {
    return { error: 'not_found' }
  }

  const sourceMessage = source.messages[messageIndex]
  if (sourceMessage?.role !== 'user') {
    return { error: 'invalid_message' }
  }
  if (
    question !== undefined &&
    !question.trim() &&
    !sourceMessage.attachments?.length
  ) {
    return { error: 'empty_message' }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timestamp = now()
    const branchId = createId()
    const cloned = await cloneMessageAttachments(
      source.id,
      branchId,
      source.messages.slice(0, messageIndex + 1),
    )
    const draftAttachments = cloned.messages.at(-1)?.attachments ?? []
    const branch: Conversation = {
      id: branchId,
      title: createBranchTitle(source.title),
      createdAt: timestamp,
      updatedAt: timestamp,
      titleManuallyEdited: true,
      messages: cloned.messages.slice(0, messageIndex),
      modelOptions: source.modelOptions ? { ...source.modelOptions } : undefined
    }
    let importedConversationId: string | null | undefined
    try {
      const imported = await importConversation(branch, 'skip')
      importedConversationId = imported.conversationId
      if (!importedConversationId) {
        await removeAttachmentFiles(cloned.createdAttachmentIds)
        continue
      }

      const persisted = await getConversation(importedConversationId)
      if (!persisted) {
        await deleteConversation(importedConversationId)
        await removeAttachmentFiles(cloned.createdAttachmentIds)
        throw new Error('会话分支创建后无法读取')
      }
      return { conversation: persisted, draftAttachments }
    } catch (error) {
      if (importedConversationId) {
        await deleteConversation(importedConversationId).catch(() => false)
      }
      await removeAttachmentFiles(cloned.createdAttachmentIds)
      throw error
    }
  }

  throw new Error('会话分支 ID 冲突，请重试')
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

  if (nextTitle.length > MAX_CONVERSATION_TITLE_LENGTH) {
    return {
      error: 'title_too_long'
    }
  }

  const conversation = await renameConversation(id, nextTitle)
  return {
    conversation
  }
}

async function removeConversation(id: string): Promise<boolean> {
  const deleted = await deleteConversation(id)
  if (deleted) {
    void cleanupOrphanedAttachments().catch((error) => {
      console.warn('Failed to clean attachments after deleting conversation:', error)
    })
  }
  return deleted
}

async function clearConversationMessages(id: string): Promise<Conversation | null> {
  const conversation = await clearConversation(id)
  if (conversation) {
    void cleanupOrphanedAttachments().catch((error) => {
      console.warn('Failed to clean attachments after clearing conversation:', error)
    })
  }
  return conversation
}

async function saveConversationModelOptions(
  id: string,
  options: ConversationModelOptions
): Promise<Conversation | null> {
  return updateConversationModelOptions(id, options)
}

async function clearAllConversations(): Promise<void> {
  const conversations = await listConversations()
  await Promise.all(conversations.map((conversation) => clearConversation(conversation.id)))
}

export {
  clearAllConversations,
  clearConversationMessages,
  createConversationBranch,
  createNewConversation,
  findConversation,
  listConversationSummaries,
  removeConversation,
  saveConversationModelOptions,
  searchConversationSummaries,
  updateConversationTitle
}
