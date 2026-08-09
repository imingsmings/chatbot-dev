import { StrictMode, type PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ConversationDetail } from '../../../client/src/types/chat'
import { useConversations, type ConversationsApi } from '../../../client/src/hooks/useConversations'

function createConversation(id: string): ConversationDetail {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    messageCount: 0,
    messages: [],
  }
}

function createApi(overrides: Partial<ConversationsApi> = {}): ConversationsApi {
  const fallbackConversation = createConversation('fallback')

  return {
    clearConversation: vi.fn<ConversationsApi['clearConversation']>().mockResolvedValue(
      fallbackConversation,
    ),
    createConversation: vi.fn<ConversationsApi['createConversation']>().mockResolvedValue(
      fallbackConversation,
    ),
    deleteConversation: vi.fn<ConversationsApi['deleteConversation']>().mockResolvedValue(
      undefined,
    ),
    getConversation: vi.fn<ConversationsApi['getConversation']>().mockResolvedValue(
      fallbackConversation,
    ),
    getConversations: vi.fn<ConversationsApi['getConversations']>().mockResolvedValue([]),
    updateConversationTitle:
      vi.fn<ConversationsApi['updateConversationTitle']>().mockResolvedValue(
        fallbackConversation,
      ),
    ...overrides,
  }
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

describe('useConversations', () => {
  it('deduplicates list loading and empty-list creation in React Strict Mode', async () => {
    const createdConversation = createConversation('created-once')
    const getConversations = vi
      .fn<ConversationsApi['getConversations']>()
      .mockResolvedValue([])
    const createConversationRequest = vi
      .fn<ConversationsApi['createConversation']>()
      .mockResolvedValue(createdConversation)
    const api = createApi({
      createConversation: createConversationRequest,
      getConversations,
    })

    const { result } = renderHook(() => useConversations({ api }), {
      wrapper: StrictModeWrapper,
    })

    await waitFor(() => {
      expect(result.current.currentConversationId).toBe('created-once')
    })

    expect(getConversations).toHaveBeenCalledTimes(1)
    expect(createConversationRequest).toHaveBeenCalledTimes(1)
    expect(result.current.isInitializing).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('keeps the latest selection when detail requests resolve out of order', async () => {
    const first = createDeferred<ConversationDetail>()
    const second = createDeferred<ConversationDetail>()
    const getConversation = vi
      .fn<ConversationsApi['getConversation']>()
      .mockImplementation((id) => (id === 'first' ? first.promise : second.promise))
    const api = createApi({ getConversation })
    const { result } = renderHook(() =>
      useConversations({ api, autoInitialize: false }),
    )

    let firstRequest!: Promise<ConversationDetail>
    let secondRequest!: Promise<ConversationDetail>
    act(() => {
      firstRequest = result.current.loadConversation('first')
      secondRequest = result.current.loadConversation('second')
    })

    await act(async () => {
      second.resolve(createConversation('second'))
      await secondRequest
    })
    expect(result.current.currentConversationId).toBe('second')

    await act(async () => {
      first.resolve(createConversation('first'))
      await firstRequest
    })
    expect(result.current.currentConversationId).toBe('second')
  })

  it('does not retain a deleted active conversation when loading its successor fails', async () => {
    const current = createConversation('current')
    const successor = createConversation('successor')
    const getConversation = vi
      .fn<ConversationsApi['getConversation']>()
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error('successor unavailable'))
    const api = createApi({
      getConversation,
      getConversations: vi
        .fn<ConversationsApi['getConversations']>()
        .mockResolvedValue([current, successor]),
    })
    const { result } = renderHook(() => useConversations({ api }))

    await waitFor(() => expect(result.current.currentConversationId).toBe('current'))

    let removalError: unknown
    await act(async () => {
      try {
        await result.current.removeConversation('current')
      } catch (error) {
        removalError = error
      }
    })
    expect(removalError).toEqual(new Error('successor unavailable'))

    await waitFor(() => {
      expect(result.current.currentConversationId).toBeNull()
      expect(result.current.messages).toEqual([])
      expect(result.current.conversations.map((conversation) => conversation.id)).toEqual([
        'successor',
      ])
    })
  })
})
