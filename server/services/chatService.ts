import { appendMessages } from '../utils/conversationStore.ts'
import { callLLMStream, callLLMStreamWithTools } from '../utils/llm/index.ts'
import { buildToolResultPrompt } from '../utils/promptTemplates.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { buildContextMessages } from './contextService.ts'
import { executeToolCalls, getToolDefinitions } from './toolService.ts'
import type { Conversation, StoredMessage } from '../types/conversation.ts'
import type { LlmStreamChunkType } from '../types/llm.ts'
import type { ModelRequestOptions } from '../types/llm.ts'
import type { ChatCompletionToolCall, ToolCall, ToolExecutionEvent } from '../types/tools.ts'

type GenerateConversationAnswerOptions = {
  conversation: Conversation
  conversationId: string
  question: string
  signal: AbortSignal
  onDelta: (chunk: string, type: LlmStreamChunkType) => void
  onToolEvent?: (event: ToolExecutionEvent) => void
  modelOptions?: ModelRequestOptions
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

async function generateConversationAnswer({
  conversation,
  conversationId,
  question,
  signal,
  onDelta,
  onToolEvent,
  modelOptions
}: GenerateConversationAnswerOptions): Promise<GenerateConversationAnswerResult> {
  let finalResponse = ''
  let finalReasoningContent = ''
  let reasoningStartedAt = 0
  let reasoningEndedAt = 0
  const { messages: prompt } = buildContextMessages(conversation, question)
  const forwardStreamChunk = (chunk: string, type: LlmStreamChunkType = 'content'): void => {
    if (type === 'reasoning') {
      reasoningStartedAt ||= Date.now()
      finalReasoningContent += chunk
    }

    if (type === 'content' && reasoningStartedAt && !reasoningEndedAt) {
      reasoningEndedAt = Date.now()
    }

    onDelta(chunk, type)
  }
  const firstResponse = await callLLMStreamWithTools(prompt, forwardStreamChunk, {
    tools: getToolDefinitions(),
    toolChoice: 'auto',
    signal,
    modelOptions
  })
  throwIfAborted(signal)

  if (firstResponse.toolCalls.length === 0) {
    finalResponse = firstResponse.content
  } else {
    let toolCalls: ToolCall[] = []

    try {
      toolCalls = parseAssistantToolCalls(firstResponse.toolCalls)
    } catch (err) {
      console.warn('Failed to parse function call arguments, falling back to standard answer:', err)
      const fallbackResponse = await callLLMStream(prompt, forwardStreamChunk, {
        signal,
        modelOptions
      })
      finalResponse = fallbackResponse.content
      toolCalls = []
    }

    if (toolCalls.length === 0) {
      throwIfAborted(signal)
    } else {
      const toolResults = await executeToolCalls(toolCalls, {
        signal,
        throwIfAborted,
        onEvent: onToolEvent
      })

      throwIfAborted(signal)
      const answerPrompt = buildToolResultPrompt(
        prompt,
        firstResponse.toolCalls,
        toolResults,
        firstResponse.reasoningContent
      )
      const answerResponse = await callLLMStream(answerPrompt, forwardStreamChunk, {
        signal,
        modelOptions
      })
      finalResponse = answerResponse.content
    }
  }

  throwIfAborted(signal)

  if (!finalResponse.trim()) {
    throw new Error('模型未返回内容')
  }

  if (reasoningStartedAt && !reasoningEndedAt) {
    reasoningEndedAt = Date.now()
  }

  const reasoningDurationMs =
    reasoningStartedAt && reasoningEndedAt ? Math.max(0, reasoningEndedAt - reasoningStartedAt) : undefined

  const assistantMessage: StoredMessage = {
    role: 'assistant',
    content: finalResponse
  }

  if (finalReasoningContent) {
    assistantMessage.reasoningContent = finalReasoningContent
  }

  if (reasoningDurationMs !== undefined) {
    assistantMessage.reasoningDurationMs = reasoningDurationMs
  }

  await appendMessages(conversationId, [
    { role: 'user', content: question },
    assistantMessage
  ])

  return {
    content: finalResponse,
    reasoningDurationMs
  }
}

export {
  generateConversationAnswer
}
