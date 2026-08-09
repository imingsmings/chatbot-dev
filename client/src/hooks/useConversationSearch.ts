import { useCallback, useEffect, useRef, useState } from 'react'

import { searchConversations as searchConversationsRequest } from '#api/conversations'
import type { ConversationSearchResult } from '#types/chat'

export type UseConversationSearchOptions = {
  searchConversations?: typeof searchConversationsRequest
}

export function useConversationSearch(options: UseConversationSearchOptions = {}) {
  const searchRequest = options.searchConversations ?? searchConversationsRequest
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const mountedRef = useRef(true)

  const clearSearch = useCallback(() => {
    requestSequenceRef.current += 1
    setQuery('')
    setResults([])
    setIsSearching(false)
    setError(null)
  }, [])

  const search = useCallback(
    async (nextQuery: string) => {
      const sequence = ++requestSequenceRef.current
      const normalizedQuery = nextQuery.trim()
      setQuery(nextQuery)

      if (!normalizedQuery) {
        setResults([])
        setIsSearching(false)
        setError(null)
        return []
      }

      setIsSearching(true)
      setError(null)

      try {
        const nextResults = await searchRequest(normalizedQuery)
        if (!mountedRef.current || sequence !== requestSequenceRef.current) {
          return nextResults
        }

        setResults(nextResults)
        return nextResults
      } catch {
        if (mountedRef.current && sequence === requestSequenceRef.current) {
          setResults([])
          setError('搜索失败')
        }
        return []
      } finally {
        if (mountedRef.current && sequence === requestSequenceRef.current) {
          setIsSearching(false)
        }
      }
    },
    [searchRequest],
  )

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestSequenceRef.current += 1
    }
  }, [])

  return {
    clearSearch,
    error,
    isSearching,
    query,
    results,
    search,
  }
}
