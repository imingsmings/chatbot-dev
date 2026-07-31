import { resolveModelOptions } from '../../modelOptions.ts'
import type {
  LlmAdapter,
  LlmStreamEvent,
  LlmToolChoice,
  ModelRequestOptions
} from '../../../types/llm.ts'
import type { PromptMessage } from '../../../types/conversation.ts'
import type { FunctionToolDefinition } from '../../../types/tools.ts'

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

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
  }
}

function buildBody({
  model,
  prompt,
  stream,
  tools,
  toolChoice,
  options
}: {
  model: string | undefined
  prompt: PromptMessage[]
  stream: boolean
  tools?: FunctionToolDefinition[]
  toolChoice?: LlmToolChoice
  options?: ModelRequestOptions
}): unknown {
  const effectiveOptions = resolveModelOptions(options)
  const body: Record<string, unknown> = {
    model,
    messages: prompt,
    stream
  }

  if (effectiveOptions.temperature !== undefined) {
    body.temperature = effectiveOptions.temperature
  }

  if (effectiveOptions.maxTokens !== undefined) {
    body.max_tokens = effectiveOptions.maxTokens
  }

  if (effectiveOptions.reasoningEnabled) {
    body.thinking = {
      type: 'enabled'
    }
    body.reasoning_effort = effectiveOptions.reasoningEffort
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

  if (!isRecord(delta)) {
    return finishReason ? { finishReason } : null
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
      finishReason
    }
  }

  if (typeof reasoningContent === 'string' && reasoningContent) {
    return {
      reasoningContent,
      toolCallDeltas: toolCalls,
      finishReason
    }
  }

  if (toolCalls?.length || finishReason) {
    return {
      toolCallDeltas: toolCalls,
      finishReason
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
