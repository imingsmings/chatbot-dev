import {
  extractPromptTemplateVariables,
  type PromptTemplate,
} from '#utils/promptTemplates'

export const CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY = 'chatbot-custom-prompt-templates'
export const CUSTOM_PROMPT_TEMPLATES_SCHEMA_VERSION = 1
export const MAX_CUSTOM_PROMPT_TEMPLATES = 100
export const MAX_CUSTOM_PROMPT_TEMPLATE_NAME_LENGTH = 80
export const MAX_CUSTOM_PROMPT_TEMPLATE_CONTENT_LENGTH = 20_000
export const MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH = 3_000_000

const CUSTOM_TEMPLATE_ID_PATTERN = /^custom-[a-zA-Z0-9_-]{1,92}$/

export type CustomPromptTemplate = {
  id: string
  name: string
  content: string
}

export type CustomPromptTemplateDraft = Pick<CustomPromptTemplate, 'name' | 'content'>

export type CustomPromptTemplateImportResult = {
  templates: CustomPromptTemplate[]
  total: number
  created: number
  duplicated: number
  skipped: number
  firstImportedId: string | null
}

type StoredCustomPromptTemplates = {
  schemaVersion: typeof CUSTOM_PROMPT_TEMPLATES_SCHEMA_VERSION
  templates: CustomPromptTemplate[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDraft(value: unknown, label = '模板'): CustomPromptTemplateDraft {
  if (!isRecord(value)) {
    throw new Error(`${label}格式无效`)
  }

  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const content = typeof value.content === 'string' ? value.content : ''

  if (!name) throw new Error(`${label}名称不能为空`)
  if (name.length > MAX_CUSTOM_PROMPT_TEMPLATE_NAME_LENGTH) {
    throw new Error(`${label}名称不能超过 ${MAX_CUSTOM_PROMPT_TEMPLATE_NAME_LENGTH} 个字符`)
  }
  if (!content.trim()) throw new Error(`${label}内容不能为空`)
  if (content.length > MAX_CUSTOM_PROMPT_TEMPLATE_CONTENT_LENGTH) {
    throw new Error(`${label}内容不能超过 ${MAX_CUSTOM_PROMPT_TEMPLATE_CONTENT_LENGTH} 个字符`)
  }

  return { name, content }
}

function normalizeTemplate(value: unknown, index: number): CustomPromptTemplate {
  const draft = normalizeDraft(value, `第 ${index + 1} 个模板`)
  const id = isRecord(value) && typeof value.id === 'string' ? value.id.trim() : ''

  if (!CUSTOM_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`第 ${index + 1} 个模板 ID 无效`)
  }

  const variableCount = extractPromptTemplateVariables(draft.content).length
  if (variableCount > 20) {
    throw new Error(`第 ${index + 1} 个模板变量不能超过 20 个`)
  }

  return { id, ...draft }
}

function normalizeTemplates(values: unknown[]): CustomPromptTemplate[] {
  if (values.length > MAX_CUSTOM_PROMPT_TEMPLATES) {
    throw new Error(`自定义模板不能超过 ${MAX_CUSTOM_PROMPT_TEMPLATES} 个`)
  }

  const templates = values.map(normalizeTemplate)
  if (new Set(templates.map((template) => template.id)).size !== templates.length) {
    throw new Error('模板文件包含重复 ID')
  }
  return templates
}

export function parseCustomPromptTemplates(value: unknown): CustomPromptTemplate[] {
  if (!isRecord(value)) throw new Error('模板文件格式无效')
  if (value.schemaVersion !== CUSTOM_PROMPT_TEMPLATES_SCHEMA_VERSION) {
    throw new Error(`不支持的模板文件版本：${String(value.schemaVersion)}`)
  }
  if (!Array.isArray(value.templates)) throw new Error('模板文件缺少 templates 数组')
  return normalizeTemplates(value.templates)
}

export function parseCustomPromptTemplatesText(text: string): CustomPromptTemplate[] {
  if (text.length > MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH) {
    throw new Error('模板文件不能超过 3 MB')
  }

  try {
    return parseCustomPromptTemplates(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('模板文件不是有效的 JSON')
    throw error
  }
}

function createStorageDocument(templates: CustomPromptTemplate[]): StoredCustomPromptTemplates {
  return {
    schemaVersion: CUSTOM_PROMPT_TEMPLATES_SCHEMA_VERSION,
    templates: normalizeTemplates(templates),
  }
}

export function loadCustomPromptTemplates(storage: Pick<Storage, 'getItem'>): CustomPromptTemplate[] {
  const value = storage.getItem(CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY)
  return value === null ? [] : parseCustomPromptTemplatesText(value)
}

export function saveCustomPromptTemplates(
  storage: Pick<Storage, 'setItem'>,
  templates: CustomPromptTemplate[],
): void {
  storage.setItem(
    CUSTOM_PROMPT_TEMPLATES_STORAGE_KEY,
    JSON.stringify(createStorageDocument(templates)),
  )
}

export function exportCustomPromptTemplates(templates: CustomPromptTemplate[]): string {
  return JSON.stringify(
    {
      ...createStorageDocument(templates),
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

export function createCustomPromptTemplate(
  draftValue: CustomPromptTemplateDraft,
  id: string,
): CustomPromptTemplate {
  return normalizeTemplate({ id, ...normalizeDraft(draftValue) }, 0)
}

export function updateCustomPromptTemplate(
  template: CustomPromptTemplate,
  draftValue: CustomPromptTemplateDraft,
): CustomPromptTemplate {
  return normalizeTemplate({ id: template.id, ...normalizeDraft(draftValue) }, 0)
}

export function toPromptTemplate(template: CustomPromptTemplate): PromptTemplate {
  return {
    ...template,
    variables: extractPromptTemplateVariables(template.content),
  }
}

function isSameTemplate(
  left: Pick<CustomPromptTemplate, 'name' | 'content'>,
  right: Pick<CustomPromptTemplate, 'name' | 'content'>,
): boolean {
  return left.name === right.name && left.content === right.content
}

export function importCustomPromptTemplates(
  currentTemplates: CustomPromptTemplate[],
  importedValue: unknown,
  createId: () => string,
): CustomPromptTemplateImportResult {
  const incomingTemplates = typeof importedValue === 'string'
    ? parseCustomPromptTemplatesText(importedValue)
    : parseCustomPromptTemplates(importedValue)
  const templates = [...normalizeTemplates(currentTemplates)]
  let created = 0
  let duplicated = 0
  let skipped = 0
  let firstImportedId: string | null = null

  for (const incoming of incomingTemplates) {
    if (templates.some((template) => isSameTemplate(template, incoming))) {
      skipped += 1
      continue
    }

    let candidate = incoming
    if (templates.some((template) => template.id === incoming.id)) {
      candidate = createCustomPromptTemplate(incoming, createId())
      duplicated += 1
    } else {
      created += 1
    }
    templates.push(candidate)
    firstImportedId ??= candidate.id
  }

  if (templates.length > MAX_CUSTOM_PROMPT_TEMPLATES) {
    throw new Error(`导入后自定义模板不能超过 ${MAX_CUSTOM_PROMPT_TEMPLATES} 个`)
  }

  return {
    templates,
    total: incomingTemplates.length,
    created,
    duplicated,
    skipped,
    firstImportedId,
  }
}
