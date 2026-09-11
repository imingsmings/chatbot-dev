import { ArrowUpRightIcon } from 'lucide-react'

import { Button } from '#components/ui/button'

type EmptyStateProps = {
  disabled: boolean
  suggestions: string[]
  title: string
  onUseSuggestion: (suggestion: string) => void
}

export function EmptyState({ disabled, suggestions, onUseSuggestion }: EmptyStateProps) {
  return (
    <section className="empty-state chat-content-column">
      <h2>有什么可以帮你？</h2>
      <div className="suggestion-grid">
        {suggestions.slice(0, 3).map((suggestion) => (
          <Button
            className="suggestion-card"
            disabled={disabled}
            key={suggestion}
            onClick={() => onUseSuggestion(suggestion)}
            type="button"
            variant="ghost"
          >
            <span>{suggestion}</span>
            <ArrowUpRightIcon aria-hidden="true" size={15} />
          </Button>
        ))}
      </div>
    </section>
  )
}
