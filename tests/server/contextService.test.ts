import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { buildContextPreview } from '../../server/services/contextDebugService.ts'
import { buildContextMessages } from '../../server/services/contextService.ts'
import { assertToolContinuationWithinBudget } from '../../server/services/contextBudgetService.ts'
import type {
  Conversation,
  ImageAttachment,
  PromptMessage,
  StoredMessage,
} from '../../server/types/conversation.ts'

const originalFetch = globalThis.fetch
const answerDataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-context-answer-tests-'))
const originalEnv = {
  CONTEXT_MAX_HISTORY_MESSAGES: process.env.CONTEXT_MAX_HISTORY_MESSAGES,
  CONTEXT_MAX_HISTORY_CHARS: process.env.CONTEXT_MAX_HISTORY_CHARS,
  DEEPSEEK_CONTEXT_WINDOW_TOKENS: process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS,
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

function image(id: string, byteSize = 100): ImageAttachment {
  return {
    id: `att_00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    kind: 'image',
    filename: `${id}.png`,
    mediaType: 'image/png',
    byteSize,
    width: 1,
    height: 1,
    detail: 'auto',
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

afterEach(() => {
  if (originalEnv.DEEPSEEK_CONTEXT_WINDOW_TOKENS === undefined) {
    delete process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS
  } else {
    process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = originalEnv.DEEPSEEK_CONTEXT_WINDOW_TOKENS
  }
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
  assert.equal(result.summaryCoveredMessages, 0)
  assert.equal(result.postSummaryMessages, 8)
  assert.deepEqual(result.selectedHistoryRange, { start: 5, end: 8 })
  assert.equal(result.selectedHistoryChars, 'MSG_4MSG_5MSG_6MSG_7'.length)
  assert(!content.includes('MSG_3'))
  assert(content.includes('MSG_4'))
  assert(content.includes('MSG_7'))
  assert(content.includes('CURRENT_QUESTION'))
})

test('buildContextMessages sends only messages after the summary coverage boundary', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const conversation = makeConversation([
    user('SUMMARY_SOURCE_USER'),
    assistant('SUMMARY_SOURCE_ASSISTANT'),
    user('AFTER_SUMMARY_USER'),
    assistant('AFTER_SUMMARY_ASSISTANT')
  ])
  conversation.summary = {
    content: 'SUMMARY_CONTENT',
    sourceMessageCount: 2,
    updatedAt: '2026-05-26T00:00:00.000Z'
  }

  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.summaryIncluded, true)
  assert.equal(result.summaryCoveredMessages, 2)
  assert.equal(result.postSummaryMessages, 2)
  assert.equal(result.selectedHistoryMessages, 2)
  assert.equal(result.droppedHistoryMessages, 0)
  assert.deepEqual(result.selectedHistoryRange, { start: 3, end: 4 })
  assert(content.includes('SUMMARY_CONTENT'))
  assert(!content.includes('SUMMARY_SOURCE_USER'))
  assert(!content.includes('SUMMARY_SOURCE_ASSISTANT'))
  assert(content.includes('AFTER_SUMMARY_USER'))
  assert(content.includes('AFTER_SUMMARY_ASSISTANT'))
})

test('buildContextMessages safely clamps summary coverage beyond imported history', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const conversation = makeConversation([
    user('OLD_BACKUP_USER'),
    assistant('OLD_BACKUP_ASSISTANT')
  ])
  conversation.summary = {
    content: 'OLD_BACKUP_SUMMARY',
    sourceMessageCount: 999,
    updatedAt: '2026-05-26T00:00:00.000Z'
  }

  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.summaryCoveredMessages, 2)
  assert.equal(result.postSummaryMessages, 0)
  assert.equal(result.selectedHistoryMessages, 0)
  assert.equal(result.droppedHistoryMessages, 0)
  assert.equal(result.selectedHistoryRange, null)
  assert(content.includes('OLD_BACKUP_SUMMARY'))
  assert(!content.includes('OLD_BACKUP_USER'))
  assert(!content.includes('OLD_BACKUP_ASSISTANT'))
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

test('buildContextMessages excludes stopped assistant bodies without counting them as budget drops', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'

  const conversation = makeConversation([
    user('STOP_CONTEXT_USER'),
    { role: 'assistant', content: 'STOPPED_BODY_MUST_NOT_REACH_MODEL', status: 'stopped' },
    user('NEXT_CONTEXT_USER'),
    { role: 'assistant', content: 'COMPLETED_BODY_REACHES_MODEL', status: 'completed' }
  ])
  const result = buildContextMessages(conversation, 'CURRENT_QUESTION')
  const content = promptContent(result.messages)

  assert.equal(result.postSummaryMessages, 4)
  assert.equal(result.excludedStoppedMessages, 1)
  assert.equal(result.selectedHistoryMessages, 3)
  assert.equal(result.droppedHistoryMessages, 0)
  assert.deepEqual(result.selectedHistoryRange, { start: 1, end: 4 })
  assert(!content.includes('STOPPED_BODY_MUST_NOT_REACH_MODEL'))
  assert(content.includes('STOP_CONTEXT_USER'))
  assert(content.includes('COMPLETED_BODY_REACHES_MODEL'))
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

test('provider-aware budget conservatively distinguishes UTF-8 Chinese from ASCII input', () => {
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '5000'
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '10000'

  const ascii = buildContextMessages(makeConversation([]), 'a'.repeat(2000), {
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      maxTokens: 200,
    },
    tools: [],
  })
  assert.equal(ascii.tokenBudget.overflowTokens, 0)
  assert(ascii.tokenBudget.breakdown.currentQuestion < 3000)

  assert.throws(
    () => buildContextMessages(makeConversation([]), '中'.repeat(2000), {
      modelOptions: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        maxTokens: 200,
      },
      tools: [],
    }),
    /context.*5000|上下文上限 5000/,
  )
})

test('provider-aware budget resolves the selected OpenAI model profile', () => {
  const result = buildContextMessages(makeConversation([user('OPENAI_HISTORY')]), 'OPENAI_CURRENT', {
    modelOptions: {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      maxTokens: 1000,
    },
    tools: [],
  })

  assert.equal(result.tokenBudget.provider, 'openai')
  assert.equal(result.tokenBudget.estimator, 'openai-utf8-conservative-v1')
  assert.equal(result.tokenBudget.contextWindowTokens, 400000)
  assert.equal(result.tokenBudget.outputReserveTokens, 1000)
  assert(result.tokenBudget.totalTokens <= result.tokenBudget.contextWindowTokens)
})

test('provider-aware budget trims the oldest history until input plus output reserve fits', () => {
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '4000'
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '10000'
  const conversation = makeConversation([
    user(`OLDEST_${'a'.repeat(1200)}`),
    assistant(`MIDDLE_${'b'.repeat(1200)}`),
    user(`LATEST_${'c'.repeat(1200)}`),
  ])

  const result = buildContextMessages(conversation, 'CURRENT', {
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      maxTokens: 500,
    },
    tools: [],
  })
  const content = promptContent(result.messages)

  assert.equal(result.legacyDroppedHistoryMessages, 0)
  assert.equal(result.tokenDroppedHistoryMessages, 1)
  assert.equal(result.selectedHistoryMessages, 2)
  assert(!content.includes('OLDEST_'))
  assert(content.includes('MIDDLE_'))
  assert(content.includes('LATEST_'))
  assert(result.tokenBudget.totalTokens <= result.tokenBudget.contextWindowTokens)
  assert.equal(
    result.tokenBudget.remainingInputTokens,
    result.tokenBudget.contextWindowTokens - result.tokenBudget.totalTokens,
  )
})

test('provider-aware budget drops an oversized summary without reopening its coverage boundary', () => {
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '2500'
  const conversation = makeConversation([
    user('SUMMARY_SOURCE_USER'),
    assistant('SUMMARY_SOURCE_ASSISTANT'),
    user('LATEST_USER'),
  ])
  conversation.summary = {
    content: '摘要'.repeat(1000),
    sourceMessageCount: 2,
    updatedAt: '2026-08-29T00:00:00.000Z',
  }

  const result = buildContextMessages(conversation, 'CURRENT', {
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      maxTokens: 300,
    },
    tools: [],
  })
  const content = promptContent(result.messages)

  assert.equal(result.summaryCoveredMessages, 2)
  assert.equal(result.summaryIncluded, false)
  assert.equal(result.summaryDroppedByTokenBudget, true)
  assert(!content.includes('SUMMARY_SOURCE_USER'))
  assert(!content.includes('SUMMARY_SOURCE_ASSISTANT'))
  assert(content.includes('LATEST_USER'))
  assert(result.tokenBudget.totalTokens <= result.tokenBudget.contextWindowTokens)
})

test('provider-aware image budget keeps current images and removes oversized historical images first', () => {
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '5000'
  const historical = {
    ...image('8', 6 * 1024 * 1024),
    width: 4096,
    height: 4096,
    detail: 'original' as const,
  }
  const current = {
    ...image('9', 1000),
    width: 500,
    height: 500,
  }
  const conversation = makeConversation([{ ...user('history'), attachments: [historical] }])

  const result = buildContextMessages(conversation, 'current', {
    currentAttachments: [current],
    includeImages: true,
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      maxTokens: 500,
    },
    tools: [],
  })

  assert.equal(result.selectedImages, 1)
  assert.equal(result.droppedImages, 1)
  assert.equal(result.messages.at(-1)?.attachments?.[0]?.id, current.id)
  assert(result.messages.some((message) => message.content?.includes('图片预算未发送')))
  assert(result.tokenBudget.totalTokens <= result.tokenBudget.contextWindowTokens)
})

test('chat orchestration rejects an oversized fixed input before calling the provider', async () => {
  const mock = createMockLlmFetch()
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '5000'
  process.env.CONVERSATION_DATA_DIR = answerDataDir
  process.env.LLM_PROVIDER = 'deepseek'
  process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
  process.env.DEEPSEEK_API_KEY = 'context-test-key'

  try {
    const { generateConversationAnswer } = await import('../../server/services/chatService.ts')
    const { importConversation } = await import('../../server/utils/conversationStore.ts')
    const conversation = {
      ...makeConversation([]),
      id: 'conv_context_budget_preflight',
    }
    await importConversation(conversation, 'overwrite')

    await assert.rejects(
      generateConversationAnswer({
        conversation,
        conversationId: conversation.id,
        question: '中'.repeat(2000),
        signal: new AbortController().signal,
        onDelta: () => {},
        modelOptions: {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          maxTokens: 200,
        },
      }),
      /上下文上限 5000/,
    )
    assert.equal(mock.requests.length, 0)
  } finally {
    mock.restore()
  }
})

test('tool continuation rechecks actual tool calls and results against the same model budget', () => {
  process.env.DEEPSEEK_CONTEXT_WINDOW_TOKENS = '5000'
  const context = buildContextMessages(makeConversation([]), 'calculate', {
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      maxTokens: 500,
    },
  })
  const firstResponse = {
    provider: 'deepseek' as const,
    model: 'deepseek-v4-pro',
    content: '',
    reasoningContent: '',
    toolCalls: [{
      id: 'call-budget',
      type: 'function' as const,
      function: { name: 'calculate', arguments: '{"expression":"1+1"}' },
    }],
  }

  const estimate = assertToolContinuationWithinBudget({
    config: context.tokenBudget,
    baseEstimate: context.tokenBudget,
    firstResponse,
    toolResults: [{
      id: 'call-budget',
      function: 'calculate',
      args: { expression: '1+1' },
      result: '2',
    }],
  })
  assert.equal(estimate.overflowTokens, 0)
  assert(estimate.breakdown.toolContinuationReserve < context.tokenBudget.toolContinuationReserveTokens)

  assert.throws(() => assertToolContinuationWithinBudget({
    config: context.tokenBudget,
    baseEstimate: context.tokenBudget,
    firstResponse,
    toolResults: [{
      id: 'call-budget',
      function: 'calculate',
      args: { expression: '1+1' },
      result: 'x'.repeat(5000),
    }],
  }), /上下文上限 5000/)
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
  assert.equal(preview.stats.summaryCoveredMessages, 0)
  assert.equal(preview.stats.postSummaryMessages, 3)
  assert.equal(preview.stats.excludedStoppedMessages, 0)
  assert.equal(preview.stats.selectedHistoryMessages, 2)
  assert.equal(preview.stats.droppedHistoryMessages, 1)
  assert.equal(preview.stats.legacyDroppedHistoryMessages, 1)
  assert.equal(preview.stats.tokenDroppedHistoryMessages, 0)
  assert.deepEqual(preview.stats.selectedHistoryRange, { start: 2, end: 3 })
  assert.equal(preview.stats.maxHistoryMessages, 2)
  assert.equal(preview.model.model, 'deepseek-v4-pro')
  assert.equal(preview.model.contextWindowTokens, 131072)
  assert.equal(preview.model.apiKeyConfigured, true)
  assert.equal(preview.model.reasoningEffort, 'medium')
  assert.equal(preview.tools.count, 3)
  assert.equal(preview.stats.estimator, 'deepseek-utf8-conservative-v1')
  assert.equal(
    preview.stats.estimatedTotalTokens,
    preview.stats.estimatedInputTokens + preview.stats.outputReserveTokens,
  )
  assert(preview.stats.estimatedTotalTokens <= preview.stats.contextWindowTokens)
  assert(preview.stats.tokenBreakdown.tools > 0)
  assert(preview.stats.tokenBreakdown.toolContinuationReserve > 0)
  assert(!serializedPreview.includes('context-preview-secret'))
  assert(!content.includes('PREVIEW_OLD_SHOULD_DROP'))
  assert(content.includes('PREVIEW_KEEP_ASSISTANT'))
  assert(content.includes('PREVIEW_KEEP_USER'))
  assert(content.includes('PREVIEW_CURRENT_QUESTION'))
})

test('image context gives current images priority and caps historical image occurrences', () => {
  process.env.CONTEXT_MAX_HISTORY_MESSAGES = '20'
  process.env.CONTEXT_MAX_HISTORY_CHARS = '1000'
  const repeated = image('1', 10)
  const conversation = makeConversation([
    { ...user('oldest'), attachments: [repeated, image('2', 20)] },
    { ...assistant('middle') },
    { ...user('latest'), attachments: [repeated, image('3', 30)] },
  ])
  const current = [image('4', 40), image('5', 50)]
  const result = buildContextMessages(conversation, 'current', {
    currentAttachments: current,
    includeImages: true,
  })
  const userMessages = result.messages.filter((message) => message.role === 'user')
  const attachmentBlocks = userMessages.flatMap((message) => message.attachments ?? [])

  assert.equal(result.selectedImages, 4)
  assert.equal(result.droppedImages, 2)
  assert.equal(result.selectedImageBytes, 130)
  assert.deepEqual(attachmentBlocks.map(({ id }) => id), [repeated.id, image('3').id, image('4').id, image('5').id])
  assert(result.messages.some((message) => message.content?.includes('图片预算未发送')))
})

test('text context strips image metadata while Vision preview includes current images', () => {
  const historical = image('6', 60)
  const current = image('7', 70)
  const conversation = makeConversation([{
    ...user('history'),
    attachments: [historical],
  }])

  const textContext = buildContextMessages(conversation, 'current', {
    currentAttachments: [current],
    includeImages: false,
  })
  assert.equal(textContext.selectedImages, 0)
  assert.equal(textContext.droppedImages, 2)
  assert(textContext.messages.every((message) => !message.attachments?.length))
  assert(textContext.messages.some((message) => message.content?.includes('历史图片未发送')))

  const preview = buildContextPreview(conversation, 'current', {
    provider: 'deepseek',
    model: 'deepseek-v4-flash-vision-exp',
  }, [current])
  assert.equal(preview.stats.selectedImages, 2)
  assert.equal(preview.stats.droppedImages, 0)
  assert.equal(preview.stats.selectedImageBytes, 130)
  assert.equal(preview.messages.at(-1)?.attachments?.[0]?.id, current.id)
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
