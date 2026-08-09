import { XIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#components/ui/button'
import { DialogClose, DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'
import { Input } from '#components/ui/input'
import { Textarea } from '#components/ui/textarea'
import { cn } from '#lib/utils'
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

function createEmptyValues(template: PromptTemplate) {
  return Object.fromEntries(template.variables.map((variable) => [variable.name, '']))
}

export function PromptTemplateModal({ open, onApply, onClose }: PromptTemplateModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState(promptTemplates[0])
  const [values, setValues] = useState<Record<string, string>>(() =>
    createEmptyValues(promptTemplates[0]),
  )

  function selectTemplate(template: PromptTemplate) {
    setSelectedTemplate(template)
    setValues(createEmptyValues(template))
  }

  function applyTemplate() {
    onApply(renderPromptTemplate(selectedTemplate, values))
  }

  return (
    <DialogRoot onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent className="template-modal w-[min(100%,860px)]">
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>Prompt 模板</DialogTitle>
          <DialogClose aria-label="关闭" onClick={onClose} render={<Button className="close-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" size="icon" variant="ghost" />}>
            <XIcon aria-hidden="true" size={18} />
          </DialogClose>
        </header>
        <div className="modal-body template-modal-body grid min-h-[390px] flex-1 grid-cols-[180px_minmax(0,1fr)] gap-[18px] overflow-y-auto p-[18px] max-[820px]:min-h-0 max-[820px]:grid-cols-1">
          <nav aria-label="Prompt 模板列表" className="template-list flex flex-col gap-[3px] border-r border-[var(--border-soft)] pr-[13px] max-[820px]:flex-row max-[820px]:overflow-x-auto max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:pr-0 max-[820px]:pb-[9px]">
            {promptTemplates.map((template) => (
              <Button
                className={cn(
                  'template-list-item h-auto justify-start rounded-[7px] bg-transparent px-2.5 py-[9px] text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] max-[820px]:shrink-0',
                  template.id === selectedTemplate.id && 'active bg-[var(--surface-muted)] text-[var(--text-primary)]',
                )}
                key={template.id}
                onClick={() => selectTemplate(template)}
                type="button"
              >
                {template.name}
              </Button>
            ))}
          </nav>
          <form className="template-fields flex flex-col gap-3.5" onSubmit={(event) => { event.preventDefault(); applyTemplate() }}>
            <h4 className="m-0 text-sm font-semibold">{selectedTemplate.name}</h4>
            {selectedTemplate.variables.map((variable) => (
              <label className="settings-field flex flex-col gap-[7px] text-xs font-semibold text-[var(--text-secondary)]" htmlFor={`prompt-template-${variable.name}`} key={variable.name}>
                <span>{variable.label}</span>
                {variable.multiline ? (
                  <Textarea
                    className="min-h-32 w-full rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                    id={`prompt-template-${variable.name}`}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [variable.name]: event.target.value }))
                    }
                    placeholder={variable.placeholder}
                    rows={6}
                    value={values[variable.name] || ''}
                  />
                ) : (
                  <Input
                    className="h-auto rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                    id={`prompt-template-${variable.name}`}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [variable.name]: event.target.value }))
                    }
                    placeholder={variable.placeholder}
                    type="text"
                    value={values[variable.name] || ''}
                  />
                )}
              </label>
            ))}
          </form>
        </div>
        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogClose onClick={onClose} render={<Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" variant="outline" />}>取消</DialogClose>
          <Button className="modal-btn primary h-[34px] rounded-[7px] bg-[var(--text-primary)] px-3.5 text-xs font-semibold text-[var(--app-bg)] hover:brightness-90" onClick={applyTemplate} type="button">填入输入框</Button>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
