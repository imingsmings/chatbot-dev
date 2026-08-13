import type { ChatStreamEvent } from '#utils/streamProtocol'

export type TimedChatStreamEvent = {
  event: ChatStreamEvent
  receivedAt: number
}

type ChatStreamEventBufferOptions = {
  flushIntervalMs?: number
  maxBufferedChars?: number
  maxBufferedEvents?: number
  onFlush: (events: TimedChatStreamEvent[]) => void
}

const DEFAULT_FLUSH_INTERVAL_MS = 40
const DEFAULT_MAX_BUFFERED_EVENTS = 100
const DEFAULT_MAX_BUFFERED_CHARS = 16_384

function isTextEvent(
  event: ChatStreamEvent,
): event is Extract<ChatStreamEvent, { type: 'delta' | 'reasoning_delta' }> {
  return event.type === 'delta' || event.type === 'reasoning_delta'
}

export function createChatStreamEventBuffer(options: ChatStreamEventBufferOptions) {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  const maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS
  const maxBufferedChars = options.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS
  let bufferedChars = 0
  let events: TimedChatStreamEvent[] = []
  let firstVisibleTextFlushed = false
  let terminal = false
  let timerId: number | null = null

  const clearTimer = () => {
    if (timerId === null) return
    window.clearTimeout(timerId)
    timerId = null
  }

  const emit = (items: TimedChatStreamEvent[]) => {
    if (items.length > 0) options.onFlush(items)
  }

  const takePending = (): TimedChatStreamEvent[] => {
    clearTimer()
    const pending = events
    events = []
    bufferedChars = 0
    return pending
  }

  const flush = () => {
    emit(takePending())
  }

  const scheduleFlush = () => {
    if (timerId !== null) return
    timerId = window.setTimeout(() => {
      timerId = null
      const pending = events
      events = []
      bufferedChars = 0
      emit(pending)
    }, flushIntervalMs)
  }

  const push = (event: ChatStreamEvent, receivedAt = performance.now()) => {
    if (terminal) return

    if (isTextEvent(event)) {
      if (!event.content) return

      const item = { event, receivedAt }
      if (!firstVisibleTextFlushed) {
        firstVisibleTextFlushed = true
        emit([item])
        return
      }

      const last = events[events.length - 1]
      if (last && last.event.type === event.type) {
        last.event = {
          ...last.event,
          content: `${last.event.content}${event.content}`,
        }
      } else {
        events.push(item)
      }
      bufferedChars += event.content.length

      if (events.length >= maxBufferedEvents || bufferedChars >= maxBufferedChars) {
        flush()
      } else {
        scheduleFlush()
      }
      return
    }

    const pending = takePending()
    if (event.type === 'done' || event.type === 'error') terminal = true
    emit([...pending, { event, receivedAt }])
  }

  const dispose = () => {
    terminal = true
    clearTimer()
    events = []
    bufferedChars = 0
  }

  return {
    dispose,
    flush,
    push,
  }
}
