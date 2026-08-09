import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cancelRequest,
  completeRequest,
  parseRequestId,
  registerRequest,
} from '../../server/utils/requestRegistry.ts'

test('request registry validates ids and permits only one active request per conversation', () => {
  assert.equal(parseRequestId('short'), null)
  assert.equal(parseRequestId('../invalid-request'), null)
  assert.equal(parseRequestId(' request_valid_123 '), 'request_valid_123')

  const first = new AbortController()
  const second = new AbortController()
  const cancelFirst = () => first.abort()
  const cancelSecond = () => second.abort()

  assert.equal(registerRequest({
    requestId: 'request_first_123',
    conversationId: 'conv_shared',
    controller: first,
    cancel: cancelFirst,
  }), true)
  assert.equal(registerRequest({
    requestId: 'request_second_123',
    conversationId: 'conv_shared',
    controller: second,
    cancel: cancelSecond,
  }), false)
  assert.equal(cancelRequest('request_first_123'), true)
  assert.equal(first.signal.aborted, true)
  assert.equal(registerRequest({
    requestId: 'request_second_123',
    conversationId: 'conv_shared',
    controller: second,
    cancel: cancelSecond,
  }), true)

  completeRequest('request_second_123', second)
  assert.equal(cancelRequest('request_second_123'), false)
})
