import { CheckIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'

import { MarkdownMessage } from '#components/MarkdownMessage'
import { ReasoningDisclosure } from '#components/ReasoningDisclosure'
import { Button } from '#components/ui/button'
import { CHAT_CONTENT_COLUMN_CLASS } from '#lib/chatLayout'
import { cn } from '#lib/utils'
import type { ChatMessage, ToolActivity } from '#types/chat'
import { formatModelName, formatProviderName } from '#utils/displayNames'

type MessageListProps = {
  copiedMessageId: string | null
  isResponding: boolean
  messages: ChatMessage[]
  onCopyMessage: (message: ChatMessage) => void
  onRetryMessage: (index: number) => void
}

function getToolActivityLabel(activity: ToolActivity) {
  const label = activity.status === 'running'
    ? '执行中'
    : activity.status === 'stopped'
      ? activity.summary || '已停止'
      : activity.summary || (activity.status === 'success' ? '执行完成' : '执行失败')
  return activity.durationMs === undefined ? label : `${label} · ${activity.durationMs}ms`
}

function GenerationDetails({ message }: { message: ChatMessage }) {
  const generation = message.generation
  if (!generation) return null

  const usage = generation.usage
  const rows = [
    ['状态', message.status === 'stopped' ? '已停止' : '已完成'],
    ['Provider', formatProviderName(generation.provider)],
    ['模型', formatModelName(generation.model)],
    ['结束原因', generation.finishReason ?? '未知'],
    ['首 token 延迟', generation.firstTokenLatencyMs === undefined ? '未知' : `${generation.firstTokenLatencyMs}ms`],
    ['总耗时', `${generation.totalDurationMs}ms`],
    ['输入 token', usage?.inputTokens ?? '未知'],
    ['输出 token', usage?.outputTokens ?? '未知'],
    ['总 token', usage?.totalTokens ?? '未知'],
    ['推理 token', usage?.reasoningTokens ?? '未知'],
    ['缓存输入 token', usage?.cachedInputTokens ?? '未知'],
  ]

  return (
    <details aria-label="生成详情" className="generation-details w-fit max-w-full rounded-md border border-[var(--border-soft)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
      <summary className="cursor-pointer select-none font-medium">生成详情</summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt>{label}</dt>
            <dd className="m-0 font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function MessageList({
  copiedMessageId,
  isResponding,
  messages,
  onCopyMessage,
  onRetryMessage,
}: MessageListProps) {
  return (
    <div className={cn('message-list flex flex-col gap-[22px] max-[820px]:gap-1.5', CHAT_CONTENT_COLUMN_CLASS)}>
      {messages.map((message, index) => {
        const isUser = message.role === 'user'
        const hasReasoning = Boolean(message.reasoningText)

        return (
          <article
            className={cn(
              'message-row group items-start py-[9px] pb-[13px]',
              message.role,
              message.status === 'pending' && 'pending items-center',
              isUser
                ? 'flex justify-end pt-2 pb-3.5'
                : 'grid grid-cols-[minmax(0,1fr)]',
            )}
            key={message.id}
          >
            <div
              className={cn(
                'message-content flex min-w-0 flex-col gap-[7px]',
                isUser
                  ? 'max-w-[min(72%,520px)] items-end max-[820px]:max-w-[88%]'
                  : 'max-w-[932px] dark:max-w-[884px] max-[820px]:max-w-full',
              )}
            >
            {message.role === 'assistant' ? <ReasoningDisclosure {...message} /> : null}

            {message.role === 'assistant' && message.toolActivities?.length ? (
              <div aria-label="工具执行状态" className="tool-activity-list flex flex-col gap-[5px] text-xs text-[var(--text-secondary)]">
                {message.toolActivities.map((activity) => (
                  <div className={`tool-activity ${activity.status} grid grid-cols-[7px_auto_minmax(0,1fr)] items-center gap-[7px]`} key={activity.id}>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'tool-activity-indicator size-1.5 rounded-full bg-[var(--text-tertiary)]',
                        activity.status === 'running' && 'animate-pulse',
                        activity.status === 'success' && 'bg-[var(--success)]',
                        activity.status === 'error' && 'bg-[var(--danger)]',
                      )}
                    />
                    <strong>{activity.name}</strong>
                    <span>{getToolActivityLabel(activity)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {message.status === 'pending' ? (
              <div className="message-text thinking-text inline-flex w-fit animate-pulse text-[13px] text-[var(--text-secondary)]">Thinking...</div>
            ) : message.status === 'error' && !message.text ? (
              <div className="message-text error-text text-[var(--danger)]">{message.error || '响应失败，请重试'}</div>
            ) : message.role === 'user' ? (
              <div className="message-text [overflow-wrap:anywhere] rounded-[12px_12px_3px_12px] bg-[var(--user-message-bg)] px-6 py-3 text-sm leading-[1.55] whitespace-pre-wrap text-[var(--user-message-text)] max-[820px]:px-[13px] max-[820px]:py-[9px]">
                {message.text}
              </div>
            ) : message.text ? (
              <MarkdownMessage
                className={cn(
                  'message-text [overflow-wrap:anywhere] text-sm leading-[1.65] font-normal whitespace-pre-wrap text-[var(--text-primary)]',
                  hasReasoning && 'mt-1.5',
                )}
                content={message.text}
                streaming={message.status === 'streaming'}
              />
            ) : null}

            {message.status === 'error' && message.text ? (
              <div className="message-status-text error-text text-xs font-medium text-[var(--danger)]">
                {message.error || '响应失败，请重试'}
              </div>
            ) : null}
            {message.status === 'stopped' ? (
              <div className="message-status-text text-xs font-medium text-[var(--text-secondary)]">已停止生成</div>
            ) : null}

            {message.role === 'assistant' ? <GenerationDetails message={message} /> : null}

            {message.role === 'assistant' ? (
              <div className="message-actions flex items-center gap-0.5 opacity-100 transition-opacity">
                {message.text && message.status !== 'pending' && message.status !== 'streaming' ? (
                  <Button
                    aria-label={copiedMessageId === message.id ? '已复制' : '复制回答'}
                    className="message-action-btn min-h-7 gap-[5px] rounded-md px-[7px] text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                    onClick={() => onCopyMessage(message)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    {copiedMessageId === message.id ? (
                      <CheckIcon aria-hidden="true" size={15} />
                    ) : (
                      <CopyIcon aria-hidden="true" size={15} />
                    )}
                    <span>{copiedMessageId === message.id ? '已复制' : '复制'}</span>
                  </Button>
                ) : null}
                {message.status === 'error' ? (
                  <Button
                    className="message-action-btn min-h-7 gap-[5px] rounded-md px-[7px] text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                    disabled={isResponding}
                    onClick={() => onRetryMessage(index)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <RefreshCwIcon aria-hidden="true" size={15} />
                    <span>重试</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
