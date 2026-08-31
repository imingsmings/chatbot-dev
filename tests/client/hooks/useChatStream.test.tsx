import { useReducer } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  conversationReducer,
  createInitialConversationState,
} from '../../../client/src/reducers/conversationReducer'
import type { ChatMessage, ConversationDetail } from '../../../client/src/types/chat'
import {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  type ChatStreamEvent,
} from '../../../client/src/utils/streamProtocol'
import { useChatStream, type UseChatStreamOptions } from '../../../client/src/hooks/useChatStream'

type HarnessOptions = Omit<UseChatStreamOptions, 'dispatch' | 'messages'>
type RequestAnswer = NonNullable<UseChatStreamOptions['requestConversationAnswer']>
type CancelRequest = NonNullable<UseChatStreamOptions['cancelRequest']>

function createConversation(id = 'conversation-1'): ConversationDetail {
  return {
    id,
    title: '测试会话',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    messageCount: 0,
    messages: [],
  }
}

function imageAttachment() {
  return {
    id: 'att_00000000-0000-4000-8000-000000000001',
    kind: 'image' as const,
    filename: 'vision.png',
    mediaType: 'image/png' as const,
    byteSize: 68,
    width: 1,
    height: 1,
    detail: 'auto' as const,
  }
}

function responseHeaders() {
  return {
    [CHAT_STREAM_PROTOCOL_HEADER]: CHAT_STREAM_PROTOCOL_VERSION,
  }
}

function responseFromEvents(events: ChatStreamEvent[]) {
  const payload = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    }),
    { status: 200, headers: responseHeaders() },
  )
}

function createControlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController
      },
    }),
    { status: 200, headers: responseHeaders() },
  )

  return {
    response,
    emit(events: ChatStreamEvent[]) {
      const payload = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
      controller.enqueue(new TextEncoder().encode(payload))
    },
    close() {
      controller.close()
    },
  }
}

function createAbortableResponse(signal: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController
        const abort = () => {
          nextController.error(new DOMException('Aborted', 'AbortError'))
        }

        if (signal.aborted) {
          abort()
        } else {
          signal.addEventListener('abort', abort, { once: true })
        }
      },
    }),
    { status: 200, headers: responseHeaders() },
  )

  return {
    response,
    emit(events: ChatStreamEvent[]) {
      const payload = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
      controller.enqueue(new TextEncoder().encode(payload))
    },
  }
}

function createHarnessOptions(overrides: Partial<HarnessOptions> = {}): HarnessOptions {
  let messageSequence = 0
  const requestConversationAnswer = vi
    .fn<RequestAnswer>()
    .mockResolvedValue(
      responseFromEvents([
        { type: 'delta', content: '默认答案' },
        { type: 'done' },
      ]),
    )

  return {
    cancelRequest: vi.fn<CancelRequest>().mockResolvedValue(true),
    conversationId: 'conversation-1',
    createConversation:
      vi.fn<UseChatStreamOptions['createConversation']>().mockResolvedValue(
        createConversation(),
      ),
    createMessageId: () => `message-${++messageSequence}`,
    createRequestId: () => 'request-1',
    getModelOptions: () => ({ reasoningEnabled: true }),
    logError: vi.fn<(message: string, error: unknown) => void>(),
    reconcileConversation:
      vi.fn<(conversationId: string) => Promise<void>>().mockResolvedValue(undefined),
    refreshConversationList: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    requestConversationAnswer,
    ...overrides,
  }
}

function renderStreamHook(options: HarnessOptions, initialMessages: ChatMessage[] = []) {
  return renderHook(() => {
    const [state, dispatch] = useReducer(conversationReducer, undefined, () => ({
      ...createInitialConversationState(),
      messages: initialMessages,
    }))
    const stream = useChatStream({ ...options, dispatch, messages: state.messages })

    return {
      ...stream,
      messages: state.messages,
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
  delete window.__chatbotPerformanceDiagnostics
})

describe('useChatStream', () => {
  it('batches a burst of text events while exposing the first text immediately', async () => {
    window.__chatbotPerformanceDiagnostics = { enabled: true, marks: [] }
    const controlled = createControlledResponse()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(controlled.response)
    const { result } = renderStreamHook(createHarnessOptions({ requestConversationAnswer }))

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('批处理测试', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(requestConversationAnswer).toHaveBeenCalledOnce())

    const events = Array.from({ length: 51 }, (_, index) => ({
      type: 'delta' as const,
      content: String(index % 10),
    }))
    await act(async () => {
      controlled.emit(events)
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.messages[1]?.text).toBe('0'))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 60))
    })

    expect(result.current.messages[1]?.text).toBe(events.map((event) => event.content).join(''))
    const marksBeforeDone = window.__chatbotPerformanceDiagnostics.marks
    expect(marksBeforeDone.filter((mark) => mark.name === 'stream-event')).toHaveLength(51)
    expect(marksBeforeDone.filter((mark) => mark.name === 'assistant-update')).toHaveLength(2)

    await act(async () => {
      controlled.emit([{ type: 'done' }])
      await submission
    })
    expect(result.current.messages[1]).toMatchObject({ status: 'done' })
  })

  it('keeps tool preamble out of text and exposes delta before done', async () => {
    const controlled = createControlledResponse()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(controlled.response)
    const reconcileConversation = vi
      .fn<(conversationId: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer, reconcileConversation }),
    )

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('测试问题', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      controlled.emit([
        { type: 'reasoning_delta', content: '先分析' },
        { type: 'tool_start', toolCallId: 'call-1', name: 'calculate' },
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          name: 'calculate',
          summary: '42',
          success: true,
        },
      ])
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.messages[1]).toMatchObject({
        text: '',
        reasoningText: '先分析',
        status: 'streaming',
        toolActivities: [
          { id: 'call-1', name: 'calculate', status: 'success', summary: '42' },
        ],
      })
    })

    await act(async () => {
      controlled.emit([{ type: 'delta', content: '最终答案' }])
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.messages[1]).toMatchObject({
        text: '最终答案',
        status: 'streaming',
      })
    })
    expect(reconcileConversation).not.toHaveBeenCalled()

    await act(async () => {
      controlled.emit([{ type: 'done', reasoningDurationMs: 240 }])
      await submission
    })

    expect(result.current.messages[1]).toMatchObject({
      text: '最终答案',
      reasoningDurationMs: 240,
      status: 'done',
    })
    expect(reconcileConversation).toHaveBeenCalledWith('conversation-1')
    expect(requestConversationAnswer).toHaveBeenCalledTimes(1)
  })

  it('can target a newly selected branch before controller state catches up', async () => {
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(
        responseFromEvents([
          { type: 'delta', content: '分支回答' },
          { type: 'done' },
        ]),
      )
    const { result } = renderStreamHook(
      createHarnessOptions({
        conversationId: 'source-1',
        requestConversationAnswer,
      }),
    )

    await act(async () => {
      await result.current.submitQuestion('编辑后的问题', {
        appendUser: true,
        clearComposer: false,
        conversationId: 'branch-1',
      })
    })

    expect(requestConversationAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'branch-1',
        question: '编辑后的问题',
      }),
    )
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', text: '编辑后的问题' }),
      expect.objectContaining({ role: 'assistant', text: '分支回答', status: 'done' }),
    ])
  })

  it('submits image-only messages and forwards attachment ids while preserving optimistic metadata', async () => {
    const attachment = imageAttachment()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(responseFromEvents([
        { type: 'delta', content: '图片答案' },
        { type: 'done' },
      ]))
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer }),
    )

    await act(async () => {
      await result.current.submitQuestion('', {
        appendUser: true,
        attachments: [attachment],
        clearComposer: true,
      })
    })

    expect(requestConversationAnswer).toHaveBeenCalledWith(expect.objectContaining({
      attachmentIds: [attachment.id],
      question: '',
    }))
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: '',
      attachments: [attachment],
    })
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      status: 'done',
      text: '图片答案',
    })
  })

  it('retries failed image messages with the original attachment ids', async () => {
    const attachment = imageAttachment()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValueOnce(responseFromEvents([{ type: 'error', message: '第一次失败' }]))
      .mockResolvedValueOnce(responseFromEvents([
        { type: 'delta', content: '重试成功' },
        { type: 'done' },
      ]))
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer }),
    )

    await act(async () => {
      await result.current.submitQuestion('', {
        appendUser: true,
        attachments: [attachment],
        clearComposer: true,
      })
    })
    expect(result.current.messages[1]).toMatchObject({ status: 'error' })

    await act(async () => {
      await result.current.retryMessage(1)
    })

    expect(requestConversationAnswer).toHaveBeenCalledTimes(2)
    expect(requestConversationAnswer.mock.calls[1]?.[0]).toMatchObject({
      attachmentIds: [attachment.id],
      question: '',
    })
    expect(result.current.messages.at(-1)).toMatchObject({
      status: 'done',
      text: '重试成功',
    })
  })

  it('sends one manual cancel and settles a running tool as stopped', async () => {
    let capturedSignal!: AbortSignal
    let abortable!: ReturnType<typeof createAbortableResponse>
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(async ({ signal }) => {
        capturedSignal = signal
        abortable = createAbortableResponse(signal)
        return abortable.response
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(true)
    const options = createHarnessOptions({ cancelRequest, requestConversationAnswer })
    const { result } = renderStreamHook(options)

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('停止测试', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(requestConversationAnswer).toHaveBeenCalledTimes(1))

    await act(async () => {
      abortable.emit([{ type: 'tool_start', toolCallId: 'call-1', name: 'weather' }])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.messages[1]?.toolActivities?.[0]?.status).toBe('running')
    })

    await act(async () => {
      await Promise.all([
        result.current.stopGenerating(),
        result.current.stopGenerating(),
      ])
      await submission
    })

    expect(capturedSignal.aborted).toBe(true)
    expect(cancelRequest).toHaveBeenCalledTimes(1)
    expect(cancelRequest).toHaveBeenCalledWith('request-1', 'manual')
    expect(options.reconcileConversation).toHaveBeenCalledWith('conversation-1')
    expect(result.current.messages[1]).toMatchObject({
      status: 'stopped',
      error: '已停止生成',
      toolActivities: [
        {
          id: 'call-1',
          name: 'weather',
          status: 'stopped',
          summary: '已停止',
        },
      ],
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('classifies a server-closed stream as manually stopped after cleanup completes', async () => {
    const controlled = createControlledResponse()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(controlled.response)
    const cancelRequest = vi.fn<CancelRequest>().mockImplementation(async () => {
      controlled.close()
      return true
    })
    const options = createHarnessOptions({ cancelRequest, requestConversationAnswer })
    const { result } = renderStreamHook(options)

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('服务端先关闭', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(requestConversationAnswer).toHaveBeenCalledOnce())

    await act(async () => {
      controlled.emit([{ type: 'delta', content: '部分回答' }])
      await result.current.stopGenerating()
      await submission
    })

    expect(result.current.messages[1]).toMatchObject({
      error: '已停止生成',
      status: 'stopped',
      text: '部分回答',
    })
    expect(options.reconcileConversation).toHaveBeenCalledWith('conversation-1')
    expect(options.refreshConversationList).not.toHaveBeenCalled()
  })

  it('keeps the local stopped state when cancellation cleanup is not confirmed', async () => {
    let abortable!: ReturnType<typeof createAbortableResponse>
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(async ({ signal }) => {
        abortable = createAbortableResponse(signal)
        return abortable.response
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(false)
    const options = createHarnessOptions({ cancelRequest, requestConversationAnswer })
    const { result } = renderStreamHook(options)

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('取消未确认', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(requestConversationAnswer).toHaveBeenCalledOnce())

    await act(async () => {
      abortable.emit([{ type: 'delta', content: '本地部分回答' }])
      await result.current.stopGenerating()
      await submission
    })

    expect(result.current.messages[1]).toMatchObject({
      status: 'stopped',
      text: '本地部分回答',
    })
    expect(options.reconcileConversation).not.toHaveBeenCalled()
    expect(options.refreshConversationList).toHaveBeenCalledOnce()
  })

  it('times out an idle stream, cancels upstream and returns to a recoverable state', async () => {
    let capturedSignal!: AbortSignal
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(async ({ signal }) => {
        capturedSignal = signal
        return createAbortableResponse(signal).response
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(true)
    const { result } = renderStreamHook(
      createHarnessOptions({
        cancelRequest,
        idleTimeoutMs: 20,
        requestConversationAnswer,
      }),
    )

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('超时测试', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.messages[1]).toMatchObject({
        status: 'error',
        error: '响应超时或连接中断',
      })
    })
    await act(async () => {
      await submission
    })

    expect(capturedSignal.aborted).toBe(true)
    expect(cancelRequest).toHaveBeenCalledTimes(1)
    expect(cancelRequest).toHaveBeenCalledWith('request-1', 'timeout')
    expect(result.current.isResponding).toBe(false)
  })

  it('keeps sending locked until timeout cancellation reaches a server terminal state', async () => {
    let capturedSignal!: AbortSignal
    let resolveCancellation!: (completed: boolean) => void
    const cancellation = new Promise<boolean>((resolve) => {
      resolveCancellation = resolve
    })
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementationOnce(async ({ signal }) => {
        capturedSignal = signal
        return createAbortableResponse(signal).response
      })
      .mockResolvedValueOnce(responseFromEvents([
        { type: 'delta', content: '释放后成功' },
        { type: 'done' },
      ]))
    const cancelRequest = vi.fn<CancelRequest>().mockReturnValue(cancellation)
    const getRequestResult = vi.fn().mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      status: 'processing',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    })
    let requestSequence = 0
    const { result } = renderStreamHook(createHarnessOptions({
      cancelRequest,
      createRequestId: () => `request-${++requestSequence}`,
      getRequestResult,
      idleTimeoutMs: 20,
      requestConversationAnswer,
    }))

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('等待取消释放', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.messages[1]).toMatchObject({
        status: 'error',
        error: '响应超时或连接中断',
      })
    })

    expect(capturedSignal.aborted).toBe(true)
    expect(result.current.isResponding).toBe(true)
    await act(async () => {
      await result.current.submitQuestion('取消未完成时不得发送', {
        appendUser: true,
        clearComposer: true,
      })
    })
    expect(requestConversationAnswer).toHaveBeenCalledOnce()

    await act(async () => {
      resolveCancellation(true)
      await submission
    })
    expect(result.current.isResponding).toBe(false)

    await act(async () => {
      await result.current.submitQuestion('释放后发送', {
        appendUser: true,
        clearComposer: true,
      })
    })
    expect(requestConversationAnswer).toHaveBeenCalledTimes(2)
    expect(result.current.messages.at(-1)).toMatchObject({
      status: 'done',
      text: '释放后成功',
    })
  })

  it('times out while waiting for response headers and cancels the backend request', async () => {
    let capturedSignal!: AbortSignal
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(({ signal }) => {
        capturedSignal = signal
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(true)
    const { result } = renderStreamHook(
      createHarnessOptions({
        cancelRequest,
        idleTimeoutMs: 20,
        requestConversationAnswer,
      }),
    )

    await act(async () => {
      await result.current.submitQuestion('首包超时', {
        appendUser: true,
        clearComposer: true,
      })
    })

    expect(capturedSignal.aborted).toBe(true)
    expect(cancelRequest).toHaveBeenCalledOnce()
    expect(cancelRequest).toHaveBeenCalledWith('request-1', 'timeout')
    expect(result.current.messages[1]).toMatchObject({
      status: 'error',
      error: '响应超时或连接中断',
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('accepts a new request after a protocol error', async () => {
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValueOnce(
        responseFromEvents([{ type: 'error', message: '第一次失败' }]),
      )
      .mockResolvedValueOnce(
        responseFromEvents([
          { type: 'delta', content: '第二次成功' },
          { type: 'done' },
        ]),
      )
    const reconcileConversation = vi
      .fn<(conversationId: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer, reconcileConversation }),
    )

    await act(async () => {
      await result.current.submitQuestion('第一次', {
        appendUser: true,
        clearComposer: true,
      })
    })
    expect(result.current.messages[1]).toMatchObject({
      status: 'error',
      error: '第一次失败',
    })

    await act(async () => {
      await result.current.submitQuestion('第二次', {
        appendUser: true,
        clearComposer: true,
      })
    })

    expect(result.current.messages.at(-1)).toMatchObject({
      text: '第二次成功',
      status: 'done',
    })
    expect(requestConversationAnswer).toHaveBeenCalledTimes(2)
    expect(reconcileConversation).toHaveBeenCalledWith('conversation-1')
    expect(result.current.isResponding).toBe(false)
  })

  it('recovers a persisted answer when the stream closes before done', async () => {
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(responseFromEvents([{ type: 'delta', content: '已持久化答案' }]))
    const getRequestResult = vi.fn().mockResolvedValue({
      requestId: 'request-1',
      conversationId: 'conversation-1',
      status: 'completed',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:01.000Z',
      messageStartIndex: 0,
      messageCount: 2
    })
    const reconcileConversation = vi.fn().mockResolvedValue(undefined)
    const { result } = renderStreamHook(createHarnessOptions({
      getRequestResult,
      reconcileConversation,
      requestConversationAnswer
    }))

    await act(async () => {
      await result.current.submitQuestion('恢复丢失的 done', {
        appendUser: true,
        clearComposer: true
      })
    })

    expect(getRequestResult).toHaveBeenCalledWith('request-1')
    expect(reconcileConversation).toHaveBeenCalledWith('conversation-1')
    expect(result.current.messages[1]).toMatchObject({
      text: '已持久化答案',
      status: 'done'
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('keeps a completed answer done when conversation-list refresh fails', async () => {
    const refreshError = new Error('refresh failed')
    const reconcileConversation = vi
      .fn<(conversationId: string) => Promise<void>>()
      .mockRejectedValue(refreshError)
    const logError = vi.fn<(message: string, error: unknown) => void>()
    const { result } = renderStreamHook(
      createHarnessOptions({ reconcileConversation, logError }),
    )

    await act(async () => {
      await result.current.submitQuestion('刷新失败不影响答案', {
        appendUser: true,
        clearComposer: true,
      })
    })

    expect(result.current.messages.at(-1)).toMatchObject({
      text: '默认答案',
      status: 'done',
    })
    expect(logError).toHaveBeenCalledWith(
      'Failed to reconcile conversation after streaming:',
      refreshError,
    )
    expect(result.current.isResponding).toBe(false)
  })

  it('aborts and cancels an active request during unmount cleanup', async () => {
    let capturedSignal!: AbortSignal
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(async ({ signal }) => {
        capturedSignal = signal
        return createAbortableResponse(signal).response
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(true)
    const { result, unmount } = renderStreamHook(
      createHarnessOptions({
        cancelRequest,
        idleTimeoutMs: 10_000,
        requestConversationAnswer,
      }),
    )

    let submission!: Promise<void>
    await act(async () => {
      submission = result.current.submitQuestion('卸载测试', {
        appendUser: true,
        clearComposer: true,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(requestConversationAnswer).toHaveBeenCalledTimes(1))

    unmount()
    await submission

    expect(capturedSignal.aborted).toBe(true)
    expect(cancelRequest).toHaveBeenCalledTimes(1)
    expect(cancelRequest).toHaveBeenCalledWith('request-1', 'unmount')
  })

  it('clears the copied-message timer on unmount', async () => {
    vi.useFakeTimers()
    const writeClipboard = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { result, unmount } = renderStreamHook(
      createHarnessOptions({ copyResetMs: 1_600, writeClipboard }),
    )
    const message: ChatMessage = {
      id: 'copy-message',
      role: 'assistant',
      text: '可复制内容',
      status: 'done',
    }

    await act(async () => {
      await result.current.copyMessage(message)
    })

    expect(result.current.copiedMessageId).toBe('copy-message')
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
