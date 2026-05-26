import { buildContextMessages } from './contextService.ts'
import { getToolDefinitions } from './toolService.ts'
import type { Conversation, PromptMessage } from '../types/conversation.ts'
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
}

type ContextPreviewStats = {
  totalHistoryMessages: number
  selectedHistoryMessages: number
  droppedHistoryMessages: number
  selectedHistoryChars: number
  maxHistoryMessages: number
  maxHistoryChars: number
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

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

function hasConfiguredValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return Boolean(trimmed) && !trimmed.startsWith('replace_with_')
}

function readReasoningEnabled(): boolean {
  const rawValue = process.env.LLM_REASONING_ENABLED

  if (rawValue === undefined || rawValue.trim() === '') {
    return true
  }

  const normalized = rawValue.trim().toLowerCase()

  if (TRUE_VALUES.has(normalized)) {
    return true
  }

  if (FALSE_VALUES.has(normalized)) {
    return false
  }

  return true
}

function readContextPreviewModel(): ContextPreviewModel {
  return {
    provider: process.env.LLM_PROVIDER?.trim() || 'deepseek',
    model: process.env.LLM_MODEL?.trim() || null,
    endpointConfigured: hasConfiguredValue(process.env.LLM_ENDPOINT),
    apiKeyConfigured: hasConfiguredValue(process.env.DEEPSEEK_API_KEY),
    reasoningEnabled: readReasoningEnabled(),
    reasoningEffort: process.env.LLM_REASONING_EFFORT?.trim() || 'max',
    stream: true,
    toolChoice: 'auto'
  }
}

function buildContextPreview(conversation: Conversation, question: string): ContextPreview {
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
      maxHistoryChars: context.config.maxHistoryChars
    },
    model: readContextPreviewModel(),
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
