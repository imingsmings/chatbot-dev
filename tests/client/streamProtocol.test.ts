import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertChatStreamProtocol,
  CHAT_STREAM_PROTOCOL_VERSION,
  parseChatStreamEvent
} from '../../client/src/utils/streamProtocol.ts'

test('stream protocol v2 parses content, reasoning and tool lifecycle events', () => {
  assert.equal(CHAT_STREAM_PROTOCOL_VERSION, '2')
  assert.deepEqual(parseChatStreamEvent('{"type":"delta","content":"a"}'), {
    type: 'delta',
    content: 'a'
  })
  assert.deepEqual(parseChatStreamEvent('{"type":"tool_start","toolCallId":"call_1","name":"calculate"}'), {
    type: 'tool_start',
    toolCallId: 'call_1',
    name: 'calculate'
  })
  assert.deepEqual(parseChatStreamEvent('{"type":"tool_result","toolCallId":"call_1","name":"calculate","summary":"42","success":true}'), {
    type: 'tool_result',
    toolCallId: 'call_1',
    name: 'calculate',
    summary: '42',
    success: true
  })
  assert.throws(() => parseChatStreamEvent('{"type":"tool_result","name":"calculate"}'), /工具结果/)
})

test('stream protocol rejects incompatible versions', () => {
  assert.doesNotThrow(() => assertChatStreamProtocol(new Response(null, {
    headers: { 'X-Chat-Stream-Protocol': '2' }
  })))
  assert.throws(() => assertChatStreamProtocol(new Response(null, {
    headers: { 'X-Chat-Stream-Protocol': '1' }
  })), /不支持的流式协议版本/)
})
