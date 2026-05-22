import { appendMessages } from '../utils/conversationStore.ts'
import { callLLM, callLLMStream } from '../utils/llm/index.ts'
import { buildAnswerPrompt, buildFunctionCallPrompt, buildStandardPrompt } from '../utils/promptTemplates.ts'
import { throwIfAborted } from '../utils/abort.ts'
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
  const functionCallResult = await callLLM(functionCallPrompt, {
    signal
  })
  throwIfAborted(signal)

  if (functionCallResult.trim() === '无函数调用') {
    const prompt = buildStandardPrompt(question, conversation.messages)
    finalResponse = await callLLMStream(prompt, onDelta, {
      signal
    })
  } else {
    const toolCalls = JSON.parse(functionCallResult) as unknown
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
