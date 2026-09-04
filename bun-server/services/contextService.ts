import { buildStandardPrompt } from '../utils/promptTemplates.ts'
import { MAX_IMAGE_ATTACHMENTS_PER_MESSAGE } from '../config/productLimits.ts'
import { resolveModelOptions } from '../utils/modelOptions.ts'
import { getToolDefinitions } from './toolService.ts'
import {
  ContextBudgetExceededError,
  estimateContextTokens,
  resolveContextTokenBudget,
  type ContextTokenBudgetConfig,
  type ContextTokenEstimate,
} from './contextBudgetService.ts'
import type {
  Conversation,
  ImageAttachment,
  PromptMessage,
  StoredMessage,
} from '../types/conversation.ts'
import type { ModelRequestOptions } from '../types/llm.ts'
import type { FunctionToolDefinition } from '../types/tools.ts'

const DEFAULT_MAX_HISTORY_MESSAGES = 20
const DEFAULT_MAX_HISTORY_CHARS = 12000

type ContextConfig = {
  maxHistoryMessages: number
  maxHistoryChars: number
  maxImages: number
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
  selectedImages: number
  droppedImages: number
  selectedImageBytes: number
  selectedHistoryRange: {
    start: number
    end: number
  } | null
  summaryIncluded: boolean
  summaryDroppedByTokenBudget: boolean
  legacyDroppedHistoryMessages: number
  tokenDroppedHistoryMessages: number
  tokenBudget: ContextTokenBudgetConfig & ContextTokenEstimate
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getContextConfig(): ContextConfig {
  return {
    maxHistoryMessages: readPositiveInteger(process.env.CONTEXT_MAX_HISTORY_MESSAGES, DEFAULT_MAX_HISTORY_MESSAGES),
    maxHistoryChars: readPositiveInteger(process.env.CONTEXT_MAX_HISTORY_CHARS, DEFAULT_MAX_HISTORY_CHARS),
    maxImages: MAX_IMAGE_ATTACHMENTS_PER_MESSAGE
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

function buildImageAwareHistory(
  messages: StoredMessage[],
  currentAttachments: ImageAttachment[],
  includeImages: boolean,
  maxImages: number,
): {
  messages: StoredMessage[]
  selectedImages: number
  droppedImages: number
  selectedImageBytes: number
} {
  const availableImages = messages.reduce(
    (total, message) => total + (message.attachments?.length ?? 0),
    currentAttachments.length,
  )
  if (!includeImages) {
    return {
      messages: messages.map((message) => message.attachments?.length
        ? {
            ...message,
            content: `${message.content}${message.content ? '\n' : ''}[${message.attachments.length} 张历史图片未发送给当前文本模型]`,
            attachments: undefined,
          }
        : message),
      selectedImages: 0,
      droppedImages: availableImages,
      selectedImageBytes: 0,
    }
  }

  const selectedLocations = new Set<string>()
  let selectedHistoryImages = 0
  let selectedHistoryBytes = 0
  let remaining = Math.max(0, maxImages - currentAttachments.length)
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const attachments = messages[index].attachments ?? []
    for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0 && remaining > 0; attachmentIndex -= 1) {
      selectedLocations.add(`${index}:${attachmentIndex}`)
      selectedHistoryImages += 1
      selectedHistoryBytes += attachments[attachmentIndex].byteSize
      remaining -= 1
    }
  }

  const selectedMessages = messages.map((message, messageIndex) => {
    if (!message.attachments?.length) return message
    const attachments = message.attachments.filter((attachment, attachmentIndex) =>
      selectedLocations.has(`${messageIndex}:${attachmentIndex}`)
    )
    const dropped = message.attachments.length - attachments.length
    return {
      ...message,
      content: dropped > 0
        ? `${message.content}${message.content ? '\n' : ''}[${dropped} 张较早图片因上下文图片预算未发送]`
        : message.content,
      attachments: attachments.length ? attachments : undefined,
    }
  })
  const selectedImages = currentAttachments.length + selectedHistoryImages

  return {
    messages: selectedMessages,
    selectedImages,
    droppedImages: Math.max(0, availableImages - selectedImages),
    selectedImageBytes: currentAttachments.reduce(
      (total, attachment) => total + attachment.byteSize,
      selectedHistoryBytes,
    ),
  }
}

function buildContextMessages(
  conversation: Conversation,
  question: string,
  options: {
    currentAttachments?: ImageAttachment[]
    includeImages?: boolean
    modelOptions?: ModelRequestOptions
    tools?: FunctionToolDefinition[]
  } = {},
): ContextBuildResult {
  const config = getContextConfig()
  const effectiveOptions = resolveModelOptions(options.modelOptions)
  const tools = options.tools ?? getToolDefinitions()
  const tokenBudgetConfig = resolveContextTokenBudget(effectiveOptions, tools)
  const totalHistoryMessages = conversation.messages.length
  const summaryCoveredMessages = getSummaryCoveredMessageCount(conversation)
  const postSummaryHistory = conversation.messages
    .slice(summaryCoveredMessages)
    .map((message, offset) => ({ index: summaryCoveredMessages + offset, message }))
  const eligibleHistory = postSummaryHistory.filter(
    ({ message }) => !(message.role === 'assistant' && message.status === 'stopped')
  )
  const recentHistory = selectRecentHistory(eligibleHistory, config)
  const selectedHistory = [...recentHistory]
  const currentAttachments = options.currentAttachments ?? []
  let allowedHistoricalImages = Math.max(0, config.maxImages - currentAttachments.length)
  let summaryIncluded = Boolean(conversation.summary)
  let summaryDroppedByTokenBudget = false
  let imageContext = buildImageAwareHistory([], currentAttachments, options.includeImages === true, config.maxImages)
  let messages: PromptMessage[] = []
  let tokenEstimate: ContextTokenEstimate

  while (true) {
    imageContext = buildImageAwareHistory(
      selectedHistory.map(({ message }) => message),
      currentAttachments,
      options.includeImages === true,
      currentAttachments.length + allowedHistoricalImages,
    )
    messages = buildStandardPrompt(
      question,
      imageContext.messages,
      summaryIncluded ? conversation.summary : undefined,
      options.includeImages ? currentAttachments : [],
    )
    const systemMessage = messages[0]
    const currentMessage = messages[messages.length - 1]
    const summaryMessage = summaryIncluded ? messages[1] : undefined
    const historyStart = summaryIncluded ? 2 : 1
    const historyMessages = messages.slice(historyStart, -1)
    tokenEstimate = estimateContextTokens({
      systemMessage,
      summaryMessage,
      historyMessages,
      currentMessage,
      config: tokenBudgetConfig,
    })

    if (tokenEstimate.overflowTokens === 0) break

    const selectedHistoryImages = imageContext.selectedImages - currentAttachments.length
    if (selectedHistoryImages > 0 && allowedHistoricalImages > 0) {
      allowedHistoricalImages -= 1
      continue
    }
    if (summaryIncluded) {
      summaryIncluded = false
      summaryDroppedByTokenBudget = true
      continue
    }
    if (selectedHistory.length > 0) {
      selectedHistory.shift()
      continue
    }

    throw new ContextBudgetExceededError(tokenBudgetConfig, tokenEstimate)
  }

  const selectedHistoryChars = selectedHistory.reduce(
    (total, { message }) => total + getMessageCharLength(message),
    0,
  )
  const eligibleImageCount = currentAttachments.length + eligibleHistory.reduce(
    (total, { message }) => total + (message.attachments?.length ?? 0),
    0,
  )

  return {
    messages,
    config,
    summaryCoveredMessages,
    postSummaryMessages: postSummaryHistory.length,
    excludedStoppedMessages: postSummaryHistory.length - eligibleHistory.length,
    selectedHistoryMessages: selectedHistory.length,
    droppedHistoryMessages: Math.max(0, eligibleHistory.length - selectedHistory.length),
    selectedHistoryChars,
    selectedImages: imageContext.selectedImages,
    droppedImages: Math.max(0, eligibleImageCount - imageContext.selectedImages),
    selectedImageBytes: imageContext.selectedImageBytes,
    selectedHistoryRange: selectedHistory.length > 0
      ? {
          start: selectedHistory[0].index + 1,
          end: selectedHistory[selectedHistory.length - 1].index + 1
        }
      : null,
    summaryIncluded,
    summaryDroppedByTokenBudget,
    legacyDroppedHistoryMessages: Math.max(0, eligibleHistory.length - recentHistory.length),
    tokenDroppedHistoryMessages: Math.max(0, recentHistory.length - selectedHistory.length),
    tokenBudget: {
      ...tokenBudgetConfig,
      ...tokenEstimate,
    },
  }
}

export {
  type ContextBuildResult,
  type ContextConfig,
  buildContextMessages
}
