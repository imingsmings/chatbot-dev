import { describe, expect, it } from 'vitest'

import {
  assertChatStreamProtocol,
  CHAT_STREAM_PROTOCOL_VERSION,
  parseChatStreamEvent,
} from '../../../client/src/utils/streamProtocol'

describe('NDJSON v2 stream protocol', () => {
  it('parses all six application event types', () => {
    expect(CHAT_STREAM_PROTOCOL_VERSION).toBe('2')
    expect(parseChatStreamEvent('{"type":"delta","content":"a"}')).toEqual({
      type: 'delta',
      content: 'a',
    })
    expect(parseChatStreamEvent('{"type":"reasoning_delta","content":"b"}')).toEqual({
      type: 'reasoning_delta',
      content: 'b',
    })
    expect(
      parseChatStreamEvent('{"type":"tool_start","toolCallId":"call_1","name":"calculate"}'),
    ).toEqual({ type: 'tool_start', toolCallId: 'call_1', name: 'calculate' })
    expect(
      parseChatStreamEvent(
        '{"type":"tool_result","toolCallId":"call_1","name":"calculate","summary":"42","success":true}',
      ),
    ).toEqual({
      type: 'tool_result',
      toolCallId: 'call_1',
      name: 'calculate',
      summary: '42',
      success: true,
    })
    expect(parseChatStreamEvent('{"type":"done","reasoningDurationMs":125}')).toEqual({
      type: 'done',
      reasoningDurationMs: 125,
    })
    expect(parseChatStreamEvent('{"type":"error","message":"failed"}')).toEqual({
      type: 'error',
      message: 'failed',
    })
  })

  it('rejects malformed and unknown events with recoverable errors', () => {
    expect(() => parseChatStreamEvent('{broken')).toThrow(SyntaxError)
    expect(() => parseChatStreamEvent('{"content":"missing type"}')).toThrow(/不支持的流式事件/)
    expect(() => parseChatStreamEvent('{"type":"unknown"}')).toThrow(/不支持的流式事件类型/)
    expect(() => parseChatStreamEvent('{"type":"reasoning_delta","content":123}')).toThrow(
      /无效的流式内容/,
    )
    expect(() => parseChatStreamEvent('{"type":"tool_result","name":"calculate"}')).toThrow(
      /工具结果/,
    )
    expect(() =>
      parseChatStreamEvent('{"type":"done","reasoningDurationMs":"slow"}'),
    ).toThrow(/完成事件/)
    expect(() =>
      parseChatStreamEvent('{"type":"done","reasoningDurationMs":-1}'),
    ).toThrow(/完成事件/)
    expect(() => parseChatStreamEvent('{"type":"tool_start","name":"   "}')).toThrow(
      /工具开始/,
    )
    expect(() =>
      parseChatStreamEvent(
        '{"type":"tool_result","toolCallId":"","name":"calculate","summary":"42","success":true}',
      ),
    ).toThrow(/工具结果/)
    expect(() => parseChatStreamEvent('{"type":"error","message":""}')).toThrow(
      /错误事件/,
    )
  })

  it('accepts only protocol version 2', () => {
    expect(() =>
      assertChatStreamProtocol(
        new Response(null, { headers: { 'X-Chat-Stream-Protocol': '2' } }),
      ),
    ).not.toThrow()
    expect(() =>
      assertChatStreamProtocol(
        new Response(null, { headers: { 'X-Chat-Stream-Protocol': '1' } }),
      ),
    ).toThrow(/不支持的流式协议版本/)
  })
})
