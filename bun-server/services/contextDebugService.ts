import { buildContextMessages } from './contextService.ts'
import { getToolDefinitions } from './toolService.ts'
import { readConversationStoreKind } from '../config/conversationStoreConfig.ts'
import { resolveModelOptions } from '../utils/modelOptions.ts'
import { getProviderConfig } from '../utils/llm/providerConfig.ts'
import { getModelDescriptor } from '../utils/llm/modelCatalog.ts'
import type { Conversation, ImageAttachment, PromptMessage } from '../types/conversation.ts'
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
  contextWindowTokens: number
}

type ContextPreviewStats = {
  totalHistoryMessages: number
  summaryCoveredMessages: number
  postSummaryMessages: number
  excludedStoppedMessages: number
  selectedHistoryMessages: number
  droppedHistoryMessages: number
  selectedHistoryChars: number
  selectedImages: number
  droppedImages: number
  selectedImageBytes: number
  selectedHistoryRange: {
    start: number
    end: number
  } | null
  maxHistoryMessages: number
  maxHistoryChars: number
  maxImages: number
  summaryIncluded: boolean
  summaryDroppedByTokenBudget: boolean
  legacyDroppedHistoryMessages: number
  tokenDroppedHistoryMessages: number
  estimatedInputTokens: number
  outputReserveTokens: number
  estimatedTotalTokens: number
  contextWindowTokens: number
  remainingInputTokens: number
  estimator: string
  tokenBreakdown: {
    system: number
    summary: number
    history: number
    currentQuestion: number
    images: number
    tools: number
    framing: number
    toolContinuationReserve: number
  }
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

function readContextPreviewModel(
  options: ModelRequestOptions = {},
  contextWindowTokens?: number,
): ContextPreviewModel {
  const effectiveOptions = resolveModelOptions(options)
  const config = getProviderConfig(effectiveOptions.provider)
  const descriptor = getModelDescriptor(effectiveOptions.provider, effectiveOptions.model)

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
    maxTokens: effectiveOptions.maxTokens ?? null,
    contextWindowTokens: contextWindowTokens ?? descriptor?.capabilities.contextWindowTokens ??
      (effectiveOptions.provider === 'openai' ? 400000 : 131072),
  }
}

function buildContextPreview(
  conversation: Conversation,
  question: string,
  options: ModelRequestOptions = {},
  currentAttachments: ImageAttachment[] = [],
): ContextPreview {
  const effectiveOptions = resolveModelOptions(options)
  const descriptor = effectiveOptions.model
    ? getModelDescriptor(effectiveOptions.provider, effectiveOptions.model)
    : undefined
  const tools = getToolDefinitions()
  const context = buildContextMessages(conversation, question, {
    currentAttachments,
    includeImages: descriptor?.capabilities.inputModalities.includes('image') === true,
    modelOptions: effectiveOptions,
    tools,
  })

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
      selectedImages: context.selectedImages,
      droppedImages: context.droppedImages,
      selectedImageBytes: context.selectedImageBytes,
      selectedHistoryRange: context.selectedHistoryRange,
      maxHistoryMessages: context.config.maxHistoryMessages,
      maxHistoryChars: context.config.maxHistoryChars,
      maxImages: context.config.maxImages,
      summaryIncluded: context.summaryIncluded,
      summaryDroppedByTokenBudget: context.summaryDroppedByTokenBudget,
      legacyDroppedHistoryMessages: context.legacyDroppedHistoryMessages,
      tokenDroppedHistoryMessages: context.tokenDroppedHistoryMessages,
      estimatedInputTokens: context.tokenBudget.inputTokens,
      outputReserveTokens: context.tokenBudget.outputReserveTokens,
      estimatedTotalTokens: context.tokenBudget.totalTokens,
      contextWindowTokens: context.tokenBudget.contextWindowTokens,
      remainingInputTokens: context.tokenBudget.remainingInputTokens,
      estimator: context.tokenBudget.estimator,
      tokenBreakdown: context.tokenBudget.breakdown,
    },
    model: readContextPreviewModel(options, context.tokenBudget.contextWindowTokens),
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
