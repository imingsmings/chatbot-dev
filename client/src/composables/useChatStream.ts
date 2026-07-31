import { computed, nextTick, reactive, ref, type Ref } from 'vue'
import { cancelRequest, requestConversationAnswer } from '@/api/conversations'
import type {
  ChatMessage,
  ConversationDetail,
  ModelRequestOptions,
  ToolActivity,
} from '@/types/chat'
import { assertChatStreamProtocol, parseChatStreamEvent } from '@/utils/streamProtocol'
import { settleRunningToolActivities } from '@/utils/toolActivities'

const STREAM_IDLE_TIMEOUT_MS = 15000

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function useChatStream(options: {
  createConversation: () => Promise<ConversationDetail>
  currentConversationId: Ref<string | null>
  followNewContent: (shouldFollow: boolean) => Promise<void>
  messages: Ref<ChatMessage[]>
  refreshConversationList: () => Promise<void>
  resizeComposer: () => void
  shouldFollowNewContent: () => boolean
  showError: (message: string, title?: string) => Promise<void> | void
  clearComposer: () => void
  getModelOptions: () => ModelRequestOptions
}) {
  const currentAbortController = ref<AbortController | null>(null)
  const currentRequestId = ref<string | null>(null)
  const abortReason = ref<'manual' | 'timeout' | null>(null)
  const copiedMessageId = ref<string | null>(null)
  const isStopping = ref(false)

  const isResponding = computed(() =>
    options.messages.value.some(
      (msg) =>
        msg.role === 'assistant' && (msg.status === 'pending' || msg.status === 'streaming'),
    ),
  )

  async function cancelActiveRequest(requestId: string) {
    try {
      await cancelRequest(requestId)
    } catch (err) {
      console.error('Failed to cancel active request:', err)
    }
  }

  async function submitQuestion(
    question: string,
    submitOptions: {
      appendUser: boolean
      clearComposer: boolean
      assistantInsertIndex?: number
    },
  ) {
    if (!question || isResponding.value || isStopping.value) return

    let conversationId = options.currentConversationId.value
    if (!conversationId) {
      const conversation = await options.createConversation()
      conversationId = conversation.id
    }

    if (submitOptions.appendUser) {
      options.messages.value.push({
        id: createMessageId(),
        role: 'user',
        text: question,
        status: 'done',
      })
    }

    const assistantMessage = reactive<ChatMessage>({
      id: createMessageId(),
      role: 'assistant',
      text: '',
      reasoningText: '',
      status: 'pending',
      toolActivities: [],
    })

    if (typeof submitOptions.assistantInsertIndex === 'number') {
      options.messages.value.splice(submitOptions.assistantInsertIndex, 0, assistantMessage)
    } else {
      options.messages.value.push(assistantMessage)
    }

    if (submitOptions.clearComposer) {
      options.clearComposer()
    }

    const shouldFollow = options.shouldFollowNewContent()
    await nextTick()
    options.resizeComposer()
    await options.followNewContent(shouldFollow)

    const controller = new AbortController()
    const requestId = createRequestId()
    let streamIdleTimer: number | undefined
    currentAbortController.value = controller
    currentRequestId.value = requestId
    abortReason.value = null

    const clearStreamIdleTimer = () => {
      if (streamIdleTimer !== undefined) {
        window.clearTimeout(streamIdleTimer)
        streamIdleTimer = undefined
      }
    }

    const resetStreamIdleTimer = () => {
      clearStreamIdleTimer()
      streamIdleTimer = window.setTimeout(() => {
        abortReason.value = 'timeout'
        controller.abort()
        void cancelActiveRequest(requestId)
      }, STREAM_IDLE_TIMEOUT_MS)
    }

    try {
      const res = await requestConversationAnswer({
        conversationId,
        question,
        requestId,
        signal: controller.signal,
        options: options.getModelOptions(),
      })

      if (!res.ok) {
        throw new Error(`请求失败：${res.status}`)
      }

      assertChatStreamProtocol(res)

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('响应内容为空')
      }

      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let streamDone = false
      let reasoningStartedAt = 0
      resetStreamIdleTimer()

      const handleStreamLine = (line: string) => {
        const text = line.trim()
        if (!text) return

        const event = parseChatStreamEvent(text)

        switch (event.type) {
          case 'error':
            throw new Error(event.message || '模型响应失败')
          case 'done':
            if (typeof event.reasoningDurationMs === 'number') {
              assistantMessage.reasoningDurationMs = event.reasoningDurationMs
            }
            streamDone = true
            return
          case 'reasoning_delta':
            if (!event.content) return
            const shouldFollow = options.shouldFollowNewContent()
            reasoningStartedAt ||= Date.now()
            assistantMessage.status = 'streaming'
            assistantMessage.reasoningText = `${assistantMessage.reasoningText ?? ''}${event.content}`
            void options.followNewContent(shouldFollow)
            return
          case 'tool_start': {
            const shouldFollow = options.shouldFollowNewContent()
            const id = event.toolCallId || `${event.name}-${assistantMessage.toolActivities?.length ?? 0}`
            const activity: ToolActivity = {
              id,
              name: event.name,
              status: 'running',
            }
            assistantMessage.status = 'streaming'
            assistantMessage.toolActivities = [...(assistantMessage.toolActivities ?? []), activity]
            void options.followNewContent(shouldFollow)
            return
          }
          case 'tool_result': {
            const shouldFollow = options.shouldFollowNewContent()
            const activities = assistantMessage.toolActivities ?? []
            let index = event.toolCallId
              ? activities.findIndex((item) => item.id === event.toolCallId)
              : -1

            if (!event.toolCallId) {
              for (let activityIndex = activities.length - 1; activityIndex >= 0; activityIndex -= 1) {
                const candidate = activities[activityIndex]
                if (candidate.name === event.name && candidate.status === 'running') {
                  index = activityIndex
                  break
                }
              }
            }
            const activity: ToolActivity = {
              id: event.toolCallId || (index >= 0 ? activities[index].id : `${event.name}-${activities.length}`),
              name: event.name,
              status: event.success ? 'success' : 'error',
              summary: event.summary,
            }

            if (index >= 0) {
              assistantMessage.toolActivities = activities.map((item, itemIndex) =>
                itemIndex === index ? activity : item,
              )
            } else {
              assistantMessage.toolActivities = [...activities, activity]
            }
            assistantMessage.status = 'streaming'
            void options.followNewContent(shouldFollow)
            return
          }
          case 'delta': {
            if (!event.content) return
            const shouldFollow = options.shouldFollowNewContent()
            if (reasoningStartedAt && assistantMessage.reasoningDurationMs === undefined) {
              assistantMessage.reasoningDurationMs = Date.now() - reasoningStartedAt
            }
            assistantMessage.status = 'streaming'
            assistantMessage.text += event.content
            void options.followNewContent(shouldFollow)
          }
        }
      }

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        resetStreamIdleTimer()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          handleStreamLine(line)
          if (streamDone) {
            await reader.cancel()
            break
          }
        }
      }

      buffer += decoder.decode()

      if (!streamDone && buffer.trim()) {
        handleStreamLine(buffer)
      }

      if (!assistantMessage.text.trim()) {
        throw new Error('模型未返回内容')
      }

      if (!streamDone) {
        throw new Error('响应未完整结束')
      }

      if (reasoningStartedAt && assistantMessage.reasoningDurationMs === undefined) {
        assistantMessage.reasoningDurationMs = Date.now() - reasoningStartedAt
      }

      assistantMessage.toolActivities = settleRunningToolActivities(
        assistantMessage.toolActivities,
        'error',
        '未收到工具结果',
      )
      assistantMessage.status = 'done'
      await options.refreshConversationList()
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? abortReason.value === 'manual'
            ? '已停止生成'
            : '响应超时或连接中断'
          : err instanceof Error
            ? err.message
            : '响应失败，请重试'

      const isManualAbort =
        err instanceof DOMException && err.name === 'AbortError' && abortReason.value === 'manual'

      assistantMessage.toolActivities = settleRunningToolActivities(
        assistantMessage.toolActivities,
        isManualAbort ? 'stopped' : 'error',
        isManualAbort ? '已停止' : '执行中断',
      )

      if (isManualAbort) {
        assistantMessage.status = 'stopped'
        assistantMessage.error = '已停止生成'
      } else if (assistantMessage.text.trim()) {
        assistantMessage.status = 'error'
        assistantMessage.error = `响应中断：${message}`
      } else {
        assistantMessage.status = 'error'
        assistantMessage.error = message
      }

      console.error('Failed to request model:', err)
    } finally {
      clearStreamIdleTimer()
      if (currentAbortController.value === controller) {
        currentAbortController.value = null
        currentRequestId.value = null
        abortReason.value = null
      }

      const shouldFollow = options.shouldFollowNewContent()
      await options.followNewContent(shouldFollow)
    }
  }

  async function stopGenerating() {
    if (isStopping.value) {
      return
    }

    const controller = currentAbortController.value
    const requestId = currentRequestId.value

    if (!controller && !requestId) {
      return
    }

    isStopping.value = true

    try {
      abortReason.value = 'manual'
      controller?.abort()

      if (requestId) {
        await cancelActiveRequest(requestId)
      }
    } finally {
      isStopping.value = false
    }
  }

  async function copyMessage(message: ChatMessage) {
    if (!message.text.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(message.text)
      copiedMessageId.value = message.id
      window.setTimeout(() => {
        if (copiedMessageId.value === message.id) {
          copiedMessageId.value = null
        }
      }, 1600)
    } catch {
      await options.showError('复制失败，请手动选择文本复制')
    }
  }

  async function retryMessage(index: number) {
    if (isResponding.value || isStopping.value) {
      return
    }

    const failedMessage = options.messages.value[index]

    if (!failedMessage || failedMessage.role !== 'assistant' || failedMessage.status !== 'error') {
      return
    }

    const previousQuestion = [...options.messages.value]
      .slice(0, index)
      .reverse()
      .find((msg) => msg.role === 'user')

    if (!previousQuestion) {
      return
    }

    options.messages.value.splice(index, 1)
    await submitQuestion(previousQuestion.text, {
      appendUser: false,
      clearComposer: false,
      assistantInsertIndex: index,
    })
  }

  return {
    copiedMessageId,
    copyMessage,
    isResponding,
    isStopping,
    retryMessage,
    stopGenerating,
    submitQuestion,
  }
}
