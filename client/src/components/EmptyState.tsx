import { ArrowUpRightIcon, SparklesIcon } from 'lucide-react'

import { Button } from '#components/ui/button'

type EmptyStateProps = {
  disabled: boolean
  suggestions: string[]
  title: string
  onUseSuggestion: (suggestion: string) => void
}

export function EmptyState({ disabled, suggestions, title, onUseSuggestion }: EmptyStateProps) {
  return (
    <section className="empty-state mx-auto flex min-h-full w-[min(100%,760px)] flex-col items-center justify-center px-0 pt-6 pb-20 text-center max-[820px]:pt-[18px] max-[820px]:pb-11">
      <div className="empty-mark grid size-[38px] place-items-center rounded-[9px] border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]">
        <SparklesIcon aria-hidden="true" size={20} />
      </div>
      <p className="empty-kicker mt-[17px] mb-0 text-[13px] text-[var(--text-secondary)]">有什么可以帮你？</p>
      <h2 className="mt-0 mb-6 text-xl leading-[1.3] font-semibold text-[var(--text-heading)] max-[820px]:text-lg">{title}</h2>
      <div className="suggestion-grid grid w-[min(100%,660px)] grid-cols-2 gap-2 max-[820px]:grid-cols-1">
        {suggestions.map((suggestion) => (
          <Button
            className="suggestion-card min-h-12 justify-between gap-3 rounded-lg border-[var(--border-soft)] bg-transparent px-3 py-2.5 text-left text-[13px] font-normal whitespace-normal text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            disabled={disabled}
            key={suggestion}
            onClick={() => onUseSuggestion(suggestion)}
            type="button"
            variant="outline"
          >
            <span>{suggestion}</span>
            <ArrowUpRightIcon aria-hidden="true" size={15} />
          </Button>
        ))}
      </div>
    </section>
  )
}
