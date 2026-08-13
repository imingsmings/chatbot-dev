import { useCallback, useEffect, useRef, useState } from 'react'

import { updateConversationModelOptions as updateConversationModelOptionsRequest } from '#api/conversations'
import type {
  ConversationDetail,
  ConversationModelOptions,
  ModelRequestOptions,
  RuntimeInfo,
} from '#types/chat'
import { resolveConversationModelOptions } from '#utils/modelOptions'

type UseConversationModelOptionsOptions = {
  applyConversationDetail: (conversation: ConversationDetail) => void
  currentConversationId: string | null
  currentConversationModelOptions?: ConversationModelOptions
  runtime: RuntimeInfo | null
  showError: (message: string, title?: string) => Promise<void>
  updateConversationModelOptions?: typeof updateConversationModelOptionsRequest
}

export function useConversationModelOptions(options: UseConversationModelOptionsOptions) {
  const [modelOptions, setModelOptions] = useState<ModelRequestOptions>({})
  const [isSaving, setIsSaving] = useState(false)
  const currentConversationIdRef = useRef(options.currentConversationId)
  const modelOptionsRef = useRef(modelOptions)
  const savingRef = useRef(false)
  const saveSequenceRef = useRef(0)

  currentConversationIdRef.current = options.currentConversationId
  modelOptionsRef.current = modelOptions

  useEffect(() => {
    if (!options.runtime) return
    setModelOptions(resolveConversationModelOptions(
      options.runtime,
      options.currentConversationModelOptions,
    ))
  }, [
    options.currentConversationId,
    options.currentConversationModelOptions,
    options.runtime,
  ])

  const saveModelOptions = useCallback(async (nextOptions: ModelRequestOptions): Promise<boolean> => {
    const conversationId = currentConversationIdRef.current
    const runtime = options.runtime
    if (!conversationId || !runtime || savingRef.current) return false

    const previousOptions = { ...modelOptionsRef.current }
    const normalizedOptions = resolveConversationModelOptions(runtime, nextOptions)
    const sequence = ++saveSequenceRef.current
    savingRef.current = true
    setIsSaving(true)
    setModelOptions(normalizedOptions)

    try {
      const request = options.updateConversationModelOptions ?? updateConversationModelOptionsRequest
      const conversation = await request(conversationId, normalizedOptions)
      options.applyConversationDetail(conversation)
      if (
        currentConversationIdRef.current === conversationId &&
        saveSequenceRef.current === sequence
      ) {
        setModelOptions(resolveConversationModelOptions(runtime, conversation.modelOptions))
      }
      return true
    } catch (error) {
      if (
        currentConversationIdRef.current === conversationId &&
        saveSequenceRef.current === sequence
      ) {
        setModelOptions(previousOptions)
      }
      await options.showError(
        error instanceof Error ? error.message : '保存会话模型配置失败',
      )
      return false
    } finally {
      if (saveSequenceRef.current === sequence) {
        savingRef.current = false
        setIsSaving(false)
      }
    }
  }, [options])

  return {
    isModelOptionsSaving: isSaving,
    modelOptions,
    saveModelOptions,
  }
}
