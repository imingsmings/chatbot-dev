import { ChevronRightIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ChatMessage } from '#types/chat'

type ReasoningDisclosureProps = Pick<
  ChatMessage,
  'reasoningDurationMs' | 'reasoningText' | 'status'
>

function getReasoningLabel({ reasoningDurationMs, status }: ReasoningDisclosureProps) {
  if (status === 'streaming') return 'Thinking...'
  if (typeof reasoningDurationMs !== 'number') return '已深度思考'

  const seconds = Math.max(1, Math.round(reasoningDurationMs / 1_000))
  return `已深度思考（用时 ${seconds} 秒）`
}

export function ReasoningDisclosure(props: ReasoningDisclosureProps) {
  const [expanded, setExpanded] = useState(props.status === 'streaming')

  useEffect(() => {
    if (props.status === 'streaming') setExpanded(true)
    if (props.status !== 'streaming') setExpanded(false)
  }, [props.status])

  if (!props.reasoningText) return null

  return (
    <details
      className="reasoning-panel w-[min(100%,760px)] text-sm leading-[1.6] text-[var(--text-secondary)] max-[820px]:text-[13px]"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary className="reasoning-summary inline-flex w-fit list-none items-center gap-1.5 text-sm text-[var(--text-tertiary)] max-[820px]:text-[13px]">
        <span>{getReasoningLabel(props)}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'}
          size={14}
        />
      </summary>
      <div className="reasoning-content mt-[7px]">
        <div className="reasoning-content-body [overflow-wrap:anywhere] border-l border-[var(--border-strong)] pl-3 whitespace-pre-wrap text-[var(--text-secondary)]">
          {props.reasoningText.trim()}
        </div>
      </div>
    </details>
  )
}
