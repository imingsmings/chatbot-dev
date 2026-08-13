import { afterEach, describe, expect, it, vi } from 'vitest'

import { createChatStreamEventBuffer } from '../../../client/src/utils/chatStreamEventBuffer'

afterEach(() => {
  vi.useRealTimers()
})

describe('chat stream event buffer', () => {
  it('flushes the first text immediately and batches later adjacent text', () => {
    vi.useFakeTimers()
    const flushed: unknown[][] = []
    const buffer = createChatStreamEventBuffer({ onFlush: (events) => flushed.push(events) })

    buffer.push({ type: 'delta', content: 'A' }, 10)
    buffer.push({ type: 'delta', content: 'B' }, 20)
    buffer.push({ type: 'delta', content: 'C' }, 30)

    expect(flushed).toEqual([[
      { event: { type: 'delta', content: 'A' }, receivedAt: 10 },
    ]])
    vi.advanceTimersByTime(40)
    expect(flushed[1]).toEqual([
      { event: { type: 'delta', content: 'BC' }, receivedAt: 20 },
    ])
  })

  it('preserves text type and semantic event order at boundaries', () => {
    vi.useFakeTimers()
    const flushed: unknown[][] = []
    const buffer = createChatStreamEventBuffer({ onFlush: (events) => flushed.push(events) })

    buffer.push({ type: 'reasoning_delta', content: '思考一' }, 10)
    buffer.push({ type: 'reasoning_delta', content: '思考二' }, 20)
    buffer.push({ type: 'delta', content: '回答' }, 30)
    buffer.push({ type: 'tool_start', toolCallId: 'call-1', name: 'calculate' }, 40)

    expect(flushed[1]).toEqual([
      { event: { type: 'reasoning_delta', content: '思考二' }, receivedAt: 20 },
      { event: { type: 'delta', content: '回答' }, receivedAt: 30 },
      {
        event: { type: 'tool_start', toolCallId: 'call-1', name: 'calculate' },
        receivedAt: 40,
      },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes pending text with terminal events and ignores later events', () => {
    vi.useFakeTimers()
    const flushed: unknown[][] = []
    const buffer = createChatStreamEventBuffer({ onFlush: (events) => flushed.push(events) })

    buffer.push({ type: 'delta', content: 'first' }, 10)
    buffer.push({ type: 'delta', content: 'last' }, 20)
    buffer.push({ type: 'done' }, 30)
    buffer.push({ type: 'delta', content: 'ignored' }, 40)

    expect(flushed[1]).toEqual([
      { event: { type: 'delta', content: 'last' }, receivedAt: 20 },
      { event: { type: 'done' }, receivedAt: 30 },
    ])
    expect(flushed).toHaveLength(2)
  })

  it('flushes synchronously when the character bound is reached and disposes timers', () => {
    vi.useFakeTimers()
    const flushed: unknown[][] = []
    const buffer = createChatStreamEventBuffer({
      maxBufferedChars: 4,
      onFlush: (events) => flushed.push(events),
    })

    buffer.push({ type: 'delta', content: 'first' }, 10)
    buffer.push({ type: 'delta', content: '1234' }, 20)
    expect(flushed).toHaveLength(2)

    buffer.push({ type: 'delta', content: '12' }, 30)
    expect(vi.getTimerCount()).toBe(1)
    buffer.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(flushed).toHaveLength(2)
  })

  it('flushes at the event-group bound and ignores pushes after disposal', () => {
    vi.useFakeTimers()
    const flushed: unknown[][] = []
    const buffer = createChatStreamEventBuffer({
      maxBufferedEvents: 2,
      onFlush: (events) => flushed.push(events),
    })

    buffer.push({ type: 'delta', content: 'first' }, 10)
    buffer.push({ type: 'delta', content: 'second' }, 20)
    buffer.push({ type: 'reasoning_delta', content: 'reasoning' }, 30)

    expect(flushed).toHaveLength(2)
    expect(flushed[1]).toEqual([
      { event: { type: 'delta', content: 'second' }, receivedAt: 20 },
      { event: { type: 'reasoning_delta', content: 'reasoning' }, receivedAt: 30 },
    ])

    buffer.dispose()
    buffer.push({ type: 'delta', content: 'ignored' }, 40)
    expect(flushed).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
