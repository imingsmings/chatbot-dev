import { buildContextMessages } from './contextService.ts'
import { getToolDefinitions } from './toolService.ts'
import { getConversationStoreKind } from '../utils/conversationStore.ts'
import { resolveModelOptions } from '../utils/modelOptions.ts'
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
  selectedHistoryMessages: number
  droppedHistoryMessages: number
  selectedHistoryChars: number
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

function hasConfiguredValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return Boolean(trimmed) && !trimmed.startsWith('replace_with_')
}

function readContextPreviewModel(options: ModelRequestOptions = {}): ContextPreviewModel {
  const effectiveOptions = resolveModelOptions(options)

  return {
    provider: process.env.LLM_PROVIDER?.trim() || 'deepseek',
    model: process.env.LLM_MODEL?.trim() || null,
    endpointConfigured: hasConfiguredValue(process.env.LLM_ENDPOINT),
    apiKeyConfigured: hasConfiguredValue(process.env.DEEPSEEK_API_KEY),
    reasoningEnabled: effectiveOptions.reasoningEnabled,
    reasoningEffort: effectiveOptions.reasoningEffort,
    stream: true,
    toolChoice: 'auto',
    storageBackend: getConversationStoreKind(),
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
      selectedHistoryMessages: context.selectedHistoryMessages,
      droppedHistoryMessages: context.droppedHistoryMessages,
      selectedHistoryChars: context.selectedHistoryChars,
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
