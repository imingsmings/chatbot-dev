import { useCallback } from 'react'

import type { SubmitQuestionOptions } from '#hooks/useChatStream'
import type { ChatMessage, ConversationDetail, SidebarOperation } from '#types/chat'

type MessageBranchingOptions = {
  beginSidebarOperation: (
    type: SidebarOperation['type'],
    conversationId?: string,
  ) => boolean
  clearSearch: () => void
  createBranchConversation: (
    sourceConversationId: string,
    messageIndex: number,
    question: string,
  ) => Promise<ConversationDetail>
  currentConversationId: string | null
  isResponding: boolean
  isStopping: boolean
  messages: ChatMessage[]
  promptText: (options: {
    fieldLabel?: string
    initialValue: string
    message: string
    multiline?: boolean
    title: string
  }) => Promise<string | null>
  resetInput: () => void
  setOperation: (operation: SidebarOperation | null) => void
  settleConversationView: (options?: {
    focus?: boolean
    scroll?: boolean
  }) => Promise<void>
  showError: (message: string, title?: string) => Promise<void>
  submitQuestion: (question: string, options: SubmitQuestionOptions) => Promise<void>
}

export function useMessageBranching(options: MessageBranchingOptions) {
  const createBranchAndSubmit = useCallback(async (
    sourceConversationId: string,
    messageIndex: number,
    question: string,
  ) => {
    try {
      const branch = await options.createBranchConversation(
        sourceConversationId,
        messageIndex,
        question,
      )
      options.clearSearch()
      options.resetInput()
      await options.submitQuestion(question, {
        appendUser: true,
        clearComposer: false,
        conversationId: branch.id,
      })
      await options.settleConversationView({ focus: true, scroll: true })
    } catch (error) {
      console.error('Failed to create conversation branch:', error)
      await options.showError(
        error instanceof Error ? error.message : '创建会话分支失败，请稍候再试',
        '创建分支失败',
      )
    } finally {
      options.setOperation(null)
    }
  }, [options])

  const handleEditMessage = useCallback(async (messageIndex: number) => {
    const sourceConversationId = options.currentConversationId
    const message = options.messages[messageIndex]
    if (
      !sourceConversationId ||
      message?.role !== 'user' ||
      message.persistedIndex === undefined ||
      options.isResponding ||
      options.isStopping ||
      !options.beginSidebarOperation('branch', sourceConversationId)
    ) {
      return
    }

    try {
      const question = await options.promptText({
        fieldLabel: '用户消息',
        initialValue: message.text,
        message: '保存后会创建新会话分支并重新生成，原会话保持不变。',
        multiline: true,
        title: '编辑消息并创建分支',
      })
      if (!question || question === message.text.trim()) {
        options.setOperation(null)
        return
      }

      await createBranchAndSubmit(sourceConversationId, message.persistedIndex, question)
    } catch (error) {
      console.error('Failed to edit conversation message:', error)
      options.setOperation(null)
      await options.showError('无法打开消息编辑，请稍候再试')
    }
  }, [createBranchAndSubmit, options])

  const handleRegenerateMessage = useCallback(async (messageIndex: number) => {
    const sourceConversationId = options.currentConversationId
    const message = options.messages[messageIndex]
    if (
      !sourceConversationId ||
      message?.role !== 'assistant' ||
      message.persistedIndex === undefined ||
      !['done', 'stopped'].includes(message.status) ||
      options.isResponding ||
      options.isStopping
    ) {
      return
    }

    let userMessageIndex = messageIndex - 1
    while (
      userMessageIndex >= 0 &&
      (options.messages[userMessageIndex]?.role !== 'user' ||
        options.messages[userMessageIndex]?.persistedIndex === undefined)
    ) {
      userMessageIndex -= 1
    }
    const userMessage = options.messages[userMessageIndex]
    const question = userMessage?.text.trim()
    if (
      userMessageIndex < 0 ||
      userMessage?.persistedIndex === undefined ||
      !question ||
      !options.beginSidebarOperation('branch', sourceConversationId)
    ) {
      return
    }

    await createBranchAndSubmit(sourceConversationId, userMessage.persistedIndex, question)
  }, [createBranchAndSubmit, options])

  return {
    handleEditMessage,
    handleRegenerateMessage,
  }
}
