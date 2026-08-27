import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteConversationAttachment,
  uploadConversationAttachment,
} from '#api/conversations'
import type { ImageAttachment } from '#types/chat'

const MAX_ATTACHMENTS = 4

export type ComposerImageAttachment = {
  clientId: string
  conversationId: string
  file: File
  previewUrl: string
  status: 'uploading' | 'ready' | 'error' | 'deleting'
  attachment?: ImageAttachment
  error?: string
}

type UseImageAttachmentsOptions = {
  conversationId: string | null
  showError?: (message: string) => Promise<void> | void
}

function createClientId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `upload_${crypto.randomUUID()}`
    : `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useImageAttachments(options: UseImageAttachmentsOptions) {
  const { conversationId, showError } = options
  const [items, setItems] = useState<ComposerImageAttachment[]>([])
  const itemsRef = useRef(items)
  const controllersRef = useRef(new Map<string, AbortController>())
  const mountedRef = useRef(true)
  itemsRef.current = items

  const updateItems = useCallback((updater: (current: ComposerImageAttachment[]) => ComposerImageAttachment[]) => {
    if (!mountedRef.current) return
    setItems((current) => {
      const next = updater(current)
      itemsRef.current = next
      return next
    })
  }, [])

  const uploadItem = useCallback(async (item: ComposerImageAttachment) => {
    const controller = new AbortController()
    controllersRef.current.set(item.clientId, controller)
    updateItems((current) => current.map((candidate) =>
      candidate.clientId === item.clientId
        ? { ...candidate, status: 'uploading', error: undefined }
        : candidate,
    ))

    try {
      const attachment = await uploadConversationAttachment(item.conversationId, item.file, {
        signal: controller.signal,
      })
      const stillPresent = itemsRef.current.some((candidate) => candidate.clientId === item.clientId)
      if (!stillPresent) {
        await deleteConversationAttachment(item.conversationId, attachment.id).catch(() => undefined)
        return
      }
      updateItems((current) => current.map((candidate) =>
        candidate.clientId === item.clientId
          ? { ...candidate, attachment, status: 'ready', error: undefined }
          : candidate,
      ))
    } catch (error) {
      if (isAbortError(error)) return
      updateItems((current) => current.map((candidate) =>
        candidate.clientId === item.clientId
          ? {
              ...candidate,
              status: 'error',
              error: error instanceof Error ? error.message : '图片上传失败',
            }
          : candidate,
      ))
    } finally {
      controllersRef.current.delete(item.clientId)
    }
  }, [updateItems])

  const addFiles = useCallback((files: File[]) => {
    if (!conversationId || files.length === 0) return
    const available = Math.max(0, MAX_ATTACHMENTS - itemsRef.current.length)
    if (available === 0) {
      void showError?.(`单条消息最多包含 ${MAX_ATTACHMENTS} 张图片`)
      return
    }
    if (files.length > available) {
      void showError?.(`本次只添加前 ${available} 张图片，单条消息最多 ${MAX_ATTACHMENTS} 张`)
    }
    const additions = files.slice(0, available).map((file): ComposerImageAttachment => ({
      clientId: createClientId(),
      conversationId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }))
    updateItems((current) => [...current, ...additions])
    for (const item of additions) void uploadItem(item)
  }, [conversationId, showError, updateItems, uploadItem])

  const removeItem = useCallback(async (clientId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.clientId === clientId)
    if (!item) return
    controllersRef.current.get(clientId)?.abort()
    updateItems((current) => current.map((candidate) =>
      candidate.clientId === clientId ? { ...candidate, status: 'deleting' } : candidate,
    ))
    try {
      if (item.attachment) {
        await deleteConversationAttachment(item.conversationId, item.attachment.id)
      }
      URL.revokeObjectURL(item.previewUrl)
      updateItems((current) => current.filter((candidate) => candidate.clientId !== clientId))
    } catch (error) {
      updateItems((current) => current.map((candidate) =>
        candidate.clientId === clientId
          ? {
              ...candidate,
              status: 'error',
              error: error instanceof Error ? error.message : '删除图片失败',
            }
          : candidate,
      ))
    }
  }, [updateItems])

  const retryItem = useCallback((clientId: string) => {
    const item = itemsRef.current.find((candidate) => candidate.clientId === clientId)
    if (!item || item.status !== 'error') return
    if (item.attachment) {
      void removeItem(clientId)
    } else {
      void uploadItem(item)
    }
  }, [removeItem, uploadItem])

  const clearSubmitted = useCallback(() => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
    itemsRef.current = []
    if (mountedRef.current) setItems([])
  }, [])

  const discardItems = useCallback((discarded: ComposerImageAttachment[]) => {
    for (const item of discarded) {
      controllersRef.current.get(item.clientId)?.abort()
      controllersRef.current.delete(item.clientId)
      URL.revokeObjectURL(item.previewUrl)
      if (item.attachment) {
        void deleteConversationAttachment(item.conversationId, item.attachment.id).catch(() => undefined)
      }
    }
  }, [])

  const discardAll = useCallback(() => {
    const discarded = itemsRef.current
    itemsRef.current = []
    if (mountedRef.current) setItems([])
    discardItems(discarded)
  }, [discardItems])

  const previousConversationIdRef = useRef(conversationId)
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return
    const discarded = itemsRef.current
    itemsRef.current = []
    setItems([])
    discardItems(discarded)
    previousConversationIdRef.current = conversationId
  }, [conversationId, discardItems])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      discardItems(itemsRef.current)
      itemsRef.current = []
    }
  }, [discardItems])

  return {
    addFiles,
    attachments: items,
    clearSubmitted,
    discardAll,
    hasBlockingUpload: items.some((item) => item.status !== 'ready'),
    readyAttachments: items.flatMap((item) => item.attachment ? [item.attachment] : []),
    removeItem,
    retryItem,
  }
}
