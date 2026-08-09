import { describe, expect, it, vi } from 'vitest'

import { readChatStream } from '../../../client/src/api/readChatStream'
import {
  CHAT_STREAM_PROTOCOL_HEADER,
  CHAT_STREAM_PROTOCOL_VERSION,
  type ChatStreamEvent,
} from '../../../client/src/utils/streamProtocol'

function createResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    }),
    {
      status: 200,
      headers: {
        [CHAT_STREAM_PROTOCOL_HEADER]: CHAT_STREAM_PROTOCOL_VERSION,
      },
    },
  )
}

describe('readChatStream', () => {
  it('reassembles split NDJSON chunks and forwards all six protocol events in order', async () => {
    const payload = [
      JSON.stringify({ type: 'reasoning_delta', content: '分析' }),
      JSON.stringify({ type: 'tool_start', toolCallId: 'call-1', name: 'calculate' }),
      JSON.stringify({
        type: 'tool_result',
        toolCallId: 'call-1',
        name: 'calculate',
        summary: '42',
        success: true,
      }),
      JSON.stringify({ type: 'error', message: '可恢复错误' }),
      JSON.stringify({ type: 'delta', content: '答案' }),
      JSON.stringify({ type: 'done', reasoningDurationMs: 120 }),
    ].join('\n') + '\n'
    const bytes = new TextEncoder().encode(payload)
    const chunks = [bytes.slice(0, 11), bytes.slice(11, 39), bytes.slice(39, 87), bytes.slice(87)]
    const events: ChatStreamEvent[] = []
    const onChunk = vi.fn<() => void>()

    await readChatStream({
      response: createResponse(chunks),
      onChunk,
      onEvent: (event) => {
        events.push(event)
      },
    })

    expect(events.map((event) => event.type)).toEqual([
      'reasoning_delta',
      'tool_start',
      'tool_result',
      'error',
      'delta',
      'done',
    ])
    expect(events[0]).toEqual({ type: 'reasoning_delta', content: '分析' })
    expect(events[4]).toEqual({ type: 'delta', content: '答案' })
    expect(onChunk).toHaveBeenCalledTimes(chunks.length + 1)
  })

  it('rejects an incomplete final line with the existing protocol error', async () => {
    const response = createResponse([
      new TextEncoder().encode('{"type":"unknown"}'),
    ])

    await expect(
      readChatStream({ response, onEvent: vi.fn<(event: ChatStreamEvent) => void>() }),
    ).rejects.toThrow('不支持的流式事件类型：unknown')
  })

  it('preserves the backend error message for non-stream responses', async () => {
    await expect(
      readChatStream({
        response: Response.json({ message: '会话正在处理中' }, { status: 409 }),
        onEvent: vi.fn<(event: ChatStreamEvent) => void>(),
      }),
    ).rejects.toThrow('会话正在处理中')
  })
})
