import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react'

import {
  cancelRequest as cancelRequestApi,
  getRequestResult as getRequestResultApi,
  requestConversationAnswer as requestConversationAnswerApi,
  type RequestCancellationReason,
} from '#api/conversations'
import { readChatStream } from '#api/readChatStream'
import {
  createInitialChatStreamState,
  finalizeChatStreamState,
  interruptChatStreamState,
  reduceChatStreamEvents,
  type ChatStreamState,
} from '../reducers/chatStreamReducer'
import type { ConversationAction } from '../reducers/conversationReducer'
import type {
  ChatMessage,
  ConversationDetail,
  ImageAttachment,
  ModelRequestOptions,
} from '#types/chat'
import { recordChatPerformance } from '#utils/chatPerformanceDiagnostics'
import { createChatStreamEventBuffer } from '#utils/chatStreamEventBuffer'

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000
const DEFAULT_COPY_RESET_MS = 1_600

export type SubmitQuestionOptions = {
  appendUser: boolean
  clearComposer: boolean
  assistantInsertIndex?: number
  conversationId?: string
  attachments?: ImageAttachment[]
}

export type UseChatStreamOptions = {
  cancelRequest?: typeof cancelRequestApi
  canStartRequest?: () => boolean
  clearComposer?: () => void
  conversationId: string | null
  copyResetMs?: number
  createConversation: () => Promise<ConversationDetail>
  createMessageId?: () => string
  createRequestId?: () => string
  dispatch: Dispatch<ConversationAction>
  followNewContent?: (shouldFollow: boolean) => Promise<void> | void
  getModelOptions: () => ModelRequestOptions
  getRequestResult?: typeof getRequestResultApi
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
  const activeEventBufferRef = useRef<ReturnType<typeof createChatStreamEventBuffer> | null>(null)
  const cancellationCompletionRef = useRef<Promise<boolean> | null>(null)
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
    async (requestId: string, reason: RequestCancellationReason): Promise<boolean> => {
      if (cancelledRequestIdsRef.current.has(requestId)) {
        return false
      }

      cancelledRequestIdsRef.current.add(requestId)
      try {
        return await (optionsRef.current.cancelRequest ?? cancelRequestApi)(requestId, reason)
      } catch (error) {
        logError('Failed to cancel active request:', error)
        return false
      }
    },
    [logError],
  )

  const cancelWithDeadline = useCallback(
    async (requestId: string, reason: RequestCancellationReason): Promise<boolean> => {
      let timerId: number | null = null
      try {
        return await Promise.race([
          cancelActiveRequest(requestId, reason),
          new Promise<boolean>((resolve) => {
            timerId = window.setTimeout(() => resolve(false), 500)
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

    recordChatPerformance('assistant-update', {
      messageId: id,
      reasoningLength: state.reasoningText.length,
      status: state.status,
      textLength: state.text.length,
    })
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
      const attachments = submitOptions.attachments ?? []
      if (
        (!normalizedQuestion && attachments.length === 0) ||
        requestInFlightRef.current ||
        isStoppingRef.current ||
        optionsRef.current.canStartRequest?.() === false
      ) {
        return
      }

      requestInFlightRef.current = true
      if (mountedRef.current) {
        setIsRequestActive(true)
      }

      let assistantId: string | null = null
      let controller: AbortController | null = null
      let requestId: string | null = null
      let eventBuffer: ReturnType<typeof createChatStreamEventBuffer> | null = null
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
              attachments: attachments.map((attachment) => ({ ...attachment })),
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
          attachmentIds: attachments.map(({ id }) => id),
        })

        eventBuffer = createChatStreamEventBuffer({
          onFlush: (events) => {
            const previousState = activeStreamStateRef.current
            if (!previousState || !assistantId) return

            const nextState = reduceChatStreamEvents(previousState, events)
            activeStreamStateRef.current = nextState
            replaceAssistantMessage(assistantId, nextState)
          },
        })
        activeEventBufferRef.current = eventBuffer

        await readChatStream({
          response,
          onChunk: () => {
            if (controller && requestId) {
              resetIdleTimer(controller, requestId)
            }
          },
          onEvent: (event) => {
            recordChatPerformance('stream-event', { type: event.type })
            eventBuffer?.push(event, (optionsRef.current.now ?? Date.now)())

            if (event.type === 'error') {
              throw new Error(event.message || '模型响应失败')
            }
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

        if (abortReason === 'unmount' || abortReason === 'transition' || !mountedRef.current) {
          eventBuffer?.dispose()
          return
        }

        eventBuffer?.flush()
        const streamState = activeStreamStateRef.current

        if (!assistantId || !streamState) {
          logError('Failed to prepare model request:', error)
          await optionsRef.current.showError?.(toErrorMessage(error))
          return
        }

        const aborted = isAbortError(error)
        const manualAbort = abortReason === 'manual'
        if (!manualAbort && requestId && conversationId) {
          try {
            const recovered = await (
              optionsRef.current.getRequestResult ?? getRequestResultApi
            )(requestId)
            if (recovered.conversationId === conversationId && (
              recovered.status === 'completed' || recovered.status === 'stopped'
            )) {
              eventBuffer?.dispose()
              if (recovered.status === 'completed' && streamState.text.trim()) {
                const recoveredState = finalizeChatStreamState(
                  { ...streamState, streamDone: true },
                  (optionsRef.current.now ?? Date.now)()
                )
                activeStreamStateRef.current = recoveredState
                replaceAssistantMessage(assistantId, recoveredState)
              } else if (recovered.status === 'stopped') {
                const recoveredState = interruptChatStreamState(
                  streamState,
                  '已停止生成',
                  'manual'
                )
                activeStreamStateRef.current = recoveredState
                replaceAssistantMessage(assistantId, recoveredState)
              }
              await optionsRef.current.reconcileConversation(conversationId)
              return
            }
          } catch (recoveryError) {
            logError('Failed to recover persisted request result:', recoveryError)
          }
        }
        const message = manualAbort
          ? '已停止生成'
          : aborted
            ? '响应超时或连接中断'
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
          const cancellationCompleted = await cancellationCompletionRef.current
          try {
            if (cancellationCompleted && conversationId) {
              await optionsRef.current.reconcileConversation(conversationId)
            } else {
              await optionsRef.current.refreshConversationList()
            }
          } catch (reconcileError) {
            logError('Failed to reconcile conversation after stopping:', reconcileError)
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
        eventBuffer?.dispose()
        if (activeEventBufferRef.current === eventBuffer) {
          activeEventBufferRef.current = null
        }
        cancellationCompletionRef.current = null
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
      if (reason === 'manual') {
        activeEventBufferRef.current?.flush()
      } else {
        activeEventBufferRef.current?.dispose()
      }

      const cancellationCompletion = requestId
        ? cancelWithDeadline(requestId, reason)
        : Promise.resolve(false)
      cancellationCompletionRef.current = cancellationCompletion
      await cancellationCompletion
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
        attachments: previousQuestion.attachments,
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
      activeEventBufferRef.current?.dispose()
      activeEventBufferRef.current = null

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
