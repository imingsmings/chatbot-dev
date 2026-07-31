import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseModelSettingsDraft } from '../../client/src/utils/modelOptions.ts'

test('parseModelSettingsDraft validates optional numeric fields', () => {
  assert.deepEqual(parseModelSettingsDraft({
    temperature: '',
    maxTokens: '',
    reasoningEnabled: false,
    reasoningEffort: 'medium'
  }), {
    reasoningEnabled: false,
    reasoningEffort: 'medium'
  })

  assert.deepEqual(parseModelSettingsDraft({
    temperature: '0.3',
    maxTokens: '2048',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  }), {
    temperature: 0.3,
    maxTokens: 2048,
    reasoningEnabled: true,
    reasoningEffort: 'high'
  })

  assert.throws(() => parseModelSettingsDraft({
    temperature: '2.1',
    maxTokens: '2048',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  }), /temperature/)
  assert.throws(() => parseModelSettingsDraft({
    temperature: '0.3',
    maxTokens: '1.5',
    reasoningEnabled: true,
    reasoningEffort: 'high'
  }), /max tokens/)
})
