import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterAll, afterEach, test } from 'bun:test'
import type { Conversation } from '../../bun-server/types/conversation.ts'
import type { ModelRequestOptions } from '../../bun-server/types/llm.ts'

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

const { generateConversationAnswer } = await import('../../bun-server/services/chatService.ts')
const { beginConversationRequest, createConversation, getConversation } = await import(
  '../../bun-server/utils/conversationStore.ts'
)

afterEach(() => {
  globalThis.fetch = originalFetch
})

afterAll(async () => {
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

function openaiCompleted(content: string, withUsage = false): unknown {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: content }]
      }],
      ...(withUsage
        ? {
            usage: {
              input_tokens: 12,
              output_tokens: 5,
              total_tokens: 17,
              input_tokens_details: { cached_tokens: 2 },
              output_tokens_details: { reasoning_tokens: 1 }
            }
          }
        : {})
    }
  }
}

function deepseekUsage(): unknown {
  return {
    choices: [],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
      prompt_cache_hit_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 2 }
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
    deepseekSse([
      deepseekDelta('恢复成功'),
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      deepseekUsage()
    ], true)
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
  assert.deepEqual((await getConversation(conversation.id))?.messages[1]?.generation?.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    reasoningTokens: 2,
    cachedInputTokens: 3
  })
  assert.equal((await getConversation(conversation.id))?.messages[1]?.status, 'completed')
  assert.equal((await getConversation(conversation.id))?.messages[1]?.generation?.finishReason, 'stop')
})

test('provider stream parsing waits for the asynchronous downstream writer', async () => {
  const conversation = await createConversation('Async stream backpressure')
  globalThis.fetch = async () => deepseekSse([
    { choices: [{ delta: { reasoning_content: '第一段推理' } }] },
    { choices: [{ delta: { reasoning_content: '第二段推理' } }] },
    deepseekDelta('最终答案'),
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ], true)

  let releaseFirstWrite!: () => void
  const firstWriteReleased = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })
  let markFirstWriteStarted!: () => void
  const firstWriteStarted = new Promise<void>((resolve) => {
    markFirstWriteStarted = resolve
  })
  const chunks: string[] = []

  const generation = generateConversationAnswer({
    conversation,
    conversationId: conversation.id,
    question: '验证下游背压',
    signal: new AbortController().signal,
    onDelta: async (chunk) => {
      chunks.push(chunk)
      if (chunks.length === 1) {
        markFirstWriteStarted()
        await firstWriteReleased
      }
    },
    modelOptions: { provider: 'deepseek' },
  })

  await firstWriteStarted
  await Promise.resolve()
  assert.deepEqual(chunks, ['第一段推理'])
  releaseFirstWrite()
  assert.equal((await generation).content, '最终答案')
  assert.deepEqual(chunks, ['第一段推理', '第二段推理', '最终答案'])
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
      openaiCompleted('恢复成功', true)
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
  assert.deepEqual((await getConversation(conversation.id))?.messages[1]?.generation?.usage, {
    inputTokens: 12,
    outputTokens: 5,
    totalTokens: 17,
    reasoningTokens: 1,
    cachedInputTokens: 2
  })
  assert.equal((await getConversation(conversation.id))?.messages[1]?.generation?.finishReason, 'completed')
})

test('manual stop persists partial body as stopped while excluding incomplete usage', async () => {
  const conversation = await createConversation('Manual stop partial')
  const requestId = 'request_manual_stop_partial_123'
  const timestamp = new Date().toISOString()
  await beginConversationRequest(conversation.id, {
    requestId,
    requestHash: 'd'.repeat(64),
    status: 'processing',
    createdAt: timestamp,
    updatedAt: timestamp
  })
  const controller = new AbortController()
  globalThis.fetch = async () => deepseekSse([
    deepseekDelta('保留这段部分正文'),
    deepseekUsage()
  ], true)

  await assert.rejects(
    generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: '手动停止问题',
      signal: controller.signal,
      onDelta: (_chunk, type) => {
        if (type === 'content') controller.abort('explicit_cancel')
      },
      modelOptions: { provider: 'deepseek' },
      requestId
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError'
  )

  const persisted = await getConversation(conversation.id)
  assert.deepEqual(persisted?.messages.map((message) => message.content), [
    '手动停止问题',
    '保留这段部分正文'
  ])
  assert.equal(persisted?.messages[1]?.status, 'stopped')
  assert.equal(persisted?.messages[1]?.generation?.provider, 'deepseek')
  assert.equal(persisted?.messages[1]?.generation?.usage, undefined)
  assert.equal(persisted?.requests?.[0]?.status, 'stopped')
  assert.equal(persisted?.requests?.[0]?.messageCount, 2)
})

test('manual stop persists reasoning-only partial output as stopped', async () => {
  const conversation = await createConversation('Manual stop reasoning only')
  const controller = new AbortController()
  globalThis.fetch = async () => deepseekSse([{
    choices: [{ delta: { reasoning_content: '保留这段部分推理' } }],
  }], true)

  await assert.rejects(
    generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: '推理阶段停止问题',
      signal: controller.signal,
      onDelta: (_chunk, type) => {
        if (type === 'reasoning') controller.abort('explicit_cancel')
      },
      modelOptions: { provider: 'deepseek' },
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  )

  const persisted = await getConversation(conversation.id)
  assert.deepEqual(persisted?.messages.map((message) => message.content), [
    '推理阶段停止问题',
    '',
  ])
  assert.equal(persisted?.messages[1]?.reasoningContent, '保留这段部分推理')
  assert.equal(persisted?.messages[1]?.status, 'stopped')
  assert.equal(persisted?.messages[1]?.generation?.usage, undefined)
})

test('manual stop before body does not create pseudo messages', async () => {
  const conversation = await createConversation('Manual stop empty')
  const controller = new AbortController()
  controller.abort('explicit_cancel')

  await assert.rejects(
    generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: '空停止问题',
      signal: controller.signal,
      onDelta: () => {},
      modelOptions: { provider: 'deepseek' }
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError'
  )
  assert.equal((await getConversation(conversation.id))?.messages.length, 0)
})

test('parallel tool calls persist trimmed result traces and aggregate completed request usage', async () => {
  const conversation = await createConversation('Tool metadata')
  const responses = [
    deepseekSse([
      {
        choices: [{
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_calc_metadata',
                type: 'function',
                function: { name: 'calculate', arguments: '{"expression":"6 * 7"}' }
              },
              {
                index: 1,
                id: 'call_time_metadata',
                type: 'function',
                function: { name: 'getCurrentTime', arguments: '{"timeZone":"UTC"}' }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }]
      },
      deepseekUsage()
    ], true),
    deepseekSse([
      deepseekDelta('工具执行完成'),
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      deepseekUsage()
    ], true)
  ]
  globalThis.fetch = async () => responses.shift()!

  const answer = await generate(conversation, '执行两个工具', { provider: 'deepseek' }, [])
  assert.equal(answer.content, '工具执行完成')

  const assistant = (await getConversation(conversation.id))?.messages[1]
  assert.equal(assistant?.status, 'completed')
  assert.equal(assistant?.generation?.finishReason, 'stop')
  assert.deepEqual(assistant?.generation?.usage, {
    inputTokens: 20,
    outputTokens: 8,
    totalTokens: 28,
    reasoningTokens: 4,
    cachedInputTokens: 6
  })
  assert.equal(assistant?.toolTrace?.length, 2)
  assert.deepEqual(assistant?.toolTrace?.map((trace) => ({
    name: trace.name,
    success: trace.success,
    hasDuration: trace.durationMs >= 0,
    hasSummary: Boolean(trace.summary)
  })), [
    { name: 'calculate', success: true, hasDuration: true, hasSummary: true },
    { name: 'getCurrentTime', success: true, hasDuration: true, hasSummary: true }
  ])
  assert.deepEqual(Object.keys(assistant?.toolTrace?.[0] ?? {}).sort(), [
    'durationMs',
    'name',
    'success',
    'summary'
  ])
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
