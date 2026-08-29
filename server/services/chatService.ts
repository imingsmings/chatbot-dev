import {
  appendMessages,
  finalizeConversationRequest,
  updateConversationModelOptions
} from '../utils/conversationStore.ts'
import {
  callLLMStream,
  callLLMStreamAfterTools,
  callLLMStreamWithTools
} from '../utils/llm/index.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { resolveModelOptions, toConversationModelOptions } from '../utils/modelOptions.ts'
import { buildContextMessages } from './contextService.ts'
import { executeToolCalls, getToolDefinitions } from './toolService.ts'
import { MAX_STORED_TOOL_TRACE_ITEMS } from '../config/productLimits.ts'
import { findModelDescriptor } from '../utils/llm/modelCatalog.ts'
import { materializePromptAttachments } from './attachmentService.ts'
import type { Conversation, ImageAttachment, StoredMessage } from '../types/conversation.ts'
import type { GenerationMetadata, StoredToolTrace, TokenUsage } from '../types/generation.ts'
import type { LlmStreamChunkType, ModelRequestOptions } from '../types/llm.ts'
import type { ChatCompletionToolCall, ToolCall, ToolExecutionEvent } from '../types/tools.ts'

type GenerateConversationAnswerOptions = {
  conversation: Conversation
  conversationId: string
  question: string
  attachments?: ImageAttachment[]
  signal: AbortSignal
  onDelta: (chunk: string, type: LlmStreamChunkType) => void
  onToolEvent?: (event: ToolExecutionEvent) => void
  modelOptions?: ModelRequestOptions
  requestId?: string
}

type GenerateConversationAnswerResult = {
  content: string
  reasoningDurationMs?: number
}

function parseAssistantToolCalls(toolCalls: ChatCompletionToolCall[]): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    function: toolCall.function.name,
    args: JSON.parse(toolCall.function.arguments || '{}') as unknown
  }))
}

const TOKEN_USAGE_KEYS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedInputTokens'
] as const

function combineTokenUsage(usages: Array<TokenUsage | undefined>): TokenUsage | undefined {
  if (!usages.length) return undefined

  const combined: TokenUsage = {}
  for (const key of TOKEN_USAGE_KEYS) {
    if (usages.every((usage) => usage?.[key] !== undefined)) {
      combined[key] = usages.reduce((total, usage) => total + (usage?.[key] ?? 0), 0)
    }
  }

  return Object.keys(combined).length ? combined : undefined
}

async function generateConversationAnswer({
  conversation,
  conversationId,
  question,
  attachments = [],
  signal,
  onDelta,
  onToolEvent,
  modelOptions,
  requestId
}: GenerateConversationAnswerOptions): Promise<GenerateConversationAnswerResult> {
  const startedAt = Date.now()
  const effectiveOptions = resolveModelOptions(modelOptions)
  const modelDescriptor = findModelDescriptor(effectiveOptions.model)
  const supportsImages = modelDescriptor?.capabilities.inputModalities.includes('image') === true
  if (attachments.length && !supportsImages) {
    throw new Error(`${modelDescriptor?.label ?? effectiveOptions.model} 不支持图片，请切换到 Vision 模型`)
  }
  const boundOptions = toConversationModelOptions(effectiveOptions)
  const persistedModelOptions = await updateConversationModelOptions(conversationId, boundOptions)
  if (!persistedModelOptions) {
    throw new Error('会话已被删除，模型配置未保存')
  }
  let finalResponse = ''
  let finalReasoningContent = ''
  let reasoningStartedAt = 0
  let reasoningEndedAt = 0
  let firstTokenAt = 0
  let terminalFinishReason: string | undefined
  const completedUsages: Array<TokenUsage | undefined> = []
  const toolTrace: StoredToolTrace[] = []
  const context = buildContextMessages(persistedModelOptions, question, {
    currentAttachments: attachments,
    includeImages: supportsImages,
  })
  const prompt = await materializePromptAttachments(conversationId, context.messages)
  const forwardStreamChunk = (chunk: string, type: LlmStreamChunkType = 'content'): void => {
    firstTokenAt ||= Date.now()

    if (type === 'reasoning') {
      reasoningStartedAt ||= Date.now()
      finalReasoningContent += chunk
    }

    if (type === 'content') {
      finalResponse += chunk
      if (reasoningStartedAt && !reasoningEndedAt) {
        reasoningEndedAt = Date.now()
      }
    }

    onDelta(chunk, type)
  }

  const getReasoningDuration = (endedAt: number): number | undefined => {
    if (!reasoningStartedAt) return undefined
    return Math.max(0, (reasoningEndedAt || endedAt) - reasoningStartedAt)
  }

  const buildGenerationMetadata = (
    endedAt: number,
    status: 'completed' | 'stopped'
  ): GenerationMetadata => {
    const generation: GenerationMetadata = {
      provider: effectiveOptions.provider,
      model: effectiveOptions.model,
      totalDurationMs: Math.max(0, endedAt - startedAt)
    }

    if (status === 'completed' && terminalFinishReason) {
      generation.finishReason = terminalFinishReason
    }
    if (firstTokenAt) {
      generation.firstTokenLatencyMs = Math.max(0, firstTokenAt - startedAt)
    }
    if (status === 'completed') {
      const usage = combineTokenUsage(completedUsages)
      if (usage) generation.usage = usage
    }

    return generation
  }

  const persistAnswer = async (status: 'completed' | 'stopped'): Promise<void> => {
    const endedAt = Date.now()
    const assistantMessage: StoredMessage = {
      role: 'assistant',
      content: finalResponse,
      status,
      generation: buildGenerationMetadata(endedAt, status)
    }
    const reasoningDurationMs = getReasoningDuration(endedAt)

    if (finalReasoningContent) {
      assistantMessage.reasoningContent = finalReasoningContent
    }
    if (reasoningDurationMs !== undefined) {
      assistantMessage.reasoningDurationMs = reasoningDurationMs
    }
    if (toolTrace.length) {
      assistantMessage.toolTrace = toolTrace.slice(0, MAX_STORED_TOOL_TRACE_ITEMS)
    }

    const messages: StoredMessage[] = [
      {
        role: 'user',
        content: question,
        ...(attachments.length
          ? { attachments: attachments.map((attachment) => ({ ...attachment })) }
          : {}),
      },
      assistantMessage
    ]
    const persistedConversation = requestId
      ? await finalizeConversationRequest(conversationId, requestId, status, messages)
      : await appendMessages(conversationId, messages)

    if (!persistedConversation) {
      throw new Error('会话已被删除，响应未保存')
    }
  }

  const handleToolEvent = (event: ToolExecutionEvent): void => {
    if (event.type === 'tool_result' && toolTrace.length < MAX_STORED_TOOL_TRACE_ITEMS) {
      toolTrace.push({
        name: event.name,
        success: event.success,
        durationMs: event.durationMs,
        summary: event.summary
      })
    }
    onToolEvent?.(event)
  }

  try {
    const firstResponse = await callLLMStreamWithTools(prompt, forwardStreamChunk, {
      tools: getToolDefinitions(),
      toolChoice: 'auto',
      signal,
      modelOptions: boundOptions
    })
    completedUsages.push(firstResponse.usage)
    terminalFinishReason = firstResponse.finishReason
    throwIfAborted(signal)

    if (firstResponse.toolCalls.length > 0) {
      let toolCalls: ToolCall[] = []

      try {
        toolCalls = parseAssistantToolCalls(firstResponse.toolCalls)
      } catch (err) {
        console.warn('Failed to parse function call arguments, falling back to standard answer:', err)
        const fallbackResponse = await callLLMStream(prompt, forwardStreamChunk, {
          signal,
          modelOptions: boundOptions
        })
        completedUsages.push(fallbackResponse.usage)
        terminalFinishReason = fallbackResponse.finishReason
      }

      if (toolCalls.length === 0) {
        throwIfAborted(signal)
      } else {
        const toolResults = await executeToolCalls(toolCalls, {
          signal,
          throwIfAborted,
          onEvent: handleToolEvent
        })

        throwIfAborted(signal)
        const answerResponse = await callLLMStreamAfterTools(
          prompt,
          firstResponse,
          toolResults,
          forwardStreamChunk,
          {
            signal,
            modelOptions: boundOptions
          }
        )
        completedUsages.push(answerResponse.usage)
        terminalFinishReason = answerResponse.finishReason
      }
    }

    throwIfAborted(signal)

    if (!finalResponse.trim()) {
      throw new Error('模型未返回内容')
    }

    await persistAnswer('completed')

    return {
      content: finalResponse,
      reasoningDurationMs: getReasoningDuration(Date.now())
    }
  } catch (error) {
    if (
      signal.aborted &&
      signal.reason === 'explicit_cancel' &&
      (finalResponse.trim() || finalReasoningContent.trim())
    ) {
      await persistAnswer('stopped')
    }
    throw error
  }
}

export {
  generateConversationAnswer
}
