import assert from 'node:assert/strict'
import test from 'node:test'
import deepseekAdapter from '../../server/utils/llm/adapters/deepseek.ts'

test('DeepSeek adapter accepts SSE data fields with or without a space', () => {
  const payload = JSON.stringify({
    choices: [{
      delta: {
        content: 'answer',
        reasoning_content: 'reasoning'
      }
    }]
  })

  assert.deepEqual(deepseekAdapter.parseStreamLine(`data: ${payload}`), {
    content: 'answer',
    reasoningContent: 'reasoning',
    toolCallDeltas: undefined,
    finishReason: undefined
  })
  assert.deepEqual(deepseekAdapter.parseStreamLine(`data:${payload}`), {
    content: 'answer',
    reasoningContent: 'reasoning',
    toolCallDeltas: undefined,
    finishReason: undefined
  })
  assert.deepEqual(deepseekAdapter.parseStreamLine('data:[DONE]'), {
    done: true
  })
})

test('DeepSeek adapter ignores non-data SSE lines', () => {
  assert.equal(deepseekAdapter.parseStreamLine('data:'), null)
  assert.equal(deepseekAdapter.parseStreamLine(': keep-alive'), null)
  assert.equal(deepseekAdapter.parseStreamLine('event: message'), null)
})
