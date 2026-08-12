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
    cancelRequest: vi.fn<CancelRequest>().mockResolvedValue(undefined),
    conversationId: 'conversation-1',
    createConversation:
      vi.fn<UseChatStreamOptions['createConversation']>().mockResolvedValue(
        createConversation(),
      ),
    createMessageId: () => `message-${++messageSequence}`,
    createRequestId: () => 'request-1',
    getModelOptions: () => ({ reasoningEnabled: true }),
    logError: vi.fn<(message: string, error: unknown) => void>(),
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
})

describe('useChatStream', () => {
  it('keeps tool preamble out of text and exposes delta before done', async () => {
    const controlled = createControlledResponse()
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockResolvedValue(controlled.response)
    const refreshConversationList = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer, refreshConversationList }),
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
    expect(refreshConversationList).not.toHaveBeenCalled()

    await act(async () => {
      controlled.emit([{ type: 'done', reasoningDurationMs: 240 }])
      await submission
    })

    expect(result.current.messages[1]).toMatchObject({
      text: '最终答案',
      reasoningDurationMs: 240,
      status: 'done',
    })
    expect(refreshConversationList).toHaveBeenCalledTimes(1)
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
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(undefined)
    const { result } = renderStreamHook(
      createHarnessOptions({ cancelRequest, requestConversationAnswer }),
    )

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

  it('times out an idle stream, cancels upstream and returns to a recoverable state', async () => {
    let capturedSignal!: AbortSignal
    const requestConversationAnswer = vi
      .fn<RequestAnswer>()
      .mockImplementation(async ({ signal }) => {
        capturedSignal = signal
        return createAbortableResponse(signal).response
      })
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(undefined)
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
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(undefined)
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
    const refreshConversationList = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const { result } = renderStreamHook(
      createHarnessOptions({ requestConversationAnswer, refreshConversationList }),
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
    expect(refreshConversationList).toHaveBeenCalledTimes(1)
    expect(result.current.isResponding).toBe(false)
  })

  it('keeps a completed answer done when conversation-list refresh fails', async () => {
    const refreshError = new Error('refresh failed')
    const refreshConversationList = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(refreshError)
    const logError = vi.fn<(message: string, error: unknown) => void>()
    const { result } = renderStreamHook(
      createHarnessOptions({ refreshConversationList, logError }),
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
      'Failed to refresh conversations after streaming:',
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
    const cancelRequest = vi.fn<CancelRequest>().mockResolvedValue(undefined)
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
