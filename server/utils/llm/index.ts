import { createAbortError } from '../abort.ts'
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout } from '../httpClient.ts'
import { readLinesFromStream } from '../streamReader.ts'
import { resolveModelOptions } from '../modelOptions.ts'
import { assertProviderConfigured, getProviderConfig } from './providerConfig.ts'
import { getProviderAdapter } from './providerRegistry.ts'
import type {
  LlmAdapter,
  LlmCallOptions,
  LlmStreamCallback,
  LlmStreamResult,
  LlmStreamToolCallDelta,
  LlmStreamWithToolsResult
} from '../../types/llm.ts'
import type { PromptMessage } from '../../types/conversation.ts'
import type { ChatCompletionToolCall, ToolResult } from '../../types/tools.ts'

const TOOL_STREAM_CONTENT_BUFFER_MS = 120

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
  modelOptions?: LlmCallOptions['modelOptions']
  continuation?: {
    firstResponse: LlmStreamWithToolsResult
    toolResults: ToolResult[]
  }
}

function getSnapshotDelta(current: string, snapshot: string | undefined): string {
  if (!snapshot || snapshot === current) return ''
  if (!current) return snapshot
  return snapshot.startsWith(current) ? snapshot.slice(current.length) : ''
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
  { prompt, stream = false, signal, tools, toolChoice, modelOptions, continuation }: CallLLMInput
) {
  const effectiveOptions = resolveModelOptions(modelOptions)
  const config = getProviderConfig(effectiveOptions.provider)
  const adapter = getProviderAdapter(effectiveOptions.provider)
  assertProviderConfigured(config)

  const upstream = await fetchWithTimeout(
    config.endpoint,
    {
      method: 'POST',
      headers: adapter.buildHeaders(config),
      body: JSON.stringify(adapter.buildBody({
        config,
        prompt,
        stream,
        tools,
        toolChoice,
        options: effectiveOptions,
        continuation
      }))
    },
    DEFAULT_TIMEOUT_MS,
    signal
  )

  return {
    adapter,
    effectiveOptions,
    upstream
  }
}

async function callLLM({
  prompt,
  stream = false,
  callback,
  signal,
  tools,
  toolChoice,
  modelOptions,
  continuation
}: CallLLMInput): Promise<string | LlmStreamResult> {
  const request = await requestModel({
    prompt,
    stream,
    signal,
    tools,
    toolChoice,
    modelOptions,
    continuation
  })
  const { adapter, upstream } = request
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
    const parseStreamLine = adapter.createStreamParser?.() ?? adapter.parseStreamLine

    if (!response.body) {
      throw new Error('模型未返回流式响应')
    }

    const handleStreamLine = (line: string): false | void => {
      const event = parseStreamLine(line)
      if (!event) return

      if (event.error) {
        throw new Error(event.error)
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

      const reasoningSnapshotDelta = getSnapshotDelta(reasoningContent, event.reasoningSnapshot)
      if (reasoningSnapshotDelta) {
        reasoningContent += reasoningSnapshotDelta
        callback?.(reasoningSnapshotDelta, 'reasoning')
      }

      const contentSnapshotDelta = getSnapshotDelta(fullResponse, event.contentSnapshot)
      if (contentSnapshotDelta) {
        fullResponse += contentSnapshotDelta
        callback?.(contentSnapshotDelta, 'content')
      }

      if (event.done) {
        return false
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
  } catch (error) {
    if (upstream.isTimedOut()) {
      throw new Error('请求超时，请稍候重试')
    }
    throw error
  } finally {
    upstream.cleanup()
  }
}

async function callLLMStreamWithTools(
  prompt: PromptMessage[],
  callback: LlmStreamCallback,
  options: LlmCallOptions = {}
): Promise<LlmStreamWithToolsResult> {
  const request = await requestModel({
    prompt,
    stream: true,
    signal: options.signal,
    tools: options.tools,
    toolChoice: options.toolChoice,
    modelOptions: options.modelOptions
  })
  const { adapter, effectiveOptions, upstream } = request
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
    let pendingContentStartedAt = 0
    let contentUnlocked = false
    let providerState: unknown
    const toolCalls = new Map<number, ChatCompletionToolCall>()
    const parseStreamLine = adapter.createStreamParser?.() ?? adapter.parseStreamLine

    const flushPendingContent = (): void => {
      if (!pendingContent) {
        return
      }

      contentUnlocked = true
      callback(pendingContent, 'content')
      pendingContent = ''
      pendingContentStartedAt = 0
    }

    const handleStreamLine = (line: string): false | void => {
      const event = parseStreamLine(line)
      if (!event) return

      if (event.error) {
        throw new Error(event.error)
      }

      if (event.finishReason) {
        finishReason = event.finishReason
      }

      if (event.reasoningContent) {
        reasoningContent += event.reasoningContent
        callback(event.reasoningContent, 'reasoning')
      }

      const reasoningSnapshotDelta = getSnapshotDelta(reasoningContent, event.reasoningSnapshot)
      if (reasoningSnapshotDelta) {
        reasoningContent += reasoningSnapshotDelta
        callback(reasoningSnapshotDelta, 'reasoning')
      }

      if (event.toolCallDeltas?.length) {
        pendingContent = ''
        pendingContentStartedAt = 0
        applyToolCallDeltas(toolCalls, event.toolCallDeltas)
      }

      if (event.content) {
        fullResponse += event.content

        if (event.contentPhase === 'final_answer' && !contentUnlocked) {
          flushPendingContent()
          contentUnlocked = true
        }

        if (contentUnlocked) {
          callback(event.content, 'content')
          return
        }

        pendingContent += event.content
        pendingContentStartedAt ||= Date.now()

        if (
          event.contentPhase !== 'commentary' &&
          Date.now() - pendingContentStartedAt >= TOOL_STREAM_CONTENT_BUFFER_MS
        ) {
          flushPendingContent()
        }
      }

      const contentSnapshotDelta = getSnapshotDelta(fullResponse, event.contentSnapshot)
      if (contentSnapshotDelta) {
        fullResponse += contentSnapshotDelta
        if (contentUnlocked) {
          callback(contentSnapshotDelta, 'content')
        } else {
          pendingContent += contentSnapshotDelta
        }
      }

      if (event.providerState !== undefined) {
        providerState = event.providerState
      }

      if (event.done) {
        return false
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
      provider: effectiveOptions.provider,
      model: effectiveOptions.model,
      content: fullResponse,
      reasoningContent,
      toolCalls: collectedToolCalls,
      finishReason,
      providerState
    }
  } catch (error) {
    if (upstream.isTimedOut()) {
      throw new Error('请求超时，请稍候重试')
    }
    throw error
  } finally {
    upstream.cleanup()
  }
}

function callLLMOnce(prompt: PromptMessage[], options: LlmCallOptions = {}): Promise<string> {
  return callLLM({
    prompt,
    signal: options.signal,
    modelOptions: options.modelOptions
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
    signal: options.signal,
    modelOptions: options.modelOptions
  }) as Promise<LlmStreamResult>
}

function callLLMStreamAfterTools(
  prompt: PromptMessage[],
  firstResponse: LlmStreamWithToolsResult,
  toolResults: ToolResult[],
  callback: LlmStreamCallback,
  options: LlmCallOptions = {}
): Promise<LlmStreamResult> {
  return callLLM({
    prompt,
    stream: true,
    callback,
    signal: options.signal,
    modelOptions: {
      ...options.modelOptions,
      provider: firstResponse.provider,
      model: firstResponse.model
    },
    continuation: {
      firstResponse,
      toolResults
    }
  }) as Promise<LlmStreamResult>
}

export {
  callLLMOnce as callLLM,
  callLLMStream,
  callLLMStreamAfterTools,
  callLLMStreamWithTools
}
