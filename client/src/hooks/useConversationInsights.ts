import { useCallback, useRef, useState } from 'react'

import {
  generateConversationSummary,
  getConversationContextPreview,
} from '#api/conversations'
import type {
  ContextPreview,
  ConversationDetail,
  ImageAttachment,
  ModelRequestOptions,
} from '#types/chat'

export type ConversationInsightOptions = {
  applyConversationDetail: (conversation: ConversationDetail) => void
  closeTopMenu: () => void
  currentAttachments: ImageAttachment[]
  currentConversationId: string | null
  hasBlockingUpload: boolean
  input: string
  isConversationTransitioning: boolean
  isModelOptionsSaving: boolean
  modelOptionsAvailable: boolean
  isResponding: boolean
  isStopping: boolean
  messageCount: number
  modelOptions: ModelRequestOptions
  refreshConversationListAndSearch: () => Promise<void>
  showError: (message: string, title?: string) => Promise<void>
}

export function useConversationInsights(options: ConversationInsightOptions) {
  const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null)
  const [isContextPreviewLoading, setIsContextPreviewLoading] = useState(false)
  const [isContextPreviewOpen, setIsContextPreviewOpen] = useState(false)
  const [isSummaryOpen, setIsSummaryOpen] = useState(false)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const contextPreviewLoadingRef = useRef(false)
  const summaryLoadingRef = useRef(false)
  const currentConversationIdRef = useRef(options.currentConversationId)
  const isRespondingRef = useRef(options.isResponding)
  currentConversationIdRef.current = options.currentConversationId
  isRespondingRef.current = options.isResponding

  const canPreviewContext =
    Boolean(options.currentConversationId) &&
    !options.isResponding &&
    !options.isStopping &&
    !options.isModelOptionsSaving &&
    !options.hasBlockingUpload &&
    options.modelOptionsAvailable &&
    !options.isConversationTransitioning
  const canGenerateSummary =
    canPreviewContext && options.messageCount > 0 && !isSummaryLoading

  const openContextPreview = useCallback(async () => {
    const conversationId = options.currentConversationId
    if (
      !conversationId ||
      options.isResponding ||
      options.isStopping ||
      options.isModelOptionsSaving ||
      !options.modelOptionsAvailable ||
      options.isConversationTransitioning ||
      contextPreviewLoadingRef.current
    ) return
    options.closeTopMenu()
    contextPreviewLoadingRef.current = true
    setIsContextPreviewLoading(true)
    try {
      const context = await getConversationContextPreview(
        conversationId,
        options.input.trim(),
        options.modelOptions,
        options.currentAttachments.map(({ id }) => id),
      )
      if (
        conversationId !== currentConversationIdRef.current ||
        isRespondingRef.current
      ) {
        return
      }
      setContextPreview(context)
      setIsContextPreviewOpen(true)
    } catch (error) {
      console.error('Failed to preview context:', error)
      await options.showError('上下文预览失败，请稍候再试')
    } finally {
      contextPreviewLoadingRef.current = false
      setIsContextPreviewLoading(false)
    }
  }, [options])

  const handleGenerateSummary = useCallback(async () => {
    const conversationId = options.currentConversationId
    if (
      !conversationId ||
      isRespondingRef.current ||
      options.isStopping ||
      options.isModelOptionsSaving ||
      !options.modelOptionsAvailable ||
      options.isConversationTransitioning ||
      summaryLoadingRef.current
    ) {
      return
    }
    summaryLoadingRef.current = true
    setIsSummaryLoading(true)
    try {
      const conversation = await generateConversationSummary(
        conversationId,
        options.modelOptions,
      )
      if (currentConversationIdRef.current !== conversationId) return
      options.applyConversationDetail(conversation)
      await options.refreshConversationListAndSearch()
    } catch (error) {
      console.error('Failed to generate conversation summary:', error)
      await options.showError(error instanceof Error ? error.message : '生成摘要失败')
    } finally {
      summaryLoadingRef.current = false
      setIsSummaryLoading(false)
    }
  }, [options])

  return {
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
  }
}
