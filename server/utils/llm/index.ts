import { createAbortError } from '../abort.ts'
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout } from '../httpClient.ts'
import { readLinesFromStream } from '../streamReader.ts'
import deepseekAdapter from './adapters/deepseek.ts'
import type {
  LlmAdapter,
  LlmCallOptions,
  LlmStreamCallback,
  LlmStreamResult,
  LlmStreamToolCallDelta,
  LlmStreamWithToolsResult
} from '../../types/llm.ts'
import type { PromptMessage } from '../../types/conversation.ts'
import type { ChatCompletionToolCall } from '../../types/tools.ts'

const adapters: Record<string, LlmAdapter> = {
  deepseek: deepseekAdapter
}

const TOOL_DECISION_CONTENT_FLUSH_CHARS = 80

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'deepseek'
const LLM_ENDPOINT = process.env.LLM_ENDPOINT
const LLM_MODEL = process.env.LLM_MODEL

function getAdapter(): LlmAdapter {
  const adapter = adapters[LLM_PROVIDER]

  if (!adapter) {
    throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`)
  }

  return adapter
}

async function readResponseText(
  response: Response,
  signal: AbortSignal,
  onAbort: () => void
): Promise<string> {
  if (!response.body) {
    return response.text()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let abortHandler: (() => void) | undefined

  if (signal) {
    abortHandler = () => {
      onAbort?.()
      reader.cancel().catch(() => {})
    }

    if (signal.aborted) {
      await reader.cancel().catch(() => {})
      throw createAbortError()
    }

    signal.addEventListener('abort', abortHandler, { once: true })
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError()
      }

      const { done, value } = await reader.read()

      if (signal?.aborted) {
        throw createAbortError()
      }

      if (done) {
        break
      }

      text += decoder.decode(value, { stream: true })
    }

    text += decoder.decode()

    return text
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw createAbortError()
    }

    throw err
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  }
}

type CallLLMInput = {
  prompt: PromptMessage[]
  stream?: boolean
  callback?: LlmStreamCallback
  signal?: AbortSignal
  tools?: LlmCallOptions['tools']
  toolChoice?: LlmCallOptions['toolChoice']
}

function applyToolCallDeltas(
  toolCalls: Map<number, ChatCompletionToolCall>,
  deltas: LlmStreamToolCallDelta[] | undefined
): void {
  if (!deltas?.length) {
    return
  }

  for (const delta of deltas) {
    const existing = toolCalls.get(delta.index) ?? {
      id: delta.id ?? `tool_call_${delta.index}`,
      type: 'function' as const,
      function: {
        name: '',
        arguments: ''
      }
    }

    toolCalls.set(delta.index, {
      id: delta.id ?? existing.id,
      type: 'function',
      function: {
        name: delta.function?.name ?? existing.function.name,
        arguments: existing.function.arguments + (delta.function?.arguments ?? '')
      }
    })
  }
}

function normalizeCollectedToolCalls(toolCalls: Map<number, ChatCompletionToolCall>): ChatCompletionToolCall[] {
  return [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall)
    .filter((toolCall) => toolCall.function.name)
}

async function requestModel(
  adapter: LlmAdapter,
  { prompt, stream = false, signal, tools, toolChoice }: CallLLMInput
) {
  if (!LLM_ENDPOINT) {
    throw new Error('LLM_ENDPOINT 未配置')
  }

  return fetchWithTimeout(
    LLM_ENDPOINT,
    {
      method: 'POST',
      headers: adapter.buildHeaders(),
      body: JSON.stringify(adapter.buildBody({
        model: LLM_MODEL,
        prompt,
        stream,
        tools,
        toolChoice
      }))
    },
    DEFAULT_TIMEOUT_MS,
    signal
  )
}

async function callLLM({
  prompt,
  stream = false,
  callback,
  signal,
  tools,
  toolChoice
}: CallLLMInput): Promise<string | LlmStreamResult> {
  const adapter = getAdapter()
  const upstream = await requestModel(adapter, {
    prompt,
    stream,
    signal,
    tools,
    toolChoice
  })
  const { response } = upstream

  try {
    if (!response.ok) {
      throw new Error(`Failed to request model：${response.status} : ${response.statusText}`)
    }

    if (!stream) {
      const text = await readResponseText(response, upstream.signal, upstream.abortUpstream)
      const data = JSON.parse(text)
      return adapter.parseResponse(data)
    }

    let fullResponse = ''
    let reasoningContent = ''

    if (!response.body) {
      throw new Error('模型未返回流式响应')
    }

    const handleStreamLine = (line: string): false | void => {
      const event = adapter.parseStreamLine(line)
      if (!event) return

      if (event.done) {
        return false
      }

      if (event.toolCallDeltas?.length) {
        return
      }

      if (event.reasoningContent) {
        reasoningContent += event.reasoningContent
        callback?.(event.reasoningContent, 'reasoning')
      }

      if (event.content) {
        fullResponse += event.content
        callback?.(event.content, 'content')
      }
    }

    await readLinesFromStream(response.body, handleStreamLine, {
      signal: upstream.signal,
      onAbort: upstream.abortUpstream
    })

    return {
      content: fullResponse,
      reasoningContent
    }
  } finally {
    upstream.cleanup()
  }
}

async function callLLMStreamWithTools(
  prompt: PromptMessage[],
  callback: LlmStreamCallback,
  options: LlmCallOptions = {}
): Promise<LlmStreamWithToolsResult> {
  const adapter = getAdapter()
  const upstream = await requestModel(adapter, {
    prompt,
    stream: true,
    signal: options.signal,
    tools: options.tools,
    toolChoice: options.toolChoice
  })
  const { response } = upstream

  try {
    if (!response.ok) {
      throw new Error(`Failed to request model：${response.status} : ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('模型未返回流式响应')
    }

    let fullResponse = ''
    let reasoningContent = ''
    let finishReason: string | undefined
    let pendingContent = ''
    let contentUnlocked = false
    const toolCalls = new Map<number, ChatCompletionToolCall>()

    const flushPendingContent = (): void => {
      if (!pendingContent) {
        return
      }

      contentUnlocked = true
      callback(pendingContent, 'content')
      pendingContent = ''
    }

    const handleStreamLine = (line: string): false | void => {
      const event = adapter.parseStreamLine(line)
      if (!event) return

      if (event.done) {
        return false
      }

      if (event.finishReason) {
        finishReason = event.finishReason
      }

      if (event.reasoningContent) {
        reasoningContent += event.reasoningContent
        callback(event.reasoningContent, 'reasoning')
      }

      if (event.toolCallDeltas?.length) {
        pendingContent = ''
        applyToolCallDeltas(toolCalls, event.toolCallDeltas)
      }

      if (event.content) {
        fullResponse += event.content

        if (contentUnlocked) {
          callback(event.content, 'content')
          return
        }

        pendingContent += event.content

        if (pendingContent.length >= TOOL_DECISION_CONTENT_FLUSH_CHARS) {
          flushPendingContent()
        }
      }
    }

    await readLinesFromStream(response.body, handleStreamLine, {
      signal: upstream.signal,
      onAbort: upstream.abortUpstream
    })

    const collectedToolCalls = normalizeCollectedToolCalls(toolCalls)

    if (collectedToolCalls.length === 0) {
      flushPendingContent()
    }

    return {
      content: fullResponse,
      reasoningContent,
      toolCalls: collectedToolCalls,
      finishReason
    }
  } finally {
    upstream.cleanup()
  }
}

function callLLMOnce(prompt: PromptMessage[], options: LlmCallOptions = {}): Promise<string> {
  return callLLM({
    prompt,
    signal: options.signal
  }) as Promise<string>
}

function callLLMStream(
  prompt: PromptMessage[],
  callback: LlmStreamCallback,
  options: LlmCallOptions = {}
): Promise<LlmStreamResult> {
  return callLLM({
    prompt,
    stream: true,
    callback,
    signal: options.signal
  }) as Promise<LlmStreamResult>
}

export {
  callLLMOnce as callLLM,
  callLLMStream,
  callLLMStreamWithTools
}
