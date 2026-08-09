import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { buildContextPreview } from '../../server/services/contextDebugService.ts'
import { buildContextMessages } from '../../server/services/contextService.ts'
import type { Conversation, PromptMessage, StoredMessage } from '../../server/types/conversation.ts'

const originalFetch = globalThis.fetch
const answerDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-context-answer-tests-'))
const originalEnv = {
  CONTEXT_MAX_HISTORY_MESSAGES: process.env.CONTEXT_MAX_HISTORY_MESSAGES,
  CONTEXT_MAX_HISTORY_CHARS: process.env.CONTEXT_MAX_HISTORY_CHARS,
  CONVERSATION_DATA_DIR: process.env.CONVERSATION_DATA_DIR,
  LLM_ENDPOINT: process.env.LLM_ENDPOINT,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_REASONING_ENABLED: process.env.LLM_REASONING_ENABLED,
  LLM_REASONING_EFFORT: process.env.LLM_REASONING_EFFORT,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function makeConversation(messages: StoredMessage[]): Conversation {
  return {
    id: 'conv_context_test',
    title: 'Context test',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    titleManuallyEdited: true,
    messages
  }
}

function user(content: string): StoredMessage {
  return {
    role: 'user',
    content
  }
}

function assistant(content: string): StoredMessage {
  return {
    role: 'assistant',
    content
  }
}

function promptContent(messages: PromptMessage[]): string {
  return messages.map((message) => message.content || '').join('\n')
}

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function sseToolCall(): string {
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_context_test',
              type: 'function',
              function: {
                name: 'missingTool',
                arguments: '{}'
              }
            }
          ]
        },
        finish_reason: 'tool_calls'
      }
    ]
  })}\n\n`
}

function createMockLlmFetch() {
  const requests: unknown[] = []
  const mockFetch: typeof fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || '{}')) as { messages?: PromptMessage[]; tools?: unknown[] }
    requests.push(body)
    const latestUserContent =
      [...(body.messages || [])].reverse().find((message) => message.role === 'user')?.content || ''

    if (body.tools?.length && String(latestUserContent).includes('TOOL_MANAGED_CONTEXT')) {
      return new Response(`${sseToolCall()}data: [DONE]\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    }

    if ((body.messages || []).some((message) => message.role === 'tool')) {
      return new Response(`${sseDelta('tool answer ok')}data: [DONE]\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      })
    }

    return new Response(`${sseDelta('managed context ok')}data: [DONE]\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }

  globalThis.fetch = mockFetch

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch
    }
  }
}

after(async () => {
  restoreEnv()
  globalThis.fetch = originalFetch
  await rm(answerDataDir, { recursive: true, force: true })
})

test('buildContextMessages keeps only the latest configured history messages', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '4'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const conversation = makeConversation([
    user('MSG_0'),
    assistant('MSG_1'),
    user('MSG_2'),
    assistant('MSG_3'),
    user('MSG_4'),
    assistant('MSG_5'),
    user('MSG_6'),
    assistant('MSG_7')
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.selectedHistoryMessages, 4)
  assert.equal(result.droppedHistoryMessages, 4)
  assert.equal(result.selectedHistoryChars, 'MSG_4MSG_5MSG_6MSG_7'.length)
  assert(!content.includes('MSG_3'))
  assert(content.includes('MSG_4'))
  assert(content.includes('MSG_7'))
  assert(content.includes('CURRENT_QUESTION'))
})

test('buildContextMessages drops the whole boundary message when adding it would exceed the char budget', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '100'

  const recentMessages = Array.from({ length: 18 }, (_, index) =>
    index % 2 === 0 ? user(`R${index}`) : assistant(`R${index}`)
  )
  const conversation = makeConversation([
    user('OLDER_SHOULD_DROP'),
    assistant('BOUNDARY_SHOULD_DROP'.repeat(10)),
    ...recentMessages
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.selectedHistoryMessages, 18)
  assert.equal(result.droppedHistoryMessages, 2)
  assert.equal(result.selectedHistoryChars, recentMessages.reduce((total, message) => total + message.content.length, 0))
  assert(!content.includes('BOUNDARY_SHOULD_DROP'))
  assert(!content.includes('OLDER_SHOULD_DROP'))
  assert(content.includes('R0'))
  assert(content.includes('R17'))
})

test('buildContextMessages keeps the latest oversized history message as a complete message', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '8'

  const conversation = makeConversation([
    user('OLD_SHOULD_DROP'),
    assistant('LATEST_MESSAGE_IS_LONGER_THAN_BUDGET')
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.selectedHistoryMessages, 1)
  assert.equal(result.droppedHistoryMessages, 1)
  assert.equal(result.selectedHistoryChars, 'LATEST_MESSAGE_IS_LONGER_THAN_BUDGET'.length)
  assert(content.includes('LATEST_MESSAGE_IS_LONGER_THAN_BUDGET'))
  assert(!content.includes('OLD_SHOULD_DROP'))
})

test('buildContextMessages falls back to default limits when env config is invalid', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '0'
  process.env.CONTEXT_MAX_HISTORY_CHARS = 'not-a-number'

  const conversation = makeConversation(
    Array.from({ length: 25 }, (_, index) => (index % 2 === 0 ? user(`MSG_${index}`) : assistant(`MSG_${index}`)))
  )
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.selectedHistoryMessages, 20)
  assert.equal(result.droppedHistoryMessages, 5)
  assert(!content.includes('MSG_4'))
  assert(content.includes('MSG_5'))
  assert(content.includes('MSG_24'))
  assert(content.includes('CURRENT_QUESTION'))
})

test('buildContextMessages includes a boundary message when it exactly matches the char budget', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '10'

  const conversation = makeConversation([
    user('OLDER_DROP'),
    assistant('AAAA'),
    user('BBBBBB')
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const historyContents = result.messages.slice(1, -1).map((message) => message.content)

  assert.deepEqual(historyContents, ['AAAA', 'BBBBBB'])
  assert.equal(result.selectedHistoryMessages, 2)
  assert.equal(result.droppedHistoryMessages, 1)
  assert.equal(result.selectedHistoryChars, 10)
})

test('buildContextMessages sends system and current question when history is empty', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const result = buildContextMessages(makeConversation([]), 'CURRENT_ONLY')

  assert.deepEqual(
    result.messages.map((message) => message.role),
    ['system', 'user']
  )
  assert.equal(result.messages.at(-1)?.content, 'CURRENT_ONLY')
  assert.equal(result.selectedHistoryMessages, 0)
  assert.equal(result.droppedHistoryMessages, 0)
  assert.equal(result.selectedHistoryChars, 0)
})

test('buildContextMessages preserves chronological order for selected history', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '3'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const conversation = makeConversation([
    user('FIRST_DROPPED'),
    assistant('SECOND_SELECTED'),
    user('THIRD_SELECTED'),
    assistant('FOURTH_SELECTED')
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')

  assert.deepEqual(
    result.messages.slice(1, -1).map((message) => `${message.role}:${message.content}`),
    ['assistant:SECOND_SELECTED', 'user:THIRD_SELECTED', 'assistant:FOURTH_SELECTED']
  )
  assert.equal(result.selectedHistoryMessages, 3)
  assert.equal(result.droppedHistoryMessages, 1)
})

test('buildContextMessages always keeps the current question outside the history budget', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '5'

  const longQuestion = 'CURRENT_QUESTION_'.repeat(100)
  const conversation = makeConversation([
    user('OLD_SHOULD_DROP'),
    assistant('SHORT')
  ])
  const result = buildContextMessages(conversation, longQuestion)
  const content = promptContent(result.messages)

  assert.equal(result.messages.at(-1)?.content, longQuestion)
  assert.equal(result.selectedHistoryMessages, 1)
  assert.equal(result.droppedHistoryMessages, 1)
  assert.equal(result.selectedHistoryChars, 5)
  assert(content.includes('SHORT'))
  assert(!content.includes('OLD_SHOULD_DROP'))
})

test('buildContextPreview exposes managed context details without leaking secrets', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '2'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
  process.env.LLM_MODEL = 'context-preview-model'
  process.env.LLM_REASONING_ENABLED = 'true'
  process.env.LLM_REASONING_EFFORT = 'medium'
  process.env.DEEPSEEK_API_KEY = 'context-preview-secret'

  const conversation = makeConversation([
    user('PREVIEW_OLD_SHOULD_DROP'),
    assistant('PREVIEW_KEEP_ASSISTANT'),
    user('PREVIEW_KEEP_USER')
  ])
  const preview = buildContextPreview(conversation, 'PREVIEW_CURRENT_QUESTION', {
    model: 'deepseek-v4-pro'
  })
  const serializedPreview = JSON.stringify(preview)
  const content = promptContent(preview.messages)

  assert.equal(preview.conversationId, conversation.id)
  assert.equal(preview.question, 'PREVIEW_CURRENT_QUESTION')
  assert.equal(preview.stats.totalHistoryMessages, 3)
  assert.equal(preview.stats.selectedHistoryMessages, 2)
  assert.equal(preview.stats.droppedHistoryMessages, 1)
  assert.equal(preview.stats.maxHistoryMessages, 2)
  assert.equal(preview.model.model, 'deepseek-v4-pro')
  assert.equal(preview.model.apiKeyConfigured, true)
  assert.equal(preview.model.reasoningEffort, 'medium')
  assert.equal(preview.tools.count, 3)
  assert(!serializedPreview.includes('context-preview-secret'))
  assert(!content.includes('PREVIEW_OLD_SHOULD_DROP'))
  assert(content.includes('PREVIEW_KEEP_ASSISTANT'))
  assert(content.includes('PREVIEW_KEEP_USER'))
  assert(content.includes('PREVIEW_CURRENT_QUESTION'))
})

test('generateConversationAnswer sends managed context to the model instead of full history', async () => {
  const mock = createMockLlmFetch()

  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '2'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'
  process.env.CONVERSATION_DATA_DIR = answerDataDir
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
  process.env.LLM_MODEL = 'context-test-model'
  process.env.LLM_REASONING_ENABLED = 'false'
  process.env.DEEPSEEK_API_KEY = 'context-test-key'

  try {
    const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
    const { importConversation } = await import('../../server/utils/conversationStore.ts')
    const conversation = makeConversation([
      user('OLD_USER_SHOULD_NOT_REACH_MODEL'),
      assistant('OLD_ASSISTANT_SHOULD_NOT_REACH_MODEL'),
      user('KEEP_USER_REACHES_MODEL'),
      assistant('KEEP_ASSISTANT_REACHES_MODEL')
    ])
    await importConversation(conversation, 'overwrite')
    const answer = await generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: 'CURRENT_REACHES_MODEL',
      signal: new AbortController().signal,
      onDelta: () => {}
    })
    const requestBody = mock.requests[0] as { messages: PromptMessage[] }
    const content = promptContent(requestBody.messages)

    assert.equal(answer.content, 'managed context ok')
    assert(!content.includes('OLD_USER_SHOULD_NOT_REACH_MODEL'))
    assert(!content.includes('OLD_ASSISTANT_SHOULD_NOT_REACH_MODEL'))
    assert(content.includes('KEEP_USER_REACHES_MODEL'))
    assert(content.includes('KEEP_ASSISTANT_REACHES_MODEL'))
    assert(content.includes('CURRENT_REACHES_MODEL'))
  } finally {
    mock.restore()
  }
})

test('generateConversationAnswer reuses managed context for the tool-result answer stage', async () => {
  const mock = createMockLlmFetch()

  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '2'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'
  process.env.CONVERSATION_DATA_DIR = answerDataDir
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
  process.env.LLM_MODEL = 'context-test-model'
  process.env.LLM_REASONING_ENABLED = 'false'
  process.env.DEEPSEEK_API_KEY = 'context-test-key'

  try {
    const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
    const { importConversation } = await import('../../server/utils/conversationStore.ts')
    const conversation = makeConversation([
      user('TOOL_OLD_USER_SHOULD_NOT_REACH_MODEL'),
      assistant('TOOL_OLD_ASSISTANT_SHOULD_NOT_REACH_MODEL'),
      user('TOOL_KEEP_USER_REACHES_MODEL'),
      assistant('TOOL_KEEP_ASSISTANT_REACHES_MODEL')
    ])
    await importConversation(conversation, 'overwrite')
    const answer = await generateConversationAnswer({
      conversation,
      conversationId: conversation.id,
      question: 'TOOL_MANAGED_CONTEXT CURRENT_REACHES_MODEL',
      signal: new AbortController().signal,
      onDelta: () => {}
    })
    const firstRequestBody = mock.requests[0] as { messages: PromptMessage[] }
    const answerRequestBody = mock.requests[1] as { messages: PromptMessage[] }
    const firstRequestContent = promptContent(firstRequestBody.messages)
    const answerRequestContent = promptContent(answerRequestBody.messages)

    assert.equal(answer.content, 'tool answer ok')
    assert(!firstRequestContent.includes('TOOL_OLD_USER_SHOULD_NOT_REACH_MODEL'))
    assert(!answerRequestContent.includes('TOOL_OLD_USER_SHOULD_NOT_REACH_MODEL'))
    assert(!answerRequestContent.includes('TOOL_OLD_ASSISTANT_SHOULD_NOT_REACH_MODEL'))
    assert(answerRequestContent.includes('TOOL_KEEP_USER_REACHES_MODEL'))
    assert(answerRequestContent.includes('TOOL_KEEP_ASSISTANT_REACHES_MODEL'))
    assert(answerRequestContent.includes('TOOL_MANAGED_CONTEXT CURRENT_REACHES_MODEL'))
    assert(answerRequestBody.messages.some((message) => message.role === 'tool' && message.content === 'unknown tool'))
  } finally {
    mock.restore()
  }
})
