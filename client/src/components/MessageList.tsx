import { useCallback, useLayoutEffect, useRef } from 'react'

import { MessageRow } from '#components/MessageRow'
import { CHAT_CONTENT_COLUMN_CLASS } from '#lib/chatLayout'
import { cn } from '#lib/utils'
import type { ChatMessage } from '#types/chat'

type MessageListProps = {
  copiedMessageId: string | null
  isResponding: boolean
  messages: ChatMessage[]
  onCopyMessage: (message: ChatMessage) => void
  onEditMessage: (index: number) => void
  onRegenerateMessage: (index: number) => void
  onRetryMessage: (index: number) => void
}

function useStableCallback<Args extends unknown[]>(callback: (...args: Args) => void) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: Args) => callbackRef.current(...args), [])
}

export function MessageList({
  copiedMessageId,
  isResponding,
  messages,
  onCopyMessage,
  onEditMessage,
  onRegenerateMessage,
  onRetryMessage,
}: MessageListProps) {
  const handleCopyMessage = useStableCallback((message: ChatMessage) => onCopyMessage(message))
  const handleEditMessage = useStableCallback((index: number) => onEditMessage(index))
  const handleRegenerateMessage = useStableCallback((index: number) => onRegenerateMessage(index))
  const handleRetryMessage = useStableCallback((index: number) => onRetryMessage(index))
  let hasPreviousPersistedUserMessage = false

  return (
    <div className={cn('message-list flex flex-col gap-[22px] max-[820px]:gap-1.5', CHAT_CONTENT_COLUMN_CLASS)}>
      {messages.map((message, index) => {
        const rowHasPreviousPersistedUserMessage = hasPreviousPersistedUserMessage
        if (message.role === 'user' && message.persistedIndex !== undefined) {
          hasPreviousPersistedUserMessage = true
        }

        return (
          <MessageRow
            copied={copiedMessageId === message.id}
            hasPreviousPersistedUserMessage={rowHasPreviousPersistedUserMessage}
            index={index}
            isResponding={isResponding}
            key={message.id}
            message={message}
            onCopyMessage={handleCopyMessage}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onRetryMessage={handleRetryMessage}
          />
        )
      })}
    </div>
  )
}
