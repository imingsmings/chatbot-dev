import { useCallback, useRef, type ChangeEvent } from 'react'

import {
  downloadAllConversationsJson,
  downloadConversationMarkdown,
  importConversationsBackup,
  type DownloadedFile,
} from '#api/conversations'
import type { ConversationSummary, SidebarOperation } from '#types/chat'

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

export type ConversationTransferOptions = {
  beginSidebarOperation: (type: SidebarOperation['type'], conversationId?: string) => boolean
  closeTopMenu: () => void
  isResponding: boolean
  isStopping: boolean
  openDialog: (options: {
    message: string
    mode: 'alert'
    title: string
  }) => Promise<string | boolean | null>
  refreshConversationListAndSearch: () => Promise<void>
  setOperation: (operation: SidebarOperation | null) => void
  showError: (message: string, title?: string) => Promise<void>
  sidebarOperationRef: { current: SidebarOperation | null }
}

export function useConversationTransfer(options: ConversationTransferOptions) {
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const handleExportConversation = useCallback(
    async (conversation: ConversationSummary) => {
      if (
        options.isResponding ||
        options.isStopping ||
        !options.beginSidebarOperation('export-one', conversation.id)
      ) {
        return
      }
      try {
        saveDownloadedFile(await downloadConversationMarkdown(conversation.id))
      } catch (error) {
        console.error('Failed to export conversation:', error)
        await options.showError('导出会话失败，请稍候再试')
      } finally {
        options.setOperation(null)
      }
    },
    [options],
  )

  const handleExportAllConversations = useCallback(async () => {
    if (
      options.isResponding ||
      options.isStopping ||
      !options.beginSidebarOperation('export-all')
    ) {
      return
    }
    try {
      saveDownloadedFile(await downloadAllConversationsJson())
    } catch (error) {
      console.error('Failed to export all conversations:', error)
      await options.showError('导出全部会话失败，请稍候再试')
    } finally {
      options.setOperation(null)
    }
  }, [options])

  const openImportPicker = useCallback(() => {
    if (options.sidebarOperationRef.current || options.isResponding || options.isStopping) return
    options.closeTopMenu()
    importInputRef.current?.click()
  }, [options])

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (
        !file ||
        options.isResponding ||
        options.isStopping ||
        !options.beginSidebarOperation('import')
      ) {
        return
      }
      try {
        const backup = JSON.parse(await file.text()) as unknown
        const result = await importConversationsBackup(backup, 'skip')
        await options.refreshConversationListAndSearch()
        await options.openDialog({
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
        await options.showError(error instanceof Error ? error.message : '导入失败')
      } finally {
        options.setOperation(null)
      }
    },
    [options],
  )

  return {
    handleExportAllConversations,
    handleExportConversation,
    handleImportFile,
    importInputRef,
    openImportPicker,
  }
}
