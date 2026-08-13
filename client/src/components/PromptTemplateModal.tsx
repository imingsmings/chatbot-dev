import {
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '#components/ui/button'
import { DialogClose, DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'
import { Input } from '#components/ui/input'
import { Textarea } from '#components/ui/textarea'
import { PromptTemplateEditor } from '#components/PromptTemplateEditor'
import { usePromptTemplates } from '#hooks/usePromptTemplates'
import { cn } from '#lib/utils'
import {
  MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH,
  toPromptTemplate,
  type CustomPromptTemplateDraft,
} from '#utils/customPromptTemplates'
import {
  promptTemplates,
  renderPromptTemplate,
  type PromptTemplate,
} from '#utils/promptTemplates'

type PromptTemplateModalProps = {
  open: boolean
  onApply: (prompt: string) => void
  onClose: () => void
}

type EditorState = {
  mode: 'create' | 'edit'
  templateId: string | null
  draft: CustomPromptTemplateDraft
}

function createEmptyValues(template: PromptTemplate) {
  return Object.fromEntries(template.variables.map((variable) => [variable.name, '']))
}

function downloadTemplates(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `chatbot-prompt-templates-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function PromptTemplateModal({ open, onApply, onClose }: PromptTemplateModalProps) {
  const {
    clearError: clearStorageError,
    createTemplate,
    deleteTemplate,
    error: storageError,
    exportTemplates,
    importTemplates,
    templates: customTemplates,
    updateTemplate,
  } = usePromptTemplates()
  const allTemplates = useMemo(
    () => [...promptTemplates, ...customTemplates.map(toPromptTemplate)],
    [customTemplates],
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState(promptTemplates[0].id)
  const selectedTemplate = allTemplates.find((template) => template.id === selectedTemplateId)
    || promptTemplates[0]
  const selectedCustomTemplate = customTemplates.find(
    (template) => template.id === selectedTemplate.id,
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    createEmptyValues(promptTemplates[0]),
  )
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValues(createEmptyValues(selectedTemplate))
  }, [selectedTemplate])

  useEffect(() => {
    if (!allTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(promptTemplates[0].id)
    }
  }, [allTemplates, selectedTemplateId])

  useEffect(() => {
    if (!open) {
      setEditor(null)
      setActionError(null)
      setStatus(null)
      setDeleteConfirmationId(null)
    }
  }, [open])

  function resetMessages() {
    clearStorageError()
    setActionError(null)
    setStatus(null)
  }

  function selectTemplate(template: PromptTemplate) {
    resetMessages()
    setEditor(null)
    setDeleteConfirmationId(null)
    setSelectedTemplateId(template.id)
    setValues(createEmptyValues(template))
  }

  function startCreate() {
    resetMessages()
    setDeleteConfirmationId(null)
    setEditor({ mode: 'create', templateId: null, draft: { name: '', content: '' } })
  }

  function startEdit() {
    if (!selectedCustomTemplate) return
    resetMessages()
    setDeleteConfirmationId(null)
    setEditor({
      mode: 'edit',
      templateId: selectedCustomTemplate.id,
      draft: {
        name: selectedCustomTemplate.name,
        content: selectedCustomTemplate.content,
      },
    })
  }

  function saveEditor() {
    if (!editor) return
    resetMessages()
    try {
      const template = editor.mode === 'create'
        ? createTemplate(editor.draft)
        : updateTemplate(editor.templateId || '', editor.draft)
      setSelectedTemplateId(template.id)
      setEditor(null)
      setStatus(editor.mode === 'create' ? '自定义模板已创建' : '自定义模板已更新')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存模板失败')
    }
  }

  function removeSelectedTemplate() {
    if (!selectedCustomTemplate) return
    if (deleteConfirmationId !== selectedCustomTemplate.id) {
      resetMessages()
      setDeleteConfirmationId(selectedCustomTemplate.id)
      setStatus('再次点击“确认删除”以删除该模板')
      return
    }

    resetMessages()
    try {
      deleteTemplate(selectedCustomTemplate.id)
      setSelectedTemplateId(promptTemplates[0].id)
      setDeleteConfirmationId(null)
      setStatus('自定义模板已删除')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除模板失败')
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    resetMessages()
    try {
      if (file.size > MAX_CUSTOM_PROMPT_TEMPLATE_IMPORT_LENGTH) {
        throw new Error('模板文件不能超过 3 MB')
      }
      const result = importTemplates(await file.text())
      if (result.firstImportedId) setSelectedTemplateId(result.firstImportedId)
      setEditor(null)
      setDeleteConfirmationId(null)
      setStatus(
        `导入完成：新增 ${result.created}，冲突副本 ${result.duplicated}，跳过 ${result.skipped}`,
      )
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '导入模板失败')
    }
  }

  function handleExport() {
    resetMessages()
    try {
      downloadTemplates(exportTemplates())
      setStatus(`已导出 ${customTemplates.length} 个自定义模板`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '导出模板失败')
    }
  }

  function applyTemplate() {
    onApply(renderPromptTemplate(selectedTemplate, values))
  }

  const visibleError = actionError || storageError

  return (
    <DialogRoot onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent className="template-modal w-[min(100%,900px)]">
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>Prompt 模板</DialogTitle>
          <DialogClose aria-label="关闭" onClick={onClose} render={<Button className="close-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" size="icon" variant="ghost" />}>
            <XIcon aria-hidden="true" size={18} />
          </DialogClose>
        </header>

        <div className="modal-body template-modal-body grid min-h-[430px] flex-1 grid-cols-[220px_minmax(0,1fr)] gap-[18px] overflow-y-auto p-[18px] max-[820px]:min-h-0 max-[820px]:grid-cols-1">
          <aside className="template-sidebar flex min-h-0 flex-col gap-3 border-r border-[var(--border-soft)] pr-[13px] max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:pr-0 max-[820px]:pb-3">
            <div className="template-toolbar grid grid-cols-3 gap-1.5">
              <Button aria-label="新建模板" className="h-8 gap-1 px-2 text-[11px]" onClick={startCreate} type="button" variant="outline">
                <PlusIcon aria-hidden="true" size={13} />新建
              </Button>
              <Button aria-label="导入模板" className="h-8 gap-1 px-2 text-[11px]" onClick={() => importInputRef.current?.click()} type="button" variant="outline">
                <UploadIcon aria-hidden="true" size={13} />导入
              </Button>
              <Button aria-label="导出模板" className="h-8 gap-1 px-2 text-[11px]" disabled={customTemplates.length === 0} onClick={handleExport} type="button" variant="outline">
                <DownloadIcon aria-hidden="true" size={13} />导出
              </Button>
              <input
                accept="application/json,.json"
                aria-label="导入模板文件"
                className="sr-only"
                onChange={(event) => void handleImport(event)}
                ref={importInputRef}
                type="file"
              />
            </div>

            <nav aria-label="Prompt 模板列表" className="template-list flex min-h-0 flex-col gap-1 overflow-y-auto max-[820px]:max-h-48">
              <p className="m-0 px-2.5 pt-1 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)]">内置模板</p>
              {promptTemplates.map((template) => (
                <TemplateListButton
                  key={template.id}
                  onClick={() => selectTemplate(template)}
                  selected={!editor && template.id === selectedTemplate.id}
                  template={template}
                />
              ))}
              <p className="m-0 mt-2 px-2.5 pt-1 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)]">自定义模板</p>
              {customTemplates.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-xs leading-5 text-[var(--text-tertiary)]">还没有自定义模板</p>
              ) : customTemplates.map((template) => {
                const promptTemplate = toPromptTemplate(template)
                return (
                  <TemplateListButton
                    custom
                    key={template.id}
                    onClick={() => selectTemplate(promptTemplate)}
                    selected={!editor && template.id === selectedTemplate.id}
                    template={promptTemplate}
                  />
                )
              })}
            </nav>
          </aside>

          {editor ? (
            <PromptTemplateEditor
              draft={editor.draft}
              mode={editor.mode}
              onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)}
            />
          ) : (
            <form className="template-fields flex min-w-0 flex-col gap-3.5" onSubmit={(event) => { event.preventDefault(); applyTemplate() }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="m-0 text-sm font-semibold">{selectedTemplate.name}</h4>
                  <p className="mt-1 mb-0 text-xs text-[var(--text-tertiary)]">{selectedCustomTemplate ? '自定义模板 · 保存在当前浏览器' : '内置模板 · 只读'}</p>
                </div>
                {selectedCustomTemplate ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button aria-label="编辑自定义模板" className="size-8" onClick={startEdit} size="icon" type="button" variant="outline">
                      <PencilIcon aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label={deleteConfirmationId === selectedCustomTemplate.id ? '确认删除自定义模板' : '删除自定义模板'}
                      className={cn('h-8 gap-1.5 px-2.5 text-xs', deleteConfirmationId === selectedCustomTemplate.id && 'border-[var(--danger)] text-[var(--danger)]')}
                      onClick={removeSelectedTemplate}
                      type="button"
                      variant="outline"
                    >
                      <Trash2Icon aria-hidden="true" size={14} />
                      {deleteConfirmationId === selectedCustomTemplate.id ? '确认删除' : '删除'}
                    </Button>
                  </div>
                ) : null}
              </div>

              {selectedTemplate.variables.length === 0 ? (
                <div className="max-h-64 overflow-auto rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 font-mono text-[13px] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {selectedTemplate.content}
                </div>
              ) : selectedTemplate.variables.map((variable) => (
                <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor={`prompt-template-${variable.name}`} key={variable.name}>
                  <span>{variable.label}</span>
                  {variable.multiline ? (
                    <Textarea
                      className="min-h-32 w-full rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                      id={`prompt-template-${variable.name}`}
                      onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}
                      placeholder={variable.placeholder}
                      rows={6}
                      value={values[variable.name] || ''}
                    />
                  ) : (
                    <Input
                      className="h-auto rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                      id={`prompt-template-${variable.name}`}
                      onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}
                      placeholder={variable.placeholder}
                      type="text"
                      value={values[variable.name] || ''}
                    />
                  )}
                </label>
              ))}
            </form>
          )}
        </div>

        {(visibleError || status) ? (
          <div className="border-t border-[var(--border-soft)] px-[17px] py-2.5">
            {visibleError ? <p className="m-0 text-xs text-[var(--danger)]" role="alert">{visibleError}</p> : null}
            {!visibleError && status ? <output className="m-0 block text-xs text-[var(--text-secondary)]">{status}</output> : null}
          </div>
        ) : null}

        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          {editor ? (
            <>
              <Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" onClick={() => { setEditor(null); resetMessages() }} type="button" variant="outline">取消编辑</Button>
              <Button className="modal-btn primary h-[34px] rounded-[7px] bg-[var(--text-primary)] px-3.5 text-xs font-semibold text-[var(--app-bg)] hover:brightness-90" onClick={saveEditor} type="button">保存模板</Button>
            </>
          ) : (
            <>
              <DialogClose onClick={onClose} render={<Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" variant="outline" />}>取消</DialogClose>
              <Button className="modal-btn primary h-[34px] rounded-[7px] bg-[var(--text-primary)] px-3.5 text-xs font-semibold text-[var(--app-bg)] hover:brightness-90" onClick={applyTemplate} type="button">填入输入框</Button>
            </>
          )}
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}

function TemplateListButton(props: {
  custom?: boolean
  onClick: () => void
  selected: boolean
  template: PromptTemplate
}) {
  return (
    <Button
      className={cn(
        'template-list-item h-auto min-w-0 justify-start rounded-[7px] bg-transparent px-2.5 py-[9px] text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]',
        props.selected && 'active bg-[var(--surface-muted)] text-[var(--text-primary)]',
      )}
      data-custom-template={props.custom ? 'true' : undefined}
      onClick={props.onClick}
      type="button"
    >
      <span className="truncate">{props.template.name}</span>
    </Button>
  )
}
