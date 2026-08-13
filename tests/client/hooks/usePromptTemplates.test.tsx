import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePromptTemplates } from '../../../client/src/hooks/usePromptTemplates'
import { CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY } from '../../../client/src/utils/customPromptTemplates'

describe('usePromptTemplates', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates, updates, exports, deletes, and restores custom templates', () => {
    const first = renderHook(() => usePromptTemplates())
    let templateId = ''

    act(() => {
      templateId = first.result.current.createTemplate({
        name: '自定义总结',
        content: '总结：{内容}',
      }).id
    })
    expect(first.result.current.templates).toHaveLength(1)

    act(() => {
      first.result.current.updateTemplate(templateId, {
        name: '自定义总结 2',
        content: '整理：\n\n{内容}',
      })
    })
    expect(first.result.current.templates[0]).toMatchObject({
      id: templateId,
      name: '自定义总结 2',
    })
    expect(JSON.parse(first.result.current.exportTemplates()).templates).toHaveLength(1)

    const second = renderHook(() => usePromptTemplates())
    expect(second.result.current.templates).toEqual(first.result.current.templates)

    act(() => first.result.current.deleteTemplate(templateId))
    expect(first.result.current.templates).toEqual([])
  })

  it('keeps malformed local data visible as an error instead of treating it as valid', () => {
    window.localStorage.setItem(CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY, '{bad json')

    const { result } = renderHook(() => usePromptTemplates())

    expect(result.current.templates).toEqual([])
    expect(result.current.error).toContain('读取自定义模板失败')
  })

  it('does not update React state when local storage rejects a write', () => {
    const { result } = renderHook(() => usePromptTemplates())
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() => {
      act(() => {
        result.current.createTemplate({ name: '无法保存', content: '内容' })
      })
    }).toThrow('保存自定义模板失败')
    expect(result.current.templates).toEqual([])
    expect(window.localStorage.getItem(CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY)).toBeNull()
    setItem.mockRestore()
  })

  it('reloads valid templates written by another browser tab', () => {
    const { result } = renderHook(() => usePromptTemplates())
    const storedValue = JSON.stringify({
      schemaVersion: 1,
      templates: [{ id: 'custom-other-tab', name: '其他标签页', content: '同步内容' }],
    })
    window.localStorage.setItem(CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY, storedValue)

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY,
        newValue: storedValue,
        storageArea: window.localStorage,
      }))
    })

    expect(result.current.templates).toEqual([
      { id: 'custom-other-tab', name: '其他标签页', content: '同步内容' },
    ])
  })
})
