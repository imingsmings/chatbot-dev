import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-store-reliability-'))
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'
process.env.LLM_PROVIDER = 'deepseek'
process.env.LLM_ENDPOINT = 'http://mock.local/chat/completions'
process.env.LLM_MODEL = 'store-reliability-model'
process.env.DEEPSEEK_API_KEY = 'store-reliability-key'

after(async () => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

const {
  appendMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} = await import('../../server/utils/conversationStore.ts')
const { generateConversationAnswer } = await import('../../server/services/chatService.ts')

test('file store serializes concurrent mutations without losing messages', async () => {
  const conversation = await createConversation('Concurrent writes')
  const contents = Array.from({ length: 40 }, (_, index) => `message-${index}`)

  await Promise.all(
    contents.map((content) => appendMessages(conversation.id, [{ role: 'user', content }])),
  )

  const stored = await getConversation(conversation.id)
  assert.equal(stored?.messages.length, contents.length)
  assert.deepEqual(
    new Set(stored?.messages.map((message) => message.content)),
    new Set(contents),
  )

  const files = await readdir(path.join(dataDir, 'file', 'conversations'))
  assert.equal(files.some((name) => name.endsWith('.tmp')), false)
})

test('file identity wins over corrupt payload ids and invalid timestamps are normalized', async () => {
  const conversationsDir = path.join(dataDir, 'file', 'conversations')
  await mkdir(conversationsDir, { recursive: true })
  await writeFile(
    path.join(conversationsDir, 'conv_identity.json'),
    JSON.stringify({
      id: 'conv_wrong_identity',
      title: 'Identity test',
      createdAt: 'not-a-date',
      updatedAt: 'also-invalid',
      titleManuallyEdited: true,
      messages: [],
      summary: {
        content: 'summary',
        sourceMessageCount: 0,
        updatedAt: 'invalid-summary-date',
      },
    }),
    'utf8',
  )

  const stored = await getConversation('conv_identity')
  assert.equal(stored?.id, 'conv_identity')
  assert.equal(Number.isNaN(Date.parse(stored?.createdAt ?? '')), false)
  assert.equal(Number.isNaN(Date.parse(stored?.updatedAt ?? '')), false)
  assert.equal(Number.isNaN(Date.parse(stored?.summary?.updatedAt ?? '')), false)
  assert.equal(await getConversation('conv_wrong_identity'), null)
})

test('a malformed JSON file does not make valid conversations unavailable', async () => {
  const valid = await createConversation('Valid beside malformed')
  const conversationsDir = path.join(dataDir, 'file', 'conversations')
  await writeFile(path.join(conversationsDir, 'conv_malformed.json'), '{not-json', 'utf8')
  await writeFile(
    path.join(conversationsDir, 'invalid-file-name.json'),
    JSON.stringify({ id: 'conv_invalid_filename_payload', title: 'Must stay hidden', messages: [] }),
    'utf8',
  )

  const summaries = await listConversations()
  assert(summaries.some((conversation) => conversation.id === valid.id))
  assert.equal(summaries.some((conversation) => conversation.id === 'conv_malformed'), false)
  assert.equal(
    summaries.some((conversation) => conversation.id === 'conv_invalid_filename_payload'),
    false,
  )
})

test('completed model output reports an error when its conversation was deleted before persistence', async () => {
  const conversation = await createConversation('Delete during response')
  globalThis.fetch = async () => {
    await deleteConversation(conversation.id)
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'late answer' } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }

  try {
    await assert.rejects(
      generateConversationAnswer({
        conversation,
        conversationId: conversation.id,
        question: 'will this persist?',
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
      /会话已被删除，响应未保存/,
    )
    assert.equal(await getConversation(conversation.id), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
