import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createCustomPromptTemplate,
  CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY,
  exportCustomPromptTemplates,
  importCustomPromptTemplates,
  loadCustomPromptTemplates,
  saveCustomPromptTemplates,
  updateCustomPromptTemplate,
  type CustomPromptTemplate,
  type CustomPromptTemplateDraft,
  type CustomPromptTemplateImportResult,
} from '#utils/customPromptTemplates'

function createTemplateId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `custom-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function toStorageError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function loadInitialTemplates(): { templates: CustomPromptTemplate[]; error: string | null } {
  try {
    return { templates: loadCustomPromptTemplates(window.localStorage), error: null }
  } catch (error) {
    return {
      templates: [],
      error: `读取自定义模板失败：${toStorageError(error, '本地数据不可用')}`,
    }
  }
}

export function usePromptTemplates() {
  const [initialState] = useState(loadInitialTemplates)
  const [templates, setTemplates] = useState(initialState.templates)
  const [error, setError] = useState<string | null>(initialState.error)
  const templatesRef = useRef(templates)

  const commit = useCallback((nextTemplates: CustomPromptTemplate[]) => {
    try {
      saveCustomPromptTemplates(window.localStorage, nextTemplates)
      templatesRef.current = nextTemplates
      setTemplates(nextTemplates)
      setError(null)
    } catch (nextError) {
      const message = `保存自定义模板失败：${toStorageError(nextError, '本地存储不可用')}`
      setError(message)
      throw new Error(message)
    }
  }, [])

  const createTemplate = useCallback((draft: CustomPromptTemplateDraft) => {
    let template = createCustomPromptTemplate(draft, createTemplateId())
    while (templatesRef.current.some((item) => item.id === template.id)) {
      template = createCustomPromptTemplate(draft, createTemplateId())
    }
    commit([...templatesRef.current, template])
    return template
  }, [commit])

  const updateTemplate = useCallback((id: string, draft: CustomPromptTemplateDraft) => {
    const existing = templatesRef.current.find((template) => template.id === id)
    if (!existing) throw new Error('要编辑的自定义模板不存在')
    const updated = updateCustomPromptTemplate(existing, draft)
    commit(templatesRef.current.map((template) => template.id === id ? updated : template))
    return updated
  }, [commit])

  const deleteTemplate = useCallback((id: string) => {
    if (!templatesRef.current.some((template) => template.id === id)) {
      throw new Error('要删除的自定义模板不存在')
    }
    commit(templatesRef.current.filter((template) => template.id !== id))
  }, [commit])

  const importTemplates = useCallback((text: string): CustomPromptTemplateImportResult => {
    const result = importCustomPromptTemplates(templatesRef.current, text, createTemplateId)
    commit(result.templates)
    return result
  }, [commit])

  const exportTemplates = useCallback(() => exportCustomPromptTemplates(templatesRef.current), [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY || event.storageArea !== localStorage) return
      try {
        const nextTemplates = loadCustomPromptTemplates(window.localStorage)
        templatesRef.current = nextTemplates
        setTemplates(nextTemplates)
        setError(null)
      } catch (nextError) {
        setError(`同步自定义模板失败：${toStorageError(nextError, '本地数据无效')}`)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return {
    clearError: () => setError(null),
    createTemplate,
    deleteTemplate,
    error,
    exportTemplates,
    importTemplates,
    templates,
    updateTemplate,
  }
}
