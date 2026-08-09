import { callLLM } from '../utils/llm/index.ts'
import { buildConversationSummaryPrompt } from '../utils/promptTemplates.ts'
import { getConversation, updateConversationSummary } from '../utils/conversationStore.ts'
import type { Conversation } from '../types/conversation.ts'
import type { ModelRequestOptions } from '../types/llm.ts'

const DEFAULT_SUMMARY_MAX_TOKENS = 1024

type GenerateSummaryResult =
  | {
      conversation: Conversation
      error?: never
    }
  | {
      error: 'not_found' | 'empty' | 'conversation_changed'
      conversation?: never
    }

async function generateConversationSummary(
  conversationId: string,
  options: ModelRequestOptions = {},
  signal?: AbortSignal
): Promise<GenerateSummaryResult> {
  const conversation = await getConversation(conversationId)

  if (!conversation) {
    return { error: 'not_found' }
  }

  if (conversation.messages.length === 0) {
    return { error: 'empty' }
  }

  const content = (await callLLM(buildConversationSummaryPrompt(conversation.messages), {
    signal,
    modelOptions: {
      ...options,
      reasoningEnabled: false,
      maxTokens: options.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS
    }
  })).trim()

  if (!content) {
    throw new Error('模型未返回摘要内容')
  }

  const latestConversation = await getConversation(conversationId)
  if (!latestConversation) {
    return { error: 'not_found' }
  }
  if (
    latestConversation.updatedAt !== conversation.updatedAt ||
    latestConversation.messages.length !== conversation.messages.length
  ) {
    return { error: 'conversation_changed' }
  }

  const updated = await updateConversationSummary(conversationId, {
    content,
    sourceMessageCount: conversation.messages.length,
    updatedAt: new Date().toISOString()
  })

  if (!updated) {
    return { error: 'not_found' }
  }

  return {
    conversation: updated
  }
}

export {
  DEFAULT_SUMMARY_MAX_TOKENS,
  generateConversationSummary
}
