import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import type { Conversation } from '../../server/types/conversation.ts'
import type { ModelRequestOptions } from '../../server/types/llm.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-stream-completeness-'))
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'
process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://deepseek.mock/chat/completions'
process.env.LLM_MODEL = 'deepseek-test-model'
process.env.DEEPSEEK_API_KEY = 'deepseek-test-key'
process.env.OPENAI_ENDPOINT = 'http://openai.mock/v1/responses'
process.env.OPENAI_MODEL = 'openai-test-model'
process.env.OPENAI_API_KEY = 'openai-test-key'

const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
const { createConversation, getConversation } = await import('../../server/utils/conversationStore.ts')

afterEach(() => {
  globalThis.fetch = originalFetch
})

after(async () => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

function deepseekSse(events: unknown[], completed = false): Response {
  const payload = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    ...(completed ? ['data: [DONE]\n\n'] : [])
  ].join('')
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

function openaiSse(events: unknown[], includeDoneSentinel = false): Response {
  const payload = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    ...(includeDoneSentinel ? ['data: [DONE]\n\n'] : [])
  ].join('')
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

function deepseekDelta(content: string): unknown {
  return { choices: [{ delta: { content } }] }
}

function openaiCompleted(content: string): unknown {
  return {
    type: 'response.completed',
    response: {
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: content }]
      }]
    }
  }
}

async function generate(
  conversation: Conversation,
  question: string,
  modelOptions: ModelRequestOptions,
  deltas: Array<{ chunk: string; type: string }>
) {
  return generateConversationAnswer({
    conversation,
    conversationId: conversation.id,
    question,
    signal: new AbortController().signal,
    onDelta: (chunk, type) => {
      deltas.push({ chunk, type })
    },
    modelOptions
  })
}

test('DeepSeek partial text EOF is not persisted and the next completed request recovers', async () => {
  const conversation = await createConversation('DeepSeek partial EOF')
  const responses = [
    deepseekSse([deepseekDelta('部分正文')]),
    deepseekSse([deepseekDelta('恢复成功')], true)
  ]
  const deltas: Array<{ chunk: string; type: string }> = []
  globalThis.fetch = async () => responses.shift()!

  await assert.rejects(
    generate(conversation, '第一次请求', { provider: 'deepseek' }, deltas),
    /上游模型响应未完整结束/
  )
  assert.deepEqual(deltas, [{ chunk: '部分正文', type: 'content' }])
  assert.equal((await getConversation(conversation.id))?.messages.length, 0)

  const recovered = await generate(conversation, '第二次请求', { provider: 'deepseek' }, deltas)
  assert.equal(recovered.content, '恢复成功')
  assert.deepEqual(
    (await getConversation(conversation.id))?.messages.map((message) => message.content),
    ['第二次请求', '恢复成功']
  )
})

test('DeepSeek reasoning-only and incomplete tool-argument EOF are rejected', async () => {
  const reasoningConversation = await createConversation('DeepSeek reasoning EOF')
  const reasoningDeltas: Array<{ chunk: string; type: string }> = []
  globalThis.fetch = async () => deepseekSse([{
    choices: [{ delta: { reasoning_content: '尚未完成的分析' } }]
  }])

  await assert.rejects(
    generate(reasoningConversation, 'reasoning EOF', { provider: 'deepseek' }, reasoningDeltas),
    /上游模型响应未完整结束/
  )
  assert.deepEqual(reasoningDeltas, [{ chunk: '尚未完成的分析', type: 'reasoning' }])
  assert.equal((await getConversation(reasoningConversation.id))?.messages.length, 0)

  const toolConversation = await createConversation('DeepSeek tool EOF')
  globalThis.fetch = async () => deepseekSse([{
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call_incomplete',
          type: 'function',
          function: { name: 'calculate', arguments: '{"expression":"6' }
        }]
      }
    }]
  }])

  await assert.rejects(
    generate(toolConversation, 'tool EOF', { provider: 'deepseek' }, []),
    /上游模型响应未完整结束/
  )
  assert.equal((await getConversation(toolConversation.id))?.messages.length, 0)
})

test('OpenAI partial text EOF rejects a trailing DONE sentinel and then recovers on response.completed', async () => {
  const conversation = await createConversation('OpenAI partial EOF')
  const responses = [
    openaiSse([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', phase: 'final_answer' }
      },
      { type: 'response.output_text.delta', output_index: 0, delta: '部分正文' }
    ], true),
    openaiSse([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', phase: 'final_answer' }
      },
      { type: 'response.output_text.delta', output_index: 0, delta: '恢复成功' },
      openaiCompleted('恢复成功')
    ])
  ]
  const deltas: Array<{ chunk: string; type: string }> = []
  globalThis.fetch = async () => responses.shift()!

  await assert.rejects(
    generate(conversation, '第一次请求', { provider: 'openai' }, deltas),
    /上游模型响应未完整结束/
  )
  assert.deepEqual(deltas, [{ chunk: '部分正文', type: 'content' }])
  assert.equal((await getConversation(conversation.id))?.messages.length, 0)

  const recovered = await generate(conversation, '第二次请求', { provider: 'openai' }, deltas)
  assert.equal(recovered.content, '恢复成功')
  assert.deepEqual(
    (await getConversation(conversation.id))?.messages.map((message) => message.content),
    ['第二次请求', '恢复成功']
  )
})

test('OpenAI reasoning-only and incomplete tool-argument EOF are rejected', async () => {
  const reasoningConversation = await createConversation('OpenAI reasoning EOF')
  const reasoningDeltas: Array<{ chunk: string; type: string }> = []
  globalThis.fetch = async () => openaiSse([{
    type: 'response.reasoning_summary_text.delta',
    delta: '尚未完成的分析'
  }])

  await assert.rejects(
    generate(reasoningConversation, 'reasoning EOF', { provider: 'openai' }, reasoningDeltas),
    /上游模型响应未完整结束/
  )
  assert.deepEqual(reasoningDeltas, [{ chunk: '尚未完成的分析', type: 'reasoning' }])
  assert.equal((await getConversation(reasoningConversation.id))?.messages.length, 0)

  const toolConversation = await createConversation('OpenAI tool EOF')
  globalThis.fetch = async () => openaiSse([
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        call_id: 'call_incomplete',
        name: 'calculate',
        arguments: ''
      }
    },
    {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"expression":"6'
    }
  ])

  await assert.rejects(
    generate(toolConversation, 'tool EOF', { provider: 'openai' }, []),
    /上游模型响应未完整结束/
  )
  assert.equal((await getConversation(toolConversation.id))?.messages.length, 0)
})
