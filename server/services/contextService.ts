import { buildStandardPrompt } from '../utils/promptTemplates.ts'
import { MAX_IMAGE_ATTACHMENTS_PER_MESSAGE } from '../config/productLimits.ts'
import type {
  Conversation,
  ImageAttachment,
  PromptMessage,
  StoredMessage,
} from '../types/conversation.ts'

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
  } = {},
): ContextBuildResult {
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
  const currentAttachments = options.currentAttachments ?? []
  const imageContext = buildImageAwareHistory(
    selectedMessages,
    currentAttachments,
    options.includeImages === true,
    config.maxImages,
  )
  const eligibleImageCount = currentAttachments.length + eligibleHistory.reduce(
    (total, { message }) => total + (message.attachments?.length ?? 0),
    0,
  )

  return {
    messages: buildStandardPrompt(
      question,
      imageContext.messages,
      conversation.summary,
      options.includeImages ? currentAttachments : [],
    ),
    config,
    summaryCoveredMessages,
    postSummaryMessages: postSummaryHistory.length,
    excludedStoppedMessages: postSummaryHistory.length - eligibleHistory.length,
    selectedHistoryMessages: recentHistory.length,
    droppedHistoryMessages: Math.max(0, eligibleHistory.length - recentHistory.length),
    selectedHistoryChars,
    selectedImages: imageContext.selectedImages,
    droppedImages: Math.max(0, eligibleImageCount - imageContext.selectedImages),
    selectedImageBytes: imageContext.selectedImageBytes,
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
