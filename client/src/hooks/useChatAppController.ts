import { useCallback, useEffect, useRef, useState } from 'react'

import { getRuntimeConfiguration } from '#api/conversations'
import type { ChatComposerHandle } from '#components/ChatComposer'
import { useAppDialog } from '#hooks/useAppDialog'
import { useAutoScroll } from '#hooks/useAutoScroll'
import { useChatStream } from '#hooks/useChatStream'
import { useConversationInsights } from '#hooks/useConversationInsights'
import { useConversationModelOptions } from '#hooks/useConversationModelOptions'
import { useConversationOperations } from '#hooks/useConversationOperations'
import { useConversationSearch } from '#hooks/useConversationSearch'
import { useConversationTransfer } from '#hooks/useConversationTransfer'
import { useConversations } from '#hooks/useConversations'
import { useMessageBranching } from '#hooks/useMessageBranching'
import { useTheme } from '#hooks/useTheme'
import type { RuntimeInfo } from '#types/chat'
import { isModelOptionsUsable } from '#utils/modelOptions'

export type ActiveTopMenu =
  | { kind: 'app' }
  | { kind: 'conversation'; id: string }
  | { kind: 'model' }
  | { kind: 'tools' }
  | { kind: 'user' }
  | null

const suggestions = [
  '帮我总结一下今天的工作重点',
  '用简单例子解释一个技术概念',
  '帮我优化这段提示词',
  '给我一个学习计划',
]

export function useChatAppController() {
  const [input, setInput] = useState('')
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [activeTopMenu, setActiveTopMenu] = useState<ActiveTopMenu>(null)
  const initializationStartedRef = useRef(false)
  const chatBoxRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<ChatComposerHandle | null>(null)

  const { closeDialog, confirmAction, dialog, openDialog, promptText, showError } =
    useAppDialog()
  const { theme, themeToggleLabel, toggleTheme } = useTheme()
  const {
    applyConversationDetail,
    clearCurrentConversation,
    conversations,
    createBranchConversation,
    createNewConversation,
    currentConversationId,
    currentConversationModelOptions,
    currentConversationSummary,
    currentConversationTitle,
    dispatch,
    loadConversation,
    loadInitialState,
    messages,
    refreshConversationList,
    removeConversation,
    renameConversation,
  } = useConversations({ autoInitialize: false })
  const {
    clearSearch,
    error: conversationSearchError,
    isSearching: isConversationSearching,
    query: conversationSearchQuery,
    results: conversationSearchResults,
    search: searchConversations,
  } = useConversationSearch()
  const { followNewContent, scrollChatToBottom, shouldFollowNewContent } =
    useAutoScroll(chatBoxRef)

  const closeTopMenu = useCallback(() => setActiveTopMenu(null), [])
  const resetInput = useCallback(() => setInput(''), [])
  const resizeComposer = useCallback(() => composerRef.current?.resizeComposer(), [])
  const focusComposer = useCallback(() => composerRef.current?.focus(), [])

  const {
    isModelOptionsSaving,
    modelOptions,
    saveModelOptions,
  } = useConversationModelOptions({
    applyConversationDetail,
    currentConversationId,
    currentConversationModelOptions,
    runtime: runtimeInfo,
    showError,
  })
  const modelOptionsAvailable = isModelOptionsUsable(runtimeInfo, modelOptions)

  const refreshActiveConversationSearch = useCallback(async () => {
    if (conversationSearchQuery.trim()) {
      await searchConversations(conversationSearchQuery)
    }
  }, [conversationSearchQuery, searchConversations])

  const refreshConversationListAndSearch = useCallback(async () => {
    await refreshConversationList()
    await refreshActiveConversationSearch()
  }, [refreshActiveConversationSearch, refreshConversationList])

  const reconcileConversationAndSearch = useCallback(async (conversationId: string) => {
    await loadConversation(conversationId)
    await refreshActiveConversationSearch()
  }, [loadConversation, refreshActiveConversationSearch])

  const settleConversationView = useCallback(
    async (options: { focus?: boolean; scroll?: boolean } = {}) => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      resizeComposer()
      if (options.scroll) scrollChatToBottom()
      if (options.focus) focusComposer()
    },
    [focusComposer, resizeComposer, scrollChatToBottom],
  )

  const {
    copiedMessageId,
    copyMessage,
    isResponding,
    isStopping,
    retryMessage,
    stopGenerating,
    submitQuestion,
  } = useChatStream({
    canStartRequest: () => !isModelOptionsSaving && modelOptionsAvailable,
    clearComposer: resetInput,
    conversationId: currentConversationId,
    createConversation: createNewConversation,
    dispatch,
    followNewContent,
    getModelOptions: () => ({ ...modelOptions }),
    messages,
    reconcileConversation: reconcileConversationAndSearch,
    refreshConversationList: refreshConversationListAndSearch,
    resizeComposer,
    shouldFollowNewContent,
    showError,
  })

  const {
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
  } = useConversationOperations({
    clearCurrentConversation,
    clearSearch,
    closeTopMenu,
    confirmAction,
    conversations,
    createNewConversation,
    currentConversationId,
    currentConversationTitle,
    isResponding,
    isStopping,
    loadConversation,
    messageCount: messages.length,
    promptText,
    refreshActiveConversationSearch,
    removeConversation,
    renameConversation,
    resetInput,
    settleConversationView,
    showError,
    stopGenerating,
  })

  const {
    handleEditMessage,
    handleRegenerateMessage,
  } = useMessageBranching({
    beginSidebarOperation,
    clearSearch,
    createBranchConversation,
    currentConversationId,
    isResponding,
    isModelOptionsSaving,
    isStopping,
    messages,
    promptText,
    resetInput,
    setOperation,
    settleConversationView,
    showError,
    submitQuestion,
  })

  const {
    handleExportAllConversations,
    handleExportConversation,
    handleImportFile,
    importInputRef,
    openImportPicker,
  } = useConversationTransfer({
    beginSidebarOperation,
    closeTopMenu,
    isResponding,
    isStopping,
    openDialog,
    refreshConversationListAndSearch,
    setOperation,
    showError,
    sidebarOperationRef,
  })

  const {
    canGenerateSummary,
    canPreviewContext,
    contextPreview,
    handleGenerateSummary,
    isContextPreviewLoading,
    isContextPreviewOpen,
    isSummaryLoading,
    isSummaryOpen,
    openContextPreview,
    setIsContextPreviewOpen,
    setIsSummaryOpen,
  } = useConversationInsights({
    applyConversationDetail,
    closeTopMenu,
    currentConversationId,
    input,
    isConversationTransitioning,
    isModelOptionsSaving,
    isResponding,
    isStopping,
    messageCount: messages.length,
    modelOptions,
    modelOptionsAvailable,
    refreshConversationListAndSearch,
    showError,
  })

  useEffect(() => {
    if (initializationStartedRef.current) return
    initializationStartedRef.current = true

    void (async () => {
      try {
        try {
          const runtime = await getRuntimeConfiguration()
          setRuntimeInfo(runtime)
        } catch (error) {
          console.error('Failed to load runtime configuration:', error)
        }

        await loadInitialState()
        await settleConversationView({ scroll: true })
      } catch (error) {
        console.error('Failed to load conversations:', error)
        await showError('加载会话失败，请刷新后重试')
      } finally {
        setOperation(null)
      }
    })()
  }, [loadInitialState, setOperation, settleConversationView, showError])

  const visibleConversations = conversationSearchQuery.trim()
    ? conversationSearchResults
    : conversations
  const canSubmit =
    Boolean(currentConversationId) &&
    input.trim().length > 0 &&
    !isResponding &&
    !isStopping &&
    !isModelOptionsSaving &&
    modelOptionsAvailable &&
    !isConversationTransitioning

  const applyPromptTemplate = useCallback(
    (prompt: string) => {
      setInput(prompt)
      setIsTemplateModalOpen(false)
      window.requestAnimationFrame(() => {
        resizeComposer()
        focusComposer()
      })
    },
    [focusComposer, resizeComposer],
  )

  const useSuggestion = useCallback(
    (suggestion: string) => {
      setInput(suggestion)
      window.requestAnimationFrame(() => {
        resizeComposer()
        focusComposer()
      })
    },
    [focusComposer, resizeComposer],
  )

  const handleSubmit = useCallback(async () => {
    if (isStopping || isConversationTransitioning || isModelOptionsSaving) return
    await submitQuestion(input.trim(), { appendUser: true, clearComposer: true })
  }, [input, isConversationTransitioning, isModelOptionsSaving, isStopping, submitQuestion])

  const setMenuOpen = useCallback(
    (menu: Exclude<ActiveTopMenu, null>, open: boolean) => {
      setActiveTopMenu(open ? menu : null)
    },
    [],
  )

  return {
    activeTopMenu,
    applyPromptTemplate,
    canPreviewContext,
    canGenerateSummary,
    canSubmit,
    chatBoxRef,
    closeDialog,
    composerRef,
    contextPreview,
    conversationSearchError,
    conversationSearchQuery,
    copiedMessageId,
    currentConversationId,
    currentConversationSummary,
    currentConversationTitle,
    dialog,
    handleClearCurrentConversation,
    handleDeleteConversation,
    handleEditMessage,
    handleExportAllConversations,
    handleExportConversation,
    handleGenerateSummary,
    handleImportFile,
    handleRenameConversation,
    handleRegenerateMessage,
    handleSubmit,
    importInputRef,
    input,
    isContextPreviewLoading,
    isContextPreviewOpen,
    isConversationSearching,
    isConversationTransitioning,
    isModelSettingsOpen,
    isModelOptionsSaving,
    isResponding,
    isStopping,
    isSummaryLoading,
    isSummaryOpen,
    isTemplateModalOpen,
    messages,
    modelOptions,
    openContextPreview,
    openImportPicker,
    retryMessage,
    runtimeInfo,
    selectConversation,
    setActiveTopMenu,
    setInput,
    setIsContextPreviewOpen,
    setIsModelSettingsOpen,
    setIsSummaryOpen,
    setIsTemplateModalOpen,
    setMenuOpen,
    setModelOptions: saveModelOptions,
    showError,
    sidebarOperation,
    startNewChat,
    stopGenerating,
    suggestions,
    theme,
    themeToggleLabel,
    toggleTheme,
    useSuggestion,
    visibleConversations,
    copyMessage,
    searchConversations,
  }
}
