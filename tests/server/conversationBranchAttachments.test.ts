import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-branch-attachments-'))
const originalEnv = { ...process.env }
process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

const { createImageAttachment, getConversationAttachment } = await import(
  '../../server/services/attachmentService.ts'
)
const { createConversationBranch, createNewConversation } = await import(
  '../../server/services/conversationService.ts'
)
const { appendMessages, getConversation } = await import('../../server/utils/conversationStore.ts')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

after(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('file branch copies prefix and draft attachments without mutating parent ownership', async () => {
  const source = await createNewConversation('Branch images')
  const prefixImage = await createImageAttachment(source.id, {
    buffer: PNG_1X1,
    filename: 'prefix.png',
    mediaType: 'image/png',
  })
  const draftImage = await createImageAttachment(source.id, {
    buffer: PNG_1X1,
    filename: 'draft.png',
    mediaType: 'image/png',
  })
  await appendMessages(source.id, [
    { role: 'user', content: 'prefix', attachments: [prefixImage] },
    { role: 'assistant', content: 'answer', status: 'completed' },
    { role: 'user', content: '', attachments: [draftImage] },
  ])
  const parentBefore = await getConversation(source.id)

  const result = await createConversationBranch(source.id, 2)
  assert(!('error' in result))
  const branchPrefix = result.conversation.messages[0]?.attachments?.[0]
  const branchDraft = result.draftAttachments[0]
  assert(branchPrefix && branchDraft)
  assert.notEqual(branchPrefix.id, prefixImage.id)
  assert.notEqual(branchDraft.id, draftImage.id)
  assert.equal(result.conversation.messages.length, 2)
  assert.deepEqual((await getConversation(source.id))?.messages, parentBefore?.messages)
  assert.deepEqual(
    (await getConversationAttachment(result.conversation.id, branchPrefix.id)).data,
    PNG_1X1,
  )
  assert.deepEqual(
    (await getConversationAttachment(result.conversation.id, branchDraft.id)).data,
    PNG_1X1,
  )
  await assert.rejects(
    getConversationAttachment(source.id, branchDraft.id),
    /附件不存在/,
  )
})
