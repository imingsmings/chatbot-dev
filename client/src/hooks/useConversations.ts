import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import {
  clearConversation as clearConversationRequest,
  createConversation as createConversationRequest,
  createConversationBranch as createConversationBranchRequest,
  deleteConversation as deleteConversationRequest,
  getConversation as getConversationRequest,
  getConversations as getConversationsRequest,
  updateConversationTitle as updateConversationTitleRequest,
} from '#api/conversations'
import {
  conversationReducer,
  createInitialConversationState,
  type ConversationAction,
} from '../reducers/conversationReducer'
import type { ConversationDetail, ConversationSummary } from '#types/chat'

export type ConversationsApi = {
  clearConversation: typeof clearConversationRequest
  createConversation: typeof createConversationRequest
  createConversationBranch: typeof createConversationBranchRequest
  deleteConversation: typeof deleteConversationRequest
  getConversation: typeof getConversationRequest
  getConversations: typeof getConversationsRequest
  updateConversationTitle: typeof updateConversationTitleRequest
}

export type UseConversationsOptions = {
  api?: ConversationsApi
  autoInitialize?: boolean
  onError?: (error: unknown, context: 'initialize' | 'refresh') => void
}

const defaultApi: ConversationsApi = {
  clearConversation: clearConversationRequest,
  createConversation: createConversationRequest,
  createConversationBranch: createConversationBranchRequest,
  deleteConversation: deleteConversationRequest,
  getConversation: getConversationRequest,
  getConversations: getConversationsRequest,
  updateConversationTitle: updateConversationTitleRequest,
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '会话请求失败'
}

export function useConversations(options: UseConversationsOptions = {}) {
  const api = options.api ?? defaultApi
  const autoInitialize = options.autoInitialize ?? true
  const onErrorRef = useRef(options.onError)
  const [state, dispatch] = useReducer(
    conversationReducer,
    undefined,
    createInitialConversationState,
  )
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef(state)
  const mountedRef = useRef(true)
  const initializedRef = useRef(false)
  const initializationPromiseRef = useRef<Promise<void> | null>(null)
  const selectionSequenceRef = useRef(0)

  stateRef.current = state
  onErrorRef.current = options.onError

  const dispatchWhenMounted = useCallback((action: ConversationAction) => {
    if (mountedRef.current) {
      dispatch(action)
    }
  }, [])

  const createNewConversation = useCallback(async () => {
    const sequence = ++selectionSequenceRef.current
    const conversation = await api.createConversation()

    if (sequence === selectionSequenceRef.current) {
      dispatchWhenMounted({ type: 'select-conversation', conversation })
    }

    return conversation
  }, [api, dispatchWhenMounted])

  const createBranchConversation = useCallback(async (
    sourceConversationId: string,
    messageIndex: number,
    question: string,
  ) => {
    const sequence = ++selectionSequenceRef.current
    const conversation = await api.createConversationBranch(
      sourceConversationId,
      messageIndex,
      question,
    )

    if (sequence === selectionSequenceRef.current) {
      dispatchWhenMounted({ type: 'select-conversation', conversation })
    }

    return conversation
  }, [api, dispatchWhenMounted])

  const loadConversation = useCallback(
    async (id: string) => {
      const sequence = ++selectionSequenceRef.current
      const conversation = await api.getConversation(id)

      if (sequence === selectionSequenceRef.current) {
        dispatchWhenMounted({ type: 'select-conversation', conversation })
      }

      return conversation
    },
    [api, dispatchWhenMounted],
  )

  const fetchConversationList = useCallback(async () => {
    const conversations = await api.getConversations()
    dispatchWhenMounted({ type: 'replace-conversations', conversations })
    return conversations
  }, [api, dispatchWhenMounted])

  const refreshConversationList = useCallback(async () => {
    try {
      await fetchConversationList()
      if (mountedRef.current) {
        setError(null)
      }
    } catch (refreshError) {
      if (mountedRef.current) {
        setError(toErrorMessage(refreshError))
      }
      onErrorRef.current?.(refreshError, 'refresh')
    }
  }, [fetchConversationList])

  const loadInitialState = useCallback((): Promise<void> => {
    if (initializedRef.current) {
      return Promise.resolve()
    }

    const activeInitialization = initializationPromiseRef.current
    if (activeInitialization) {
      return activeInitialization
    }

    if (mountedRef.current) {
      setIsInitializing(true)
      setError(null)
    }

    const initialization = (async () => {
      try {
        const conversations = await api.getConversations()
        dispatchWhenMounted({ type: 'replace-conversations', conversations })

        if (conversations.length > 0) {
          await loadConversation(conversations[0].id)
        } else {
          await createNewConversation()
        }

        initializedRef.current = true
      } catch (initializationError) {
        if (mountedRef.current) {
          setError(toErrorMessage(initializationError))
        }
        onErrorRef.current?.(initializationError, 'initialize')
        throw initializationError
      } finally {
        initializationPromiseRef.current = null
        if (mountedRef.current) {
          setIsInitializing(false)
        }
      }
    })()

    initializationPromiseRef.current = initialization
    return initialization
  }, [api, createNewConversation, dispatchWhenMounted, loadConversation])

  const renameConversation = useCallback(
    async (conversation: ConversationSummary, title: string) => {
      const updatedConversation = await api.updateConversationTitle(conversation.id, title)
      dispatchWhenMounted({ type: 'upsert-conversation', conversation: updatedConversation })
      return updatedConversation
    },
    [api, dispatchWhenMounted],
  )

  const removeConversation = useCallback(
    async (id: string) => {
      await api.deleteConversation(id)

      const currentState = stateRef.current
      const remainingConversations = currentState.conversations.filter(
        (conversation) => conversation.id !== id,
      )
      dispatchWhenMounted({ type: 'remove-conversation', conversationId: id })

      if (currentState.currentConversationId !== id) {
        return
      }

      const nextConversation = remainingConversations[0]
      if (nextConversation) {
        await loadConversation(nextConversation.id)
      } else {
        await createNewConversation()
      }
    },
    [api, createNewConversation, dispatchWhenMounted, loadConversation],
  )

  const clearCurrentConversation = useCallback(async () => {
    const conversationId = stateRef.current.currentConversationId
    if (!conversationId) {
      return undefined
    }

    const conversation = await api.clearConversation(conversationId)
    dispatchWhenMounted({ type: 'clear-current-conversation', conversation })
    return conversation
  }, [api, dispatchWhenMounted])

  const applyConversationDetail = useCallback(
    (conversation: ConversationDetail) => {
      dispatchWhenMounted({ type: 'apply-conversation-detail', conversation })
    },
    [dispatchWhenMounted],
  )

  useEffect(() => {
    mountedRef.current = true

    if (autoInitialize) {
      void loadInitialState().catch(() => undefined)
    }

    return () => {
      mountedRef.current = false
    }
  }, [autoInitialize, loadInitialState])

  const currentConversationTitle = useMemo(
    () =>
      state.conversations.find(
        (conversation) => conversation.id === state.currentConversationId,
      )?.title ?? '新的聊天',
    [state.conversations, state.currentConversationId],
  )

  return {
    applyConversationDetail,
    clearCurrentConversation,
    conversations: state.conversations,
    createBranchConversation,
    createNewConversation,
    currentConversationId: state.currentConversationId,
    currentConversationSummary: state.currentConversationSummary,
    currentConversationTitle,
    dispatch,
    error,
    isInitializing,
    loadConversation,
    loadInitialState,
    messages: state.messages,
    refreshConversationList,
    removeConversation,
    renameConversation,
  }
}
