import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'

import {
  cancelRequest as cancelRequestApi,
  requestConversationAnswer as requestConversationAnswerApi,
  type RequestCancellationReason,
} from '#api/conversations'
import { readChatStream } from '#api/readChatStream'
import {
  createInitialChatStreamState,
  finalizeChatStreamState,
  interruptChatStreamState,
  reduceChatStreamEvent,
  type ChatStreamState,
} from '../reducers/chatStreamReducer'
import type { ConversationAction } from '../reducers/conversationReducer'
import type { ChatMessage, ConversationDetail, ModelRequestOptions } from '#types/chat'

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_COPY_RESET_MS = 1_600

export type SubmitQuestionOptions = {
  appendUser: boolean
  clearComposer: boolean
  assistantInsertIndex?: number
  conversationId?: string
}

export type UseChatStreamOptions = {
  cancelRequest?: typeof cancelRequestApi
  clearComposer?: () => void
  conversationId: string | null
  copyResetMs?: number
  createConversation: () => Promise<ConversationDetail>
  createMessageId?: () => string
  createRequestId?: () => string
  dispatch: Dispatch<ConversationAction>
  followNewContent?: (shouldFollow: boolean) => Promise<void> | void
  getModelOptions: () => ModelRequestOptions
  idleTimeoutMs?: number
  logError?: (message: string, error: unknown) => void
  messages: ChatMessage[]
  now?: () => number
  reconcileConversation: (conversationId: string) => Promise<void>
  refreshConversationList: () => Promise<void>
  requestConversationAnswer?: typeof requestConversationAnswerApi
  resizeComposer?: () => void
  shouldFollowNewContent?: () => boolean
  showError?: (message: string) => Promise<void> | void
  writeClipboard?: (text: string) => Promise<void>
}

type AbortReason = RequestCancellationReason | null

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function writeClipboard(text: string) {
  if (!navigator.clipboard) {
    throw new Error('Clipboard API unavailable')
  }

  await navigator.clipboard.writeText(text)
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '响应失败，请重试'
}

function toAssistantMessage(id: string, state: ChatStreamState): ChatMessage {
  return {
    id,
    role: 'assistant',
    text: state.text,
    reasoningText: state.reasoningText,
    reasoningDurationMs: state.reasoningDurationMs,
    status: state.status,
    error: state.error,
    toolActivities: state.toolActivities,
  }
}

export function useChatStream(options: UseChatStreamOptions) {
  const optionsRef = useRef(options)
  const messagesRef = useRef(options.messages)
  const mountedRef = useRef(true)
  const requestInFlightRef = useRef(false)
  const isStoppingRef = useRef(false)
  const currentAbortControllerRef = useRef<AbortController | null>(null)
  const currentRequestIdRef = useRef<string | null>(null)
  const abortReasonRef = useRef<AbortReason>(null)
  const activeStreamStateRef = useRef<ChatStreamState | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)
  const cancelledRequestIdsRef = useRef(new Set<string>())
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [isRequestActive, setIsRequestActive] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  optionsRef.current = options
  messagesRef.current = options.messages

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const clearCopiedTimer = useCallback(() => {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = null
    }
  }, [])

  const logError = useCallback((message: string, error: unknown) => {
    const logger = optionsRef.current.logError
    if (logger) {
      logger(message, error)
    } else {
      console.error(message, error)
    }
  }, [])

  const cancelActiveRequest = useCallback(
    async (requestId: string, reason: RequestCancellationReason) => {
      if (cancelledRequestIdsRef.current.has(requestId)) {
        return
      }

      cancelledRequestIdsRef.current.add(requestId)
      try {
        await (optionsRef.current.cancelRequest ?? cancelRequestApi)(requestId, reason)
      } catch (error) {
        logError('Failed to cancel active request:', error)
      }
    },
    [logError],
  )

  const cancelWithDeadline = useCallback(
    async (requestId: string, reason: RequestCancellationReason) => {
      let timerId: number | null = null
      try {
        await Promise.race([
          cancelActiveRequest(requestId, reason),
          new Promise<void>((resolve) => {
            timerId = window.setTimeout(resolve, 500)
          }),
        ])
      } finally {
        if (timerId !== null) {
          window.clearTimeout(timerId)
        }
      }
    },
    [cancelActiveRequest],
  )

  const followNewContent = useCallback((shouldFollow: boolean) => {
    try {
      const result = optionsRef.current.followNewContent?.(shouldFollow)
      void Promise.resolve(result).catch((error) => {
        logError('Failed to follow streamed content:', error)
      })
    } catch (error) {
      logError('Failed to follow streamed content:', error)
    }
  }, [logError])

  const replaceAssistantMessage = useCallback((id: string, state: ChatStreamState) => {
    if (!mountedRef.current) {
      return
    }

    optionsRef.current.dispatch({
      type: 'replace-message',
      message: toAssistantMessage(id, state),
    })
  }, [])

  const resetIdleTimer = useCallback(
    (controller: AbortController, requestId: string) => {
      clearIdleTimer()
      const timeoutMs =
        optionsRef.current.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS

      idleTimerRef.current = window.setTimeout(() => {
        if (
          currentAbortControllerRef.current !== controller ||
          currentRequestIdRef.current !== requestId
        ) {
          return
        }

        abortReasonRef.current = 'timeout'
        controller.abort()
        void cancelActiveRequest(requestId, 'timeout')
      }, timeoutMs)
    },
    [cancelActiveRequest, clearIdleTimer],
  )

  const submitQuestion = useCallback(
    async (question: string, submitOptions: SubmitQuestionOptions) => {
      const normalizedQuestion = question.trim()
      if (!normalizedQuestion || requestInFlightRef.current || isStoppingRef.current) {
        return
      }

      requestInFlightRef.current = true
      if (mountedRef.current) {
        setIsRequestActive(true)
      }

      let assistantId: string | null = null
      let controller: AbortController | null = null
      let requestId: string | null = null
      let conversationId = submitOptions.conversationId ?? optionsRef.current.conversationId

      try {
        const currentOptions = optionsRef.current

        if (!conversationId) {
          const conversation = await currentOptions.createConversation()
          conversationId = conversation.id
        }

        const shouldFollow = currentOptions.shouldFollowNewContent?.() ?? true
        const nextMessageId = currentOptions.createMessageId ?? createMessageId

        if (submitOptions.appendUser) {
          currentOptions.dispatch({
            type: 'append-message',
            message: {
              id: nextMessageId(),
              role: 'user',
              text: normalizedQuestion,
              status: 'done',
            },
          })
        }

        assistantId = nextMessageId()
        const initialStreamState = createInitialChatStreamState()
        activeStreamStateRef.current = initialStreamState
        const assistantMessage = toAssistantMessage(assistantId, initialStreamState)

        if (typeof submitOptions.assistantInsertIndex === 'number') {
          currentOptions.dispatch({
            type: 'insert-message',
            index: submitOptions.assistantInsertIndex,
            message: assistantMessage,
          })
        } else {
          currentOptions.dispatch({ type: 'append-message', message: assistantMessage })
        }

        if (submitOptions.clearComposer) {
          currentOptions.clearComposer?.()
        }

        await Promise.resolve()
        currentOptions.resizeComposer?.()
        followNewContent(shouldFollow)

        controller = new AbortController()
        requestId = (currentOptions.createRequestId ?? createRequestId)()
        currentAbortControllerRef.current = controller
        currentRequestIdRef.current = requestId
        abortReasonRef.current = null
        resetIdleTimer(controller, requestId)

        const response = await (
          currentOptions.requestConversationAnswer ?? requestConversationAnswerApi
        )({
          conversationId,
          question: normalizedQuestion,
          requestId,
          signal: controller.signal,
          options: currentOptions.getModelOptions(),
        })

        await readChatStream({
          response,
          onChunk: () => {
            if (controller && requestId) {
              resetIdleTimer(controller, requestId)
            }
          },
          onEvent: (event) => {
            const previousState = activeStreamStateRef.current
            if (!previousState || !assistantId) {
              return
            }

            const nextState = reduceChatStreamEvent(
              previousState,
              event,
              (optionsRef.current.now ?? Date.now)(),
            )
            activeStreamStateRef.current = nextState
            replaceAssistantMessage(assistantId, nextState)

            if (event.type === 'error') {
              throw new Error(event.message || '模型响应失败')
            }

            followNewContent(optionsRef.current.shouldFollowNewContent?.() ?? true)
          },
        })
        clearIdleTimer()

        const streamState = activeStreamStateRef.current
        if (!streamState || !assistantId) {
          throw new Error('响应状态丢失')
        }

        const finalState = finalizeChatStreamState(
          streamState,
          (optionsRef.current.now ?? Date.now)(),
        )
        activeStreamStateRef.current = finalState
        replaceAssistantMessage(assistantId, finalState)
        try {
          await optionsRef.current.reconcileConversation(conversationId)
        } catch (reconcileError) {
          logError('Failed to reconcile conversation after streaming:', reconcileError)
        }
      } catch (error) {
        const abortReason = abortReasonRef.current
        const streamState = activeStreamStateRef.current

        if (abortReason === 'unmount' || abortReason === 'transition' || !mountedRef.current) {
          return
        }

        if (!assistantId || !streamState) {
          logError('Failed to prepare model request:', error)
          await optionsRef.current.showError?.(toErrorMessage(error))
          return
        }

        const aborted = isAbortError(error)
        const manualAbort = aborted && abortReason === 'manual'
        const message = aborted
          ? manualAbort
            ? '已停止生成'
            : '响应超时或连接中断'
          : toErrorMessage(error)
        const interruptedState = interruptChatStreamState(
          streamState,
          message,
          manualAbort ? 'manual' : 'error',
        )
        activeStreamStateRef.current = interruptedState
        replaceAssistantMessage(assistantId, interruptedState)

        if (!manualAbort) {
          logError('Failed to request model:', error)
        } else {
          try {
            await optionsRef.current.refreshConversationList()
          } catch (refreshError) {
            logError('Failed to refresh conversations after stopping:', refreshError)
          }
        }
      } finally {
        clearIdleTimer()

        if (requestId) {
          cancelledRequestIdsRef.current.delete(requestId)
        }

        if (controller && currentAbortControllerRef.current === controller) {
          currentAbortControllerRef.current = null
          currentRequestIdRef.current = null
          abortReasonRef.current = null
        }

        activeStreamStateRef.current = null
        requestInFlightRef.current = false

        if (mountedRef.current) {
          setIsRequestActive(false)
          followNewContent(optionsRef.current.shouldFollowNewContent?.() ?? true)
        }
      }
    },
    [clearIdleTimer, followNewContent, logError, replaceAssistantMessage, resetIdleTimer],
  )

  const stopGenerating = useCallback(async (
    reason: Extract<RequestCancellationReason, 'manual' | 'transition'> = 'manual',
  ) => {
    if (isStoppingRef.current) {
      return
    }

    const controller = currentAbortControllerRef.current
    const requestId = currentRequestIdRef.current
    if (!controller && !requestId) {
      return
    }

    isStoppingRef.current = true
    if (mountedRef.current) {
      setIsStopping(true)
    }

    try {
      abortReasonRef.current = reason

      if (requestId) {
        await cancelWithDeadline(requestId, reason)
      }
      controller?.abort()
    } finally {
      isStoppingRef.current = false
      if (mountedRef.current) {
        setIsStopping(false)
      }
    }
  }, [cancelWithDeadline])

  const copyMessage = useCallback(
    async (message: ChatMessage) => {
      if (!message.text.trim()) {
        return
      }

      try {
        await (optionsRef.current.writeClipboard ?? writeClipboard)(message.text)
        if (!mountedRef.current) {
          return
        }

        clearCopiedTimer()
        setCopiedMessageId(message.id)
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = null
          if (mountedRef.current) {
            setCopiedMessageId((currentId) =>
              currentId === message.id ? null : currentId,
            )
          }
        }, optionsRef.current.copyResetMs ?? DEFAULT_COPY_RESET_MS)
      } catch {
        await optionsRef.current.showError?.('复制失败，请手动选择文本复制')
      }
    },
    [clearCopiedTimer],
  )

  const retryMessage = useCallback(
    async (index: number) => {
      if (requestInFlightRef.current || isStoppingRef.current) {
        return
      }

      const messages = messagesRef.current
      const failedMessage = messages[index]
      if (
        !failedMessage ||
        failedMessage.role !== 'assistant' ||
        failedMessage.status !== 'error'
      ) {
        return
      }

      const previousQuestion = [...messages]
        .slice(0, index)
        .reverse()
        .find((message) => message.role === 'user')
      if (!previousQuestion) {
        return
      }

      optionsRef.current.dispatch({ type: 'remove-message', messageId: failedMessage.id })
      await submitQuestion(previousQuestion.text, {
        appendUser: false,
        clearComposer: false,
        assistantInsertIndex: index,
      })
    },
    [submitQuestion],
  )

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      clearIdleTimer()
      clearCopiedTimer()

      const controller = currentAbortControllerRef.current
      const requestId = currentRequestIdRef.current
      if (controller || requestId) {
        abortReasonRef.current = 'unmount'
        controller?.abort()
        if (requestId) {
          void cancelActiveRequest(requestId, 'unmount')
        }
      }
    }
  }, [cancelActiveRequest, clearCopiedTimer, clearIdleTimer])

  const isResponding =
    isRequestActive ||
    options.messages.some(
      (message) =>
        message.role === 'assistant' &&
        (message.status === 'pending' || message.status === 'streaming'),
    )

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
