import { useCallback, useMemo, useRef, useState } from 'react'

import type { ConversationSummary, SidebarOperation } from '#types/chat'

export type ConversationOperationOptions = {
  clearCurrentConversation: () => Promise<unknown>
  clearSearch: () => void
  closeTopMenu: () => void
  confirmAction: (options: {
    confirmLabel?: string
    danger?: boolean
    message: string
    title: string
  }) => Promise<boolean>
  conversations: ConversationSummary[]
  createNewConversation: () => Promise<unknown>
  currentConversationId: string | null
  currentConversationTitle: string
  isResponding: boolean
  isStopping: boolean
  loadConversation: (id: string) => Promise<unknown>
  messageCount: number
  promptText: (options: {
    initialValue: string
    message: string
    title: string
  }) => Promise<string | null>
  refreshActiveConversationSearch: () => Promise<void>
  removeConversation: (id: string) => Promise<void>
  renameConversation: (conversation: ConversationSummary, title: string) => Promise<unknown>
  resetInput: () => void
  settleConversationView: (options?: {
    focus?: boolean
    scroll?: boolean
  }) => Promise<void>
  showError: (message: string, title?: string) => Promise<void>
  stopGenerating: (reason?: 'manual' | 'transition') => Promise<void>
}

export function useConversationOperations(options: ConversationOperationOptions) {
  const [sidebarOperation, setSidebarOperation] = useState<SidebarOperation | null>({
    type: 'initialize',
  })
  const sidebarOperationRef = useRef<SidebarOperation | null>(sidebarOperation)

  const setOperation = useCallback((operation: SidebarOperation | null) => {
    sidebarOperationRef.current = operation
    setSidebarOperation(operation)
  }, [])

  const beginSidebarOperation = useCallback(
    (type: SidebarOperation['type'], conversationId?: string) => {
      if (sidebarOperationRef.current) return false
      setOperation({ type, ...(conversationId ? { conversationId } : {}) })
      return true
    },
    [setOperation],
  )

  const isConversationTransitioning = useMemo(
    () =>
      ['initialize', 'create', 'select', 'delete', 'clear'].includes(
        sidebarOperation?.type || '',
      ),
    [sidebarOperation],
  )

  const startNewChat = useCallback(async () => {
    if (options.isStopping || !beginSidebarOperation('create')) return
    options.closeTopMenu()
    try {
      if (options.isResponding) await options.stopGenerating('transition')

      if (
        options.currentConversationId &&
        options.currentConversationTitle === '新的聊天' &&
        options.messageCount === 0
      ) {
        options.clearSearch()
        options.resetInput()
        setOperation(null)
        await options.settleConversationView({ focus: true })
        return
      }

      await options.createNewConversation()
      options.clearSearch()
      options.resetInput()
      setOperation(null)
      await options.settleConversationView({ focus: true })
    } catch (error) {
      console.error('Failed to create conversation:', error)
      await options.showError('新建会话失败')
    } finally {
      setOperation(null)
    }
  }, [beginSidebarOperation, options, setOperation])

  const selectConversation = useCallback(
    async (id: string) => {
      if (
        id === options.currentConversationId ||
        options.isStopping ||
        !beginSidebarOperation('select', id)
      ) {
        return
      }
      options.closeTopMenu()
      try {
        if (options.isResponding) await options.stopGenerating('transition')
        await options.loadConversation(id)
        options.resetInput()
        await options.settleConversationView({ scroll: true })
      } catch (error) {
        console.error('Failed to select conversation:', error)
        await options.showError('切换会话失败')
      } finally {
        setOperation(null)
      }
    },
    [beginSidebarOperation, options, setOperation],
  )

  const handleRenameConversation = useCallback(
    async (conversation: ConversationSummary) => {
      if (options.isStopping || !beginSidebarOperation('rename', conversation.id)) return
      options.closeTopMenu()
      try {
        const title = await options.promptText({
          initialValue: conversation.title,
          message: '请输入新的会话名称',
          title: '重命名会话',
        })
        if (!title || title === conversation.title) return
        await options.renameConversation(conversation, title)
        await options.refreshActiveConversationSearch()
      } catch (error) {
        console.error('Failed to rename conversation:', error)
        await options.showError('重命名失败，请稍候再试')
      } finally {
        setOperation(null)
      }
    },
    [beginSidebarOperation, options, setOperation],
  )

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (
        options.isResponding ||
        options.isStopping ||
        !beginSidebarOperation('delete', id)
      ) {
        return
      }
      options.closeTopMenu()
      const title =
        options.conversations.find((conversation) => conversation.id === id)?.title || '该会话'
      try {
        const confirmed = await options.confirmAction({
          confirmLabel: '删除',
          danger: true,
          message: `确定删除“${title}”吗？该操作不可逆`,
          title: '删除会话',
        })
        if (!confirmed) return
        await options.removeConversation(id)
        await options.refreshActiveConversationSearch()
        options.resetInput()
        setOperation(null)
        await options.settleConversationView({ focus: true, scroll: true })
      } catch (error) {
        console.error('Failed to delete conversation:', error)
        await options.showError('删除会话失败，请稍候再试')
      } finally {
        setOperation(null)
      }
    },
    [beginSidebarOperation, options, setOperation],
  )

  const handleClearCurrentConversation = useCallback(async () => {
    if (
      !options.currentConversationId ||
      options.isResponding ||
      options.isStopping ||
      !beginSidebarOperation('clear', options.currentConversationId)
    ) {
      return
    }
    options.closeTopMenu()
    try {
      const confirmed = await options.confirmAction({
        confirmLabel: '清空',
        danger: true,
        message: '确定清空当前会话消息吗？会话名称会保留',
        title: '清空当前会话',
      })
      if (!confirmed) return
      await options.clearCurrentConversation()
      await options.refreshActiveConversationSearch()
      options.resetInput()
      await options.settleConversationView()
    } catch (error) {
      console.error('Failed to clear conversation:', error)
      await options.showError('清空会话失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [beginSidebarOperation, options, setOperation])

  return {
    beginSidebarOperation,
    handleClearCurrentConversation,
    handleDeleteConversation,
    handleRenameConversation,
    isConversationTransitioning,
    selectConversation,
    setOperation,
    sidebarOperation,
    sidebarOperationRef,
    startNewChat,
  }
}
