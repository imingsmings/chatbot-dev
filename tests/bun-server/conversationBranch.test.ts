import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, test } from 'bun:test'
import {
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_QUESTION_LENGTH,
} from '../../bun-server/config/productLimits.ts'
import type { Conversation } from '../../bun-server/types/conversation.ts'
import { startBunTestServer, type BunTestServer } from './helpers/bunTestServer.ts'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-branch-file-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

const { createApp } = await import('../../bun-server/app.ts')
const {
  getConversation,
  importConversation,
  listConversations,
} = await import('../../bun-server/utils/conversationStore.ts')

let origin = ''
let server: BunTestServer

function sourceConversation(id: string): Conversation {
  return {
    id,
    title: '分支测试会话'.padEnd(MAX_CONVERSATION_TITLE_LENGTH, '长'),
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:01:00.000Z',
    titleManuallyEdited: true,
    modelOptions: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      maxTokens: 4096,
    },
    messages: [
      { role: 'user', content: '第一问' },
      {
        role: 'assistant',
        content: '第一答',
        reasoningContent: '第一轮推理',
        reasoningDurationMs: 18,
        status: 'completed',
        generation: {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          finishReason: 'stop',
          totalDurationMs: 36,
          usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
        },
        toolTrace: [{
          name: 'calculate',
          success: true,
          durationMs: 2,
          summary: '计算结果：42',
        }],
      },
      { role: 'user', content: '第二问' },
      { role: 'assistant', content: '第二答', status: 'stopped' },
    ],
    summary: {
      content: '原会话摘要',
      sourceMessageCount: 4,
      updatedAt: '2026-08-12T00:02:00.000Z',
    },
  }
}

async function postBranch(id: string, body: unknown) {
  return fetch(`${origin}/api/conversations/${encodeURIComponent(id)}/branches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  const app = createApp({
    validateRuntime: false,
    clientHosting: { enabled: false, distDir: '' },
  })
  server = startBunTestServer(app)
  origin = server.origin
})

afterAll(async () => {
  await server.close()
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('branch API copies only the prefix before the target user message', async () => {
  const source = sourceConversation('conv_branch_file_source')
  assert.equal((await importConversation(source, 'skip')).status, 'created')
  const originalBefore = await getConversation(source.id)

  const response = await postBranch(source.id, {
    messageIndex: 2,
    question: '编辑后的第二问',
  })
  assert.equal(response.status, 201)
  const payload = await response.json() as { conversation: Conversation }
  const branch = payload.conversation

  assert.notEqual(branch.id, source.id)
  assert.equal(branch.title.length, MAX_CONVERSATION_TITLE_LENGTH)
  assert.match(branch.title, /（分支）$/)
  assert.equal(branch.titleManuallyEdited, true)
  assert(originalBefore)
  assert.deepEqual(
    branch.messages,
    JSON.parse(JSON.stringify(originalBefore.messages.slice(0, 2))),
  )
  assert.equal(branch.summary, undefined)
  assert.deepEqual(branch.modelOptions, source.modelOptions)
  assert.deepEqual(await getConversation(source.id), originalBefore)
  const persistedBranch = await getConversation(branch.id)
  assert(persistedBranch)
  assert.deepEqual(persistedBranch.messages, originalBefore.messages.slice(0, 2))
  assert.deepEqual(JSON.parse(JSON.stringify(persistedBranch)), branch)

  const repeatedResponse = await postBranch(branch.id, {
    messageIndex: 0,
    question: '再次分支',
  })
  assert.equal(repeatedResponse.status, 201)
  const repeatedPayload = await repeatedResponse.json() as { conversation: Conversation }
  assert.equal(repeatedPayload.conversation.title, branch.title)
  assert.equal(repeatedPayload.conversation.messages.length, 0)
  assert.deepEqual(await getConversation(branch.id), persistedBranch)
})

test('branch API rejects invalid targets atomically', async () => {
  const source = sourceConversation('conv_branch_file_validation')
  assert.equal((await importConversation(source, 'skip')).status, 'created')
  const originalBefore = await getConversation(source.id)
  const initialCount = (await listConversations()).length
  const cases = [
    { id: 'conv_missing_branch', body: { messageIndex: 0, question: '问题' }, status: 404 },
    { id: source.id, body: { messageIndex: 1, question: '问题' }, status: 400 },
    { id: source.id, body: { messageIndex: 99, question: '问题' }, status: 400 },
    { id: source.id, body: { messageIndex: -1, question: '问题' }, status: 400 },
    { id: source.id, body: { messageIndex: 0.5, question: '问题' }, status: 400 },
    { id: source.id, body: { messageIndex: 0, question: '   ' }, status: 400 },
    {
      id: source.id,
      body: { messageIndex: 0, question: 'q'.repeat(MAX_QUESTION_LENGTH + 1) },
      status: 400,
    },
  ]

  for (const scenario of cases) {
    const response = await postBranch(scenario.id, scenario.body)
    assert.equal(response.status, scenario.status)
  }

  assert.equal((await listConversations()).length, initialCount)
  assert.deepEqual(await getConversation(source.id), originalBefore)
})
