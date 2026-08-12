import { XIcon } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '#components/ui/button'
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from '#components/ui/dialog'
import type { ContextPreview } from '#types/chat'
import {
  formatModelName,
  formatProviderName,
  formatReasoningEffort,
  formatStorageBackend,
} from '#utils/displayNames'

type ContextDebugModalProps = {
  context: ContextPreview | null
  open: boolean
  onClose: () => void
}

export function ContextDebugModal({ context, open, onClose }: ContextDebugModalProps) {
  const formattedTools = useMemo(
    () => JSON.stringify(context?.tools.definitions ?? [], null, 2),
    [context],
  )
  const selectedHistoryRange = context?.stats.selectedHistoryRange
    ? `${context.stats.selectedHistoryRange.start}-${context.stats.selectedHistoryRange.end}`
    : 'None'

  return (
    <DialogRoot onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <DialogContent className="context-debug-modal w-[min(100%,920px)]">
        <header className="modal-header flex shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogTitle>Model Context</DialogTitle>
          <DialogClose aria-label="Close" onClick={onClose} render={<Button className="close-btn size-[34px] rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" size="icon" variant="ghost" />}>
            <XIcon aria-hidden="true" size={18} />
          </DialogClose>
        </header>
        <div className="modal-body context-debug-body min-h-0 flex-1 overflow-y-auto p-0">
          {context ? (
            <div className="context-debug-content flex flex-col gap-4 p-[18px]">
              <section aria-label="Context Statistics" className="context-debug-section">
                <div className="context-debug-stats grid grid-cols-4 gap-[7px] max-[820px]:grid-cols-2">
                  {[
                    ['History', `${context.stats.selectedHistoryMessages}/${context.stats.totalHistoryMessages}`],
                    ['Summary Covered', context.stats.summaryCoveredMessages],
                    ['After Summary', context.stats.postSummaryMessages],
                    ['Stopped Excluded', context.stats.excludedStoppedMessages],
                    ['Selected Range', selectedHistoryRange],
                    ['Dropped', context.stats.droppedHistoryMessages],
                    ['Characters', `${context.stats.selectedHistoryChars}/${context.stats.maxHistoryChars}`],
                    ['Tools', context.tools.count],
                    ['Summary', context.stats.summaryIncluded ? 'Included' : 'None'],
                  ].map(([label, value]) => (
                    <div className="context-debug-stat min-w-0 rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-[9px]" key={label}>
                      <span className="block text-[11px] text-[var(--text-secondary)]">{label}</span>
                      <strong className="mt-[5px] block text-sm [overflow-wrap:anywhere]">{value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Model Parameters" className="context-debug-section">
                <h4 className="mt-0 mb-[9px] text-[13px] font-semibold">Model Parameters</h4>
                <dl className="context-debug-meta grid grid-cols-3 gap-[7px] max-[820px]:grid-cols-2">
                  {[
                    ['Provider', formatProviderName(context.model.provider)],
                    ['Model', context.model.model ? formatModelName(context.model.model) : 'Not Configured'],
                    ['Streaming', context.model.stream ? 'Enabled' : 'Disabled'],
                    ['Tool Choice', context.model.toolChoice === 'auto' ? 'Auto' : context.model.toolChoice],
                    ['Reasoning', context.model.reasoningEnabled ? formatReasoningEffort(context.model.reasoningEffort) : 'Disabled'],
                    ['API Key', context.model.apiKeyConfigured ? 'Configured' : 'Not Configured'],
                    ['Storage', formatStorageBackend(context.model.storageBackend)],
                    ['Temperature', context.model.temperature ?? 'Provider Default'],
                    ['Max Tokens', context.model.maxTokens ?? 'Provider Default'],
                  ].map(([label, value]) => (
                    <div className="min-w-0 rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-[9px]" key={label}>
                      <dt className="block text-[11px] text-[var(--text-secondary)]">{label}</dt>
                      <dd className="mt-1 mb-0 text-xs font-semibold [overflow-wrap:anywhere]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-label="Messages Sent to Model" className="context-debug-section">
                <h4 className="mt-0 mb-[9px] text-[13px] font-semibold">Messages</h4>
                <ol className="context-message-list m-0 flex list-none flex-col gap-[7px] p-0">
                  {context.messages.map((message, index) => (
                    <li className="context-message-item min-w-0 rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-[9px]" key={`${index}-${message.role}`}>
                      <span className="context-message-role mb-1.5 inline-flex rounded-full bg-[var(--surface-muted)] px-1.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">{message.role.toUpperCase()}</span>
                      <pre className="context-message-content m-0 max-w-full overflow-x-auto font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-[var(--text-primary)] [overflow-wrap:anywhere]">{message.content || ''}</pre>
                    </li>
                  ))}
                </ol>
              </section>

              <details className="context-debug-details min-w-0 rounded-[7px] border border-[var(--border-soft)] bg-[var(--surface)] px-2.5 py-[9px]" open>
                <summary className="text-xs font-semibold text-[var(--text-secondary)]">Tool Definitions</summary>
                <pre className="mt-[9px] mb-0 max-w-full overflow-x-auto font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-[var(--text-primary)] [overflow-wrap:anywhere]">{formattedTools}</pre>
              </details>
            </div>
          ) : null}
        </div>
        <footer className="modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-soft)] px-[17px] py-[15px]">
          <DialogClose onClick={onClose} render={<Button className="modal-btn secondary h-[34px] rounded-[7px] border-[var(--border-strong)] bg-[var(--surface-raised)] px-3.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-muted)]" variant="outline" />}>
            Close
          </DialogClose>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
