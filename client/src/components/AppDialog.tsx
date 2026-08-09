import { useEffect, useRef, useState } from 'react'

import {
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '#components/ui/dialog'
import { Button } from '#components/ui/button'
import { Input } from '#components/ui/input'
import type { DialogState } from '#hooks/useAppDialog'

type AppDialogProps = {
  dialog: DialogState
  onCancel: () => void
  onConfirm: (value: string | true) => void
}

export function AppDialog({ dialog, onCancel, onConfirm }: AppDialogProps) {
  const [draftValue, setDraftValue] = useState(dialog.initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!dialog.open) return
    setDraftValue(dialog.initialValue)
  }, [dialog.initialValue, dialog.open])

  return (
    <DialogRoot
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      open={dialog.open}
    >
      <DialogContent
        className="app-dialog"
        initialFocus={dialog.mode === 'prompt' ? inputRef : confirmButtonRef}
      >
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>{dialog.title}</DialogTitle>
        </header>
        <div className="modal-body min-h-0 flex-1 overflow-y-auto p-[18px]">
          <DialogDescription className="dialog-message m-0 text-[13px] leading-[1.6] whitespace-pre-wrap text-[var(--text-primary)] [overflow-wrap:anywhere]">{dialog.message}</DialogDescription>
          {dialog.mode === 'prompt' ? (
            <label className="dialog-field mt-4 flex flex-col gap-[7px]" htmlFor="app-dialog-conversation-name">
              <span className="dialog-label text-xs font-semibold text-[var(--text-secondary)]">会话名称</span>
              <Input
                className="dialog-input h-auto rounded-[7px] border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-[9px] text-[13px] text-[var(--text-primary)] focus-visible:border-[var(--ring)] focus-visible:ring-0"
                id="app-dialog-conversation-name"
                onChange={(event) => setDraftValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onConfirm(draftValue)
                  }
                }}
                ref={inputRef}
                type="text"
                value={draftValue}
              />
            </label>
          ) : null}
        </div>
        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          {dialog.mode !== 'alert' ? (
            <Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" onClick={onCancel} type="button" variant="outline">
              {dialog.cancelLabel}
            </Button>
          ) : null}
          <Button
            className={`modal-btn h-[34px] rounded-[7px] px-3.5 text-xs font-semibold${dialog.danger ? ' danger bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90' : ' bg-[var(--text-primary)] text-[var(--app-bg)] hover:brightness-90'}`}
            onClick={() => onConfirm(dialog.mode === 'prompt' ? draftValue : true)}
            ref={confirmButtonRef}
            type="button"
          >
            {dialog.confirmLabel}
          </Button>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
