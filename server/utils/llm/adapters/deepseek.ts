import { buildToolResultPrompt } from '../../promptTemplates.ts'
import type {
  EffectiveModelOptions,
  LlmAdapter,
  LlmProviderConfig,
  LlmStreamEvent,
  LlmStreamWithToolsResult,
  LlmToolChoice
} from '../../../types/llm.ts'
import type { PromptMessage } from '../../../types/conversation.ts'
import type { FunctionToolDefinition, ToolResult } from '../../../types/tools.ts'
import type { TokenUsage } from '../../../types/generation.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getChoice(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return null
  }

  const [choice] = data.choices
  return isRecord(choice) ? choice : null
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function extractUsage(data: unknown): TokenUsage | undefined {
  if (!isRecord(data) || !isRecord(data.usage)) return undefined

  const details = isRecord(data.usage.completion_tokens_details)
    ? data.usage.completion_tokens_details
    : undefined
  const usage: TokenUsage = {
    inputTokens: readTokenCount(data.usage.prompt_tokens),
    outputTokens: readTokenCount(data.usage.completion_tokens),
    totalTokens: readTokenCount(data.usage.total_tokens),
    reasoningTokens: readTokenCount(details?.reasoning_tokens),
    cachedInputTokens: readTokenCount(data.usage.prompt_cache_hit_tokens)
  }

  return Object.values(usage).some((value) => value !== undefined) ? usage : undefined
}

function buildHeaders(config: LlmProviderConfig & { apiKey: string }): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`
  }
}

function buildBody({
  prompt,
  stream,
  tools,
  toolChoice,
  options,
  continuation
}: {
  config: LlmProviderConfig
  prompt: PromptMessage[]
  stream: boolean
  tools?: FunctionToolDefinition[]
  toolChoice?: LlmToolChoice
  options: EffectiveModelOptions
  continuation?: {
    firstResponse: LlmStreamWithToolsResult
    toolResults: ToolResult[]
  }
}): unknown {
  const requestPrompt = continuation
    ? buildToolResultPrompt(
        prompt,
        continuation.firstResponse.toolCalls,
        continuation.toolResults,
        continuation.firstResponse.reasoningContent
      )
    : prompt
  const body: Record<string, unknown> = {
    model: options.model,
    messages: requestPrompt,
    stream
  }

  if (stream) {
    body.stream_options = {
      include_usage: true
    }
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature
  }

  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens
  }

  if (options.reasoningEnabled) {
    body.thinking = {
      type: 'enabled'
    }
    body.reasoning_effort = options.reasoningEffort
  } else {
    body.thinking = {
      type: 'disabled'
    }
  }

  if (tools?.length) {
    body.tools = tools
    body.tool_choice = toolChoice ?? 'auto'
  }

  return body
}

function parseResponse(data: unknown): string {
  const choice = getChoice(data)
  const message = choice?.message

  if (!isRecord(message)) {
    return ''
  }

  return typeof message.content === 'string' ? message.content : ''
}

function parseStreamLine(line: string): LlmStreamEvent | null {
  const text = line.trim()
  if (!text) return null
  if (!text.startsWith('data:')) return null

  const jsonStr = text.slice(5).trimStart()
  if (!jsonStr) return null
  if (jsonStr === '[DONE]') {
    return { done: true }
  }

  const data = JSON.parse(jsonStr) as unknown
  const choice = getChoice(data)
  const delta = choice?.delta
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
  const usage = extractUsage(data)

  if (!isRecord(delta)) {
    return finishReason || usage ? { finishReason, usage } : null
  }

  const content = delta.content
  const reasoningContent = delta.reasoning_content
  const toolCalls = Array.isArray(delta.tool_calls)
    ? delta.tool_calls.filter(isRecord).map((item) => {
        const fn = isRecord(item.function) ? item.function : undefined
        return {
          index: typeof item.index === 'number' ? item.index : 0,
          id: typeof item.id === 'string' ? item.id : undefined,
          type: item.type === 'function' ? 'function' as const : undefined,
          function: fn
            ? {
                name: typeof fn.name === 'string' ? fn.name : undefined,
                arguments: typeof fn.arguments === 'string' ? fn.arguments : undefined
              }
            : undefined
        }
      })
    : undefined

  if (typeof content === 'string' && content) {
    return {
      content,
      reasoningContent: typeof reasoningContent === 'string' ? reasoningContent : undefined,
      toolCallDeltas: toolCalls,
      finishReason,
      usage
    }
  }

  if (typeof reasoningContent === 'string' && reasoningContent) {
    return {
      reasoningContent,
      toolCallDeltas: toolCalls,
      finishReason,
      usage
    }
  }

  if (toolCalls?.length || finishReason || usage) {
    return {
      toolCallDeltas: toolCalls,
      finishReason,
      usage
    }
  }

  return null
}

const deepseekAdapter: LlmAdapter = {
  name: 'deepseek',
  buildHeaders,
  buildBody,
  parseResponse,
  parseStreamLine
}

export default deepseekAdapter

export { extractUsage }
