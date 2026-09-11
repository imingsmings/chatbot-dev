import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

import { DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'

type SidePanelProps = {
  children: ReactNode
  label: string
  modal: boolean
  open: boolean
  side: 'left' | 'right'
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

// Desktop panels participate in layout; narrow screens use the same content in a focus-trapped sheet.
export function SidePanel({ children, label, modal, open, side, onClose, returnFocusRef }: SidePanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || modal || side !== 'right') return
    const trigger = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const panel = panelRef.current
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="menu"], [role="dialog"]')) return
      closeRef.current()
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
      if (trigger?.isConnected && (panel?.contains(document.activeElement) || document.activeElement === document.body)) trigger.focus()
    }
  }, [open, modal, side, returnFocusRef])
  if (!modal) {
    return open ? <section aria-label={label} className={`workspace-panel panel-${side}`} ref={panelRef}>{children}</section> : null
  }
  return (
    <DialogRoot open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={`workspace-sheet sheet-${side}`} side={side} finalFocus={returnFocusRef}>
        <DialogTitle className="sr-only">{label}</DialogTitle>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}
