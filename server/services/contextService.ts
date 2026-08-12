import { buildStandardPrompt } from '../utils/promptTemplates.ts'
import type { Conversation, PromptMessage, StoredMessage } from '../types/conversation.ts'

const DEFAULT_MAX_HISTORY_MESSAGES = 20
const DEFAULT_MAX_HISTORY_CHARS = 12000

type ContextConfig = {
  maxHistoryMessages: number
  maxHistoryChars: number
}

type ContextBuildResult = {
  messages: PromptMessage[]
  config: ContextConfig
  summaryCoveredMessages: number
  postSummaryMessages: number
  excludedStoppedMessages: number
  selectedHistoryMessages: number
  droppedHistoryMessages: number
  selectedHistoryChars: number
  selectedHistoryRange: {
    start: number
    end: number
  } | null
  summaryIncluded: boolean
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getContextConfig(): ContextConfig {
  return {
    maxHistoryMessages: readPositiveInteger(process.env.CONTEXT_MAX_HISTORY_MESSAGES, DEFAULT_MAX_HISTORY_MESSAGES),
    maxHistoryChars: readPositiveInteger(process.env.CONTEXT_MAX_HISTORY_CHARS, DEFAULT_MAX_HISTORY_CHARS)
  }
}

function getMessageCharLength(message: StoredMessage): number {
  return message.content.length
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

type IndexedStoredMessage = {
  index: number
  message: StoredMessage
}

function selectRecentHistory(messages: IndexedStoredMessage[], config: ContextConfig): IndexedStoredMessage[] {
  const selected: IndexedStoredMessage[] = []
  let selectedChars = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (selected.length >= config.maxHistoryMessages) {
      break
    }

    const indexedMessage = messages[index]
    const message = indexedMessage.message
    const messageChars = getMessageCharLength(message)

    if (selected.length > 0 && selectedChars + messageChars > config.maxHistoryChars) {
      break
    }

    if (selected.length === 0 && messageChars > config.maxHistoryChars) {
      selected.unshift(indexedMessage)
      break
    }

    selected.unshift(indexedMessage)
    selectedChars += messageChars
  }

  return selected
}

function buildContextMessages(conversation: Conversation, question: string): ContextBuildResult {
  const config = getContextConfig()
  const totalHistoryMessages = conversation.messages.length
  const summaryCoveredMessages = getSummaryCoveredMessageCount(conversation)
  const postSummaryHistory = conversation.messages
    .slice(summaryCoveredMessages)
    .map((message, offset) => ({ index: summaryCoveredMessages + offset, message }))
  const eligibleHistory = postSummaryHistory.filter(
    ({ message }) => !(message.role === 'assistant' && message.status === 'stopped')
  )
  const recentHistory = selectRecentHistory(eligibleHistory, config)
  const selectedHistoryChars = recentHistory.reduce(
    (total, { message }) => total + getMessageCharLength(message),
    0
  )
  const selectedMessages = recentHistory.map(({ message }) => message)

  return {
    messages: buildStandardPrompt(question, selectedMessages, conversation.summary),
    config,
    summaryCoveredMessages,
    postSummaryMessages: postSummaryHistory.length,
    excludedStoppedMessages: postSummaryHistory.length - eligibleHistory.length,
    selectedHistoryMessages: recentHistory.length,
    droppedHistoryMessages: Math.max(0, eligibleHistory.length - recentHistory.length),
    selectedHistoryChars,
    selectedHistoryRange: recentHistory.length > 0
      ? {
          start: recentHistory[0].index + 1,
          end: recentHistory[recentHistory.length - 1].index + 1
        }
      : null,
    summaryIncluded: Boolean(conversation.summary)
  }
}

export {
  type ContextBuildResult,
  type ContextConfig,
  buildContextMessages
}
