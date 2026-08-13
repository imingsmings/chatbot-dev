import { describe, expect, it } from 'vitest'

import {
  createInitialChatStreamState,
  finalizeChatStreamState,
  reduceChatStreamEvent,
  reduceChatStreamEvents,
} from '../../../client/src/reducers/chatStreamReducer'

describe('chat stream reducer', () => {
  it('reduces reasoning, delta, tool and done events immutably', () => {
    const initial = createInitialChatStreamState()
    const reasoning = reduceChatStreamEvent(
      initial,
      { type: 'reasoning_delta', content: '分析' },
      1_000,
    )
    const delta = reduceChatStreamEvent(reasoning, { type: 'delta', content: '答案' }, 1_250)
    const toolStart = reduceChatStreamEvent(delta, {
      type: 'tool_start',
      toolCallId: 'call_1',
      name: 'calculate',
    })
    const toolResult = reduceChatStreamEvent(toolStart, {
      type: 'tool_result',
      toolCallId: 'call_1',
      name: 'calculate',
      summary: '42',
      success: true,
    })
    const done = reduceChatStreamEvent(toolResult, {
      type: 'done',
      reasoningDurationMs: 300,
    })

    expect(initial).toEqual(createInitialChatStreamState())
    expect(reasoning).not.toBe(initial)
    expect(reasoning.reasoningText).toBe('分析')
    expect(reasoning.reasoningStartedAt).toBe(1_000)
    expect(delta.text).toBe('答案')
    expect(delta.reasoningDurationMs).toBe(250)
    expect(toolStart.toolActivities).toEqual([
      { id: 'call_1', name: 'calculate', status: 'running' },
    ])
    expect(toolResult.toolActivities).toEqual([
      { id: 'call_1', name: 'calculate', status: 'success', summary: '42' },
    ])
    expect(toolStart.toolActivities[0].status).toBe('running')
    expect(done.streamDone).toBe(true)
    expect(done.reasoningDurationMs).toBe(300)
  })

  it('finalizes a complete response and closes unfinished tools', () => {
    const withDelta = reduceChatStreamEvent(
      createInitialChatStreamState(),
      { type: 'delta', content: '答案' },
    )
    const withTool = reduceChatStreamEvent(withDelta, {
      type: 'tool_start',
      name: 'weather',
    })
    const withDone = reduceChatStreamEvent(withTool, { type: 'done' })
    const finalized = finalizeChatStreamState(withDone)

    expect(finalized.status).toBe('done')
    expect(finalized.toolActivities).toEqual([
      {
        id: 'weather-0',
        name: 'weather',
        status: 'error',
        summary: '未收到工具结果',
      },
    ])
    expect(withDone.toolActivities[0].status).toBe('running')
  })

  it('rejects empty and incomplete final states with stable client errors', () => {
    const emptyDone = reduceChatStreamEvent(createInitialChatStreamState(), { type: 'done' })
    const incomplete = reduceChatStreamEvent(
      createInitialChatStreamState(),
      { type: 'delta', content: 'partial' },
    )

    expect(() => finalizeChatStreamState(emptyDone)).toThrow('模型未返回内容')
    expect(() => finalizeChatStreamState(incomplete)).toThrow('响应未完整结束')
  })

  it('matches a tool result without an id to the latest running tool with the same name', () => {
    const withTools = {
      ...createInitialChatStreamState(),
      toolActivities: [
        { id: 'call_1', name: 'weather', status: 'running' as const },
        { id: 'call_2', name: 'weather', status: 'running' as const },
      ],
    }

    const result = reduceChatStreamEvent(withTools, {
      type: 'tool_result',
      name: 'weather',
      summary: 'sunny',
      success: true,
    })

    expect(result.toolActivities).toEqual([
      withTools.toolActivities[0],
      { id: 'call_2', name: 'weather', status: 'success', summary: 'sunny' },
    ])
    expect(withTools.toolActivities[1].status).toBe('running')
  })

  it('turns an error event into recoverable error state', () => {
    const initial = {
      ...createInitialChatStreamState(),
      toolActivities: [{ id: 'call_1', name: 'weather', status: 'running' as const }],
    }
    const failed = reduceChatStreamEvent(initial, { type: 'error', message: '模型响应失败' })

    expect(failed).toMatchObject({ status: 'error', error: '模型响应失败', streamDone: false })
    expect(failed.toolActivities).toEqual([
      {
        id: 'call_1',
        name: 'weather',
        status: 'error',
        summary: '执行中断',
      },
    ])
    expect(initial.status).toBe('pending')
    expect(initial.toolActivities[0].status).toBe('running')
  })

  it('returns the same state for empty content events', () => {
    const initial = createInitialChatStreamState()

    expect(reduceChatStreamEvent(initial, { type: 'delta', content: '' })).toBe(initial)
    expect(reduceChatStreamEvent(initial, { type: 'reasoning_delta', content: '' })).toBe(initial)
  })

  it('reduces a timed batch in event order and preserves reasoning timestamps', () => {
    const result = reduceChatStreamEvents(createInitialChatStreamState(), [
      { event: { type: 'reasoning_delta', content: '先分析' }, receivedAt: 1_000 },
      { event: { type: 'delta', content: '答' }, receivedAt: 1_240 },
      { event: { type: 'delta', content: '案' }, receivedAt: 1_250 },
      { event: { type: 'done' }, receivedAt: 1_260 },
    ])

    expect(result).toMatchObject({
      reasoningText: '先分析',
      reasoningStartedAt: 1_000,
      reasoningDurationMs: 240,
      status: 'streaming',
      streamDone: true,
      text: '答案',
    })
  })
})
