import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ConversationSearchResult } from '../../../client/src/types/chat'
import { useConversationSearch } from '../../../client/src/hooks/useConversationSearch'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

function createResult(id: string): ConversationSearchResult {
  return {
    id,
    title: id,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    messageCount: 1,
    matchedIn: 'title',
  }
}

describe('useConversationSearch', () => {
  it('prevents a stale slow response from replacing the latest search results', async () => {
    const slow = createDeferred<ConversationSearchResult[]>()
    const fast = createDeferred<ConversationSearchResult[]>()
    const searchConversations = vi.fn<
      (query: string) => Promise<ConversationSearchResult[]>
    >((query) => (query === 'slow' ? slow.promise : fast.promise))
    const { result } = renderHook(() =>
      useConversationSearch({ searchConversations }),
    )

    let slowRequest!: Promise<ConversationSearchResult[]>
    let fastRequest!: Promise<ConversationSearchResult[]>
    act(() => {
      slowRequest = result.current.search('slow')
      fastRequest = result.current.search('fast')
    })

    await act(async () => {
      fast.resolve([createResult('fast-result')])
      await fastRequest
    })

    await waitFor(() => {
      expect(result.current.results.map((item) => item.id)).toEqual(['fast-result'])
    })
    expect(result.current.query).toBe('fast')

    await act(async () => {
      slow.resolve([createResult('slow-result')])
      await slowRequest
    })

    expect(result.current.results.map((item) => item.id)).toEqual(['fast-result'])
    expect(result.current.isSearching).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('clears pending search state and invalidates the outstanding request', async () => {
    const pending = createDeferred<ConversationSearchResult[]>()
    const searchConversations = vi.fn<
      (query: string) => Promise<ConversationSearchResult[]>
    >(() => pending.promise)
    const { result } = renderHook(() =>
      useConversationSearch({ searchConversations }),
    )

    let request!: Promise<ConversationSearchResult[]>
    act(() => {
      request = result.current.search('pending')
      result.current.clearSearch()
    })

    expect(result.current.query).toBe('')
    expect(result.current.isSearching).toBe(false)

    await act(async () => {
      pending.resolve([createResult('late-result')])
      await request
    })

    expect(result.current.results).toEqual([])
  })

  it('ignores a stale rejection after a newer search has succeeded', async () => {
    const stale = createDeferred<ConversationSearchResult[]>()
    const current = createDeferred<ConversationSearchResult[]>()
    const searchConversations = vi.fn<
      (query: string) => Promise<ConversationSearchResult[]>
    >((query) => (query === 'stale' ? stale.promise : current.promise))
    const { result } = renderHook(() =>
      useConversationSearch({ searchConversations }),
    )

    let staleRequest!: Promise<ConversationSearchResult[]>
    let currentRequest!: Promise<ConversationSearchResult[]>
    act(() => {
      staleRequest = result.current.search('stale')
      currentRequest = result.current.search('current')
    })

    await act(async () => {
      current.resolve([createResult('current-result')])
      await currentRequest
    })
    await act(async () => {
      stale.reject(new Error('stale failure'))
      await staleRequest
    })

    expect(result.current.results.map((item) => item.id)).toEqual(['current-result'])
    expect(result.current.error).toBeNull()
    expect(result.current.isSearching).toBe(false)
  })

  it('shows a stable user-facing error and clears stale results for the latest failed search', async () => {
    const searchConversations = vi
      .fn<(query: string) => Promise<ConversationSearchResult[]>>()
      .mockResolvedValueOnce([createResult('previous-result')])
      .mockRejectedValueOnce(new Error('backend detail must not leak'))
    const { result } = renderHook(() =>
      useConversationSearch({ searchConversations }),
    )

    await act(async () => {
      await result.current.search('previous')
    })
    await act(async () => {
      await result.current.search('failed')
    })

    expect(result.current.results).toEqual([])
    expect(result.current.error).toBe('搜索失败')
    expect(result.current.isSearching).toBe(false)
  })
})
