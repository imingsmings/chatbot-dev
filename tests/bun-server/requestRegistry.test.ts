import assert from 'node:assert/strict'
import { test } from 'bun:test'
import {
  cancelAllRequests,
  cancelRequest,
  completeRequest,
  parseRequestId,
  registerRequest,
  waitForRequestCompletion,
} from '../../bun-server/utils/requestRegistry.ts'

test('request registry keeps a cancelled conversation locked until lifecycle completion', async () => {
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
  assert.equal(cancelRequest('request_first_123'), true)
  assert.equal(registerRequest({
    requestId: 'request_second_123',
    conversationId: 'conv_shared',
    controller: second,
    cancel: cancelSecond,
  }), false)

  let completionObserved = false
  const completion = waitForRequestCompletion('request_first_123').then(() => {
    completionObserved = true
  })
  await Promise.resolve()
  assert.equal(completionObserved, false)

  completeRequest('request_first_123', first)
  await completion
  assert.equal(completionObserved, true)
  assert.equal(registerRequest({
    requestId: 'request_second_123',
    conversationId: 'conv_shared',
    controller: second,
    cancel: cancelSecond,
  }), true)

  completeRequest('request_second_123', second)
  assert.equal(cancelRequest('request_second_123'), false)
})

test('request registry cancels every active request during server shutdown', () => {
  const reasons: string[] = []
  const first = new AbortController()
  const second = new AbortController()

  assert.equal(registerRequest({
    requestId: 'request_shutdown_1',
    conversationId: 'conv_shutdown_1',
    controller: first,
    cancel: (reason) => {
      reasons.push(reason ?? '')
      first.abort()
    },
  }), true)
  assert.equal(registerRequest({
    requestId: 'request_shutdown_2',
    conversationId: 'conv_shutdown_2',
    controller: second,
    cancel: (reason) => {
      reasons.push(reason ?? '')
      second.abort()
    },
  }), true)

  assert.equal(cancelAllRequests('server_shutdown'), 2)
  assert.deepEqual(reasons, ['server_shutdown', 'server_shutdown'])
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, true)
  assert.equal(cancelAllRequests(), 0)
  assert.equal(cancelRequest('request_shutdown_1'), true)
  completeRequest('request_shutdown_1', first)
  completeRequest('request_shutdown_2', second)
  assert.equal(cancelRequest('request_shutdown_1'), false)
})
