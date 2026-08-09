import { XIcon } from 'lucide-react'

import { Button } from '#components/ui/button'
import { DialogClose, DialogContent, DialogRoot, DialogTitle } from '#components/ui/dialog'
import type { ConversationContextSummary } from '#types/chat'

type ConversationSummaryModalProps = {
  loading: boolean
  open: boolean
  summary?: ConversationContextSummary
  onClose: () => void
  onGenerate: () => void
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function ConversationSummaryModal({
  loading,
  open,
  summary,
  onClose,
  onGenerate,
}: ConversationSummaryModalProps) {
  return (
    <DialogRoot onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent className="summary-modal">
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>会话摘要</DialogTitle>
          <DialogClose aria-label="关闭" onClick={onClose} render={<Button className="close-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" size="icon" variant="ghost" />}>
            <XIcon aria-hidden="true" size={18} />
          </DialogClose>
        </header>
        <div className="modal-body summary-modal-body min-h-[220px] flex-1 overflow-y-auto p-[18px]">
          {summary ? (
            <>
              <p className="summary-meta m-0 text-xs font-semibold text-[var(--text-secondary)]">
                基于 {summary.sourceMessageCount} 条消息 · {formatTime(summary.updatedAt)}
              </p>
              <div className="summary-content mt-3.5 text-[13px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]">{summary.content}</div>
            </>
          ) : (
            <p className="summary-empty text-[13px] text-[var(--text-secondary)]">当前会话还没有摘要</p>
          )}
        </div>
        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogClose onClick={onClose} render={<Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" variant="outline" />}>关闭</DialogClose>
          <Button className="modal-btn primary h-[34px] rounded-[7px] bg-[var(--text-primary)] px-3.5 text-xs font-semibold text-[var(--app-bg)] hover:brightness-90" disabled={loading} onClick={onGenerate} type="button">
            {loading ? '生成中...' : summary ? '重新生成' : '生成摘要'}
          </Button>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
