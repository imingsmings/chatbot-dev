import { appendMessages } from '../utils/conversationStore.ts'
import { callLLMStream, callLLMStreamWithTools } from '../utils/llm/index.ts'
import { buildStandardPrompt, buildToolResultPrompt } from '../utils/promptTemplates.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { executeToolCalls, getToolDefinitions } from './toolService.ts'
import type { Conversation } from '../types/conversation.ts'
import type { ChatCompletionToolCall, ToolCall } from '../types/tools.ts'

type GenerateConversationAnswerOptions = {
  conversation: Conversation
  conversationId: string
  question: string
  signal: AbortSignal
  onDelta: (chunk: string) => void
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
  onDelta
}: GenerateConversationAnswerOptions): Promise<string> {
  let finalResponse = ''
  const prompt = buildStandardPrompt(question, conversation.messages)
  const firstResponse = await callLLMStreamWithTools(prompt, onDelta, {
    tools: getToolDefinitions(),
    toolChoice: 'auto',
    signal
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
      finalResponse = await callLLMStream(prompt, onDelta, {
        signal
      })
      toolCalls = []
    }

    if (toolCalls.length === 0) {
      throwIfAborted(signal)
    } else {
      const toolResults = await executeToolCalls(toolCalls, {
        signal,
        throwIfAborted
      })

      throwIfAborted(signal)
      const answerPrompt = buildToolResultPrompt(
        prompt,
        firstResponse.toolCalls,
        toolResults,
        firstResponse.reasoningContent
      )
      finalResponse = await callLLMStream(answerPrompt, onDelta, {
        signal
      })
    }
  }

  throwIfAborted(signal)

  if (!finalResponse.trim()) {
    throw new Error('模型未返回内容')
  }

  await appendMessages(conversationId, [
    { role: 'user', content: question },
    { role: 'assistant', content: finalResponse }
  ])

  return finalResponse
}

export {
  generateConversationAnswer
}
