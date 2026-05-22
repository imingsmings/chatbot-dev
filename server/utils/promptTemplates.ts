import type { PromptMessage, StoredMessage } from '../types/conversation.ts'
import type { ChatCompletionToolCall, ToolResult } from '../types/tools.ts'

function buildStandardPrompt(userInput: string, conversations: StoredMessage[]): PromptMessage[] {
  // return [
  //   `你是一个中文智能助手，请使用中文回答用户的问题。`,
  //   ...conversations.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`),
  //   ` 问题：${userInput}`
  // ].join('\n')

  return [
    {
      role: 'system',
      content: '你是一个中文智能助手，请使用中文回答用户的问题。'
    },
    ...conversations,
    {
      role: 'user',
      content: userInput
    }
  ]
}

function buildToolResultPrompt(
  prompt: PromptMessage[],
  toolCalls: ChatCompletionToolCall[],
  results: ToolResult[],
  reasoningContent = ''
): PromptMessage[] {
  return [
    ...prompt,
    {
      role: 'assistant',
      content: '',
      reasoning_content: reasoningContent || undefined,
      tool_calls: toolCalls
    },
    ...results.map((item, index) => ({
      role: 'tool' as const,
      tool_call_id: item.id ?? toolCalls[index]?.id ?? `tool_call_${index}`,
      content: item.result
    }))
  ]
}

export {
  buildStandardPrompt,
  buildToolResultPrompt
}
