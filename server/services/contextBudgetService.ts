import { getModelDescriptor } from '../utils/llm/modelCatalog.ts'
import type { ImageAttachment, PromptMessage } from '../types/conversation.ts'
import type {
  EffectiveModelOptions,
  LlmProviderId,
  LlmStreamWithToolsResult,
} from '../types/llm.ts'
import type { FunctionToolDefinition, ToolResult } from '../types/tools.ts'

const PROVIDER_DEFAULTS: Record<LlmProviderId, {
  contextWindowTokens: number
  maxOutputTokens: number
  messageOverheadTokens: number
  requestOverheadTokens: number
  toolContinuationReserveTokens: number
}> = {
  deepseek: {
    contextWindowTokens: 131072,
    maxOutputTokens: 65536,
    messageOverheadTokens: 12,
    requestOverheadTokens: 32,
    toolContinuationReserveTokens: 2048,
  },
  openai: {
    contextWindowTokens: 400000,
    maxOutputTokens: 128000,
    messageOverheadTokens: 16,
    requestOverheadTokens: 48,
    toolContinuationReserveTokens: 3072,
  },
}

type ContextTokenBudgetConfig = {
  provider: LlmProviderId
  model: string
  estimator: string
  contextWindowTokens: number
  outputReserveTokens: number
  messageOverheadTokens: number
  requestOverheadTokens: number
  toolContinuationReserveTokens: number
  tools: FunctionToolDefinition[]
}

type ContextTokenBreakdown = {
  system: number
  summary: number
  history: number
  currentQuestion: number
  images: number
  tools: number
  framing: number
  toolContinuationReserve: number
}

type ContextTokenEstimate = {
  inputTokens: number
  totalTokens: number
  remainingInputTokens: number
  overflowTokens: number
  breakdown: ContextTokenBreakdown
}

class ContextBudgetExceededError extends Error {
  readonly code = 'context_budget_exceeded'
  readonly estimate: ContextTokenEstimate
  readonly config: ContextTokenBudgetConfig

  constructor(config: ContextTokenBudgetConfig, estimate: ContextTokenEstimate) {
    super(
      `当前问题、图片、工具和输出预留预计需要 ${estimate.totalTokens} tokens，` +
      `超过 ${config.model} 的本地上下文上限 ${config.contextWindowTokens} tokens；` +
      '请缩短当前问题、减少图片或降低 Max Tokens',
    )
    this.name = 'ContextBudgetExceededError'
    this.config = config
    this.estimate = estimate
  }
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function resolveContextTokenBudget(
  options: EffectiveModelOptions,
  tools: FunctionToolDefinition[],
): ContextTokenBudgetConfig {
  const providerDefaults = PROVIDER_DEFAULTS[options.provider]
  const descriptor = getModelDescriptor(options.provider, options.model)
  const contextWindowOverride = readPositiveInteger(
    process.env[`${options.provider.toUpperCase()}_CONTEXT_WINDOW_TOKENS`],
  )
  const contextWindowTokens = contextWindowOverride ??
    descriptor?.capabilities.contextWindowTokens ??
    providerDefaults.contextWindowTokens
  const maxOutputTokens = descriptor?.capabilities.maxOutputTokens ?? providerDefaults.maxOutputTokens

  return {
    provider: options.provider,
    model: options.model,
    estimator: `${options.provider}-utf8-conservative-v1`,
    contextWindowTokens,
    outputReserveTokens: options.maxTokens ?? maxOutputTokens,
    messageOverheadTokens: providerDefaults.messageOverheadTokens,
    requestOverheadTokens: providerDefaults.requestOverheadTokens,
    toolContinuationReserveTokens: tools.length
      ? providerDefaults.toolContinuationReserveTokens
      : 0,
    tools,
  }
}

function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0
  // Both adapters ultimately submit UTF-8 JSON. Count the serialized string so
  // control characters and quotes cannot make the transport larger than the
  // estimate. One token per byte is intentionally conservative and avoids a
  // provider-specific tokenizer dependency.
  return Math.max(0, Buffer.byteLength(JSON.stringify(text), 'utf8') - 2)
}

function estimateImageTokens(
  attachment: ImageAttachment,
  provider: LlmProviderId,
): number {
  const tileEdge = attachment.detail === 'low' ? 1024 : 512
  const tiles = Math.max(1, Math.ceil(attachment.width / tileEdge)) *
    Math.max(1, Math.ceil(attachment.height / tileEdge))

  if (provider === 'openai') {
    if (attachment.detail === 'low') return 512
    return 1024 + tiles * (attachment.detail === 'original' ? 768 : 384)
  }

  if (attachment.detail === 'low') return 512
  return 512 + tiles * (attachment.detail === 'original' ? 768 : 384)
}

function estimateMessageTokens(
  message: PromptMessage,
  config: ContextTokenBudgetConfig,
): number {
  return config.messageOverheadTokens + estimateTextTokens(message.content)
}

function estimateToolsTokens(
  tools: FunctionToolDefinition[],
  config: ContextTokenBudgetConfig,
): number {
  if (!tools.length) return 0
  return estimateTextTokens(JSON.stringify(tools)) + config.messageOverheadTokens
}

function estimateContextTokens(input: {
  systemMessage: PromptMessage
  summaryMessage?: PromptMessage
  historyMessages: PromptMessage[]
  currentMessage: PromptMessage
  config: ContextTokenBudgetConfig
}): ContextTokenEstimate {
  const { systemMessage, summaryMessage, historyMessages, currentMessage, config } = input
  const images = [...historyMessages, currentMessage]
    .flatMap((message) => message.attachments ?? [])
    .reduce(
      (total, attachment) => total + estimateImageTokens(attachment, config.provider),
      0,
    )
  const breakdown: ContextTokenBreakdown = {
    system: estimateMessageTokens(systemMessage, config),
    summary: summaryMessage ? estimateMessageTokens(summaryMessage, config) : 0,
    history: historyMessages.reduce(
      (total, message) => total + estimateMessageTokens(message, config),
      0,
    ),
    currentQuestion: estimateMessageTokens(currentMessage, config),
    images,
    tools: estimateToolsTokens(config.tools, config),
    framing: config.requestOverheadTokens,
    toolContinuationReserve: config.toolContinuationReserveTokens,
  }
  const inputTokens = Object.values(breakdown).reduce((total, count) => total + count, 0)
  const totalTokens = inputTokens + config.outputReserveTokens

  return {
    inputTokens,
    totalTokens,
    remainingInputTokens: Math.max(0, config.contextWindowTokens - totalTokens),
    overflowTokens: Math.max(0, totalTokens - config.contextWindowTokens),
    breakdown,
  }
}

function assertToolContinuationWithinBudget(input: {
  config: ContextTokenBudgetConfig
  baseEstimate: ContextTokenEstimate
  firstResponse: LlmStreamWithToolsResult
  toolResults: ToolResult[]
}): ContextTokenEstimate {
  const { config, baseEstimate, firstResponse, toolResults } = input
  const actualContinuationTokens = config.messageOverheadTokens * (1 + toolResults.length) +
    estimateTextTokens(firstResponse.content) +
    estimateTextTokens(firstResponse.reasoningContent) +
    estimateTextTokens(JSON.stringify(firstResponse.toolCalls)) +
    toolResults.reduce(
      (total, result) => total + estimateTextTokens(JSON.stringify({
        id: result.id,
        function: result.function,
        args: result.args,
        result: result.result,
      })),
      0,
    )
  const breakdown = {
    ...baseEstimate.breakdown,
    toolContinuationReserve: actualContinuationTokens,
  }
  const inputTokens = baseEstimate.inputTokens -
    baseEstimate.breakdown.toolContinuationReserve +
    actualContinuationTokens
  const estimate: ContextTokenEstimate = {
    inputTokens,
    totalTokens: inputTokens + config.outputReserveTokens,
    remainingInputTokens: Math.max(
      0,
      config.contextWindowTokens - inputTokens - config.outputReserveTokens,
    ),
    overflowTokens: Math.max(
      0,
      inputTokens + config.outputReserveTokens - config.contextWindowTokens,
    ),
    breakdown,
  }

  if (estimate.overflowTokens > 0) {
    throw new ContextBudgetExceededError(config, estimate)
  }

  return estimate
}

export {
  ContextBudgetExceededError,
  type ContextTokenBudgetConfig,
  type ContextTokenBreakdown,
  type ContextTokenEstimate,
  assertToolContinuationWithinBudget,
  estimateContextTokens,
  resolveContextTokenBudget,
}
