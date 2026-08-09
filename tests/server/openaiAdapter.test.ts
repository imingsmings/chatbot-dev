import assert from 'node:assert/strict'
import test from 'node:test'
import { getToolDefinitions } from '../../server/services/toolService.ts'
import openaiAdapter from '../../server/utils/llm/adapters/openai.ts'
import type { EffectiveModelOptions, LlmStreamWithToolsResult } from '../../server/types/llm.ts'

const config = {
  id: 'openai' as const,
  endpoint: 'https://api.example.com/v1/responses',
  apiKey: 'test-key',
  defaultModel: 'gpt-5.6-luna'
}

const options: EffectiveModelOptions = {
  provider: 'openai',
  model: 'gpt-5.6-luna',
  maxTokens: 4096,
  reasoningEnabled: true,
  reasoningEffort: 'medium'
}

test('OpenAI adapter builds a stateless Responses request with strict flat tools', () => {
  const body = openaiAdapter.buildBody({
    config,
    prompt: [
      { role: 'system', content: 'Use Chinese.' },
      { role: 'user', content: 'What time is it?' }
    ],
    stream: true,
    tools: getToolDefinitions(),
    toolChoice: 'auto',
    options
  }) as Record<string, unknown>
  const tools = body.tools as Array<Record<string, unknown>>
  const currentTime = tools.find((tool) => tool.name === 'getCurrentTime')
  const parameters = currentTime?.parameters as Record<string, unknown>
  const properties = parameters.properties as Record<string, Record<string, unknown>>

  assert.equal(body.model, 'gpt-5.6-luna')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.equal(body.max_output_tokens, 4096)
  assert.deepEqual(body.reasoning, {
    effort: 'medium',
    summary: 'detailed',
    context: 'current_turn'
  })
  assert.equal(body.tool_choice, 'auto')
  assert.equal(body.parallel_tool_calls, true)
  assert.equal(currentTime?.type, 'function')
  assert.equal(currentTime?.strict, true)
  assert.deepEqual(parameters.required, ['timeZone'])
  assert.deepEqual(properties.timeZone.type, ['string', 'null'])
  assert(!Object.hasOwn(body, 'messages'))
  assert(!Object.hasOwn(body, 'max_tokens'))
})

test('OpenAI adapter disables reasoning summaries when reasoning is off', () => {
  const body = openaiAdapter.buildBody({
    config,
    prompt: [{ role: 'user', content: 'hello' }],
    stream: false,
    options: {
      ...options,
      reasoningEnabled: false
    }
  }) as Record<string, unknown>

  assert.deepEqual(body.reasoning, {
    effort: 'none',
    context: 'current_turn'
  })
  assert(!Object.hasOwn(body, 'tools'))
})

test('OpenAI stream parser emits text, reasoning summary, and completion snapshots', () => {
  const parse = openaiAdapter.createStreamParser?.()
  assert(parse)

  assert.equal(parse('event: response.output_item.added'), null)
  assert.equal(parse(`data: ${JSON.stringify({
    type: 'response.output_item.added',
    output_index: 1,
    item: { type: 'message', phase: 'final_answer' }
  })}`), null)
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.reasoning_summary_text.delta',
    delta: '先分析。'
  })}`), {
    reasoningContent: '先分析。'
  })
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.output_text.delta',
    output_index: 1,
    delta: '答案'
  })}`), {
    content: '答案',
    contentPhase: 'final_answer'
  })

  const output = [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: '先分析。' }] },
    { type: 'message', content: [{ type: 'output_text', text: '答案' }] }
  ]
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.completed',
    response: { output }
  })}`), {
    done: true,
    contentSnapshot: '答案',
    reasoningSnapshot: '先分析。',
    providerState: { output },
    finishReason: 'stop'
  })
})

test('OpenAI stream parser preserves call_id while aggregating function arguments', () => {
  const parse = openaiAdapter.createStreamParser?.()
  assert(parse)

  assert.deepEqual(parse(`data:${JSON.stringify({
    type: 'response.output_item.added',
    output_index: 2,
    item: {
      type: 'function_call',
      call_id: 'call_calc',
      name: 'calculate',
      arguments: ''
    }
  })}`), {
    toolCallDeltas: [{
      index: 2,
      id: 'call_calc',
      type: 'function',
      function: { name: 'calculate', arguments: '' }
    }]
  })
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.function_call_arguments.delta',
    output_index: 2,
    delta: '{"expression"'
  })}`), {
    toolCallDeltas: [{ index: 2, function: { arguments: '{"expression"' } }]
  })
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.output_item.done',
    output_index: 2,
    item: {
      type: 'function_call',
      call_id: 'call_calc',
      name: 'calculate',
      arguments: '{"expression":"6 * 7"}'
    }
  })}`), {
    toolCallDeltas: [{
      index: 2,
      id: undefined,
      type: 'function',
      function: { name: undefined, arguments: ':"6 * 7"}' }
    }]
  })
})

test('OpenAI stream parser can recover a complete function call from output_item.done', () => {
  const parse = openaiAdapter.createStreamParser?.()
  assert(parse)

  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.output_item.done',
    output_index: 3,
    item: {
      type: 'function_call',
      call_id: 'call_time',
      name: 'getCurrentTime',
      arguments: '{"timeZone":null}'
    }
  })}`), {
    toolCallDeltas: [{
      index: 3,
      id: 'call_time',
      type: 'function',
      function: { name: 'getCurrentTime', arguments: '{"timeZone":null}' }
    }]
  })
})

test('OpenAI continuation replays output items and correlates function outputs by call_id', () => {
  const output = [{
    type: 'function_call',
    call_id: 'call_calc',
    name: 'calculate',
    arguments: '{"expression":"6 * 7"}'
  }]
  const firstResponse: LlmStreamWithToolsResult = {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    content: '',
    reasoningContent: '',
    toolCalls: [{
      id: 'call_calc',
      type: 'function',
      function: { name: 'calculate', arguments: '{"expression":"6 * 7"}' }
    }],
    providerState: { output }
  }
  const body = openaiAdapter.buildBody({
    config,
    prompt: [{ role: 'user', content: 'calculate' }],
    stream: true,
    options,
    continuation: {
      firstResponse,
      toolResults: [{
        id: 'call_calc',
        function: 'calculate',
        args: { expression: '6 * 7' },
        result: '计算结果：42'
      }]
    }
  }) as Record<string, unknown>
  const input = body.input as Array<Record<string, unknown>>

  assert.deepEqual(input.slice(-2), [
    output[0],
    {
      type: 'function_call_output',
      call_id: 'call_calc',
      output: '计算结果：42'
    }
  ])
  assert(!Object.hasOwn(body, 'tools'))
})

test('OpenAI adapter extracts raw REST output text and stream errors', () => {
  assert.equal(openaiAdapter.parseResponse({
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: 'REST answer' }]
    }]
  }), 'REST answer')

  const parse = openaiAdapter.createStreamParser?.()
  assert(parse)
  assert.deepEqual(parse(`data: ${JSON.stringify({
    type: 'response.failed',
    response: { error: { message: 'upstream failed' } }
  })}`), {
    error: 'upstream failed'
  })
})
