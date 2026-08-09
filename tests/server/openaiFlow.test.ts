import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Conversation } from '../../server/types/conversation.ts'
import type { ToolExecutionEvent } from '../../server/types/tools.ts'

function sseResponse(events: unknown[]): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

test('OpenAI Responses flow streams reasoning, executes a tool, and continues with function output', async () => {
  const originalFetch = globalThis.fetch
  const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-openai-flow-'))
  const requests: Array<Record<string, unknown>> = []
  const deltas: Array<{ chunk: string; type: string }> = []
  const toolEvents: ToolExecutionEvent[] = []

  process.env.CONVERSATION_DATA_DIR = dataDir
  process.env.CONVERSATION_STORE = 'file'
  process.env.LLM_PROVIDER = 'openai'
  process.env.OPENAI_ENDPOINT = 'http://openai.mock/'
  process.env.OPENAI_MODEL = 'gpt-5.6-luna'
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.LLM_REASONING_ENABLED = 'true'
  process.env.LLM_REASONING_EFFORT = 'medium'

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://openai.mock/v1/responses')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push(body)

    if (requests.length === 1) {
      return sseResponse([
        { type: 'response.reasoning_summary_text.delta', delta: '先进行计算。' },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            type: 'function_call',
            call_id: 'call_calc',
            name: 'calculate',
            arguments: ''
          }
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          delta: '{"expression":"6'
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          delta: ' * 7"}'
        },
        {
          type: 'response.completed',
          response: {
            output: [
              {
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: '先进行计算。' }]
              },
              {
                type: 'function_call',
                call_id: 'call_calc',
                name: 'calculate',
                arguments: '{"expression":"6 * 7"}'
              }
            ]
          }
        }
      ])
    }

    return sseResponse([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', phase: 'final_answer' }
      },
      { type: 'response.output_text.delta', output_index: 0, delta: '结果是' },
      { type: 'response.output_text.delta', output_index: 0, delta: ' 42。' },
      {
        type: 'response.completed',
        response: {
          output: [{
            type: 'message',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: '结果是 42。' }]
          }]
        }
      }
    ])
  }

  const conversation: Conversation = {
    id: 'conv_openai_flow_test',
    title: 'OpenAI flow',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    titleManuallyEdited: false,
    messages: []
  }

  try {
    const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
    const { importConversation } = await import('../../server/utils/conversationStore.ts')
    await importConversation(conversation, 'overwrite')
    const result = await generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: '请计算 6 * 7',
      signal: new AbortController().signal,
      onDelta: (chunk, type) => deltas.push({ chunk, type }),
      onToolEvent: (event) => toolEvents.push(event),
      modelOptions: {
        provider: 'openai',
        model: 'gpt-5.6-luna',
        reasoningEnabled: true,
        reasoningEffort: 'medium'
      }
    })

    assert.equal(result.content, '结果是 42。')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].store, false)
    assert.equal(requests[0].model, 'gpt-5.6-luna')
    assert.equal(requests[0].tool_choice, 'auto')
    const secondInput = requests[1].input as Array<Record<string, unknown>>
    assert.deepEqual(secondInput.at(-1), {
      type: 'function_call_output',
      call_id: 'call_calc',
      output: '计算结果：42'
    })
    assert.deepEqual(deltas, [
      { chunk: '先进行计算。', type: 'reasoning' },
      { chunk: '结果是', type: 'content' },
      { chunk: ' 42。', type: 'content' }
    ])
    assert.deepEqual(toolEvents.map((event) => event.type), ['tool_start', 'tool_result'])
    assert.equal(toolEvents[0].toolCallId, 'call_calc')
  } finally {
    globalThis.fetch = originalFetch
    await rm(dataDir, { recursive: true, force: true })
  }
})
