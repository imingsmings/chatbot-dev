import { appendMessages } from '../utils/conversationStore.ts'
import { callLLMStream, callLLMStreamToText } from '../utils/llm/index.ts'
import { buildAnswerPrompt, buildFunctionCallPrompt, buildStandardPrompt } from '../utils/promptTemplates.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { parseToolCallsFromText } from './toolCallParser.ts'
import { executeToolCalls } from './toolService.ts'
import type { Conversation } from '../types/conversation.ts'

type GenerateConversationAnswerOptions = {
  conversation: Conversation
  conversationId: string
  question: string
  signal: AbortSignal
  onDelta: (chunk: string) => void
}

async function generateConversationAnswer({
  conversation,
  conversationId,
  question,
  signal,
  onDelta
}: GenerateConversationAnswerOptions): Promise<string> {
  let finalResponse = ''
  const functionCallPrompt = buildFunctionCallPrompt(question)
  const functionCallResult = await callLLMStreamToText(functionCallPrompt, {
    signal
  })
  throwIfAborted(signal)

  const toolCalls = parseToolCallsFromText(functionCallResult)

  if (toolCalls.length === 0) {
    const prompt = buildStandardPrompt(question, conversation.messages)
    finalResponse = await callLLMStream(prompt, onDelta, {
      signal
    })
  } else {
    const toolResults = await executeToolCalls(toolCalls, {
      signal,
      throwIfAborted
    })

    throwIfAborted(signal)
    const answerPrompt = buildAnswerPrompt(question, toolResults)
    finalResponse = await callLLMStream(answerPrompt, onDelta, {
      signal
    })
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
