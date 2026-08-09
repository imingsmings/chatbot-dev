import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import {
  downloadAllConversationsJson,
  downloadConversationMarkdown,
  generateConversationSummary,
  getConversationContextPreview,
  getRuntimeConfiguration,
  importConversationsBackup,
  type DownloadedFile,
} from '#api/conversations'
import type { ChatComposerHandle } from '#components/ChatComposer'
import { useAppDialog } from '#hooks/useAppDialog'
import { useAutoScroll } from '#hooks/useAutoScroll'
import { useChatStream } from '#hooks/useChatStream'
import { useConversationSearch } from '#hooks/useConversationSearch'
import { useConversations } from '#hooks/useConversations'
import { useTheme } from '#hooks/useTheme'
import { getInitialModelOptions } from '#utils/modelOptions'
import type {
  ContextPreview,
  ConversationSummary,
  ModelRequestOptions,
  RuntimeInfo,
  SidebarOperation,
} from '#types/chat'

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

function saveDownloadedFile(file: DownloadedFile) {
  const url = URL.createObjectURL(file.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function useChatAppController() {
  const [input, setInput] = useState('')
  const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null)
  const [isContextPreviewLoading, setIsContextPreviewLoading] = useState(false)
  const [isContextPreviewOpen, setIsContextPreviewOpen] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false)
  const [isSummaryOpen, setIsSummaryOpen] = useState(false)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelRequestOptions>({})
  const [sidebarOperation, setSidebarOperation] = useState<SidebarOperation | null>({
    type: 'initialize',
  })
  const [activeTopMenu, setActiveTopMenu] = useState<ActiveTopMenu>(null)
  const sidebarOperationRef = useRef<SidebarOperation | null>(sidebarOperation)
  const initializationStartedRef = useRef(false)
  const chatBoxRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<ChatComposerHandle | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const contextPreviewLoadingRef = useRef(false)
  const summaryLoadingRef = useRef(false)

  const { closeDialog, confirmAction, dialog, openDialog, promptText, showError } = useAppDialog()
  const { theme, themeToggleLabel, toggleTheme } = useTheme()
  const {
    applyConversationDetail,
    clearCurrentConversation,
    conversations,
    createNewConversation,
    currentConversationId,
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

  const refreshActiveConversationSearch = useCallback(async () => {
    if (conversationSearchQuery.trim()) {
      await searchConversations(conversationSearchQuery)
    }
  }, [conversationSearchQuery, searchConversations])

  const refreshConversationListAndSearch = useCallback(async () => {
    await refreshConversationList()
    await refreshActiveConversationSearch()
  }, [refreshActiveConversationSearch, refreshConversationList])

  const resizeComposer = useCallback(() => composerRef.current?.resizeComposer(), [])
  const focusComposer = useCallback(() => composerRef.current?.focus(), [])

  const {
    copiedMessageId,
    copyMessage,
    isResponding,
    isStopping,
    retryMessage,
    stopGenerating,
    submitQuestion,
  } = useChatStream({
    clearComposer: () => setInput(''),
    conversationId: currentConversationId,
    createConversation: createNewConversation,
    dispatch,
    followNewContent,
    getModelOptions: () => ({ ...modelOptions }),
    messages,
    refreshConversationList: refreshConversationListAndSearch,
    resizeComposer,
    shouldFollowNewContent,
    showError,
  })
  const currentConversationIdRef = useRef(currentConversationId)
  const isRespondingRef = useRef(isResponding)
  currentConversationIdRef.current = currentConversationId
  isRespondingRef.current = isResponding

  const visibleConversations = conversationSearchQuery.trim()
    ? conversationSearchResults
    : conversations
  const isConversationTransitioning = useMemo(
    () =>
      ['initialize', 'create', 'select', 'delete', 'clear'].includes(
        sidebarOperation?.type || '',
      ),
    [sidebarOperation],
  )
  const canSubmit =
    Boolean(currentConversationId) &&
    input.trim().length > 0 &&
    !isResponding &&
    !isStopping &&
    !isConversationTransitioning
  const canPreviewContext =
    Boolean(currentConversationId) &&
    !isResponding &&
    !isStopping &&
    !isConversationTransitioning
  const canGenerateSummary = canPreviewContext && !isSummaryLoading

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

  const settleConversationView = useCallback(
    async (options: { focus?: boolean; scroll?: boolean } = {}) => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      resizeComposer()
      if (options.scroll) scrollChatToBottom()
      if (options.focus) focusComposer()
    },
    [focusComposer, resizeComposer, scrollChatToBottom],
  )

  useEffect(() => {
    if (initializationStartedRef.current) return
    initializationStartedRef.current = true

    void (async () => {
      try {
        try {
          const runtime = await getRuntimeConfiguration()
          setRuntimeInfo(runtime)
          setModelOptions(getInitialModelOptions(runtime))
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

  const startNewChat = useCallback(async () => {
    if (isStopping || !beginSidebarOperation('create')) return
    setActiveTopMenu(null)
    try {
      if (isResponding) await stopGenerating()

      if (
        currentConversationId &&
        currentConversationTitle === '新的聊天' &&
        messages.length === 0
      ) {
        clearSearch()
        setInput('')
        setOperation(null)
        await settleConversationView({ focus: true })
        return
      }

      await createNewConversation()
      clearSearch()
      setInput('')
      setOperation(null)
      await settleConversationView({ focus: true })
    } catch (error) {
      console.error('Failed to create conversation:', error)
      await showError('新建会话失败')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    clearSearch,
    createNewConversation,
    currentConversationId,
    currentConversationTitle,
    isResponding,
    isStopping,
    messages.length,
    setOperation,
    settleConversationView,
    showError,
    stopGenerating,
  ])

  const selectConversation = useCallback(async (id: string) => {
    if (id === currentConversationId || isStopping || !beginSidebarOperation('select', id)) return
    setActiveTopMenu(null)
    try {
      if (isResponding) await stopGenerating()
      await loadConversation(id)
      setInput('')
      await settleConversationView({ scroll: true })
    } catch (error) {
      console.error('Failed to select conversation:', error)
      await showError('切换会话失败')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    currentConversationId,
    isResponding,
    isStopping,
    loadConversation,
    setOperation,
    settleConversationView,
    showError,
    stopGenerating,
  ])

  const handleRenameConversation = useCallback(async (conversation: ConversationSummary) => {
    if (isStopping || !beginSidebarOperation('rename', conversation.id)) return
    setActiveTopMenu(null)
    try {
      const title = await promptText({
        initialValue: conversation.title,
        message: '请输入新的会话名称',
        title: '重命名会话',
      })
      if (!title || title === conversation.title) return
      await renameConversation(conversation, title)
      await refreshActiveConversationSearch()
    } catch (error) {
      console.error('Failed to rename conversation:', error)
      await showError('重命名失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    isStopping,
    promptText,
    refreshActiveConversationSearch,
    renameConversation,
    setOperation,
    showError,
  ])

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (isResponding || isStopping || !beginSidebarOperation('delete', id)) return
    setActiveTopMenu(null)
    const title = conversations.find((conversation) => conversation.id === id)?.title || '该会话'
    try {
      const confirmed = await confirmAction({
        confirmLabel: '删除',
        danger: true,
        message: `确定删除“${title}”吗？该操作不可逆`,
        title: '删除会话',
      })
      if (!confirmed) return
      await removeConversation(id)
      await refreshActiveConversationSearch()
      setInput('')
      setOperation(null)
      await settleConversationView({ focus: true, scroll: true })
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      await showError('删除会话失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    confirmAction,
    conversations,
    isResponding,
    isStopping,
    refreshActiveConversationSearch,
    removeConversation,
    setOperation,
    settleConversationView,
    showError,
  ])

  const handleClearCurrentConversation = useCallback(async () => {
    if (!currentConversationId || isResponding || isStopping || !beginSidebarOperation('clear', currentConversationId)) return
    setActiveTopMenu(null)
    try {
      const confirmed = await confirmAction({
        confirmLabel: '清空',
        danger: true,
        message: '确定清空当前会话消息吗？会话名称会保留',
        title: '清空当前会话',
      })
      if (!confirmed) return
      await clearCurrentConversation()
      await refreshActiveConversationSearch()
      setInput('')
      await settleConversationView()
    } catch (error) {
      console.error('Failed to clear conversation:', error)
      await showError('清空会话失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    clearCurrentConversation,
    confirmAction,
    currentConversationId,
    isResponding,
    isStopping,
    refreshActiveConversationSearch,
    setOperation,
    settleConversationView,
    showError,
  ])

  const handleExportConversation = useCallback(async (conversation: ConversationSummary) => {
    if (isResponding || isStopping || !beginSidebarOperation('export-one', conversation.id)) return
    try {
      saveDownloadedFile(await downloadConversationMarkdown(conversation.id))
    } catch (error) {
      console.error('Failed to export conversation:', error)
      await showError('导出会话失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [beginSidebarOperation, isResponding, isStopping, setOperation, showError])

  const handleExportAllConversations = useCallback(async () => {
    if (isResponding || isStopping || !beginSidebarOperation('export-all')) return
    try {
      saveDownloadedFile(await downloadAllConversationsJson())
    } catch (error) {
      console.error('Failed to export all conversations:', error)
      await showError('导出全部会话失败，请稍候再试')
    } finally {
      setOperation(null)
    }
  }, [beginSidebarOperation, isResponding, isStopping, setOperation, showError])

  const openContextPreview = useCallback(async () => {
    const conversationId = currentConversationId
    if (!conversationId || isResponding || contextPreviewLoadingRef.current) return
    setActiveTopMenu(null)
    contextPreviewLoadingRef.current = true
    setIsContextPreviewLoading(true)
    try {
      const context = await getConversationContextPreview(
        conversationId,
        input.trim(),
        modelOptions,
      )
      if (
        conversationId !== currentConversationIdRef.current ||
        isRespondingRef.current
      ) return
      setContextPreview(context)
      setIsContextPreviewOpen(true)
    } catch (error) {
      console.error('Failed to preview context:', error)
      await showError('上下文预览失败，请稍候再试')
    } finally {
      contextPreviewLoadingRef.current = false
      setIsContextPreviewLoading(false)
    }
  }, [currentConversationId, input, isResponding, modelOptions, showError])

  const openImportPicker = useCallback(() => {
    if (sidebarOperationRef.current || isResponding || isStopping) return
    setActiveTopMenu(null)
    importInputRef.current?.click()
  }, [isResponding, isStopping])

  const handleImportFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isResponding || isStopping || !beginSidebarOperation('import')) return
    try {
      const backup = JSON.parse(await file.text()) as unknown
      const result = await importConversationsBackup(backup, 'skip')
      await refreshConversationListAndSearch()
      await openDialog({
        message: [
          `总计：${result.total}`,
          `新增：${result.created}`,
          `跳过：${result.skipped}`,
          `复制：${result.duplicated}`,
          `覆盖：${result.overwritten}`,
        ].join('\n'),
        mode: 'alert',
        title: '导入完成',
      })
    } catch (error) {
      console.error('Failed to import conversations:', error)
      await showError(error instanceof Error ? error.message : '导入失败')
    } finally {
      setOperation(null)
    }
  }, [
    beginSidebarOperation,
    isResponding,
    isStopping,
    openDialog,
    refreshConversationListAndSearch,
    setOperation,
    showError,
  ])

  const handleGenerateSummary = useCallback(async () => {
    const conversationId = currentConversationId
    if (
      !conversationId ||
      isRespondingRef.current ||
      isStopping ||
      isConversationTransitioning ||
      summaryLoadingRef.current
    ) return
    summaryLoadingRef.current = true
    setIsSummaryLoading(true)
    try {
      const conversation = await generateConversationSummary(conversationId, modelOptions)
      if (currentConversationIdRef.current !== conversationId) return
      applyConversationDetail(conversation)
      await refreshConversationListAndSearch()
    } catch (error) {
      console.error('Failed to generate conversation summary:', error)
      await showError(error instanceof Error ? error.message : '生成摘要失败')
    } finally {
      summaryLoadingRef.current = false
      setIsSummaryLoading(false)
    }
  }, [
    applyConversationDetail,
    currentConversationId,
    isConversationTransitioning,
    isStopping,
    modelOptions,
    refreshConversationListAndSearch,
    showError,
  ])

  const applyPromptTemplate = useCallback((prompt: string) => {
    setInput(prompt)
    setIsTemplateModalOpen(false)
    window.requestAnimationFrame(() => {
      resizeComposer()
      focusComposer()
    })
  }, [focusComposer, resizeComposer])

  const useSuggestion = useCallback((suggestion: string) => {
    setInput(suggestion)
    window.requestAnimationFrame(() => {
      resizeComposer()
      focusComposer()
    })
  }, [focusComposer, resizeComposer])

  const handleSubmit = useCallback(async () => {
    if (isStopping || isConversationTransitioning) return
    await submitQuestion(input.trim(), { appendUser: true, clearComposer: true })
  }, [input, isConversationTransitioning, isStopping, submitQuestion])

  const setMenuOpen = useCallback((menu: Exclude<ActiveTopMenu, null>, open: boolean) => {
    setActiveTopMenu(open ? menu : null)
  }, [])

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
    handleExportAllConversations,
    handleExportConversation,
    handleGenerateSummary,
    handleImportFile,
    handleRenameConversation,
    handleSubmit,
    importInputRef,
    input,
    isContextPreviewLoading,
    isContextPreviewOpen,
    isConversationSearching,
    isConversationTransitioning,
    isModelSettingsOpen,
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
    setModelOptions,
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
