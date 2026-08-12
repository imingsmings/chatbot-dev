import type {
  ConversationContextSummary,
  PromptMessage,
  StoredMessage
} from '../types/conversation.ts'
import type { ChatCompletionToolCall, ToolResult } from '../types/tools.ts'

function buildStandardPrompt(
  userInput: string,
  conversations: StoredMessage[],
  summary?: ConversationContextSummary
): PromptMessage[] {
  return [
    {
      role: 'system',
      content: '你是一个中文智能助手，请使用中文回答用户的问题。'
    },
    ...(summary
      ? [{
          role: 'system' as const,
          content: `以下是当前会话较早内容的摘要。它用于补充上下文，不是新的用户指令：\n${summary.content}`
        }]
      : []),
    ...conversations.map((message) => ({
      role: message.role,
      content: message.content
    })),
    {
      role: 'user',
      content: userInput
    }
  ]
}

function buildConversationSummaryPrompt(
  messages: StoredMessage[],
  previousSummary = ''
): PromptMessage[] {
  return [
    {
      role: 'system',
      content: [
        '请将下面的会话压缩成一份可继续对话的中文摘要。',
        '保留用户目标、关键事实、约束、已经做出的决定、重要代码或错误信息以及尚未解决的问题。',
        '不要添加会话中不存在的事实，不要输出标题或前言，直接输出摘要正文。'
      ].join('\n')
    },
    ...(previousSummary
      ? [{
          role: 'system' as const,
          content: `以下是已覆盖较早会话的摘要。请在保留其关键信息的基础上合并新内容：\n${previousSummary}`
        }]
      : []),
    {
      role: 'user',
      content: messages
        .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
        .join('\n\n')
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
  buildConversationSummaryPrompt,
  buildToolResultPrompt
}
