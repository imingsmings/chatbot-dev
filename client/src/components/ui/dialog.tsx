import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '#lib/utils'

export const DialogRoot = BaseDialog.Root

export function DialogTitle({ className, ...props }: BaseDialog.Title.Props) {
  return (
    <BaseDialog.Title
      className={cn('m-0 text-sm leading-none font-semibold text-[var(--text-heading)]', className)}
      data-slot="dialog-title"
      {...props}
    />
  )
}

export function DialogDescription({ className, ...props }: BaseDialog.Description.Props) {
  return (
    <BaseDialog.Description
      className={cn('text-sm text-[var(--text-secondary)]', className)}
      data-slot="dialog-description"
      {...props}
    />
  )
}

type DialogContentProps = ComponentProps<typeof BaseDialog.Popup> & {
  children: ReactNode
  showCloseButton?: boolean
  onClose?: () => void
}

export function DialogContent({
  children,
  className,
  showCloseButton = false,
  onClose,
  ...props
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="modal-backdrop fixed inset-0 z-[1290] bg-[var(--overlay)] transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <BaseDialog.Viewport className="modal-overlay fixed inset-0 z-[1300] flex items-center justify-center overflow-y-auto p-6 max-[820px]:p-3">
        <BaseDialog.Popup
          className={cn(
            'modal-content relative flex max-h-[min(760px,86vh)] w-[min(100%,680px)] flex-col overflow-hidden rounded-[9px] border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[0_24px_80px_rgb(0_0_0/30%)] outline-none transition-[opacity,transform] duration-[120ms] data-[starting-style]:scale-[.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[.98] data-[ending-style]:opacity-0 max-[820px]:max-h-[92vh]',
            className,
          )}
          data-slot="dialog-content"
          {...props}
        >
          {children}
          {showCloseButton ? (
            <BaseDialog.Close
              aria-label="关闭"
              className="close-btn absolute top-3 right-3 inline-grid size-[34px] place-items-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              onClick={onClose}
            >
              <XIcon aria-hidden="true" size={18} />
            </BaseDialog.Close>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  )
}

export function DialogClose(props: BaseDialog.Close.Props) {
  return <BaseDialog.Close data-slot="dialog-close" {...props} />
}
