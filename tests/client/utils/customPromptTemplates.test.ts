import { describe, expect, it } from 'vitest'

import {
  createCustomPromptTemplate,
  CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY,
  exportCustomPromptTemplates,
  importCustomPromptTemplates,
  loadCustomPromptTemplates,
  MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH,
  parseCustomPromptTemplatesText,
  saveCustomPromptTemplates,
  toPromptTemplate,
} from '../../../client/src/utils/customPromptTemplates'
import {
  extractPromptTemplateVariables,
  renderPromptTemplate,
} from '../../../client/src/utils/promptTemplates'

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  }
}

describe('custom prompt templates', () => {
  it('extracts ordered unique Unicode variables and renders their values', () => {
    const content = '主题：{主题}\n\n{内容}\n再次确认：{主题}'
    const variables = extractPromptTemplateVariables(content)

    expect(variables).toEqual([
      { name: '主题', label: '主题', placeholder: '填写 主题', multiline: false },
      { name: '内容', label: '内容', placeholder: '填写 内容', multiline: true },
    ])
    expect(renderPromptTemplate(
      { id: 'custom-render', name: '测试', content, variables },
      { 主题: '流式协议', 内容: '逐行解析' },
    )).toBe('主题：流式协议\n\n逐行解析\n再次确认：流式协议')
  })

  it('round-trips versioned local storage and export documents', () => {
    const storage = createMemoryStorage()
    const template = createCustomPromptTemplate(
      { name: '代码审查', content: '审查以下代码：\n\n{code}' },
      'custom-review',
    )

    saveCustomPromptTemplates(storage, [template])

    expect(loadCustomPromptTemplates(storage)).toEqual([template])
    expect(JSON.parse(storage.values.get(CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY) || '')).toEqual({
      schemaVersion: 1,
      templates: [template],
    })
    expect(parseCustomPromptTemplatesText(exportCustomPromptTemplates([template]))).toEqual([template])
    expect(toPromptTemplate(template).variables).toEqual([
      { name: 'code', label: 'code', placeholder: '填写 code', multiline: true },
    ])
  })

  it('imports without overwriting, duplicates ID conflicts, and skips identical templates', () => {
    const current = [
      createCustomPromptTemplate({ name: '现有', content: '旧内容' }, 'custom-shared'),
    ]
    const incoming = {
      schemaVersion: 1,
      templates: [
        { ...current[0], id: 'custom-identical' },
        { id: 'custom-shared', name: '冲突模板', content: '新内容' },
        { id: 'custom-fresh', name: '新增模板', content: '内容 {topic}' },
      ],
    }

    const result = importCustomPromptTemplates(current, incoming, () => 'custom-copy')

    expect(result).toMatchObject({ total: 3, created: 1, duplicated: 1, skipped: 1 })
    expect(result.templates).toEqual([
      current[0],
      { id: 'custom-copy', name: '冲突模板', content: '新内容' },
      { id: 'custom-fresh', name: '新增模板', content: '内容 {topic}' },
    ])
  })

  it('rejects malformed, oversized, and duplicate-ID documents', () => {
    expect(() => parseCustomPromptTemplatesText('{')).toThrow('有效的 JSON')
    expect(() => parseCustomPromptTemplatesText(
      ' '.repeat(MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH + 1),
    )).toThrow('3 MB')
    expect(() => parseCustomPromptTemplatesText(JSON.stringify({
      schemaVersion: 2,
      templates: [],
    }))).toThrow('不支持的模板文件版本')
    expect(() => parseCustomPromptTemplatesText(JSON.stringify({
      schemaVersion: 1,
      templates: [
        { id: 'custom-a', name: 'A', content: 'A' },
        { id: 'custom-a', name: 'B', content: 'B' },
      ],
    }))).toThrow('重复 ID')
    expect(() => createCustomPromptTemplate(
      { name: 'A', content: 'x'.repeat(20_001) },
      'custom-too-long',
    )).toThrow('20000')
  })
})
