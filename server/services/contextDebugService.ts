import { buildContextMessages } from './contextService.ts'
import { getToolDefinitions } from './toolService.ts'
import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'
import { resolveModelOptions } from '../utils/modelOptions.ts'
import { getProviderConfig } from '../utils/llm/providerConfig.ts'
import type { Conversation, PromptMessage } from '../types/conversation.ts'
import type { ModelRequestOptions } from '../types/llm.ts'
import type { FunctionToolDefinition } from '../types/tools.ts'

type ContextPreviewModel = {
  provider: string
  model: string | null
  endpointConfigured: boolean
  apiKeyConfigured: boolean
  reasoningEnabled: boolean
  reasoningEffort: string
  stream: true
  toolChoice: 'auto'
  storageBackend: 'file' | 'sqlite'
  temperature: number | null
  maxTokens: number | null
}

type ContextPreviewStats = {
  totalHistoryMessages: number
  summaryCoveredMessages: number
  postSummaryMessages: number
  excludedStoppedMessages: number
  selectedHistoryMessages: number
  droppedHistoryMessages: number
  selectedHistoryChars: number
  selectedHistoryRange: {
    start: number
    end: number
  } | null
  maxHistoryMessages: number
  maxHistoryChars: number
  summaryIncluded: boolean
}

type ContextPreview = {
  conversationId: string
  question: string
  messages: PromptMessage[]
  stats: ContextPreviewStats
  model: ContextPreviewModel
  tools: {
    count: number
    definitions: FunctionToolDefinition[]
  }
}

function readContextPreviewModel(options: ModelRequestOptions = {}): ContextPreviewModel {
  const effectiveOptions = resolveModelOptions(options)
  const config = getProviderConfig(effectiveOptions.provider)

  return {
    provider: effectiveOptions.provider,
    model: effectiveOptions.model ?? null,
    endpointConfigured: Boolean(config.endpoint),
    apiKeyConfigured: Boolean(config.apiKey),
    reasoningEnabled: effectiveOptions.reasoningEnabled,
    reasoningEffort: effectiveOptions.reasoningEffort,
    stream: true,
    toolChoice: 'auto',
    storageBackend: readConversationStoreKind(),
    temperature: effectiveOptions.temperature ?? null,
    maxTokens: effectiveOptions.maxTokens ?? null
  }
}

function buildContextPreview(
  conversation: Conversation,
  question: string,
  options: ModelRequestOptions = {}
): ContextPreview {
  const context = buildContextMessages(conversation, question)
  const tools = getToolDefinitions()

  return {
    conversationId: conversation.id,
    question,
    messages: context.messages,
    stats: {
      totalHistoryMessages: conversation.messages.length,
      summaryCoveredMessages: context.summaryCoveredMessages,
      postSummaryMessages: context.postSummaryMessages,
      excludedStoppedMessages: context.excludedStoppedMessages,
      selectedHistoryMessages: context.selectedHistoryMessages,
      droppedHistoryMessages: context.droppedHistoryMessages,
      selectedHistoryChars: context.selectedHistoryChars,
      selectedHistoryRange: context.selectedHistoryRange,
      maxHistoryMessages: context.config.maxHistoryMessages,
      maxHistoryChars: context.config.maxHistoryChars,
      summaryIncluded: context.summaryIncluded
    },
    model: readContextPreviewModel(options),
    tools: {
      count: tools.length,
      definitions: tools
    }
  }
}

export {
  type ContextPreview,
  buildContextPreview
}
