import { callLLM } from '../utils/llm/index.ts'
import { buildConversationSummaryPrompt } from '../utils/promptTemplates.ts'
import { getConversation, updateConversationSummary } from '../utils/conversationStore.ts'
import type { Conversation, PromptMessage, StoredMessage } from '../types/conversation.ts'
import type { ModelRequestOptions } from '../types/llm.ts'

const DEFAULT_SUMMARY_MAX_TOKENS = 1024
const DEFAULT_SUMMARY_MAX_INPUT_CHARS = 24_000
const MIN_SUMMARY_MAX_INPUT_CHARS = 8_000

type GenerateSummaryResult =
  | {
      conversation: Conversation
      error?: never
    }
  | {
      error: 'not_found' | 'empty' | 'conversation_changed'
      conversation?: never
    }

function getSummaryMaxInputChars(): number {
  const parsed = Number(process.env.SUMMARY_MAX_INPUT_CHARS)
  return Number.isInteger(parsed) && parsed >= MIN_SUMMARY_MAX_INPUT_CHARS
    ? parsed
    : DEFAULT_SUMMARY_MAX_INPUT_CHARS
}

function getPromptCharCount(prompt: PromptMessage[]): number {
  return prompt.reduce((total, message) => total + (message.content?.length ?? 0), 0)
}

function getSummaryModelOptions(options: ModelRequestOptions): ModelRequestOptions {
  return {
    ...options,
    reasoningEnabled: false,
    maxTokens: Math.min(
      options.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS,
      DEFAULT_SUMMARY_MAX_TOKENS
    )
  }
}

function addAttachmentReferences(message: StoredMessage): StoredMessage {
  if (!message.attachments?.length) return message
  const references = message.attachments
    .map((attachment) =>
      `- ${attachment.filename}（${attachment.mediaType}，${attachment.width}×${attachment.height}）`
    )
    .join('\n')
  return {
    ...message,
    content: `${message.content}${message.content ? '\n' : ''}[图片附件]\n${references}`,
  }
}

function findFittingPrefixLength(
  message: StoredMessage,
  chunk: StoredMessage[],
  previousSummary: string,
  maxInputChars: number
): number {
  let low = 1
  let high = message.content.length
  let fittingLength = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const prompt = buildConversationSummaryPrompt([
      ...chunk,
      { ...message, content: message.content.slice(0, middle) }
    ], previousSummary)
    if (getPromptCharCount(prompt) <= maxInputChars) {
      fittingLength = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return fittingLength
}

function trimPreviousSummaryToFit(
  previousSummary: string,
  message: StoredMessage,
  maxInputChars: number
): string {
  const oneCharacterMessage = { ...message, content: message.content.slice(0, 1) }
  const overflow = getPromptCharCount(
    buildConversationSummaryPrompt([oneCharacterMessage], previousSummary)
  ) - maxInputChars
  return overflow > 0
    ? previousSummary.slice(0, Math.max(0, previousSummary.length - overflow))
    : previousSummary
}

async function summarizeMessageBatches(
  messages: StoredMessage[],
  initialSummary: string,
  options: ModelRequestOptions,
  signal: AbortSignal | undefined,
  maxInputChars: number
): Promise<string> {
  let previousSummary = initialSummary
  let chunk: StoredMessage[] = []

  const flushChunk = async (): Promise<void> => {
    if (chunk.length === 0) return

    const prompt = buildConversationSummaryPrompt(chunk, previousSummary)
    if (getPromptCharCount(prompt) > maxInputChars) {
      throw new Error('摘要输入超过字符预算')
    }

    const content = (await callLLM(prompt, {
      signal,
      modelOptions: getSummaryModelOptions(options)
    })).trim()
    if (!content) {
      throw new Error('模型未返回摘要内容')
    }
    previousSummary = content
    chunk = []
  }

  for (const sourceMessage of messages) {
    let remainingContent = sourceMessage.content
    if (!remainingContent) continue

    while (remainingContent) {
      const remainingMessage = { ...sourceMessage, content: remainingContent }
      const wholePrompt = buildConversationSummaryPrompt(
        [...chunk, remainingMessage],
        previousSummary
      )
      if (getPromptCharCount(wholePrompt) <= maxInputChars) {
        chunk.push(remainingMessage)
        break
      }

      if (chunk.length > 0) {
        await flushChunk()
        continue
      }

      previousSummary = trimPreviousSummaryToFit(
        previousSummary,
        remainingMessage,
        maxInputChars
      )
      const fittingLength = findFittingPrefixLength(
        remainingMessage,
        chunk,
        previousSummary,
        maxInputChars
      )
      if (fittingLength <= 0) {
        throw new Error('摘要字符预算过小，无法容纳消息')
      }

      chunk.push({
        ...remainingMessage,
        content: remainingContent.slice(0, fittingLength)
      })
      remainingContent = remainingContent.slice(fittingLength)
      await flushChunk()
    }
  }

  await flushChunk()
  return previousSummary
}

function getSummaryCoveredMessageCount(conversation: Conversation): number {
  const sourceMessageCount = conversation.summary?.sourceMessageCount
  if (
    typeof sourceMessageCount !== 'number' ||
    !Number.isInteger(sourceMessageCount) ||
    sourceMessageCount < 0
  ) {
    return 0
  }

  return Math.min(sourceMessageCount, conversation.messages.length)
}

async function generateConversationSummary(
  conversationId: string,
  options: ModelRequestOptions = {},
  signal?: AbortSignal
): Promise<GenerateSummaryResult> {
  const conversation = await getConversation(conversationId)

  if (!conversation) {
    return { error: 'not_found' }
  }

  const coveredMessageCount = getSummaryCoveredMessageCount(conversation)
  const pendingMessages = conversation.messages.slice(coveredMessageCount)
  const summaryMessages = pendingMessages.filter(
    (message) =>
      (message.content.trim() || message.attachments?.length) &&
      !(message.role === 'assistant' && message.status === 'stopped')
  ).map(addAttachmentReferences)
  if (!conversation.summary && summaryMessages.length === 0) {
    return { error: 'empty' }
  }
  if (pendingMessages.length === 0 && conversation.summary) {
    return { conversation }
  }

  const sourceMessagesSnapshot = JSON.stringify(conversation.messages)
  const maxInputChars = getSummaryMaxInputChars()
  let initialSummary = conversation.summary?.content ?? ''

  if (
    initialSummary &&
    summaryMessages.length > 0 &&
    getPromptCharCount(buildConversationSummaryPrompt([
      { role: 'assistant', content: 'x' }
    ], initialSummary)) > maxInputChars
  ) {
    initialSummary = await summarizeMessageBatches(
      [{ role: 'assistant', content: initialSummary }],
      '',
      options,
      signal,
      maxInputChars
    )
  }

  const content = summaryMessages.length > 0
    ? await summarizeMessageBatches(
        summaryMessages,
        initialSummary,
        options,
        signal,
        maxInputChars
      )
    : initialSummary

  const latestConversation = await getConversation(conversationId)
  if (!latestConversation) {
    return { error: 'not_found' }
  }
  if (
    latestConversation.updatedAt !== conversation.updatedAt ||
    JSON.stringify(latestConversation.messages) !== sourceMessagesSnapshot
  ) {
    return { error: 'conversation_changed' }
  }

  const updated = await updateConversationSummary(conversationId, {
    content,
    sourceMessageCount: conversation.messages.length,
    updatedAt: new Date().toISOString()
  })

  if (!updated) {
    return { error: 'not_found' }
  }

  return {
    conversation: updated
  }
}

export {
  DEFAULT_SUMMARY_MAX_INPUT_CHARS,
  DEFAULT_SUMMARY_MAX_TOKENS,
  MIN_SUMMARY_MAX_INPUT_CHARS,
  generateConversationSummary
}
