import type { PromptMessage } from '../../../types/conversation.ts'
import type {
  EffectiveModelOptions,
  LlmAdapter,
  LlmProviderConfig,
  LlmStreamEvent,
  LlmStreamWithToolsResult,
  LlmToolChoice
} from '../../../types/llm.ts'
import type { FunctionToolDefinition, ToolResult } from '../../../types/tools.ts'
import type { TokenUsage } from '../../../types/generation.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractOutputText(output: unknown): string {
  if (!Array.isArray(output)) return ''

  return output
    .filter(isRecord)
    .filter((item) => item.type === 'message')
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter(isRecord)
    .filter((item) => item.type === 'output_text' || item.type === 'refusal')
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .join('')
}

function extractReasoningSummary(output: unknown): string {
  if (!Array.isArray(output)) return ''

  return output
    .filter(isRecord)
    .filter((item) => item.type === 'reasoning')
    .flatMap((item) => Array.isArray(item.summary) ? item.summary : [])
    .filter(isRecord)
    .filter((item) => item.type === 'summary_text')
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .join('')
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function extractUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined

  const inputDetails = isRecord(value.input_tokens_details) ? value.input_tokens_details : undefined
  const outputDetails = isRecord(value.output_tokens_details) ? value.output_tokens_details : undefined
  const usage: TokenUsage = {
    inputTokens: readTokenCount(value.input_tokens),
    outputTokens: readTokenCount(value.output_tokens),
    totalTokens: readTokenCount(value.total_tokens),
    reasoningTokens: readTokenCount(outputDetails?.reasoning_tokens),
    cachedInputTokens: readTokenCount(inputDetails?.cached_tokens)
  }

  return Object.values(usage).some((count) => count !== undefined) ? usage : undefined
}

function buildHeaders(config: LlmProviderConfig & { apiKey: string }): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`
  }
}

function toResponseInput(prompt: PromptMessage[]): Array<Record<string, unknown>> {
  return prompt
    .filter((message) => message.role !== 'tool')
    .map((message) => ({
      role: message.role,
      content: message.content ?? ''
    }))
}

function toResponseTools(tools: FunctionToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
      required: []
    },
    strict: tool.function.strict ?? false
  }))
}

function toResponseToolChoice(toolChoice: LlmToolChoice | undefined): unknown {
  if (!toolChoice || typeof toolChoice === 'string') {
    return toolChoice ?? 'auto'
  }

  return {
    type: 'function',
    name: toolChoice.function.name
  }
}

function buildToolOutputs(results: ToolResult[]): Array<Record<string, unknown>> {
  return results.map((result, index) => ({
    type: 'function_call_output',
    call_id: result.id ?? `tool_call_${index}`,
    output: result.result
  }))
}

function readOutputItems(firstResponse: LlmStreamWithToolsResult): unknown[] {
  if (!isRecord(firstResponse.providerState) || !Array.isArray(firstResponse.providerState.output)) {
    throw new Error('OpenAI 工具调用缺少 response output continuation state')
  }
  return firstResponse.providerState.output
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
  const input = continuation
    ? [
        ...toResponseInput(prompt),
        ...readOutputItems(continuation.firstResponse),
        ...buildToolOutputs(continuation.toolResults)
      ]
    : toResponseInput(prompt)
  const body: Record<string, unknown> = {
    model: options.model,
    input,
    stream,
    store: false,
    reasoning: options.reasoningEnabled
      ? {
          effort: options.reasoningEffort,
          summary: 'detailed',
          context: 'current_turn'
        }
      : {
          effort: 'none',
          context: 'current_turn'
        }
  }

  if (options.maxTokens !== undefined) {
    body.max_output_tokens = options.maxTokens
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature
  }

  if (tools?.length && !continuation) {
    body.tools = toResponseTools(tools)
    body.tool_choice = toResponseToolChoice(toolChoice)
    body.parallel_tool_calls = true
  }

  return body
}

function parseResponse(data: unknown): string {
  if (!isRecord(data)) return ''
  return typeof data.output_text === 'string' ? data.output_text : extractOutputText(data.output)
}

function parseSseData(line: string): Record<string, unknown> | null {
  const text = line.trim()
  if (!text || !text.startsWith('data:')) return null
  const json = text.slice(5).trimStart()
  if (!json || json === '[DONE]') return null
  const value = JSON.parse(json) as unknown
  return isRecord(value) ? value : null
}

function createStreamParser(): (line: string) => LlmStreamEvent | null {
  const messagePhases = new Map<number, 'commentary' | 'final_answer'>()
  const functionCalls = new Map<number, {
    id?: string
    name?: string
    arguments: string
  }>()

  return (line: string): LlmStreamEvent | null => {
    const event = parseSseData(line)
    if (!event) return null

    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'response.output_item.added') {
      const item = isRecord(event.item) ? event.item : null
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0
      if (item?.type === 'message') {
        if (item.phase === 'commentary' || item.phase === 'final_answer') {
          messagePhases.set(outputIndex, item.phase)
        }
        return null
      }
      if (item?.type === 'function_call') {
        const call = {
          id: typeof item.call_id === 'string' ? item.call_id : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          arguments: typeof item.arguments === 'string' ? item.arguments : ''
        }
        functionCalls.set(outputIndex, call)
        return {
          toolCallDeltas: [{
            index: outputIndex,
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: call.arguments
            }
          }]
        }
      }
      return null
    }

    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0
      return typeof event.delta === 'string' && event.delta
        ? {
            content: event.delta,
            contentPhase: messagePhases.get(outputIndex)
          }
        : null
    }

    if (type === 'response.reasoning_summary_text.delta') {
      return typeof event.delta === 'string' && event.delta
        ? { reasoningContent: event.delta }
        : null
    }

    if (type === 'response.function_call_arguments.delta') {
      if (typeof event.delta !== 'string') return null
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0
      const call = functionCalls.get(outputIndex) ?? { arguments: '' }
      call.arguments += event.delta
      functionCalls.set(outputIndex, call)
      return {
        toolCallDeltas: [{
          index: outputIndex,
          function: { arguments: event.delta }
        }]
      }
    }

    if (type === 'response.output_item.done') {
      const item = isRecord(event.item) ? event.item : null
      if (item?.type !== 'function_call') return null

      const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0
      const previous = functionCalls.get(outputIndex) ?? { arguments: '' }
      const completeArguments = typeof item.arguments === 'string' ? item.arguments : ''
      const missingArguments = completeArguments.startsWith(previous.arguments)
        ? completeArguments.slice(previous.arguments.length)
        : previous.arguments
          ? ''
          : completeArguments
      const id = previous.id ?? (typeof item.call_id === 'string' ? item.call_id : undefined)
      const name = previous.name ?? (typeof item.name === 'string' ? item.name : undefined)

      functionCalls.set(outputIndex, {
        id,
        name,
        arguments: completeArguments || previous.arguments
      })

      if (previous.id && previous.name && !missingArguments) return null
      return {
        toolCallDeltas: [{
          index: outputIndex,
          id: previous.id ? undefined : id,
          type: 'function',
          function: {
            name: previous.name ? undefined : name,
            arguments: missingArguments
          }
        }]
      }
    }

    if (type === 'response.completed') {
      const response = isRecord(event.response) ? event.response : null
      const output = response?.output
      const status = typeof response?.status === 'string' ? response.status : undefined
      return {
        done: true,
        contentSnapshot: extractOutputText(output),
        reasoningSnapshot: extractReasoningSummary(output),
        providerState: {
          output: Array.isArray(output) ? output : []
        },
        finishReason: status ?? 'completed',
        usage: extractUsage(response?.usage)
      }
    }

    if (type === 'response.failed' || type === 'response.incomplete') {
      const response = isRecord(event.response) ? event.response : null
      const error = response && isRecord(response.error) ? response.error : null
      return {
        error: typeof error?.message === 'string'
          ? error.message
          : `OpenAI response ${type === 'response.failed' ? 'failed' : 'incomplete'}`
      }
    }

    if (type === 'error') {
      const error = isRecord(event.error) ? event.error : event
      return {
        error: typeof error.message === 'string' ? error.message : 'OpenAI stream error'
      }
    }

    return null
  }
}

function parseStreamLine(line: string): LlmStreamEvent | null {
  return createStreamParser()(line)
}

const openaiAdapter: LlmAdapter = {
  name: 'openai',
  buildHeaders,
  buildBody,
  parseResponse,
  parseStreamLine,
  createStreamParser
}

export {
  buildToolOutputs,
  extractOutputText,
  extractReasoningSummary,
  extractUsage,
  toResponseTools
}

export default openaiAdapter
