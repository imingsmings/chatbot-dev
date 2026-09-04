import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, test } from 'bun:test'

const dataDir = await mkdtemp(path.join(tmpdir(), 'chatbot-attachments-'))
const originalEnv = { ...process.env }

process.env.CONVERSATION_DATA_DIR = dataDir
process.env.CONVERSATION_STORE = 'file'

const {
  AttachmentError,
  checkAttachmentStorageHealth,
  cleanupOrphanedAttachments,
  createImageAttachment,
  deleteConversationAttachment,
  getConversationAttachment,
  inspectImage,
  materializePromptAttachments,
  resolveConversationAttachments,
} = await import('../../bun-server/services/attachmentService.ts')
const { createNewConversation } = await import('../../bun-server/services/conversationService.ts')
const { appendMessages } = await import('../../bun-server/utils/conversationStore.ts')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZP4sAAAAASUVORK5CYII=',
  'base64',
)

const JPEG_3X2 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
])
const WEBP_4X5 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
  0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x03, 0x00, 0x00, 0x04, 0x00, 0x00,
])

afterAll(async () => {
  process.env = originalEnv
  await rm(dataDir, { recursive: true, force: true })
})

test('attachment storage validates actual bytes and materializes Base64 only for model calls', async () => {
  const conversation = await createNewConversation('Attachment service')
  const attachment = await createImageAttachment(conversation.id, {
    buffer: PNG_1X1,
    filename: '../tiny.png',
    mediaType: 'image/png',
    detail: 'original',
  })

  assert.deepEqual(inspectImage(PNG_1X1), {
    mediaType: 'image/png',
    width: 1,
    height: 1,
  })
  assert.deepEqual(inspectImage(JPEG_3X2), {
    mediaType: 'image/jpeg',
    width: 3,
    height: 2,
  })
  assert.deepEqual(inspectImage(WEBP_4X5), {
    mediaType: 'image/webp',
    width: 4,
    height: 5,
  })
  assert.equal(attachment.filename, 'tiny.png')
  assert.equal(attachment.byteSize, PNG_1X1.length)
  assert.equal(attachment.detail, 'original')

  const stored = await getConversationAttachment(conversation.id, attachment.id)
  assert.deepEqual(stored.data, PNG_1X1)
  const prompt = await materializePromptAttachments(conversation.id, [{
    role: 'user',
    content: '识别图片',
    attachments: [attachment],
  }])
  assert.deepEqual(prompt[0]?.content, [
    { type: 'text', text: '识别图片' },
    {
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
        detail: 'original',
      },
    },
  ])
})

test('attachment storage rejects spoofed media, duplicates, cross-conversation access and sent deletion', async () => {
  const source = await createNewConversation('Attachment source')
  const other = await createNewConversation('Attachment other')

  await assert.rejects(
    createImageAttachment(source.id, {
      buffer: PNG_1X1,
      filename: 'spoof.jpg',
      mediaType: 'image/jpeg',
    }),
    (error: unknown) => error instanceof AttachmentError && /实际内容不一致/.test(error.message),
  )
  await assert.rejects(
    createImageAttachment(source.id, {
      buffer: Buffer.from('not an image'),
      filename: 'fake.png',
      mediaType: 'image/png',
    }),
    /只支持实际内容/,
  )

  const attachment = await createImageAttachment(source.id, {
    buffer: PNG_1X1,
    filename: 'owned.png',
    mediaType: 'image/png',
  })
  await assert.rejects(
    getConversationAttachment(other.id, attachment.id),
    (error: unknown) => error instanceof AttachmentError && error.status === 404,
  )
  await assert.rejects(
    resolveConversationAttachments(source.id, [attachment.id, attachment.id]),
    /不能重复/,
  )

  await appendMessages(source.id, [{
    role: 'user',
    content: '',
    attachments: [attachment],
  }])
  await assert.rejects(
    deleteConversationAttachment(source.id, attachment.id),
    (error: unknown) => error instanceof AttachmentError && error.status === 409,
  )
})

test('orphan cleanup removes only expired unreferenced attachments and storage stays writable', async () => {
  const conversation = await createNewConversation('Attachment cleanup')
  const orphan = await createImageAttachment(conversation.id, {
    buffer: PNG_1X1,
    filename: 'orphan.png',
    mediaType: 'image/png',
  })

  assert.equal(await cleanupOrphanedAttachments({ now: Date.now(), ttlMs: 60_000 }), 0)
  assert((await cleanupOrphanedAttachments({ now: Date.now() + 1, ttlMs: 0 })) >= 1)
  await assert.rejects(getConversationAttachment(conversation.id, orphan.id), /附件不存在/)
  await checkAttachmentStorageHealth()
})
