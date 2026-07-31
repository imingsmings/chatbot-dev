import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  promptTemplates,
  renderPromptTemplate
} from '../../client/src/utils/promptTemplates.ts'

test('prompt templates cover the roadmap list and replace repeated variables', () => {
  assert.deepEqual(promptTemplates.map((template) => template.name), [
    '代码解释',
    'Bug 分析',
    '技术方案评审',
    '翻译润色',
    '周报总结',
    '学习计划'
  ])

  const template = {
    id: 'repeat',
    name: 'Repeat',
    content: '{topic} -> {topic}: {code}',
    variables: []
  }
  assert.equal(renderPromptTemplate(template, {
    topic: 'streaming',
    code: 'fetch()'
  }), 'streaming -> streaming: fetch()')
})
